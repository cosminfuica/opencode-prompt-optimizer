import { describe, expect, test } from "bun:test"
import type { Config } from "../src/config.ts"
import { createHooks, newPartID, type Deps, type HookClient, type Part, type TextPart } from "../src/hooks.ts"

const LONG = "Please refactor the login handler to use async/await everywhere."

function cfg(over: Partial<Config> = {}): Config {
  return {
    enabled: true, headers: {}, body: {}, turns: 1, strategy: "parallel", timeoutMs: 60000, minChars: 20,
    skipPatterns: [/<!--\s*OMO_INTERNAL/, /^\s*\[SYSTEM DIRECTIVE/, /^\/[\w.-]+(\s|$)/],
    toast: true, prompts: {}, judgePrompt: "JUDGE", ...over,
  }
}

function setup(o: {
  config?: Partial<Config>; loadThrows?: boolean; resolveThrows?: boolean; optimizeThrows?: boolean
  parentID?: string; sessionGetThrows?: boolean; clientThrows?: boolean
} = {}) {
  const toasts: any[] = []
  const logs: any[] = []
  const calls = { optimize: [] as any[], sessionGet: 0 }
  const boom = () => { throw new Error("client down") }
  const client: HookClient = {
    session: {
      get: async () => {
        calls.sessionGet++
        if (o.sessionGetThrows) throw new Error("nope")
        return { data: o.parentID ? { parentID: o.parentID } : {} }
      },
    },
    tui: { showToast: o.clientThrows ? boom : async (x) => { toasts.push(x.body) } },
    app: { log: o.clientThrows ? async () => boom() : async (x) => { logs.push(x.body) } },
    config: { get: async () => ({}), providers: async () => ({}) },
  }
  const deps: Deps = {
    client,
    loadConfig: async () => { if (o.loadThrows) throw new Error("bad config"); return cfg(o.config) },
    selectPrompt: (_c, target) => `SYS for ${target}`,
    resolveEndpoint: async () => {
      if (o.resolveThrows) throw new Error("no endpoint")
      return { baseURL: "http://x/v1", apiKey: "sk-secret", model: "mini" }
    },
    optimize: async (input) => {
      calls.optimize.push(input)
      if (o.optimizeThrows) throw new Error("timeout")
      return { prompt: "OPTIMIZED: " + input.prompt, candidates: ["a", "OPTIMIZED"], chosen: 1, judged: true, ms: 42 }
    },
  }
  return { hooks: createHooks(deps), toasts, logs, calls }
}

const text = (t: string, extra: Partial<TextPart> = {}): TextPart =>
  ({ id: newPartID(), sessionID: "ses_1", messageID: "msg_1", type: "text", text: t, ...extra })

function msg(parts: Part[], sessionID = "ses_1") {
  const message = { id: "msg_1", sessionID, role: "user", time: { created: 1 }, agent: "build",
    model: { providerID: "anthropic", modelID: "claude-x" } } as any
  return { input: { sessionID }, output: { message, parts } }
}

async function send(h: ReturnType<typeof setup>, parts: Part[], sessionID = "ses_1") {
  const m = msg(parts, sessionID)
  const before = parts.map((p) => ({ ...p }))
  await h.hooks["chat.message"]!(m.input, m.output)
  return { parts: m.output.parts, before, same: m.output.parts === parts }
}

describe("chat.message", () => {
  test("success appends one synthetic part, user parts untouched", async () => {
    const h = setup({ config: { turns: 2 } })
    const file = { id: newPartID(), sessionID: "ses_1", messageID: "msg_1", type: "file", mime: "text/plain", url: "file:///a" } as Part
    const user = text(LONG)
    const r = await send(h, [user, file])
    expect(r.same).toBe(true)
    expect(r.parts.length).toBe(3)
    expect(r.parts.slice(0, 2)).toEqual(r.before)
    const s = r.parts[2] as TextPart
    expect(s).toMatchObject({ sessionID: "ses_1", messageID: "msg_1", type: "text", text: "OPTIMIZED: " + LONG, synthetic: true })
    expect(s.ignored).toBeUndefined()
    expect(s.id > user.id).toBe(true)
    expect(s.metadata).toEqual({ promptOptimizer: {
      version: 1, original: LONG, optimizerModel: "mini", target: "anthropic/claude-x", turns: 2,
      candidates: ["a", "OPTIMIZED"], chosen: 1, judged: true, ms: 42,
    } })
    const inp = h.calls.optimize[0]
    expect(inp).toMatchObject({ system: "SYS for anthropic/claude-x", judgeSystem: "JUDGE", prompt: LONG, target: "anthropic/claude-x", turns: 2, strategy: "parallel", timeoutMs: 60000 })
    expect(h.toasts[0]).toMatchObject({ variant: "info", title: "Prompt optimizer", message: "Optimizing with mini… (2 candidates + judge)", duration: 60000 })
    expect(h.toasts[1]).toMatchObject({ variant: "success", title: "✨ Prompt optimized", message: `OPTIMIZED: ${LONG}\n\n/optimized to view full`, duration: 8000 })
    expect(JSON.stringify(h.logs)).not.toContain("sk-secret")
  })

  test("joins multiple user text parts, ignores synthetic ones; long preview is cut", async () => {
    const h = setup()
    const long = "x".repeat(400)
    await send(h, [text("first part of it"), text("SYNTH", { synthetic: true }), text(long)])
    expect(h.calls.optimize[0].prompt).toBe("first part of it\n\n" + long)
    expect(h.toasts[0].message).toBe("Optimizing with mini…")
    const preview = h.toasts[1].message as string
    expect(preview).toBe(("OPTIMIZED: first part of it\n\n" + long).slice(0, 300) + "…\n\n/optimized to view full")
  })

  test("falls back to input.model when message.model is missing", async () => {
    const h = setup()
    const m = msg([text(LONG)])
    delete m.output.message.model
    await h.hooks["chat.message"]!({ ...m.input, model: { providerID: "openai", modelID: "gpt-9" } }, m.output)
    expect(h.calls.optimize[0].target).toBe("openai/gpt-9")
  })

  const skips: [string, Parameters<typeof setup>[0], Part[]][] = [
    ["disabled", { config: { enabled: false } }, [text(LONG)]],
    ["too short", {}, [text("  fix it   ")]],
    ["skipPattern", {}, [text("/review this whole thing please now")]],
    ["empty text", {}, [text("   ")]],
    ["synthetic-only", {}, [text(LONG, { synthetic: true })]],
    ["ignored-only", {}, [text(LONG, { ignored: true })]],
    ["child session", { parentID: "ses_parent" }, [text(LONG)]],
  ]
  for (const [name, opts, parts] of skips) {
    test(`skip: ${name}`, async () => {
      const h = setup(opts)
      const r = await send(h, parts)
      expect(r.parts).toEqual(r.before)
      expect(h.calls.optimize.length).toBe(0)
      expect(h.toasts.length).toBe(0)
    })
  }

  test("child lookup is cached; lookup error => not a child", async () => {
    const h = setup({ parentID: "p" })
    await send(h, [text(LONG)])
    await send(h, [text(LONG)])
    expect(h.calls.sessionGet).toBe(1)
    const e = setup({ sessionGetThrows: true })
    const r = await send(e, [text(LONG)])
    expect(r.parts.length).toBe(2)
  })

  test("slash-command mark skips exactly one message", async () => {
    const h = setup()
    await h.hooks["command.execute.before"]!({ command: "review", sessionID: "ses_1", arguments: "" }, { parts: [] })
    expect((await send(h, [text(LONG)])).parts.length).toBe(1)
    expect((await send(h, [text(LONG)], "ses_2")).parts.length).toBe(2)
    expect((await send(h, [text(LONG)])).parts.length).toBe(2)
  })

  for (const [name, opts] of [
    ["loadConfig throws", { loadThrows: true }],
    ["resolveEndpoint throws", { resolveThrows: true }],
    ["optimize throws", { optimizeThrows: true }],
  ] as const) {
    test(`failure: ${name} => parts unchanged + warning`, async () => {
      const h = setup({ ...opts, config: { toast: false } })
      const r = await send(h, [text(LONG)])
      expect(r.parts).toEqual(r.before)
      expect(h.toasts.length).toBe(1)
      expect(h.toasts[0]).toMatchObject({ variant: "warning", title: "Prompt optimizer", duration: 6000 })
      expect(h.toasts[0].message).toStartWith("Sent your original prompt — ")
      expect(h.logs.some((l) => l.level === "warn")).toBe(true)
    })
  }

  test("toast=false suppresses info/success", async () => {
    const h = setup({ config: { toast: false } })
    const r = await send(h, [text(LONG)])
    expect(r.parts.length).toBe(2)
    expect(h.toasts.length).toBe(0)
  })

  test("never throws when toast/log throw", async () => {
    for (const o of [{}, { optimizeThrows: true }, { loadThrows: true }]) {
      const h = setup({ ...o, clientThrows: true })
      const r = await send(h, [text(LONG)])
      expect(r.parts.length).toBe("optimizeThrows" in o || "loadThrows" in o ? 1 : 2)
    }
  })
})

describe("messages.transform", () => {
  const synth = (t: string, original: string) => text(t, { synthetic: true, metadata: { promptOptimizer: { original } } })
  const run = async (messages: any[]) => {
    const h = setup()
    const output = { messages }
    await h.hooks["experimental.chat.messages.transform"]!({}, output)
    expect(output.messages).toBe(messages)
    return messages
  }
  const user = (parts: Part[]) => ({ info: { role: "user" }, parts })

  test("replace in place keeps injected text around the original; synthetic removed", async () => {
    const real = text(`[ctx]\n\n---\n\n${LONG}`)
    const file = { id: "prt_f", type: "file" } as any
    const s = synth("BETTER $& $1", LONG)
    const m = user([real, file, s])
    const msgs = await run([m])
    expect(msgs[0]).not.toBe(m)
    expect(msgs[0].parts).toEqual([{ ...real, text: "[ctx]\n\n---\n\nBETTER $& $1" }, file])
    expect(msgs[0].parts[1]).toBe(file)
    expect(real.text).toBe(`[ctx]\n\n---\n\n${LONG}`)  // original object not mutated
    expect(m.parts.length).toBe(3)
  })

  test("fallback: 2 user text parts => both ignored, synthetic kept", async () => {
    const a = text("part one"), b = text("part two"), s = synth("BETTER", "part one\n\npart two")
    const msgs = await run([user([a, b, s])])
    expect(msgs[0].parts).toEqual([{ ...a, ignored: true }, { ...b, ignored: true }, s])
    expect(a.ignored).toBeUndefined()
  })

  test("messages without our metadata, and assistant messages, untouched", async () => {
    const u = user([text(LONG), text("sys", { synthetic: true })])
    const a = { info: { role: "assistant" }, parts: [text("reply", { metadata: { promptOptimizer: { original: "reply" } } })] }
    const msgs = await run([u, a])
    expect(msgs[0]).toBe(u)
    expect(msgs[1]).toBe(a)
  })

  test("never throws on malformed input", async () => {
    await run([null, user([text("x", { metadata: { promptOptimizer: null as any } })])])
  })
})

test("newPartID format and monotonic order", () => {
  const ids = Array.from({ length: 1000 }, newPartID)
  for (const id of ids) expect(id).toMatch(/^prt_[0-9a-f]{12}[0-9A-Za-z]{14}$/)
  expect([...ids].sort()).toEqual(ids)
  expect(new Set(ids).size).toBe(1000)
})
