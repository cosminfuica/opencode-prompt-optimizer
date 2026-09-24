// Manual visual smoke test of the real opencode TUI (isolated XDG dirs + mock provider) in tmux.
//   bun test/tui-smoke.ts        prints screen captures: after sending a prompt, and after /optimized
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync, existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { startMock } from "./mock-openai.ts"

const REPO = resolve(import.meta.dir, "..")
const tmp = mkdtempSync(join(tmpdir(), "po-tui-"))
const CFG = join(tmp, "config", "opencode")
const work = join(tmp, "work")
const mockLog = join(tmp, "mock.jsonl")
const SESSION = `po-tui-${process.pid}`
for (const d of [join(CFG, "plugins"), work, join(tmp, "home")]) mkdirSync(d, { recursive: true })

const mock = startMock({ port: 0, log: mockLog })
writeFileSync(join(CFG, "opencode.json"), JSON.stringify({
  $schema: "https://opencode.ai/config.json", autoupdate: false, share: "disabled",
  provider: { mock: { npm: "@ai-sdk/openai-compatible", name: "Mock",
    options: { baseURL: `${mock.url.origin}/v1`, apiKey: "test-key" },
    models: { target: { name: "Target" }, small: { name: "Small" } } } },
  model: "mock/target", small_model: "mock/small",
}))
symlinkSync(REPO, join(CFG, "plugins", "prompt-optimizer"))
writeFileSync(join(CFG, "plugins", "prompt-optimizer.ts"), 'export { PromptOptimizer } from "./prompt-optimizer/src/server.ts"\n')
writeFileSync(join(CFG, "tui.json"), JSON.stringify({ $schema: "https://opencode.ai/tui.json", plugin: ["./plugins/prompt-optimizer/src/tui.ts"] }))
writeFileSync(join(CFG, "prompt-optimizer.jsonc"), JSON.stringify({ model: "mock/small", turns: 2, minChars: 5 }))

const tmux = (...a: string[]) => Bun.spawnSync(["tmux", ...a], { stderr: "pipe" })
const screen = () => tmux("capture-pane", "-p", "-t", SESSION).stdout.toString()
const requests = () => existsSync(mockLog) ? readFileSync(mockLog, "utf8").trim().split("\n").filter(Boolean).length : 0
const waitFor = async (what: string, ok: () => boolean, ms = 60_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await Bun.sleep(250)) if (ok()) return
  throw new Error(`timed out waiting for ${what}\n${screen()}`)
}

let code = 1
try {
  const env = {
    HOME: join(tmp, "home"), XDG_CONFIG_HOME: join(tmp, "config"), XDG_DATA_HOME: join(tmp, "data"),
    XDG_STATE_HOME: join(tmp, "state"), XDG_CACHE_HOME: process.env.XDG_CACHE_HOME || join(process.env.HOME!, ".cache"),
    OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_AUTOUPDATE: "1", TERM: "xterm-256color",
  }
  const r = tmux("new-session", "-d", "-s", SESSION, "-x", "150", "-y", "45",
    "env", ...Object.entries(env).map(([k, v]) => `${k}=${v}`), "opencode", work)
  if (r.exitCode !== 0) throw new Error(r.stderr.toString())
  await waitFor("TUI start", () => /mock|Target|Ask anything|tab/i.test(screen()))
  await Bun.sleep(1500)

  tmux("send-keys", "-t", SESSION, "-l", "Please write a function that reverses a linked list in place")
  await Bun.sleep(300)
  tmux("send-keys", "-t", SESSION, "Enter")
  await waitFor("optimizer + judge + target requests", () => requests() >= 4)
  await Bun.sleep(1500)
  console.log("===== after sending the prompt =====\n" + screen())

  tmux("send-keys", "-t", SESSION, "-l", "/optimized")
  await Bun.sleep(700)
  tmux("send-keys", "-t", SESSION, "Enter")
  await Bun.sleep(1500)
  const dialog = screen()
  console.log("===== after /optimized =====\n" + dialog)
  const ok = /Optimized prompt/.test(dialog) && /OPTIMIZED#\d+/.test(dialog)
  console.log(ok ? "PASS: /optimized dialog shows the optimized prompt" : "FAIL: dialog not found")
  code = ok ? 0 : 1
} catch (e) {
  console.error(`ERROR: ${(e as Error).message}`)
} finally {
  tmux("kill-session", "-t", SESSION)
  mock.stop(true)
  if (process.env.E2E_KEEP) console.log(`kept ${tmp}`)
  else rmSync(tmp, { recursive: true, force: true })
  process.exit(code)
}
