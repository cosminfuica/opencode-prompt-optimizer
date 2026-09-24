import { expect, mock, test } from "bun:test"
import plugin from "../src/tui.ts"

const meta = (m: string) => ({
  version: 1, original: "o", optimizerModel: m, target: "p/x", turns: 3,
  candidates: ["a", "b", "c"], chosen: 1, judged: true, ms: 42,
})

function fake(route: any, opts: { legacy?: boolean } = {}) {
  const log: any = { toasts: [], dialogs: [], sizes: [], layers: [], disposed: 0, cmd: undefined }
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
    theme: { current: { text: "T", textMuted: "M", background: "B", borderActive: "A" } },
    ui: {
      DialogAlert: (p: any) => ({ marker: "alert", ...p }),
      dialog: {
        replace: (r: any, onClose?: () => void) => { log.onClose = onClose; log.dialogs.push(r()) },
        setSize: (s: string) => log.sizes.push(s),
        clear: () => log.onClose?.(),
      },
      toast: (t: any) => log.toasts.push(t),
    },
    lifecycle: { onDispose: (fn: any) => { log.dispose = fn; return () => {} } },
  }
  if (opts.legacy) api.command = { register: (cb: any) => { log.cmd = cb()[0]; return () => log.disposed++ } }
  else api.keymap = { registerLayer: (l: any) => { log.layers.push(l); log.cmd ??= l.commands?.[0]; return () => log.disposed++ } }
  return { api, log }
}

const session = { name: "session", params: { sessionID: "s1" } }

// @opentui/solid is not installed for unit tests, so these use the DialogAlert fallback
test("registers /optimized and shows newest optimized part, metadata first", async () => {
  const { api, log } = fake(session)
  await plugin.tui(api, undefined, {} as any)
  expect(log.cmd).toMatchObject({ name: "prompt-optimizer.show", slashName: "optimized", namespace: "palette", category: "Prompt Optimizer" })
  log.cmd.run()
  expect(log.dialogs).toHaveLength(1)
  expect(log.dialogs[0].marker).toBe("alert")
  expect(log.dialogs[0].title).toBe("Optimized prompt · small")
  expect(log.dialogs[0].message).toBe("for p/x · 3 turn(s) · candidate 2/3 by judge · 42ms\n\nNEW")
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

// keep last: the module mock stays registered for the rest of the process
test("scrollable dialog: metadata on top, prompt in a scrollbox, keys scroll it, key layer removed on close", async () => {
  mock.module("@opentui/solid", () => ({
    createElement: (tag: string) => ({
      tag, props: {} as any, children: [] as any[], calls: [] as any[], scrollHeight: 99,
      scrollBy(n: number, unit?: string) { this.calls.push(["by", n, unit]) },
      scrollTo(n: number) { this.calls.push(["to", n]) },
    }),
    setProp: (e: any, k: string, v: unknown) => { e.props[k] = v },
    insert: (e: any, c: unknown) => e.children.push(c),
    effect: (fn: () => void) => fn(),
    useTerminalDimensions: () => () => ({ height: 40 }),
  }))
  const flat = (e: any): string => typeof e === "string" ? e : e.children.map(flat).join("\n")
  const find = (e: any, tag: string): any => e?.tag === tag ? e : e?.children?.map((c: any) => find(c, tag)).find(Boolean)
  const { api, log } = fake(session)
  await plugin.tui(api, undefined, {} as any)
  log.cmd.run()
  const root = log.dialogs[0]
  expect(flat(root)).toMatch(/^Optimized prompt · small\nesc\nfor p\/x · 3 turn\(s\) · candidate 2\/3 by judge · 42ms\nNEW\n↑↓ /)
  expect(root.props.maxHeight).toBe(28) // 3/4 of 40 rows, minus 2
  const box = find(root, "scrollbox")
  expect(flat(box)).toBe("NEW")
  const layer = log.layers.at(-1)
  expect(layer.priority).toBe(1)
  const key = (k: string) => layer.bindings.find((b: any) => b.key === k).cmd()
  key("pagedown"); key("end")
  expect(box.calls).toEqual([["by", 1, "viewport"], ["to", 99]])
  key("return") // closes the dialog, which removes the key layer
  expect(log.disposed).toBe(1)
})
