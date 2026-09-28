import type { Plugin } from "@opencode/plugin"
import type { SessionPrompt } from "@opencode/plugin/promise/session"
import { loadConfig, selectPrompt } from "./config.ts"
import { optimize, optimizeWith, type OptimizeResult } from "./optimizer.ts"

export const ID = "@cosminfuica/opencode-prompt-optimizer"

export interface OptimizedPrompt extends OptimizeResult {
  version: 2
  original: string
  optimizerModel: string
  target: string
  turns: number
  toast: boolean
}

export function readOptimized(value: unknown): OptimizedPrompt | undefined {
  if (!value || typeof value !== "object") return
  const meta = value as Partial<OptimizedPrompt>
  if (meta.version === 2 && typeof meta.original === "string" && typeof meta.prompt === "string"
    && typeof meta.optimizerModel === "string" && typeof meta.target === "string"
    && Array.isArray(meta.candidates) && meta.candidates.every((c) => typeof c === "string")
    && typeof meta.chosen === "number" && typeof meta.turns === "number" && typeof meta.ms === "number")
    return meta as OptimizedPrompt
}

export async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`optimizer request timed out after ${ms}ms`)), ms)
    })])
  } finally { clearTimeout(timer) }
}

export const setup: Plugin.Plugin["setup"] = async (ctx) => {
  const prepare = async (event: SessionPrompt) => {
    try {
      const cfg = await loadConfig(undefined, { options: ctx.options })
      const original = event.prompt.text
      const text = original.trim()
      if (!cfg.enabled || !text || text.length < cfg.minChars || cfg.skipPatterns.some((p) => p.test(text))) return
      const session = await ctx.session.get({ sessionID: event.sessionID })
      if (session.parentID) return
      const selected = session.model ?? (await ctx.model.default({ location: session.location })).data
      if (!selected) throw new Error("No model selected in OpenCode")
      const target = `${selected.providerID}/${selected.id}`
      const input = {
        system: selectPrompt(cfg, target), judgeSystem: cfg.judgePrompt,
        prompt: text, target, turns: cfg.turns, strategy: cfg.strategy, timeoutMs: cfg.timeoutMs, body: cfg.body,
      }
      let result: OptimizeResult
      if (cfg.baseURL) {
        result = await optimize({ ...input, endpoint: {
          baseURL: cfg.baseURL, model: cfg.model!, apiKey: cfg.apiKey, headers: cfg.headers,
        } })
      } else {
        const model = cfg.model ? parseModel(cfg.model) : {
          providerID: selected.providerID, id: selected.id,
          ...("variant" in selected ? { variant: selected.variant } : {}),
        }
        result = await optimizeWith(input, async (messages) => {
          // Standalone generation receives no session ID, history, tools or agent instructions.
          const response = await withTimeout(ctx.generate.text({
            model, prompt: messages.map((m) => m.content).join("\n\n"),
          }), cfg.timeoutMs)
          return response.text
        })
      }
      const meta: OptimizedPrompt = {
        ...result, version: 2, original, target, optimizerModel: cfg.model ?? target, turns: cfg.turns, toast: cfg.toast,
      }
      event.metadata = { ...event.metadata, promptOptimizer: meta }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      event.metadata = { ...event.metadata, promptOptimizerError: message }
      console.warn(`${ID}: sent original prompt — ${message}`)
    }
  }

  await ctx.session.hook("prompt", prepare)
  await ctx.session.hook("context", (event) => {
    event.messages = event.messages.map((message) => {
      const meta = readOptimized(message.metadata?.promptOptimizer)
      if (message.role !== "user" || !meta) return message
      // Preserve skill text, attachments and other plugins' surrounding text.
      const exact = message.content.findIndex((p) => p.type === "text" && p.text === meta.original)
      const index = exact >= 0 ? exact : message.content.findIndex((p) => p.type === "text" && p.text.includes(meta.original))
      return { ...message, content: message.content.map((part, i) =>
        i === index && part.type === "text" ? { ...part, text: part.text.replace(meta.original, () => meta.prompt) } : part) }
    })
  })
  await ctx.command.transform((commands) => commands.add({
    name: "optimize",
    description: "Optimize and send a request with the current session model",
    async execute({ sessionID, prompt, delivery }) {
      if (!prompt.text.trim()) throw new Error("Usage: /optimize <your request>. Use /optimized to view the last rewrite.")
      await ctx.session.prompt({ sessionID, ...prompt, delivery })
    },
  }))
  await ctx.command.reload()
}

function parseModel(ref: string): Parameters<Plugin.Context["generate"]["text"]>[0]["model"] {
  const slash = ref.indexOf("/")
  if (slash <= 0 || slash === ref.length - 1) throw new Error('Optimizer model must be "provider/model"')
  // The public SDK brands identifiers; configuration supplies their string representation.
  return { providerID: ref.slice(0, slash), id: ref.slice(slash + 1) } as NonNullable<ReturnType<typeof parseModel>>
}
