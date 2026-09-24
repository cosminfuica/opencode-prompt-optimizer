import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"

const NAME = "prompt-optimizer.show"
const TITLE = "Show optimized prompt"
const CATEGORY = "Prompt Optimizer"

type Meta = {
  optimizerModel: string
  target: string
  turns: number
  candidates: string[]
  chosen: number
  judged: boolean
  ms: number
}

function show(api: TuiPluginApi) {
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
        const message = `${p.text}\n\n— for ${meta.target} · ${meta.turns} turn(s)${pick} · ${meta.ms}ms`
        api.ui.dialog.replace(() => api.ui.DialogAlert({ title: `Optimized prompt · ${meta.optimizerModel}`, message }))
        api.ui.dialog.setSize("large")
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
    const dispose = api.keymap?.registerLayer
      ? api.keymap.registerLayer({
          commands: [
            { name: NAME, title: TITLE, category: CATEGORY, namespace: "palette", slashName: "optimized", run: () => show(api) },
          ],
        } as any)
      : api.command?.register(() => [
          { title: TITLE, value: NAME, category: CATEGORY, slash: { name: "optimized" }, onSelect: () => show(api) },
        ])
    if (typeof dispose === "function") api.lifecycle.onDispose(dispose)
  } catch (e) {
    try {
      api.ui.toast({ variant: "error", message: `Prompt optimizer TUI failed to load: ${e instanceof Error ? e.message : String(e)}` })
    } catch {}
  }
}

export default { id: "prompt-optimizer", tui }
