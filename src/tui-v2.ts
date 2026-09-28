import type { Plugin } from "@opencode/plugin/tui"
import { readOptimized } from "./v2.ts"

type Solid = {
  createElement(tag: string): unknown
  setProp(element: unknown, name: string, value: unknown): void
  insert(parent: unknown, child: unknown): void
  useTerminalDimensions(): () => { height: number }
  effect(fn: () => void): void
}
type ScrollBox = { scrollBy(n: number, unit?: string): void; scrollTo(n: number): void; scrollHeight: number }

export const setup: Plugin.Definition["setup"] = async (ctx) => {
  // OpenCode supplies this renderer to TUI plugins; no runtime SDK dependency.
  // @ts-ignore -- host-provided optional peer
  const solid: Solid = await import("@opentui/solid")
  const element = (tag: string, props: Record<string, unknown>, ...children: unknown[]) => {
    const value = solid.createElement(tag)
    for (const [key, prop] of Object.entries(props)) solid.setProp(value, key, prop)
    for (const child of children) solid.insert(value, child)
    return value
  }

  const show = async () => {
    const route = ctx.ui.router.current()
    if (route.type !== "session") {
      ctx.ui.toast.show({ message: "Open a session first", variant: "info" })
      return
    }
    await ctx.data.session.message.sync(route.sessionID)
    const messages = ctx.data.session.message.list(route.sessionID)
    const meta = messages.slice().reverse().filter((m) => m.type === "user")
      .map((m) => readOptimized(m.metadata?.promptOptimizer)).find(Boolean)
    if (!meta) {
      ctx.ui.toast.show({ message: "No optimized prompt in this session yet", variant: "info" })
      return
    }
    ctx.ui.dialog.show(() => {
      let box: ScrollBox | undefined
      const dimensions = solid.useTerminalDimensions()
      const scroll = (n: number, unit?: string) => () => { box?.scrollBy(n, unit) }
      ctx.keymap.layer(() => ({ mode: "modal", priority: 10, commands: [
        { bind: "up", run: scroll(-1) }, { bind: "down", run: scroll(1) },
        { bind: "k", run: scroll(-1) }, { bind: "j", run: scroll(1) },
        { bind: "pageup", run: scroll(-1, "viewport") }, { bind: "pagedown", run: scroll(1, "viewport") },
        { bind: "home", run: () => { box?.scrollTo(0) } },
        { bind: "end", run: () => { box?.scrollTo(box.scrollHeight) } },
        { bind: "return", run: () => ctx.ui.dialog.clear() },
      ] }))
      const info = `Optimizer: ${meta.optimizerModel}\nTarget: ${meta.target} · ${meta.ms}ms\n` +
        `${meta.candidates.length} candidate(s) · selected ${meta.chosen + 1}${meta.judged ? " by judge" : ""}`
      const root = element("box", { padding: 1, gap: 1 },
        element("text", { attributes: 1 }, "Optimized prompt"),
        element("text", { wrapMode: "word", flexShrink: 0 }, info),
        element("scrollbox", { ref: (value: ScrollBox) => { box = value }, flexGrow: 1 },
          element("text", { wrapMode: "word" }, meta.prompt)),
        element("text", { flexShrink: 0 }, "↑↓ PgUp PgDn Home End to scroll · Enter/Esc to close"))
      solid.effect(() => solid.setProp(root, "height", Math.max(8, Math.floor(dimensions().height * 0.7))))
      return root as ReturnType<Parameters<typeof ctx.ui.dialog.show>[0]>
    })
    ctx.ui.dialog.set({ size: "large", centered: true })
  }

  const unmount = ctx.ui.slot({ append: "app", render() {
    ctx.keymap.layer(() => ({ mode: "global", commands: [{
      id: "prompt-optimizer.show", title: "Show optimized prompt", group: "Prompt Optimizer",
      palette: true, slash: { name: "optimized" },
      run: () => show().catch((error: unknown) => {
        ctx.ui.toast.show({ message: `Prompt optimizer: ${String(error)}`, variant: "error" })
      }),
    }] }))
    return null
  } })
  const unsubscribe = ctx.data.on("session.inbox.enqueued", (event) => {
    const item = event.data.item
    if (item.type !== "user") return
    const meta = readOptimized(item.payload.metadata?.promptOptimizer)
    const error = item.payload.metadata?.promptOptimizerError
    if (typeof error === "string") ctx.ui.toast.show({ title: "Prompt optimizer", message: `Sent original prompt — ${error}`, variant: "warning" })
    else if (meta?.toast) ctx.ui.toast.show({
      title: "Prompt optimized", message: `${meta.prompt.slice(0, 300)}\n/optimized to view full`, variant: "success",
    })
  })
  return () => { unmount(); unsubscribe() }
}
