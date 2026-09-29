// End-to-end: real `opencode serve` + mock OpenAI-compatible provider + this package loaded through its
// package.json ("plugin": [<repo>] -> main -> dist/index.js), all under isolated temp XDG dirs. Build first.
//   bun tests/e2e.ts           (E2E_KEEP=1 keeps the temp dir for debugging)
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { startMock } from "./mock-openai.ts"

const REPO = resolve(import.meta.dir, "..")
const tmp = mkdtempSync(join(tmpdir(), "po-e2e-"))
const xdg = (k: string) => join(tmp, k)
const CFG = join(xdg("config"), "opencode")
const work = join(tmp, "work")
const mockLog = join(tmp, "mock.jsonl")
const serverLog = join(tmp, "opencode.log")
for (const d of [CFG, work, xdg("home")]) mkdirSync(d, { recursive: true })

const LONG = "Please write a function that reverses a linked list in place"
const SHORT = "hi"
const LONG2 = "Explain the difference between TCP and UDP for a beginner"

const results: [string, boolean, string?][] = []
const check = (name: string, ok: boolean, detail?: unknown) => {
  results.push([name, ok, ok ? undefined : typeof detail === "string" ? detail : JSON.stringify(detail)?.slice(0, 1500)])
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`)
}

const mock = startMock({ port: 0, log: mockLog })
const writeCfg = (o: object) => writeFileSync(join(CFG, "prompt-optimizer.jsonc"), JSON.stringify(o, null, 2))

writeFileSync(join(CFG, "opencode.json"), JSON.stringify({
  $schema: "https://opencode.ai/config.json", autoupdate: false, share: "disabled",
  provider: { mock: { npm: "@ai-sdk/openai-compatible", name: "Mock",
    options: { baseURL: `${mock.url.origin}/v1`, apiKey: "test-key" },
    models: { target: { name: "Target" }, small: { name: "Small" } } } },
  model: "mock/target", small_model: "mock/small", plugin: [REPO],
}, null, 2))
writeCfg({ model: "mock/small", turns: 2, minChars: 5, toast: false })

type Req = { path: string; auth: string | null; body: any }
const txt = (c: any): string => typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? "").join("") : ""
const lastUser = (r: Req) => txt([...(r.body.messages ?? [])].reverse().find((m: any) => m.role === "user")?.content)
const readLog = (): Req[] => existsSync(mockLog) ? readFileSync(mockLog, "utf8").trim().split("\n").filter(Boolean).map(l => JSON.parse(l)) : []
const kind = (r: Req) =>
  /<candidate\b/.test(lastUser(r)) ? "judge" : /<original_prompt>/.test(lastUser(r)) ? "optimizer" : r.body.model === "target" ? "target" : "other"

let proc: { kill(): void; exited: Promise<number> } | undefined
let failed = false
try {
  const p = Bun.spawn([process.env.OPENCODE_BIN || "opencode", "serve", "--port", "0", "--hostname", "127.0.0.1", "--print-logs", "--log-level", "INFO"], {
    cwd: work,
    env: {
      ...process.env,
      HOME: xdg("home"),
      XDG_CONFIG_HOME: xdg("config"), XDG_DATA_HOME: xdg("data"), XDG_STATE_HOME: xdg("state"),
      // ponytail: reuses the real opencode cache (provider npm packages) read-mostly; set E2E_FRESH_CACHE=1 to isolate it too (slow first run, needs network)
      XDG_CACHE_HOME: process.env.E2E_FRESH_CACHE ? xdg("cache") : (process.env.XDG_CACHE_HOME || join(process.env.HOME!, ".cache")),
      OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1",
      OPENCODE_PROMPT_OPTIMIZER_CONFIG: "",
    },
    stdout: "pipe", stderr: Bun.file(serverLog),
  })
  proc = p

  // wait for "opencode server listening on http://..."
  const base = await (async () => {
    const reader = p.stdout.getReader()
    let buf = ""
    const deadline = Date.now() + 180_000
    while (Date.now() < deadline) {
      const { value, done } = await Promise.race([reader.read(), Bun.sleep(1000).then(() => ({ value: undefined, done: false }))])
      if (done) break
      if (value) buf += new TextDecoder().decode(value)
      const m = buf.match(/listening on (http:\/\/\S+)/)
      if (m) { reader.releaseLock(); return m[1].replace(/\/$/, "") }
    }
    throw new Error(`opencode serve did not start. stdout:\n${buf}`)
  })()
  console.log(`opencode at ${base}, mock at ${mock.url.origin}, tmp ${tmp}`)

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base}${path}${path.includes("?") ? "&" : "?"}directory=${encodeURIComponent(work)}`, {
      method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(300_000),
    })
    if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${await res.text()}`)
    return res.json() as Promise<any>
  }
  const session = await api("POST", "/session", {})
  const send = async (text: string) => {
    const before = readLog().length
    const reply = await api("POST", `/session/${session.id}/message`, {
      parts: [{ type: "text", text }], model: { providerID: "mock", modelID: "target" },
    })
    if (reply.info?.error) throw new Error(`assistant error: ${JSON.stringify(reply.info.error)}`)
    const msgs: any[] = await api("GET", `/session/${session.id}/message`)
    const user = [...msgs].reverse().find(m => m.info.role === "user")
    const reqs = readLog().slice(before).filter(r => kind(r) !== "other")
    const target = reqs.filter(r => kind(r) === "target").at(-1)
    return { reply, user, reqs, target }
  }
  // text of the LAST user message the target model received
  const targetUser = (r?: Req) => r ? lastUser(r) : ""
  const synthetic = (user: any) => user.parts.filter((p: any) => p.type === "text" && p.metadata?.promptOptimizer)

  // (1)-(4) long message -> 2 optimizer calls + judge, target sees optimized text
  {
    const { user, reqs, target } = await send(LONG)
    const kinds = reqs.map(kind)
    check("2 optimizer calls, then 1 judge, then target", kinds.join(",") === "optimizer,optimizer,judge,target", kinds)
    check("optimizer calls use the optimizer model", reqs.filter(r => kind(r) !== "target").every(r => r.body.model === "small" && r.auth === "Bearer test-key"), reqs.map(r => [r.body.model, r.auth]))
    const syn = synthetic(user)
    check("user message has exactly one synthetic optimizer part", syn.length === 1 && syn[0].synthetic === true, user.parts)
    const meta = syn[0]?.metadata?.promptOptimizer ?? {}
    check("metadata: 2 candidates, judged, chose the last, original kept",
      meta.candidates?.length === 2 && meta.judged === true && meta.chosen === 1 && meta.original === LONG
        && meta.target === "mock/target" && syn[0].text === meta.candidates[1] && /^OPTIMIZED#\d+: /.test(syn[0].text), meta)
    const real = user.parts.filter((p: any) => p.type === "text" && !p.synthetic && !p.ignored)
    check("original user part still stored untouched", real.length === 1 && real[0].text === LONG, user.parts)
    const seen = targetUser(target)
    check("target model sees the optimized prompt", !!syn[0] && seen.includes(syn[0].text), seen)
    check("target model does not see the original standalone", !!syn[0] && !seen.split(syn[0].text).join("").includes(LONG), seen)
  }

  // (5) short message passes through
  {
    const { user, reqs, target } = await send(SHORT)
    check("short message: no optimizer/judge calls", reqs.every(r => kind(r) === "target") && !!target, reqs.map(kind))
    check("short message: no synthetic part", synthetic(user).length === 0, user.parts)
    check("short message: target sees original", targetUser(target).trim() === SHORT, targetUser(target))
    const first = txt((target?.body.messages ?? []).find((m: any) => m.role === "user")?.content)
    check("history: earlier message still optimized for the model",
      /OPTIMIZED#\d+: /.test(first) && !first.replace(/OPTIMIZED#\d+: [^\n]*/, "").includes(LONG), first)
  }

  // (6) enabled:false applies live
  {
    writeCfg({ enabled: false, model: "mock/small", turns: 2, minChars: 5, toast: false })
    const { user, reqs, target } = await send(LONG2)
    check("disabled (live reload): no optimizer calls", reqs.every(r => kind(r) === "target") && !!target, reqs.map(kind))
    check("disabled: no synthetic part", synthetic(user).length === 0, user.parts)
    check("disabled: target sees original", targetUser(target).trim() === LONG2, targetUser(target))
  }
} catch (e) {
  failed = true
  console.error(`ERROR: ${(e as Error).stack ?? e}`)
} finally {
  proc?.kill()
  await proc?.exited
  mock.stop(true)
  const bad = results.filter(r => !r[1])
  if (failed || bad.length) {
    for (const [n, , d] of bad) console.log(`\n--- FAIL ${n}\n${d}`)
    const log = existsSync(serverLog) ? readFileSync(serverLog, "utf8").split("\n") : []
    console.log(`\n--- opencode log (prompt-optimizer / errors, last 40)\n` +
      log.filter(l => /prompt-optimizer|ERROR|error/i.test(l)).slice(-40).join("\n"))
  }
  console.log(`\n${failed || bad.length ? "FAIL" : "PASS"}: ${results.length - bad.length}/${results.length} checks passed${failed ? " (aborted with error)" : ""}`)
  if (process.env.E2E_KEEP) console.log(`kept ${tmp}`)
  else rmSync(tmp, { recursive: true, force: true })
  process.exit(failed || bad.length ? 1 : 0)
}
