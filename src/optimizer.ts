import type { Config } from "./config.ts"

export interface Endpoint { baseURL: string; apiKey?: string; model: string; headers?: Record<string, string> }
export interface ProviderSource {          // the subset of the opencode SDK client we use
  config: {
    get(): Promise<{ data?: { small_model?: string } }>
    providers(): Promise<{ data?: { providers: Array<{
      id: string; key?: string; env?: string[]; options?: Record<string, any>
      models: Record<string, { id: string; api?: { id?: string; url?: string; npm?: string } }>
    }> } }>
  }
}

const KNOWN: Record<string, string> = {
  "@ai-sdk/openai": "https://api.openai.com/v1",
  "@ai-sdk/anthropic": "https://api.anthropic.com/v1",
  "@ai-sdk/google": "https://generativelanguage.googleapis.com/v1beta/openai",
  "@openrouter/ai-sdk-provider": "https://openrouter.ai/api/v1",
  "@ai-sdk/groq": "https://api.groq.com/openai/v1",
  "@ai-sdk/mistral": "https://api.mistral.ai/v1",
  "@ai-sdk/deepseek": "https://api.deepseek.com/v1",
  "@ai-sdk/xai": "https://api.x.ai/v1",
}

export async function resolveEndpoint(
  cfg: Pick<Config, "model" | "baseURL" | "apiKey" | "headers">,
  client: ProviderSource,
): Promise<Endpoint> {
  if (cfg.baseURL) {
    // custom endpoint: only the user's own apiKey, never opencode provider keys
    if (!cfg.model) throw new Error(`"model" is required when "baseURL" is set in the plugin config`)
    return { baseURL: cfg.baseURL, apiKey: cfg.apiKey, model: cfg.model, headers: cfg.headers }
  }
  const ref = cfg.model ?? (await client.config.get()).data?.small_model
  if (!ref) throw new Error(`no optimizer model — set "model" in the plugin config or "small_model" in opencode config`)
  const slash = ref.indexOf("/")
  if (slash <= 0) throw new Error(`optimizer model "${ref}" must be "provider/model" (or set "baseURL" in the plugin config)`)
  const providerID = ref.slice(0, slash)
  const modelKey = ref.slice(slash + 1)

  const providers = (await client.config.providers()).data?.providers ?? []
  const provider = providers.find((p) => p.id === providerID)
  const model = provider?.models?.[modelKey]
  if (!provider || !model) throw new Error(`optimizer model "${ref}" not found in opencode providers — see \`opencode models\`; OAuth/subscription logins can't be the optimizer`)

  const baseURL = provider.options?.baseURL || model.api?.url || KNOWN[model.api?.npm ?? ""]
  if (!baseURL) throw new Error(`no baseURL for provider "${providerID}" — set "baseURL" in the plugin config`)
  // ponytail: env-name heuristic (models.dev also lists IDs/regions; a SigV4 secret isn't a bearer token);
  // map key vars per provider if one ever ends in something else
  const envKey = provider.env?.filter((n) => /(KEY|TOKEN|PAT)$/i.test(n) && !/SECRET/i.test(n)).map((n) => process.env[n]).find(Boolean)
  return {
    baseURL,
    apiKey: provider.key ?? provider.options?.apiKey ?? envKey,
    model: model.api?.id || modelKey,
    headers: { ...provider.options?.headers, ...cfg.headers },
  }
}

export async function chat(
  endpoint: Endpoint,
  messages: { role: "system" | "user"; content: string }[],
  opts: { timeoutMs: number; body?: Record<string, unknown> },
): Promise<string> {
  const url = `${endpoint.baseURL.replace(/\/+$/, "")}/chat/completions`
  let res: Response
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(endpoint.apiKey ? { Authorization: `Bearer ${endpoint.apiKey}` } : {}),
        ...endpoint.headers,
      },
      body: JSON.stringify({ ...opts.body, model: endpoint.model, messages, stream: false }),
      signal: AbortSignal.timeout(opts.timeoutMs),
    })
  } catch (e: any) {
    if (e?.name === "TimeoutError" || e?.name === "AbortError")
      throw new Error(`optimizer request timed out after ${opts.timeoutMs}ms`)
    throw new Error(`optimizer request to ${url} failed: ${e?.message ?? e}`)
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "")
    throw new Error(`optimizer endpoint returned HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
  const data: any = await res.json()
  const choice = data?.choices?.[0]
  if (choice?.finish_reason === "length")
    throw new Error(`optimizer reply was cut off at the token limit; raise "max_tokens" (or "max_completion_tokens" for OpenAI reasoning models) under "body" in the plugin config`)
  const c = choice?.message?.content
  const raw = typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? "").join("") : ""
  const content = raw.replace(/^\s*<think>[\s\S]*?<\/think>/, "").trim()
  if (!content) throw new Error("optimizer model returned empty content")
  return content
}

export function extractTag(text: string, tag: string): string | undefined {
  // last non-empty complete top-level block wins; a quoted copy of the tag inside a block stays text,
  // and blocks inside a closed top-level <think>…</think> are ignored
  // ponytail: a quoted, unpaired </tag> still ends the block early
  const blocks: string[] = []
  let depth = 0, start = 0, skipTo = 0
  for (const m of text.matchAll(new RegExp(`<(/?)(think|${tag})>`, "g"))) {
    if (m.index! < skipTo) continue
    if (m[2] === "think") {
      if (depth === 0 && !m[1]) {
        const end = text.indexOf("</think>", m.index)
        if (end >= 0) skipTo = end + 1
      }
      continue
    }
    if (!m[1]) { if (depth++ === 0) start = m.index! + m[0].length }
    else if (depth > 0 && --depth === 0) blocks.push(text.slice(start, m.index).trim())
  }
  return blocks.filter(Boolean).at(-1)
}

const head = (prompt: string, target: string) =>
  `<target_model>${target}</target_model>\n<original_prompt>\n${prompt}\n</original_prompt>`

export function buildOptimizerMessage(prompt: string, target: string, previous?: string): string {
  if (previous === undefined) return head(prompt, target)
  return `${head(prompt, target)}\n<previous_attempt>\n${previous}\n</previous_attempt>\n` +
    `Improve on the previous attempt. If it cannot be meaningfully improved, return it unchanged.`
}

export function buildJudgeMessage(prompt: string, target: string, candidates: string[]): string {
  return [head(prompt, target), ...candidates.map((c, i) => `<candidate index="${i + 1}">\n${c}\n</candidate>`)].join("\n")
}

export interface OptimizeInput {
  endpoint: Endpoint; system: string; judgeSystem: string
  prompt: string; target: string; turns: number; strategy: "parallel" | "refine"; timeoutMs: number
  body?: Record<string, unknown>
}
export interface OptimizeResult { prompt: string; candidates: string[]; chosen: number; judged: boolean; ms: number }

export async function optimize(input: OptimizeInput): Promise<OptimizeResult> {
  const start = Date.now()
  const opts = { timeoutMs: input.timeoutMs, body: input.body }
  const candidate = async (previous?: string) => {
    const reply = await chat(input.endpoint, [
      { role: "system", content: input.system },
      { role: "user", content: buildOptimizerMessage(input.prompt, input.target, previous) },
    ], opts)
    // never fall back to the raw reply: a refusal or chatter would replace the user's prompt
    const prompt = extractTag(reply, "optimized_prompt")
    if (!prompt) {
      const r = reply.replace(/\s+/g, " ")
      throw new Error(`optimizer reply has no text inside <optimized_prompt> tags (reply: "${r.length > 100 ? r.slice(0, 100) + "…" : r}")`)
    }
    return prompt
  }

  const turns = Math.max(1, input.turns)
  const candidates: string[] = []
  let firstError: unknown
  if (input.strategy === "refine") {
    for (let k = 0; k < turns; k++) {
      try { candidates.push(await candidate(candidates.at(-1))) }
      catch (e) { firstError = e; break }
    }
  } else {
    const settled = await Promise.allSettled(Array.from({ length: turns }, () => candidate()))
    for (const s of settled) {
      if (s.status === "fulfilled") candidates.push(s.value)
      else firstError ??= s.reason
    }
  }

  if (candidates.length === 0) throw firstError
  const done = (chosen: number, judged: boolean): OptimizeResult =>
    ({ prompt: candidates[chosen]!, candidates, chosen, judged, ms: Date.now() - start })
  if (candidates.length === 1) return done(0, false)

  const fallback = input.strategy === "refine" ? candidates.length - 1 : 0
  try {
    const reply = await chat(input.endpoint, [
      { role: "system", content: input.judgeSystem },
      { role: "user", content: buildJudgeMessage(input.prompt, input.target, candidates) },
    ], opts)
    const k = Number(extractTag(reply, "best")?.match(/\d+/)?.[0] ?? reply.match(/^\s*(\d+)\s*$/)?.[1])
    if (Number.isInteger(k) && k >= 1 && k <= candidates.length) return done(k - 1, true)
  } catch {
    // judge failure: fall through to the strategy's default pick
  }
  return done(fallback, false)
}
