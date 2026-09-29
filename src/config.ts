import { existsSync, readFileSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export interface Config {
  enabled: boolean; model?: string; baseURL?: string; apiKey?: string
  headers: Record<string, string>; body: Record<string, unknown>
  turns: number; strategy: "parallel" | "refine"; timeoutMs: number; minChars: number; skipPatterns: RegExp[]
  toast: boolean
  prompts: Record<string, string>   // resolved TEXT, insertion order kept
  judgePrompt: string               // resolved text
}
export interface LoadOptions {
  builtinDir?: string; env?: Record<string, string | undefined>
  options?: Record<string, unknown>  // from opencode.json `["<package>", { … }]`; the config file overrides them per key
}
type Env = Record<string, string | undefined>

const DEFAULT_SKIP = ["<!--\\s*OMO_INTERNAL", "^\\s*\\[SYSTEM DIRECTIVE", "^/[\\w.-]+(\\s|$)"]
const BUILTIN_PROMPTS: Record<string, string> = { "*claude*": "anthropic.md", "*gpt*": "gpt.md", "*gemini*": "gemini.md", default: "default.md" }

export function configPath(env: Env = process.env): string {
  if (env.OPENCODE_PROMPT_OPTIMIZER_CONFIG) return env.OPENCODE_PROMPT_OPTIMIZER_CONFIG
  const dir = join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "opencode")
  const jsonc = join(dir, "prompt-optimizer.jsonc")
  const json = join(dir, "prompt-optimizer.json")
  return !existsSync(jsonc) && existsSync(json) ? json : jsonc
}

export async function loadConfig(path?: string, opts: LoadOptions = {}): Promise<Config> {
  const env = opts.env ?? process.env
  const file = path ?? configPath(env)
  const exists = existsSync(file)
  const hasOptions = isObject(opts.options) && Object.keys(opts.options).length > 0
  const where = !hasOptions ? file : exists ? `${file} + plugin options` : "plugin options"
  const fail = (what: string): never => { throw new Error(`prompt-optimizer config ${where}: ${what}`) }
  const builtinDir = opts.builtinDir ?? fileURLToPath(new URL("../prompts/", import.meta.url))
  const builtin = (name: string) => {
    try { return readFileSync(join(builtinDir, name), "utf8").trim() }
    catch { return fail(`cannot read built-in prompt ${join(builtinDir, name)}`) }
  }

  // plugin options arrive already {env:}/{file:}-substituted by opencode
  let raw: Record<string, unknown> = isObject(opts.options) ? { ...opts.options } : {}
  if (exists) {
    let parsed: unknown
    try { parsed = Bun.JSONC.parse(readFileSync(file, "utf8")) }
    catch (e) { fail(`invalid JSONC (${(e as Error).message})`) }
    if (!isObject(parsed)) fail("top level must be an object")
    const home = env.HOME || homedir()
    raw = { ...raw, ...(substitute(parsed, env, dirname(resolve(file)), home, fail) as Record<string, unknown>) }
  }

  const bool = (k: string, d: boolean) => {
    const v = raw[k]
    if (v === undefined) return d
    return typeof v === "boolean" ? v : fail(`"${k}" must be a boolean`)
  }
  const str = (k: string) => {
    const v = raw[k]
    if (v === undefined) return undefined
    return typeof v === "string" ? v : fail(`"${k}" must be a string`)
  }
  const int = (k: string, d: number, min: number, max = Infinity) => {
    const v = raw[k]
    if (v === undefined) return d
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max)
      fail(`"${k}" must be an integer ${max === Infinity ? `>= ${min}` : `${min}..${max}`}`)
    return v as number
  }
  const strMap = (k: string) => {
    const v = raw[k]
    if (v === undefined) return undefined
    if (!isObject(v) || Object.values(v).some((x) => typeof x !== "string")) fail(`"${k}" must be an object of strings`)
    return { ...(v as Record<string, string>) }
  }

  const strategy = raw.strategy ?? "parallel"
  if (strategy !== "parallel" && strategy !== "refine") fail(`"strategy" must be "parallel" or "refine"`)
  if (raw.body !== undefined && !isObject(raw.body)) fail(`"body" must be an object`)

  const patterns = raw.skipPatterns ?? DEFAULT_SKIP
  if (!Array.isArray(patterns) || patterns.some((p) => typeof p !== "string")) fail(`"skipPatterns" must be an array of strings`)
  const skipPatterns = (patterns as string[]).map((p) => {
    try { return new RegExp(p) } catch (e) { return fail(`invalid skipPatterns regex ${JSON.stringify(p)} (${(e as Error).message})`) }
  })

  const model = str("model")
  const baseURL = str("baseURL")
  if (baseURL && !model) fail(`"model" is required when "baseURL" is set`)

  let prompts = strMap("prompts")
  if (!prompts) prompts = Object.fromEntries(Object.entries(BUILTIN_PROMPTS).map(([k, f]) => [k, builtin(f)]))
  else if (prompts.default === undefined) prompts.default = builtin("default.md")

  return {
    enabled: bool("enabled", true),
    model,
    baseURL,
    apiKey: str("apiKey"),
    headers: strMap("headers") ?? {},
    body: { ...((raw.body as Record<string, unknown>) ?? {}) },
    turns: int("turns", 1, 1, 8),
    strategy: strategy as Config["strategy"],
    timeoutMs: int("timeoutMs", 60000, 1000),
    minChars: int("minChars", 20, 0),
    skipPatterns,
    toast: bool("toast", true),
    prompts,
    judgePrompt: str("judgePrompt") ?? builtin("judge.md"),
  }
}

export function selectPrompt(cfg: Config, target: string): string {
  for (const [glob, text] of Object.entries(cfg.prompts)) {
    if (glob !== "default" && globMatch(glob, target)) return text
  }
  if (cfg.prompts.default !== undefined) return cfg.prompts.default
  throw new Error(`prompt-optimizer: no prompt matches "${target}" and no "default" prompt is set`)
}

export function globMatch(pattern: string, s: string): boolean {
  const re = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".")
  return new RegExp(`^${re}$`, "is").test(s)
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function substitute(v: unknown, env: Env, dir: string, home: string, fail: (what: string) => never): unknown {
  if (typeof v === "string") {
    // single pass: substituted values are never re-scanned
    return v.replace(/\{(env|file):([^}]+)\}/g, (_, kind: string, arg: string) => {
      arg = arg.trim()
      if (kind === "env") return env[arg] ?? ""
      const full = arg.startsWith("~/") ? join(home, arg.slice(2)) : resolve(dir, arg)
      try { return readFileSync(full, "utf8").trim() } catch { return fail(`cannot read {file:${arg}} (${full})`) }
    })
  }
  if (Array.isArray(v)) return v.map((x) => substitute(x, env, dir, home, fail))
  if (isObject(v)) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, substitute(x, env, dir, home, fail)]))
  return v
}
