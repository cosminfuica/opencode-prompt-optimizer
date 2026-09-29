// Visual smoke test of the real opencode TUI (isolated XDG dirs + mock provider) in tmux. The package is loaded
// through its package.json from opencode.json + tui.json "plugin": [<repo>] (dist/, so build first).
//   bun tests/tui-smoke.ts   1) sends a prompt (2 candidates + judge), opens /optimized
//                           2) switches the optimizer to an 85-line reply, opens /optimized and checks that the
//                              metadata and the last line can be reached with keys, the mouse wheel and a resize
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { startMock } from "./mock-openai.ts"

const REPO = resolve(import.meta.dir, "..")
const tmp = mkdtempSync(join(tmpdir(), "po-tui-"))
const CFG = join(tmp, "config", "opencode")
const work = join(tmp, "work")
const mockLog = join(tmp, "mock.jsonl")
const SESSION = `po-tui-${process.pid}`
for (const d of [CFG, work, join(tmp, "home")]) mkdirSync(d, { recursive: true })

const mock = startMock({ port: 0, log: mockLog })
// optimizer endpoint for step 2: always replies with an 85-line optimized prompt
const LINES = 85
const LONG = Array.from({ length: LINES }, (_, i) => `LINE-${i + 1} keep this requirement`).join("\n")
let longHits = 0
const long = Bun.serve({
  port: 0, hostname: "127.0.0.1",
  async fetch(req) {
    await req.text()
    longHits++
    const content = `<optimized_prompt>\n${LONG}\n</optimized_prompt>`
    return Response.json({ choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }] })
  },
})
writeFileSync(join(CFG, "opencode.json"), JSON.stringify({
  $schema: "https://opencode.ai/config.json", autoupdate: false, share: "disabled",
  provider: { mock: { npm: "@ai-sdk/openai-compatible", name: "Mock",
    options: { baseURL: `${mock.url.origin}/v1`, apiKey: "test-key" },
    models: { target: { name: "Target" }, small: { name: "Small" } } } },
  model: "mock/target", small_model: "mock/small", plugin: [REPO],
}))
writeFileSync(join(CFG, "tui.json"), JSON.stringify({ $schema: "https://opencode.ai/tui.json", plugin: [REPO] }))
const writeCfg = (o: object) => writeFileSync(join(CFG, "prompt-optimizer.jsonc"), JSON.stringify(o))
writeCfg({ model: "mock/small", turns: 2, minChars: 5 })

const tmux = (...a: string[]) => Bun.spawnSync(["tmux", ...a], { stderr: "pipe" })
const screen = () => tmux("capture-pane", "-p", "-t", SESSION).stdout.toString()
const keys = (...k: string[]) => { for (const x of k) tmux("send-keys", "-t", SESSION, x) }
const type = (s: string) => tmux("send-keys", "-t", SESSION, "-l", s)
const requests = () => existsSync(mockLog) ? readFileSync(mockLog, "utf8").trim().split("\n").filter(Boolean).length : 0
const waitFor = async (what: string, ok: () => boolean, ms = 60_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(250)) if (ok()) return
  throw new Error(`timed out waiting for ${what}\n${screen()}`)
}
const openOptimized = async () => {
  type("/optimized"); await Bun.sleep(700)
  keys("Enter"); await Bun.sleep(1500)
  return screen()
}
// LINE-n numbers visible on screen: [first, last], [Infinity, -Infinity] when none
const visible = (sc: string) => {
  const n = [...sc.matchAll(/LINE-(\d+) /g)].map((m) => +m[1]!)
  return [Math.min(...n), Math.max(...n)]
}
const results: [string, boolean][] = []
const check = (name: string, ok: boolean, sc?: string) => {
  results.push([name, ok])
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`)
  if (!ok && sc) console.log(sc)
}
const META_LONG = /for mock\/target · 1 turn\(s\) · \d+ms/

let failed = false
try {
  const env = {
    HOME: join(tmp, "home"), XDG_CONFIG_HOME: join(tmp, "config"), XDG_DATA_HOME: join(tmp, "data"),
    XDG_STATE_HOME: join(tmp, "state"), XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || join(process.env.HOME!, ".cache"),
    OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1", TERM: "xterm-256color",
  }
  const r = tmux("new-session", "-d", "-s", SESSION, "-x", "150", "-y", "45",
    "env", ...Object.entries(env).map(([k, v]) => `${k}=${v}`), process.env.OPENCODE_BIN || "opencode", work)
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  await waitFor("TUI start", () => /mock|Target|Ask anything|tab/i.test(screen()))
  await Bun.sleep(1500)

  // 1) short optimized prompt: 2 candidates + judge
  type("Please write a function that reverses a linked list in place")
  await Bun.sleep(300)
  keys("Enter")
  await waitFor("optimizer + judge + target requests", () => requests() >= 4)
  await Bun.sleep(1500)
  console.log("===== after sending the prompt =====\n" + screen())
  const dialog = await openOptimized()
  console.log("===== after /optimized =====\n" + dialog)
  check("/optimized dialog shows the optimized prompt", /Optimized prompt/.test(dialog) && /OPTIMIZED#\d+/.test(dialog), dialog)
  check("dialog shows the metadata", /for mock\/target · 2 turn\(s\) · candidate 2\/2 by judge · \d+ms/.test(dialog), dialog)
  keys("Escape"); await Bun.sleep(500)

  // 2) 85-line optimized prompt, taller than the dialog
  writeCfg({ baseURL: `${long.url.origin}/v1`, model: "long", turns: 1, minChars: 5, toast: false })
  const before = requests()
  type("Now plan the refactor of the billing module")
  await Bun.sleep(300)
  keys("Enter")
  await waitFor("long optimizer + target requests", () => longHits >= 1 && requests() > before)
  await Bun.sleep(1500)
  let sc = await openOptimized()
  console.log("===== long prompt: /optimized =====\n" + sc)
  check("long: dialog open with title and metadata", sc.includes("Optimized prompt · long") && META_LONG.test(sc), sc)
  check(`long: starts at LINE-1 and the prompt is taller than the dialog`, visible(sc)[0] === 1 && visible(sc)[1] < LINES, sc)

  keys("End"); await Bun.sleep(600); sc = screen()
  console.log("===== long prompt: End =====\n" + sc)
  check(`long: End reaches LINE-${LINES}, metadata still visible`, visible(sc)[1] === LINES && META_LONG.test(sc), sc)

  keys("Home"); await Bun.sleep(400)
  keys("Down", "Down", "Down"); await Bun.sleep(600); sc = screen()
  check("long: Home, then Down x3 scrolls 3 lines", visible(sc)[0] === 4, sc)

  keys("Home"); await Bun.sleep(400)
  keys("PageDown"); await Bun.sleep(600); sc = screen()
  check("long: PageDown scrolls and keeps the dialog open", sc.includes("Optimized prompt · long") && visible(sc)[0] > 4, sc)

  keys("Home"); await Bun.sleep(400)
  for (let i = 0; i < 5; i++) type(`\x1b[<65;75;27M`)  // SGR mouse wheel down, inside the dialog text
  await Bun.sleep(600); sc = screen()
  const [first] = visible(sc)
  check("long: mouse wheel scrolls the open dialog", sc.includes("Optimized prompt · long") && Number.isFinite(first) && first! > 1, sc)

  tmux("resize-window", "-t", SESSION, "-x", "120", "-y", "30"); await Bun.sleep(1000)
  keys("End"); await Bun.sleep(600); sc = screen()
  console.log("===== long prompt: 120x30, End =====\n" + sc)
  check(`long: at 120x30, End reaches LINE-${LINES}, metadata still visible`, visible(sc)[1] === LINES && META_LONG.test(sc), sc)

  keys("Escape"); await Bun.sleep(600); sc = screen()
  check("long: Escape closes the dialog", !sc.includes("Optimized prompt"), sc)

  // the dialog's key layer must go away with it: j/k reach the prompt again instead of scrolling a closed dialog
  type("jjkk-typed"); await Bun.sleep(600); sc = screen()
  check("long: after closing, j/k type into the prompt again", sc.includes("jjkk-typed"), sc)
} catch (e) {
  failed = true
  console.error(`ERROR: ${(e as Error).message}`)
} finally {
  tmux("kill-session", "-t", SESSION)
  mock.stop(true)
  long.stop(true)
  const bad = results.filter((r) => !r[1]).length
  console.log(`${failed || bad ? "FAIL" : "PASS"}: ${results.length - bad}/${results.length} checks passed${failed ? " (aborted with error)" : ""}`)
  if (process.env.E2E_KEEP) console.log(`kept ${tmp}`)
  else rmSync(tmp, { recursive: true, force: true })
  process.exit(failed || bad ? 1 : 0)
}
