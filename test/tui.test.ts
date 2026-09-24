import { expect, test } from "bun:test"
import plugin from "../src/tui.ts"

const meta = (m: string) => ({
  version: 1, original: "o", optimizerModel: m, target: "p/x", turns: 3,
  candidates: ["a", "b", "c"], chosen: 1, judged: true, ms: 42,
})

function fake(route: any, opts: { legacy?: boolean } = {}) {
  const log: any = { toasts: [], dialogs: [], sizes: [], disposed: 0, cmd: undefined }
  const messages = [
    { id: "m1", role: "user" },
    { id: "m2", role: "assistant" },
    { id: "m3", role: "user" },
    { id: "m4", role: "user" },
  ]
  const parts: Record<string, any[]> = {
    m1: [{ type: "text", text: "OLD", metadata: { promptOptimizer: meta("old-model") } }],
    m3: [{ type: "text", text: "raw" }, { type: "text", text: "NEW", synthetic: true, metadata: { promptOptimizer: meta("small") } }],
    m4: [{ type: "text", text: "not optimized" }],
  }
  const api: any = {
    route: { current: route },
    state: { session: { messages: () => messages }, part: (id: string) => parts[id] ?? [] },
    ui: {
      DialogAlert: (p: any) => ({ marker: "alert", ...p }),
      dialog: { replace: (r: any) => log.dialogs.push(r()), setSize: (s: string) => log.sizes.push(s) },
      toast: (t: any) => log.toasts.push(t),
    },
    lifecycle: { onDispose: (fn: any) => { log.dispose = fn; return () => {} } },
  }
  if (opts.legacy) api.command = { register: (cb: any) => { log.cmd = cb()[0]; return () => log.disposed++ } }
  else api.keymap = { registerLayer: (l: any) => { log.cmd = l.commands[0]; return () => log.disposed++ } }
  return { api, log }
}

const session = { name: "session", params: { sessionID: "s1" } }

test("registers /optimized and shows newest optimized part", async () => {
  const { api, log } = fake(session)
  await plugin.tui(api, undefined, {} as any)
  expect(log.cmd).toMatchObject({ name: "prompt-optimizer.show", slashName: "optimized", namespace: "palette", category: "Prompt Optimizer" })
  log.cmd.run()
  expect(log.dialogs).toHaveLength(1)
  expect(log.dialogs[0].marker).toBe("alert")
  expect(log.dialogs[0].title).toBe("Optimized prompt · small")
  expect(log.dialogs[0].message).toStartWith("NEW\n\n— ")
  expect(log.dialogs[0].message).toContain("candidate 2/3 by judge")
  expect(log.sizes).toEqual(["large"])
  log.dispose()
  expect(log.disposed).toBe(1)
})

test("toast when no optimized prompt", async () => {
  const { api, log } = fake(session)
  api.state.part = () => []
  await plugin.tui(api, undefined, {} as any)
  log.cmd.run()
  expect(log.dialogs).toHaveLength(0)
  expect(log.toasts[0].message).toBe("No optimized prompt in this session yet")
})

test("toast when not in a session", async () => {
  const { api, log } = fake({ name: "home" })
  await plugin.tui(api, undefined, {} as any)
  log.cmd.run()
  expect(log.toasts[0].message).toBe("Open a session first")
})

test("errors become error toasts", async () => {
  const { api, log } = fake(session)
  api.state.session.messages = () => { throw new Error("boom") }
  await plugin.tui(api, undefined, {} as any)
  log.cmd.run()
  expect(log.toasts[0]).toMatchObject({ variant: "error" })
  expect(log.toasts[0].message).toContain("boom")
})

test("falls back to legacy api.command", async () => {
  const { api, log } = fake(session, { legacy: true })
  await plugin.tui(api, undefined, {} as any)
  expect(log.cmd).toMatchObject({ value: "prompt-optimizer.show", slash: { name: "optimized" } })
  log.cmd.onSelect()
  expect(log.dialogs[0].title).toBe("Optimized prompt · small")
})
