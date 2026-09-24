import type { Hooks } from "@opencode-ai/plugin"
import type { Config, selectPrompt } from "./config.ts"
import type { ProviderSource, optimize, resolveEndpoint } from "./optimizer.ts"

// Derived from the hook signature, so @opencode-ai/sdk isn't a dependency.
export type Part = Parameters<NonNullable<Hooks["chat.message"]>>[1]["parts"][number]
export type TextPart = Extract<Part, { type: "text" }>

export interface HookClient {   // subset of the opencode SDK v1 client (PluginInput.client)
  session: { get(o: { path: { id: string } }): Promise<{ data?: { parentID?: string } }> }
  tui: { showToast(o: { body: { title?: string; message: string; variant: "info" | "success" | "warning" | "error"; duration?: number } }): Promise<unknown> }
  app: { log(o: { body: { service: string; level: "debug" | "info" | "warn" | "error"; message: string; extra?: Record<string, unknown> } }): Promise<unknown> }
  config: ProviderSource["config"]
}

export interface Deps {
  client: HookClient
  loadConfig: () => Promise<Config>
  selectPrompt: typeof selectPrompt
  resolveEndpoint: typeof resolveEndpoint
  optimize: typeof optimize
}

export interface PromptOptimizerMeta {
  version: 1
  original: string
  optimizerModel: string
  target: string
  turns: number
  candidates: string[]
  chosen: number
  judged: boolean
  ms: number
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
let lastMs = 0
let counter = 0

// Same shape as opencode's ascending ids, so our part sorts after existing ones.
export function newPartID(): string {
  const now = Date.now()
  if (now !== lastMs) { lastMs = now; counter = 0 }
  counter++
  const hex = (BigInt(now) * 0x1000n + BigInt(counter)).toString(16).padStart(12, "0").slice(-12)
  let rand = ""
  for (const b of crypto.getRandomValues(new Uint8Array(14))) rand += BASE62[b % 62]
  return "prt_" + hex + rand
}

const isText = (p: Part): p is TextPart => p.type === "text"
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e))

// Fire-and-forget; toast/log failures (sync or async) never reach the user's message.
function quiet(f: () => Promise<unknown>) {
  try { f().catch(() => {}) } catch {}
}

export function createHooks(deps: Deps): Pick<Hooks, "chat.message" | "command.execute.before" | "experimental.chat.messages.transform"> {
  const { client } = deps
  const pendingCommands = new Set<string>()
  const isChild = new Map<string, boolean>()

  type ToastBody = Parameters<HookClient["tui"]["showToast"]>[0]["body"]
  const toast = (body: ToastBody) => quiet(() => client.tui.showToast({ body }))
  const log = (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) =>
    quiet(() => client.app.log({ body: { service: "@cosminfuica/opencode-prompt-optimizer", level, message, extra } }))
  const warn = (e: unknown) => {
    toast({ title: "Prompt optimizer", message: `Sent your original prompt — ${errMsg(e)}`, variant: "warning", duration: 6000 })
    log("warn", `optimization skipped: ${errMsg(e)}`)
  }

  async function childSession(sessionID: string): Promise<boolean> {
    const cached = isChild.get(sessionID)
    if (cached !== undefined) return cached
    try {
      const res = await client.session.get({ path: { id: sessionID } })
      const child = !!res?.data?.parentID
      isChild.set(sessionID, child)
      return child
    } catch {
      return false  // lookup failed: treat as a normal session, retry next time
    }
  }

  return {
    "command.execute.before": async (input) => {
      try { pendingCommands.add(input.sessionID) } catch {}
    },

    "chat.message": async (input, output) => {
      try {
        if (pendingCommands.delete(input.sessionID)) return

        let cfg: Config
        try {
          cfg = await deps.loadConfig()
        } catch (e) {
          return warn(e)
        }
        if (!cfg.enabled) return

        const text = output.parts.filter(isText).filter((p) => !p.synthetic && !p.ignored)
          .map((p) => p.text).join("\n\n").trim()
        if (!text || text.length < cfg.minChars || cfg.skipPatterns.some((r) => r.test(text))) return

        if (await childSession(input.sessionID)) return

        const model = output.message.model ?? input.model
        if (!model) return
        const target = `${model.providerID}/${model.modelID}`

        try {
          const endpoint = await deps.resolveEndpoint(cfg, client)
          if (cfg.toast) {
            const extra = cfg.turns > 1 ? ` (${cfg.turns} candidates + judge)` : ""
            toast({ title: "Prompt optimizer", message: `Optimizing with ${endpoint.model}…${extra}`, variant: "info", duration: cfg.timeoutMs })
          }
          const result = await deps.optimize({
            endpoint, system: deps.selectPrompt(cfg, target), judgeSystem: cfg.judgePrompt, prompt: text, target,
            turns: cfg.turns, strategy: cfg.strategy, timeoutMs: cfg.timeoutMs, body: cfg.body,
          })
          const meta: PromptOptimizerMeta = {
            version: 1, original: text, optimizerModel: endpoint.model, target, turns: cfg.turns,
            candidates: result.candidates, chosen: result.chosen, judged: result.judged, ms: result.ms,
          }
          output.parts.push({
            id: newPartID(), sessionID: input.sessionID, messageID: output.message.id,
            type: "text", text: result.prompt, synthetic: true, metadata: { promptOptimizer: meta },
          })
          log("info", "prompt optimized", { target, optimizerModel: endpoint.model, turns: cfg.turns, chosen: result.chosen, judged: result.judged, ms: result.ms })
          if (cfg.toast) {
            const preview = result.prompt.length > 300 ? result.prompt.slice(0, 300) + "…" : result.prompt
            toast({ title: "✨ Prompt optimized", message: `${preview}\n\n/optimized to view full`, variant: "success", duration: 8000 })
          }
        } catch (e) {
          warn(e)
        }
      } catch (e) {
        log("error", `chat.message hook failed: ${errMsg(e)}`)
      }
    },

    "experimental.chat.messages.transform": async (_input, output) => {
      try {
        for (let i = 0; i < output.messages.length; i++) {
          const m = output.messages[i]
          if (m.info.role !== "user") continue
          const s = m.parts.find((p): p is TextPart => isText(p) && !!p.metadata?.promptOptimizer)
          if (!s) continue
          const original = (s.metadata!.promptOptimizer as PromptOptimizerMeta).original
          const real = m.parts.filter(isText).filter((p) => !p.synthetic && !p.ignored)
          const parts: Part[] = real.length === 1 && real[0].text.includes(original)
            // replace in place: keeps text that other plugins injected around the user's words
            ? m.parts.filter((p) => p !== s).map((p) => (p === real[0] ? { ...real[0], text: real[0].text.replace(original, () => s.text) } : p))
            // fallback: hide the user's text parts; the synthetic optimized part carries the prompt
            : m.parts.map((p) => (real.includes(p as TextPart) ? { ...p, ignored: true } : p))
          output.messages[i] = { ...m, parts }
        }
      } catch (e) {
        log("error", `messages.transform hook failed: ${errMsg(e)}`)
      }
    },
  }
}
