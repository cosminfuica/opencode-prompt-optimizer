// Run after build with a real OpenCode v2 binary. All inference goes to a local mock.
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { strict as assert } from "node:assert"

const root = await mkdtemp(join(tmpdir(), "prompt-optimizer-v2-"))
const config = join(root, "config", "opencode")
const project = join(root, "project")
await Promise.all([mkdir(config, { recursive: true }), mkdir(project)])
const calls: Record<string, any>[] = []
const mock = Bun.serve({ port: 0, hostname: "127.0.0.1", async fetch(request) {
  const body = await request.json() as Record<string, any>
  calls.push(body)
  const text = JSON.stringify(body.messages)
  const content = text.includes("<candidate index=") ? "<best>1</best>"
    : text.includes("<original_prompt>") ? "<optimized_prompt>Investigate the login failure in src/auth.ts and fix its cause.</optimized_prompt>" : "Mock answer."
  if (body.stream) {
    const chunk = (delta: object, finish_reason: string | null = null) => `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta, finish_reason }] })}\n\n`
    return new Response(chunk({ role: "assistant", content }) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "Content-Type": "text/event-stream" } })
  }
  return Response.json({ id: "mock", object: "chat.completion", created: 1, model: body.model,
    choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })
} })
await writeFile(join(config, "opencode.json"), JSON.stringify({
  plugins: [resolve(".")], model: "optimizer-test/default",
  providers: { "optimizer-test": {
    package: "@opencode/ai/providers/openai/chat", settings: { baseURL: `http://127.0.0.1:${mock.port}/v1`, apiKey: "test-only" },
    models: { default: {}, selected: {} },
  } },
}))
const optimizerConfig = join(config, "prompt-optimizer.jsonc")
await writeFile(optimizerConfig, JSON.stringify({ turns: 2, strategy: "refine" }))
const port = 19000 + Math.floor(Math.random() * 20000)
const base = `http://127.0.0.1:${port}`
const proc = Bun.spawn([process.env.OPENCODE_BIN ?? "opencode", "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: project, env: { ...process.env, OPENCODE_TEST_HOME: root, OPENCODE_PASSWORD: "optimizer-integration-test",
    OPENCODE_CONFIG_DIR: config, XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_PROMPT_OPTIMIZER_CONFIG: optimizerConfig },
  stdout: Bun.file(join(root, "server.log")), stderr: Bun.file(join(root, "server-errors.log")),
})
const request = async (path: string, body?: unknown) => {
  const response = await fetch(base + path, { method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Authorization: `Basic ${btoa("opencode:optimizer-integration-test")}` }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) })
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? undefined : (await response.json() as { data: any }).data
}
try {
  for (let i = 0; ; i++) {
    try { await request("/api/command"); break } catch (error) { if (i >= 100) throw error; await Bun.sleep(100) }
  }
  let commands: unknown
  for (let i = 0; i < 50; i++) {
    commands = await request(`/api/command?location[directory]=${encodeURIComponent(project)}`)
    if (JSON.stringify(commands).includes('"optimize"')) break
    await Bun.sleep(100)
  }
  assert(JSON.stringify(commands).includes('"optimize"'), `slash command is registered: ${JSON.stringify(commands)}`)
  const session = await request("/api/session", { title: "Optimizer integration test", location: { directory: project }, model: { providerID: "optimizer-test", id: "selected" } })
  const original = "login broken in src/auth.ts please figure it out and fix it"
  const admitted = await request(`/api/session/${session.id}/prompt`, { text: original, resume: false })
  const payload = admitted.payload ?? admitted
  assert.equal(payload.text, original, "stored user text is preserved")
  assert.equal(payload.metadata?.promptOptimizer?.optimizerModel, "optimizer-test/selected", JSON.stringify(admitted))
  assert.equal(calls.length, 3, "two candidates and one judge")
  assert(calls.every((call) => call.model === "selected"), "session model overrides global default")
  assert(calls.every((call) => !call.tools?.length), "optimizer cannot invoke agent tools")
  assert.equal(payload.metadata.promptOptimizer.judged, true)
  await request(`/api/session/${session.id}/command`, { name: "optimize", text: "Write regression tests for the authentication module" })
  const isPrimary = (call: Record<string, any>) => call.messages.some((message: any) => message.role === "user"
    && (message.content === "Investigate the login failure in src/auth.ts and fix its cause."
      || Array.isArray(message.content) && message.content.some((part: any) => part.text === "Investigate the login failure in src/auth.ts and fix its cause.")))
  for (let i = 0; i < 100 && !calls.some(isPrimary); i++) await Bun.sleep(100)
  assert(calls.some(isPrimary), "main model receives optimized text as a user message")
  const secondOptimization = calls.filter((call) => JSON.stringify(call.messages).includes("Write regression tests for the authentication module"))
  assert(secondOptimization.length >= 2, "second prompt generated independent candidates")
  assert(secondOptimization.every((call) => !JSON.stringify(call.messages).includes(original)), "previous chat text cannot leak into optimization")
  await writeFile(optimizerConfig, JSON.stringify({ enabled: false }))
  const count = calls.length
  const skipped = await request(`/api/session/${session.id}/prompt`, { text: original, resume: false })
  assert.equal((skipped.payload ?? skipped).metadata?.promptOptimizer, undefined)
  assert.equal(calls.length, count, "disabled optimizer makes no calls")
  if (process.env.V2_TUI === "1") {
    const name = `optimizer-v2-${process.pid}`
    const tmux = (...args: string[]) => Bun.spawnSync(["tmux", ...args])
    const screen = () => tmux("capture-pane", "-p", "-t", name).stdout.toString()
    try {
      const started = tmux("new-session", "-d", "-s", name, "-x", "140", "-y", "42", "env",
        `OPENCODE_CONFIG_DIR=${config}`, `OPENCODE_TEST_HOME=${root}`, `XDG_CONFIG_HOME=${join(root, "config")}`,
        `XDG_DATA_HOME=${join(root, "data")}`, `XDG_STATE_HOME=${join(root, "state")}`, `XDG_CACHE_HOME=${join(root, "cache")}`,
        "OPENCODE_PASSWORD=optimizer-integration-test", "TERM=xterm-256color",
        process.env.OPENCODE_BIN ?? "opencode", project, "--server", base, "--session", session.id)
      assert.equal(started.exitCode, 0, started.stderr.toString())
      await Bun.sleep(3000)
      tmux("send-keys", "-t", name, "-l", "/optimized")
      await Bun.sleep(700)
      tmux("send-keys", "-t", name, "Enter")
      for (let i = 0; i < 100 && !screen().includes("Optimizer: optimizer-test/selected"); i++) await Bun.sleep(100)
      const captured = screen()
      await writeFile(join(root, "tui.txt"), captured)
      assert(captured.includes("Optimizer: optimizer-test/selected"), `real TUI opens /optimized:\n${captured}`)
      assert(captured.includes("Investigate the login failure"), "preview shows rewritten text")
      console.log("PASS: real v2 TUI /optimized dialog")
    } finally { tmux("kill-session", "-t", name) }
  }
  console.log(`PASS: real v2 command, selected model, candidate/judge, original history, rewritten model context and live disable. Evidence: ${root}`)
} finally {
  proc.kill("SIGTERM")
  await proc.exited
  mock.stop(true)
  await writeFile(join(root, "requests.json"), JSON.stringify(calls, null, 2))
}
