import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

const NAME = "prompt-optimizer.show"
const TITLE = "Show optimized prompt"
const CATEGORY = "Prompt Optimizer"
const HINT = "↑↓ PgUp PgDn Home End or mouse wheel to scroll"

type Meta = {
  optimizerModel: string
  target: string
  turns: number
  candidates: string[]
  chosen: number
  judged: boolean
  ms: number
}

// The @opentui/solid functions used to build raw elements without JSX (opencode provides the module at runtime).
type Solid = {
  createElement(tag: string): any
  setProp(el: any, name: string, value: unknown): void
  insert(parent: any, child: unknown): void
  effect(fn: () => void): void
  useTerminalDimensions(): () => { height: number }
}

function el(solid: Solid, tag: string, props: Record<string, unknown>, ...children: unknown[]) {
  const e = solid.createElement(tag)
  for (const [k, v] of Object.entries(props)) solid.setProp(e, k, v)
  for (const c of children) solid.insert(e, c)
  return e
}

// DialogAlert can't scroll and cuts off text taller than the terminal. So: title, metadata, the prompt in a
// scrollbox, a key hint. Keys scroll through a keymap layer that lives exactly as long as the dialog.
function openDialog(api: TuiPluginApi, solid: Solid | undefined, title: string, info: string, text: string) {
  const alert = () => api.ui.DialogAlert({ title, message: `${info}\n\n${text}` })  // metadata first: never cut off
  if (!solid || !api.keymap?.registerLayer) {
    api.ui.dialog.replace(alert)
    api.ui.dialog.setSize("large")
    return
  }
  let box: any
  let off = () => {}
  const close = () => api.ui.dialog.clear()
  api.ui.dialog.replace(() => {
    try {
      const t = api.theme.current
      const dims = solid.useTerminalDimensions()
      box = el(solid, "scrollbox", { verticalScrollbarOptions: { trackOptions: { backgroundColor: t.background, foregroundColor: t.borderActive } } },
        el(solid, "text", { fg: t.text, wrapMode: "word" }, text))
      const root = el(solid, "box", { paddingLeft: 2, paddingRight: 2, paddingBottom: 1, gap: 1 },
        el(solid, "box", { flexDirection: "row", justifyContent: "space-between", flexShrink: 0 },
          el(solid, "text", { fg: t.text, attributes: 1 /* bold */ }, title),
          el(solid, "text", { fg: t.textMuted, onMouseUp: close }, "esc")),
        el(solid, "text", { fg: t.textMuted, wrapMode: "word", flexShrink: 0 }, info),
        box,
        el(solid, "text", { fg: t.textMuted, flexShrink: 0 }, HINT))
      // ponytail: mirrors opencode 1.18's dialog frame, which starts height/4 down the screen. Cap the height so the
      // bottom stays on screen; the scrollbox shrinks. Re-check this if a newer opencode moves the frame.
      solid.effect(() => solid.setProp(root, "maxHeight", Math.floor(dims().height * 3 / 4) - 2))
      return root
    } catch {
      box = undefined
      return alert()
    }
  }, () => off())
  api.ui.dialog.setSize("large")
  const by = (n: number, unit?: string) => () => box?.scrollBy(n, unit)
  off = api.keymap.registerLayer({
    priority: 1, // wins over opencode's global pageup/pagedown/home/end, which scroll the transcript and close dialogs
    bindings: [
      { key: "up", cmd: by(-1) }, { key: "k", cmd: by(-1) }, { key: "down", cmd: by(1) }, { key: "j", cmd: by(1) },
      { key: "pageup", cmd: by(-1, "viewport") }, { key: "pagedown", cmd: by(1, "viewport") },
      { key: "home", cmd: () => box?.scrollTo(0) }, { key: "end", cmd: () => box?.scrollTo(box.scrollHeight) },
      { key: "return", cmd: close },
    ],
  } as any)
}

function show(api: TuiPluginApi, solid?: Solid) {
  try {
    const route = api.route.current
    if (route.name !== "session" || !route.params?.sessionID) {
      api.ui.toast({ variant: "info", message: "Open a session first" })
      return
    }
    const messages = api.state.session.messages(route.params.sessionID as string)
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!
      if (m.role !== "user") continue
      for (const p of api.state.part(m.id)) {
        const meta = p.type === "text" ? (p.metadata?.promptOptimizer as Meta | undefined) : undefined
        if (!meta || p.type !== "text") continue
        const n = meta.candidates?.length ?? 1
        const pick = n > 1 ? ` · candidate ${meta.chosen + 1}/${n}${meta.judged ? " by judge" : ""}` : ""
        const info = `for ${meta.target} · ${meta.turns} turn(s)${pick} · ${meta.ms}ms`
        openDialog(api, solid, `Optimized prompt · ${meta.optimizerModel}`, info, p.text)
        return
      }
    }
    api.ui.toast({ variant: "info", message: "No optimized prompt in this session yet" })
  } catch (e) {
    try {
      api.ui.toast({ variant: "error", message: `Prompt optimizer: ${e instanceof Error ? e.message : String(e)}` })
    } catch {}
  }
}

const tui: TuiPlugin = async (api) => {
  try {
    // @ts-ignore -- not installed here; opencode serves it to TUI plugins at runtime
    const solid: Solid | undefined = await import("@opentui/solid").catch(() => undefined)
    const dispose = api.keymap?.registerLayer
      ? api.keymap.registerLayer({
          commands: [
            { name: NAME, title: TITLE, category: CATEGORY, namespace: "palette", slashName: "optimized", run: () => show(api, solid) },
          ],
        } as any)
      : api.command?.register(() => [
          { title: TITLE, value: NAME, category: CATEGORY, slash: { name: "optimized" }, onSelect: () => show(api, solid) },
        ])
    if (typeof dispose === "function") api.lifecycle.onDispose(dispose)
  } catch (e) {
    try {
      api.ui.toast({ variant: "error", message: `Prompt optimizer TUI failed to load: ${e instanceof Error ? e.message : String(e)}` })
    } catch {}
  }
}

export default { id: "@cosminfuica/opencode-prompt-optimizer", tui }
