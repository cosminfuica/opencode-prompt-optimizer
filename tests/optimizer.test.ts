import { afterAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { startMock } from "./mock-openai.ts"
import {
  buildJudgeMessage, buildOptimizerMessage, chat, extractTag, optimize, resolveEndpoint,
  type Endpoint, type OptimizeInput, type ProviderSource,
} from "../src/optimizer.ts"

const dir = mkdtempSync(join(tmpdir(), "po-optimizer-"))
const log = join(dir, "log.jsonl")
let failOn: (body: any) => boolean = () => false
const mock = startMock({ port: 0, log, fail: (b) => failOn(b) })
const ep: Endpoint = { baseURL: `${mock.url}v1/`, model: "mock" }
const calls = (): any[] => readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
const lastUser = (c: any) => c.body.messages.at(-1).content as string
const isJudge = (b: any) => b.messages.at(-1).content.includes("<candidate")

beforeEach(() => { writeFileSync(log, ""); failOn = () => false })
afterAll(() => { mock.stop(true); rmSync(dir, { recursive: true, force: true }) })

// one-route server that replies with a fixed chat completion (or sleeps)
function fixed(content: unknown, sleepMs = 0) {
  return Bun.serve({
    port: 0, hostname: "127.0.0.1",
    async fetch() {
      if (sleepMs) await Bun.sleep(sleepMs)
      return Response.json({ choices: [{ message: { role: "assistant", content } }] })
    },
  })
}
const user = (content: string) => [{ role: "user" as const, content }]

describe("extractTag", () => {
  test("inner text, trimmed, last non-empty occurrence, undefined when absent or empty", () => {
    expect(extractTag("x <a>\n hi \n</a> y", "a")).toBe("hi")
    expect(extractTag("<a>format</a> ... <a>real</a>", "a")).toBe("real")
    expect(extractTag("<a>real</a> echo: <a></a> <a> \n </a>", "a")).toBe("real")
    expect(extractTag("<a>\n</a>", "a")).toBeUndefined()
    expect(extractTag("<a>cut off", "a")).toBeUndefined()
    expect(extractTag("<A>no</A>", "a")).toBeUndefined()
  })
})

describe("message builders", () => {
  test("exact formats", () => {
    expect(buildOptimizerMessage("P", "a/b")).toBe("<target_model>a/b</target_model>\n<original_prompt>\nP\n</original_prompt>")
    expect(buildOptimizerMessage("P", "a/b", "Q")).toBe(
      "<target_model>a/b</target_model>\n<original_prompt>\nP\n</original_prompt>\n<previous_attempt>\nQ\n</previous_attempt>\n" +
      "Improve on the previous attempt. If it cannot be meaningfully improved, return it unchanged.")
    expect(buildJudgeMessage("P", "a/b", ["x", "y"])).toBe(
      "<target_model>a/b</target_model>\n<original_prompt>\nP\n</original_prompt>\n" +
      '<candidate index="1">\nx\n</candidate>\n<candidate index="2">\ny\n</candidate>')
  })
})

describe("chat", () => {
  test("string content, body merge, no auth without apiKey", async () => {
    const out = await chat(ep, user("hello"), { timeoutMs: 5000, body: { temperature: 0.2, stream: false } })
    expect(out).toBe("MOCK REPLY")
    const [c] = calls()
    expect(c.path).toBe("/v1/chat/completions")
    expect(c.auth).toBeNull()
    expect(c.body).toEqual({ model: "mock", messages: user("hello"), stream: false, temperature: 0.2 })
  })

  test("body can't override model, messages or stream", async () => {
    await chat(ep, user("real prompt"), { timeoutMs: 5000, body: { model: "other", messages: [], stream: true, top_p: 0.5 } })
    expect(calls()[0].body).toEqual({ model: "mock", messages: user("real prompt"), stream: false, top_p: 0.5 })
  })

  test("Authorization header when apiKey is set", async () => {
    await chat({ ...ep, apiKey: "sk-test" }, user("hi"), { timeoutMs: 5000 })
    expect(calls()[0].auth).toBe("Bearer sk-test")
  })

  test("array content and <think> stripping", async () => {
    const s = fixed([{ type: "text", text: "<think>hmm\nlong</think>  ans" }, { type: "text", text: "wer " }])
    try { expect(await chat({ baseURL: s.url.href, model: "m" }, user("x"), { timeoutMs: 5000 })).toBe("answer") }
    finally { s.stop(true) }
  })

  test("empty content throws", async () => {
    const s = fixed("<think>only thoughts</think>  ")
    try { await expect(chat({ baseURL: s.url.href, model: "m" }, user("x"), { timeoutMs: 5000 })).rejects.toThrow("empty") }
    finally { s.stop(true) }
  })

  test("non-2xx throws with status + body snippet, never the key", async () => {
    failOn = () => true
    const err = await chat({ ...ep, apiKey: "sk-secret" }, user("x"), { timeoutMs: 5000 }).catch((e) => e)
    expect(err.message).toContain("500")
    expect(err.message).toContain("mock failure")
    expect(err.message).not.toContain("sk-secret")
  })

  test("timeout is readable", async () => {
    const s = fixed("late", 2000)
    try {
      await expect(chat({ baseURL: s.url.href, model: "m" }, user("x"), { timeoutMs: 200 }))
        .rejects.toThrow("optimizer request timed out after 200ms")
    } finally { s.stop(true) }
  })

  test("a 200 that isn't JSON, and a body that stalls past the timeout, give readable errors", async () => {
    const html = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("<!doctype html>\n<html>LM Studio</html>", { headers: { "content-type": "text/html" } }) })
    const stall = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(new ReadableStream({
      async start(c) {
        c.enqueue(new TextEncoder().encode('{"choices":['))
        await Bun.sleep(1500)
        try { c.enqueue(new TextEncoder().encode("]}")); c.close() } catch {}
      },
    }), { headers: { "content-type": "application/json" } }) })
    try {
      await expect(chat({ baseURL: html.url.href, model: "m" }, user("x"), { timeoutMs: 5000 }))
        .rejects.toThrow('optimizer endpoint returned non-JSON ("<!doctype html> <html>LM Studio</html>"); is "baseURL" the …/v1 API root?')
      await expect(chat({ baseURL: stall.url.href, model: "m" }, user("x"), { timeoutMs: 300 }))
        .rejects.toThrow("optimizer request timed out after 300ms")
    } finally { html.stop(true); stall.stop(true) }
  })
})

describe("optimize", () => {
  const base: OptimizeInput = {
    endpoint: ep, system: "SYS", judgeSystem: "JUDGE", prompt: "fix the bug", target: "p/m",
    turns: 1, strategy: "parallel", timeoutMs: 5000, body: { temperature: 0 },
  }

  test("turns=1: one call, candidate extracted", async () => {
    const r = await optimize(base)
    expect(r).toMatchObject({ chosen: 0, judged: false })
    expect(r.prompt).toMatch(/^OPTIMIZED#\d+: fix the bug$/)
    expect(r.candidates).toEqual([r.prompt])
    const cs = calls()
    expect(cs.length).toBe(1)
    expect(cs[0].body.messages[0]).toEqual({ role: "system", content: "SYS" })
    expect(cs[0].body.temperature).toBe(0)
  })

  test("parallel turns=3: 3 calls + 1 judge, judge picks last", async () => {
    const r = await optimize({ ...base, turns: 3 })
    const cs = calls()
    expect(cs.length).toBe(4)
    expect(cs.slice(0, 3).every((c) => !lastUser(c).includes("<previous_attempt>"))).toBe(true)
    expect(isJudge(cs[3].body)).toBe(true)
    expect(cs[3].body.messages[0].content).toBe("JUDGE")
    expect(r.candidates.length).toBe(3)
    expect(r).toMatchObject({ chosen: 2, judged: true, prompt: r.candidates[2] })
  })

  test("refine turns=3: sequential with previous attempts", async () => {
    const r = await optimize({ ...base, turns: 3, strategy: "refine" })
    const cs = calls()
    expect(cs.length).toBe(4)
    expect(lastUser(cs[0])).not.toContain("<previous_attempt>")
    expect(lastUser(cs[1])).toContain(`<previous_attempt>\n${r.candidates[0]}\n</previous_attempt>`)
    expect(lastUser(cs[2])).toContain(`<previous_attempt>\n${r.candidates[1]}\n</previous_attempt>`)
    expect(r.candidates.every((c) => /^OPTIMIZED#\d+: fix the bug$/.test(c))).toBe(true)
    expect(r).toMatchObject({ chosen: 2, judged: true })
  })

  test("parallel partial failure: 1 success => no judge", async () => {
    let n = 0
    failOn = (b) => !isJudge(b) && ++n <= 2
    const r = await optimize({ ...base, turns: 3 })
    expect(r).toMatchObject({ chosen: 0, judged: false })
    expect(r.candidates.length).toBe(1)
    expect(calls().length).toBe(3)
  })

  test("refine partial failure: stops refining, judges what it has", async () => {
    let n = 0
    failOn = (b) => !isJudge(b) && ++n === 3
    const r = await optimize({ ...base, turns: 4, strategy: "refine" })
    expect(r.candidates.length).toBe(2)
    expect(r).toMatchObject({ chosen: 1, judged: true })
    expect(calls().length).toBe(4) // 2 ok + 1 failed + judge
  })

  test("all fail => throws first error", async () => {
    failOn = () => true
    await expect(optimize({ ...base, turns: 3 })).rejects.toThrow("500")
    await expect(optimize({ ...base, turns: 3, strategy: "refine" })).rejects.toThrow("500")
  })

  test("judge failure falls back: parallel => first, refine => last", async () => {
    failOn = isJudge
    expect(await optimize({ ...base, turns: 3 })).toMatchObject({ chosen: 0, judged: false })
    expect(await optimize({ ...base, turns: 3, strategy: "refine" })).toMatchObject({ chosen: 2, judged: false })
  })

  test("judge reply without <best>: a bare integer is used; prose or out of range falls back", async () => {
    const s = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      async fetch(req) {
        const b: any = await req.json()
        const judge = isJudge(b)
        const content = judge ? (b.model === "oob" ? "<best>9</best>" : b.model === "prose" ? "I pick 2." : " 2\n") : "<optimized_prompt>c</optimized_prompt>"
        return Response.json({ choices: [{ message: { content } }] })
      },
    })
    try {
      const e = { baseURL: s.url.href, model: "m" }
      expect(await optimize({ ...base, endpoint: e, turns: 2 })).toMatchObject({ chosen: 1, judged: true })
      expect(await optimize({ ...base, endpoint: { ...e, model: "oob" }, turns: 2 })).toMatchObject({ chosen: 0, judged: false })
      expect(await optimize({ ...base, endpoint: { ...e, model: "prose" }, turns: 2 })).toMatchObject({ chosen: 0, judged: false })
    } finally { s.stop(true) }
  })

  describe("malformed replies never become the prompt", () => {
    const GOOD = "<optimized_prompt>\nFix the slow login page.\n</optimized_prompt>"
    const replies: Record<string, [content: string, finish_reason?: string]> = {
      refusal: ["I'm sorry, but I can't help with that request."],
      empty: ["<optimized_prompt>\n</optimized_prompt>"],
      echo: [`${GOOD}\nAs requested I used <optimized_prompt></optimized_prompt>.`],
      truncated: ["Let me think. Keep the log verbatim.\n<optimized_prompt>\nThe login page is slow. Log:\nERR db tim", "length"],
    }
    let got: any[] = []
    const s = Bun.serve({
      port: 0, hostname: "127.0.0.1",
      async fetch(req) {
        const b: any = await req.json()
        got.push(b)
        // "mixed": the first call to arrive gets a refusal, the others a good block
        const [content, finish_reason = "stop"] = b.model === "mixed" ? (got.length === 1 ? replies.refusal! : [GOOD]) : replies[b.model]!
        return Response.json({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason }] })
      },
    })
    afterAll(() => s.stop(true))
    beforeEach(() => { got = [] })
    const run = (model: string, turns = 1) => optimize({ ...base, endpoint: { baseURL: s.url.href, model }, turns })

    test("no tags (refusal) => throws", async () => {
      await expect(run("refusal")).rejects.toThrow(`no text inside <optimized_prompt> tags (reply: "I'm sorry, but I can't help`)
    })

    test("empty block => throws", async () => {
      await expect(run("empty")).rejects.toThrow("no text inside <optimized_prompt> tags")
    })

    test("good block, then an echoed empty block => the good block", async () => {
      expect(await run("echo")).toMatchObject({ prompt: "Fix the slow login page.", candidates: ["Fix the slow login page."] })
    })

    test("cut off at max_tokens (finish_reason length) => throws, suggests max_tokens", async () => {
      await expect(run("truncated")).rejects.toThrow(`cut off at the token limit; raise "max_tokens" (or "max_completion_tokens" for OpenAI reasoning models) under "body" in the plugin config`)
    })

    test("parallel turns=2, one malformed + one good => good one used, no judge call", async () => {
      expect(await run("mixed", 2)).toMatchObject({ prompt: "Fix the slow login page.", candidates: ["Fix the slow login page."], chosen: 0, judged: false })
      expect(got.length).toBe(2)
      expect(got.some(isJudge)).toBe(false)
    })
  })
})

describe("resolveEndpoint", () => {
  type Providers = NonNullable<Awaited<ReturnType<ProviderSource["config"]["providers"]>>["data"]>["providers"]
  const providers: Providers = [
    {
      id: "cli-proxy-api", key: "sk-proxy", env: [],
      options: { baseURL: "http://127.0.0.1:8318/v1", timeout: 600000, headers: { "X-P": "p", "X-Both": "p" } },
      models: { "claude-sonnet-5-fast": { id: "claude-sonnet-5-fast", api: { id: "claude-sonnet-5(none)", url: "", npm: "@ai-sdk/openai-compatible" } } },
    },
    { id: "openai", env: ["PO_TEST_OPENAI_KEY"], options: {}, models: { "gpt-x": { id: "gpt-x", api: { npm: "@ai-sdk/openai" } } } },
    { id: "direct", options: { apiKey: "opt-key" }, models: { m: { id: "m", api: { url: "https://direct/v1" } } } },
    { id: "nourl", models: { m: { id: "m", api: { npm: "@ai-sdk/unknown" } } } },
  ]
  const client = (small_model?: string): ProviderSource => ({
    config: {
      get: async () => ({ data: { small_model } }),
      providers: async () => ({ data: { providers } }),
    },
  })
  const cfg = (o: { model?: string; baseURL?: string; apiKey?: string; headers?: Record<string, string> } = {}) =>
    ({ model: undefined, baseURL: undefined, apiKey: undefined, headers: {}, ...o })

  test("custom baseURL: own key only, model required", async () => {
    expect(await resolveEndpoint(cfg({ baseURL: "http://x/v1", model: "raw", apiKey: "k", headers: { A: "1" } }), client()))
      .toEqual({ baseURL: "http://x/v1", apiKey: "k", model: "raw", headers: { A: "1" } })
    // provider-style model string with custom baseURL must not pick up provider keys
    const e = await resolveEndpoint(cfg({ baseURL: "http://x/v1", model: "cli-proxy-api/claude-sonnet-5-fast" }), client())
    expect(e.apiKey).toBeUndefined()
    await expect(resolveEndpoint(cfg({ baseURL: "http://x/v1" }), client())).rejects.toThrow('"model"')
  })

  test("provider path: api.id mapping, empty api.url => options.baseURL, headers merged", async () => {
    expect(await resolveEndpoint(cfg({ model: "cli-proxy-api/claude-sonnet-5-fast", headers: { "X-Both": "c" } }), client()))
      .toEqual({
        baseURL: "http://127.0.0.1:8318/v1", apiKey: "sk-proxy", model: "claude-sonnet-5(none)",
        headers: { "X-P": "p", "X-Both": "c" },
      })
  })

  test("small_model fallback, api.url wins, options.apiKey", async () => {
    expect(await resolveEndpoint(cfg(), client("direct/m")))
      .toMatchObject({ baseURL: "https://direct/v1", apiKey: "opt-key", model: "m" })
  })

  test("KNOWN npm map + env key fallback", async () => {
    process.env.PO_TEST_OPENAI_KEY = "env-key"
    try {
      expect(await resolveEndpoint(cfg({ model: "openai/gpt-x" }), client()))
        .toMatchObject({ baseURL: "https://api.openai.com/v1", apiKey: "env-key", model: "gpt-x" })
    } finally { delete process.env.PO_TEST_OPENAI_KEY }
  })

  test("readable errors", async () => {
    await expect(resolveEndpoint(cfg(), client())).rejects.toThrow('set "model" in the plugin config')
    await expect(resolveEndpoint(cfg({ model: "nope/m" }), client())).rejects.toThrow('"nope/m" not found in opencode providers — see `opencode models`; OAuth/subscription logins can\'t be the optimizer')
    await expect(resolveEndpoint(cfg({ model: "openai/missing" }), client())).rejects.toThrow("not found")
    await expect(resolveEndpoint(cfg({ model: "nourl/m" }), client())).rejects.toThrow('no OpenAI-compatible baseURL for provider "nourl" — set "baseURL" in the plugin config')
    await expect(resolveEndpoint(cfg({ model: "bare" }), client())).rejects.toThrow('(or set "baseURL" in the plugin config)')
    await expect(resolveEndpoint(cfg({ baseURL: "http://x/v1" }), client())).rejects.toThrow('"model" is required when "baseURL" is set in the plugin config')
  })
})

describe("review regressions (REVIEW.md)", () => {
  const O = "optimized_prompt"
  const run = async (content: string) => {
    const s = fixed(content)
    try { return (await optimize({ endpoint: { baseURL: s.url.href, model: "m" }, system: "S", judgeSystem: "J", prompt: "p", target: "a/b", turns: 1, strategy: "parallel", timeoutMs: 5000 })).prompt }
    finally { s.stop(true) }
  }
  const src = (providers: any[]) => ({ config: { get: async () => ({ data: {} }), providers: async () => ({ data: { providers } }) } }) as ProviderSource
  const endpoint = (model: string, providers: any[]) => resolveEndpoint({ model, headers: {} }, src(providers))

  test("M3 (P3): a rewrite that quotes the tag is kept whole", async () => {
    const p3 = "In extractTag, handle replies like `<optimized_prompt>x</optimized_prompt>` correctly and add a test."
    expect(await run(`<${O}>\n${p3}\n</${O}>`)).toBe(p3)
  })

  test("M3 (P8): <think> quoted inside the rewrite survives", async () => {
    const p8 = "Make parseReply drop <think>...</think> blocks before JSON.parse."
    expect(await run(`<${O}>\n${p8}\n</${O}>`)).toBe(p8)
    expect(await run(`<think>plan</think>\n<${O}>${p8}</${O}>`)).toBe(p8)
  })

  test("M3 (runtime F5): a block inside a leading or trailing <think> is ignored", async () => {
    expect(await run(`<${O}>RIGHT</${O}>\n<think>draft <${O}>WRONG</${O}></think>`)).toBe("RIGHT")
    expect(extractTag(`<think>draft <${O}>WRONG</${O}></think>\n<${O}>RIGHT</${O}>`, O)).toBe("RIGHT")
    expect(extractTag("<best>2</best><think>maybe <best>3</best></think>", "best")).toBe("2")
  })

  test("M3: a stray or unclosed <think> in chatter does not hide the answer", async () => {
    expect(await run(`I dropped the <think> tag. <${O}>X</${O}>`)).toBe("X")
    expect(await run(`reasoning</think>\n<${O}>X</${O}>`)).toBe("X")
    expect(await run(`<${O}>X</${O}> <think>`)).toBe("X")
  })

  test("m3 (P5): numbers in judge prose never pick the winner, even after a mid-reply <think>", async () => {
    for (const judge of ["Both keep the 2 file paths; the third one is clearly best.", "My analysis. <think>maybe 3</think> I prefer the second one."]) {
      const s = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(req) {
        const content = isJudge(await req.json()) ? judge : `<${O}>cand</${O}>`
        return Response.json({ choices: [{ message: { content } }] })
      } })
      try {
        expect(await optimize({ endpoint: { baseURL: s.url.href, model: "m" }, system: "S", judgeSystem: "J", prompt: "p", target: "a/b", turns: 3, strategy: "parallel", timeoutMs: 5000 }))
          .toMatchObject({ chosen: 0, judged: false })
      } finally { s.stop(true) }
    }
  })

  test("M1: a user's options.baseURL wins over the catalogue api.url", async () => {
    const p = { id: "ds", env: ["DS_KEY"], options: { baseURL: "https://gateway.example/v1" }, models: { m: { id: "m", api: { url: "https://api.vendor.example" } } } }
    expect((await endpoint("ds/m", [p])).baseURL).toBe("https://gateway.example/v1")
  })

  test("P2-5: templated URLs and catalogue URLs of non-OpenAI packages give a clear error; a user baseURL still wins", async () => {
    const cf = { id: "cf", env: [], options: {}, models: { m: { id: "m", api: { url: "https://x.example/accounts/${ACCOUNT_ID}/v1", npm: "@ai-sdk/openai-compatible" } } } }
    await expect(endpoint("cf/m", [cf])).rejects.toThrow('provider "cf" has a templated URL (https://x.example/accounts/${ACCOUNT_ID}/v1) — set "baseURL" in the plugin config')
    const mg = { id: "mg", env: [], options: {}, models: { m: { id: "m", api: { url: "https://gw.example/v1/ai-sdk", npm: "some-ai-sdk-provider" } } } }
    await expect(endpoint("mg/m", [mg])).rejects.toThrow('no OpenAI-compatible baseURL for provider "mg" — set "baseURL" in the plugin config')
    expect((await endpoint("mg/m", [{ ...mg, options: { baseURL: "https://proxy.example/v1" } }])).baseURL).toBe("https://proxy.example/v1")
  })

  test("P2-5: HTTP 404 names the URL and says what to do", async () => {
    const s = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("404 page not found", { status: 404 }) })
    try {
      await expect(chat({ baseURL: `${s.url.href}anthropic/v1`, model: "m" }, [{ role: "user", content: "x" }], { timeoutMs: 5000 }))
        .rejects.toThrow(`optimizer endpoint returned HTTP 404: 404 page not found (no OpenAI-compatible chat API at ${s.url.href}anthropic/v1/chat/completions? set "baseURL" in the plugin config)`)
    } finally { s.stop(true) }
  })

  test("M2: a key in any credential env var is found; IDs and SigV4 secrets are never sent", async () => {
    const g = { id: "g", env: ["PO_T_ACCOUNT_ID", "PO_T_API_KEY", "PO_T_ALT_API_KEY"], options: {}, models: { m: { id: "m", api: { url: "https://g.example/v1" } } } }
    const b = { id: "b", env: ["PO_T_ACCESS_KEY_ID", "PO_T_SECRET_ACCESS_KEY"], options: { baseURL: "https://proxy.example/v1" }, models: { m: { id: "m" } } }
    Object.assign(process.env, { PO_T_ACCOUNT_ID: "acct", PO_T_ALT_API_KEY: "alt-key", PO_T_ACCESS_KEY_ID: "id", PO_T_SECRET_ACCESS_KEY: "secret" })
    try {
      expect((await endpoint("g/m", [g])).apiKey).toBe("alt-key")
      delete process.env.PO_T_ALT_API_KEY
      expect((await endpoint("g/m", [g])).apiKey).toBeUndefined()
      expect((await endpoint("b/m", [b])).apiKey).toBeUndefined()
    } finally {
      for (const k of ["PO_T_ACCOUNT_ID", "PO_T_ALT_API_KEY", "PO_T_ACCESS_KEY_ID", "PO_T_SECRET_ACCESS_KEY"]) delete process.env[k]
    }
  })
})
