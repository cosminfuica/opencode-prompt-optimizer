# opencode-prompt-optimizer — design contract

Status: v1 contract. Every module owner codes against THIS file. Do not change an
interface here without the integrator's approval; if you must deviate, say so in
your final report.

## Goal

Runs when the user sends a message in opencode:

    user -> prompt-optimizer (small model rewrites the prompt) -> opencode target model

- A config file controls: optimizer model (opencode provider, or a custom
  OpenAI-compatible endpoint), the optimizer system prompt, a different prompt
  for each TARGET model, and the number of optimization turns.
- turns = N > 1: N rewrite calls run in parallel, then one extra judge call gets
  all N candidates and picks the best. The best one is sent on.
- The user still sees their original message in the chat. The optimized prompt
  is shown only as UI (a toast plus a `/optimized` dialog). It must never be
  included in the model's reply.

## How it works (the mechanism is fixed; don't redesign it)

opencode's TextPart has two flags:
- `synthetic: true`: the part IS sent to the model. The TUI hides it from the
  user bubble.
- `ignored: true`: the part is NOT sent to the model.

Two server hooks, both typed in `Hooks` from `@opencode-ai/plugin`:

1. `chat.message(input, output)`. It runs after opencode builds the user message
   parts and before it saves them and sends them to the model. Hooks are awaited,
   so a few seconds of async work is fine. `output.parts` is the same array opencode
   saves afterwards: mutate it IN PLACE (`push`) and never reassign it. On success
   it appends ONE part and does not touch the user's own parts:
   ```ts
   { id: newPartID(), sessionID: input.sessionID, messageID: output.message.id,
     type: "text", text: <optimized prompt>, synthetic: true,
     metadata: { promptOptimizer: PromptOptimizerMeta } }
   ```
   Because the part is synthetic, the TUI user bubble still shows only the original
   message. Timeline, fork, copy, and revert keep working on the original text.
2. `experimental.chat.messages.transform(_input, output)`. It runs before every
   model request (and before compaction) on that request's copy of the history.
   Mutate the array `output.messages` IN PLACE by index assignment; opencode keeps
   using the same array. Never reassign `output.messages` and never mutate existing
   part objects (they may be shared state). Algorithm:
   ```ts
   for (let i = 0; i < output.messages.length; i++) {
     const m = output.messages[i]
     if (m.info.role !== "user") continue
     const s = m.parts.find(p => p.type === "text" && p.metadata?.promptOptimizer)
     if (!s) continue
     const original = s.metadata.promptOptimizer.original
     const real = m.parts.filter(p => p.type === "text" && !p.synthetic && !p.ignored)
     const parts = real.length === 1 && real[0].text.includes(original)
       // replace in place: keeps text that other plugins injected around the user's words
       ? m.parts.filter(p => p !== s).map(p => p === real[0] ? { ...p, text: p.text.replace(original, () => s.text) } : p)
       // fallback: hide the user's text parts; the synthetic optimized part carries the prompt
       : m.parts.map(p => real.includes(p) ? { ...p, ignored: true } : p)
     output.messages[i] = { ...m, parts }
   }
   ```
   The model gets the optimized prompt instead of the original, plus any file/agent
   parts. If this hook stops running (API change, plugin removed), the model gets
   original + optimized. That is degraded, not broken.

On any failure or skip, `chat.message` leaves `output.parts` untouched and the
original prompt goes through. **Neither hook may throw.** A throw would break the
user's message.

Part IDs: `"prt_" + 12 lowercase hex chars + 14 base62 chars`. The hex part is
`(BigInt(Date.now()) * 0x1000n + counter)` formatted as 12 hex digits. This
matches opencode's ascending ids, so our part sorts after the existing ones.

```ts
interface PromptOptimizerMeta {
  version: 1
  original: string        // user text that was optimized
  optimizerModel: string  // model name sent to the endpoint
  target: string          // "providerID/modelID" of the model receiving the prompt
  turns: number           // configured turns
  candidates: string[]    // all successful candidates (length 1 when turns = 1)
  chosen: number          // 0-based index of the chosen candidate
  judged: boolean         // true when a judge call picked it
  ms: number              // elapsed wall time
}
```

## Repo layout and ownership

```
~/Projects/opencode-prompt-optimizer/
  DESIGN.md                this file (integrator)
  package.json tsconfig.json   (integrator) bun test / tsc --noEmit
  prompt-optimizer.jsonc   example config (integrator)
  src/config.ts            (A) config loading/validation/prompt selection
  src/optimizer.ts         (B) endpoint resolution, HTTP calls, turns + judge
  src/hook.ts              (C) createHooks(deps): the chat.message logic
  src/server.ts            (C) thin plugin entry (exports ONLY the plugin fn)
  src/tui.ts               (D) TUI plugin: /optimized dialog
  prompts/{default,anthropic,gpt,gemini,judge}.md   (F) prompt library
  test/mock-openai.ts      shared mock server (integrator; do not edit)
  test/config.test.ts      (A)   test/optimizer.test.ts (B)
  test/hook.test.ts        (C)   test/tui.test.ts (D, optional)
  test/e2e.ts              (E) real opencode binary + mock provider
  README.md install.sh     (E)
```
Only edit files you own. Runtime: Bun (opencode 1.18.32 embeds Bun 1.3.14; the
system has bun 1.4.2). Use ESM TypeScript with `.ts` extensions in relative imports.
Use no runtime dependencies. Only `import type` from `@opencode-ai/plugin` / `@opencode-ai/sdk`.

## Install layout (used by install.sh and e2e)

```
$CFG = ${XDG_CONFIG_HOME:-~/.config}/opencode
$CFG/plugins/prompt-optimizer/            -> symlink to the repo (or a copy)
$CFG/plugins/prompt-optimizer.ts          loader, auto-loaded by opencode:
    export { PromptOptimizer } from "./prompt-optimizer/src/server.ts"
$CFG/prompt-optimizer.jsonc               user config (copied from the example if absent)
$CFG/tui.json  "plugin": [..., "./plugins/prompt-optimizer/src/tui.ts"]
```
opencode auto-loads only top-level `plugins/*.{ts,js}`. That is why the helpers
live in a subdirectory. Every export of a server plugin module must be a plugin
function, so server.ts exports only `PromptOptimizer`.

Load order matters for plugins that inject text into the user's message, such as
oh-my-openagent's keyword modes and AGENTS.md injection. Their `chat.message`
hooks edit the user's text part in place.
- Default install (the loader in `plugins/`) runs AFTER the plugins listed in
  opencode.json. The optimizer then sees their injected text and is told to keep
  it verbatim.
- "Run first" install: delete the loader and put
  `"./plugins/prompt-optimizer/src/server.ts"` FIRST in opencode.json `"plugin"`.
  The optimizer then sees only what the user typed. The transform's
  replace-in-place step keeps other plugins' injections around the optimized text.
  Use one method or the other, never both: both would double-optimize.

## Config file (A)

Path: `$OPENCODE_PROMPT_OPTIMIZER_CONFIG`, else `$CFG/prompt-optimizer.jsonc`,
else `$CFG/prompt-optimizer.json`. If no file exists, use defaults. The format is
JSONC (comments + trailing commas), parsed with `Bun.JSONC.parse`. The file is
re-read on every message, so edits apply live.

| key | type | default | notes |
|---|---|---|---|
| enabled | boolean | true | |
| model | string? | opencode `small_model` | `"provider/model"` from opencode config; or the raw model name when `baseURL` is set |
| baseURL | string? | — | custom OpenAI-compatible endpoint (…/v1) |
| apiKey | string? | — | only used with baseURL |
| headers | object | {} | extra HTTP headers |
| body | object | {} | extra request-body fields merged into every call (temperature, max_tokens, reasoning_effort…) |
| turns | int 1..8 | 1 | N optimization calls; N>1 adds 1 judge call |
| strategy | "parallel" \| "refine" | "parallel" | how the N calls run (see optimizer) |
| timeoutMs | int ≥1000 | 60000 | per HTTP request |
| minChars | int ≥0 | 20 | shorter trimmed text is not optimized |
| skipPatterns | string[] (regex) | see below | if any matches the text, it is not optimized |
| toast | boolean | true | progress/success toasts (failure toasts always show) |
| prompts | {glob: string} | built-ins | optimizer system prompt chosen by TARGET model |
| judgePrompt | string | built-in judge.md | |

Default skipPatterns: `["<!--\\s*OMO_INTERNAL", "^\\s*\\[SYSTEM DIRECTIVE", "^/[\\w.-]+(\\s|$)"]`.
They cover other plugins' automated prompts and slash-command-like text.

String substitution applies recursively to every string value: `{env:VAR}` becomes
the env value (or ""), and `{file:path}` becomes the file contents, trimmed. The
path is relative to the config file's directory; `~/` means the home dir.

Prompt selection: `selectPrompt(cfg, "providerID/modelID")`. Keys are globs
(`*`, `?`) matched case-insensitively against the full `"providerID/modelID"`.
Keys are tried in insertion order (`"default"` excluded) and the first match wins.
Then comes `prompts.default`, then the built-in default.md. When the file has no
`prompts` key, the built-ins are:
`{"*claude*": anthropic.md, "*gpt*": gpt.md, "*gemini*": gemini.md, "default": default.md}`.
They are read from `<repo>/prompts/` (resolved via `import.meta.url`).

```ts
// src/config.ts
export interface Config {
  enabled: boolean; model?: string; baseURL?: string; apiKey?: string
  headers: Record<string, string>; body: Record<string, unknown>
  turns: number; strategy: "parallel" | "refine"; timeoutMs: number; minChars: number; skipPatterns: RegExp[]
  toast: boolean
  prompts: Record<string, string>   // resolved TEXT, insertion order kept
  judgePrompt: string               // resolved text
  path?: string                     // file used; undefined => defaults
}
export interface LoadOptions { builtinDir?: string; env?: Record<string, string | undefined> }
export function configPath(env?: Record<string, string | undefined>): string
export async function loadConfig(path?: string, opts?: LoadOptions): Promise<Config>
  // missing file => defaults. Invalid JSONC / invalid values / unreadable {file:} =>
  // throw Error("prompt-optimizer config <path>: <what is wrong>")
export function selectPrompt(cfg: Config, target: string): string
export function globMatch(pattern: string, s: string): boolean
```

## Optimizer core (B)

```ts
// src/optimizer.ts
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
export async function resolveEndpoint(cfg: Pick<Config, "model" | "baseURL" | "apiKey" | "headers">, client: ProviderSource): Promise<Endpoint>
export interface OptimizeInput {
  endpoint: Endpoint; system: string; judgeSystem: string
  prompt: string; target: string; turns: number; strategy: "parallel" | "refine"; timeoutMs: number
  body?: Record<string, unknown>
}
export interface OptimizeResult { prompt: string; candidates: string[]; chosen: number; judged: boolean; ms: number }
export async function optimize(input: OptimizeInput): Promise<OptimizeResult>
export async function chat(endpoint: Endpoint, messages: { role: "system" | "user"; content: string }[],
                           opts: { timeoutMs: number; body?: Record<string, unknown> }): Promise<string>
export function extractTag(text: string, tag: string): string | undefined
export function buildOptimizerMessage(prompt: string, target: string, previous?: string): string
export function buildJudgeMessage(prompt: string, target: string, candidates: string[]): string
```

resolveEndpoint:
- If `cfg.baseURL` is set: return `{ baseURL, apiKey: cfg.apiKey, model: cfg.model, headers: cfg.headers }`.
  `model` is required here. Never send opencode provider keys to a custom baseURL.
- Otherwise: `ref = cfg.model ?? (await client.config.get()).data?.small_model`, then split
  at the first "/" into providerID and modelKey. Look up the provider and the model
  in `client.config.providers()`. Then:
  - `baseURL = model.api?.url || provider.options?.baseURL || KNOWN[model.api?.npm]`, with:
    ```
    KNOWN = { "@ai-sdk/openai": "https://api.openai.com/v1",
      "@ai-sdk/anthropic": "https://api.anthropic.com/v1",
      "@ai-sdk/google": "https://generativelanguage.googleapis.com/v1beta/openai",
      "@openrouter/ai-sdk-provider": "https://openrouter.ai/api/v1",
      "@ai-sdk/groq": "https://api.groq.com/openai/v1", "@ai-sdk/mistral": "https://api.mistral.ai/v1",
      "@ai-sdk/deepseek": "https://api.deepseek.com/v1", "@ai-sdk/xai": "https://api.x.ai/v1" }
    ```
    (Each of these vendors serves an OpenAI-compatible /chat/completions.)
  - `apiKey = provider.key ?? provider.options?.apiKey ?? process.env[provider.env?.[0]]`.
    OAuth-only logins have no key; the call then fails and the user gets the
    original prompt plus a toast.
  - `model = model.api?.id || modelKey`. The config key can differ from the API id,
    e.g. `claude-sonnet-5-fast` has api.id `claude-sonnet-5(none)`.
  - `headers = { ...provider.options?.headers, ...cfg.headers }`
  - If anything is missing, throw a readable Error that says what to set, e.g.
    `optimizer model "x/y" not found in opencode providers` or
    `no baseURL for provider "x" — set "baseURL" in prompt-optimizer.jsonc`.

chat: POST `${baseURL without trailing /}/chat/completions` with the JSON
`{ model, messages, stream: false, ...body }` and the headers
`Content-Type: application/json`, `Authorization: Bearer <apiKey>` (only if apiKey), and `...headers`.
Use `AbortSignal.timeout(timeoutMs)`. A non-2xx response throws an Error with the
status and a snippet of the body. `choices[0].finish_reason === "length"` throws: the
reply was cut off, so the message says to raise `max_tokens`. Content is `choices[0].message.content` (a string,
or an array of `{text}` pieces). Strip `<think>…</think>` blocks and trim. Empty
content throws.

optimize:
- The candidate call uses `[system: input.system, user: buildOptimizerMessage(prompt, target, previous?)]`.
  The candidate is the last non-empty `<optimized_prompt>` block (`extractTag`). If there is none,
  the call fails like any other error. The raw reply is never used as the prompt.
- turns = 1 makes one call.
- strategy "parallel", turns = N: run N independent calls in parallel
  (`Promise.allSettled`, no `previous`) and keep the successes in input order.
- strategy "refine", turns = N: run the calls one after another. Call k > 1 passes
  the candidate from call k-1 as `previous`. If a call fails, stop refining and keep
  the candidates so far.
- Then, for both strategies:
  - 0 successes: throw with the first error.
  - 1 success: use it (`judged = false`).
  - 2 or more: one judge call with `[system: judgeSystem, user: buildJudgeMessage(prompt, target, candidates)]`.
    Parse `<best>k</best>` (1-based). If that fails, use the first integer in the
    reply. If the judge fails or k is out of range, use the LAST candidate for
    "refine" and candidate 1 for "parallel". `judged` is true only when the judge's
    answer was used.

Message formats (the mock server relies on these tags):
```
buildOptimizerMessage:
<target_model>{target}</target_model>
<original_prompt>
{prompt}
</original_prompt>
  …and when `previous` is given, it appends:
<previous_attempt>
{previous}
</previous_attempt>
Improve on the previous attempt. If it cannot be meaningfully improved, return it unchanged.

buildJudgeMessage:
<target_model>{target}</target_model>
<original_prompt>
{prompt}
</original_prompt>
<candidate index="1">
{c1}
</candidate>
<candidate index="2">
{c2}
</candidate>
```
Output contracts that the prompt files (F) must instruct:
- The optimizer replies with the rewrite inside `<optimized_prompt>…</optimized_prompt>`.
- The judge replies with an optional `<reason>…</reason>`, then `<best>k</best>`.

## Hook wiring (C)

```ts
// src/hook.ts
import type { Hooks } from "@opencode-ai/plugin"
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
export function createHooks(deps: Deps): Pick<Hooks, "chat.message" | "command.execute.before" | "experimental.chat.messages.transform">
export function newPartID(): string
```
```ts
// src/server.ts: the ONLY export is the plugin function
import type { Plugin } from "@opencode-ai/plugin"
export const PromptOptimizer: Plugin = async ({ client }) =>
  createHooks({ client, loadConfig: () => loadConfig(), selectPrompt, resolveEndpoint, optimize })
```
hook.ts must use only `import type` from config.ts/optimizer.ts. Every runtime
function arrives through `deps`, so hook tests need no other module.
chat.message steps, in order. Wrap everything in try/catch. Never throw.
1. If `command.execute.before` marked this sessionID: clear the mark and skip.
   Slash-command templates are not optimized.
2. `cfg = await loadConfig()`. On error: warning toast (the message), log, skip.
   If `!cfg.enabled`, skip.
3. `userParts` = text parts with `!synthetic && !ignored`. `text` = their texts joined
   by "\n\n", then trimmed. Skip if empty, if `text.length < cfg.minChars`, or if any
   skipPattern matches.
4. Skip child sessions (subagents/task tool): `client.session.get` returns a
   `parentID`. Cache the result per sessionID. If the lookup fails, treat the
   session as not a child.
5. `target = output.message.model ?? input.model` (both `{providerID, modelID}`), as the string `"p/m"`.
6. `endpoint = await resolveEndpoint(cfg, client)`. If `cfg.toast`, show an info toast:
   title "Prompt optimizer", message `Optimizing with <endpoint.model>…`, and
   `(N candidates + judge)` when turns > 1. Duration = `cfg.timeoutMs`; the next
   toast replaces it.
7. `result = await deps.optimize({ endpoint, system: deps.selectPrompt(cfg, target), judgeSystem: cfg.judgePrompt, prompt: text, target, turns: cfg.turns, strategy: cfg.strategy, timeoutMs: cfg.timeoutMs, body: cfg.body })`.
8. Append the synthetic part as described in "How it works". Do NOT modify the
   user's parts; the transform hook hides them from the model. If `cfg.toast`,
   show a success toast: title "✨ Prompt optimized", message = first 300 chars of
   the optimized prompt (plus "…" if cut), then "\n\n/optimized to view full".
   Duration 8000.
9. On any error in 6–8: parts stay untouched. Warning toast (always shown): title
   "Prompt optimizer", message `Sent your original prompt — <error.message>`,
   duration 6000. Log at warn level.
Logging goes through `client.app.log` with service "prompt-optimizer". Never log apiKey.
Toast/log failures are swallowed.

`command.execute.before({sessionID})`: record `sessionID` in a Set of pending
slash-command runs. Step 1 above consumes it. Slash commands arrive as rendered
templates; optimizing them would be surprising.

`experimental.chat.messages.transform`: exactly as described in "How it works".
It is synchronous-safe and cheap, and must never throw (wrap it in try/catch).

## TUI display (D)

`src/tui.ts`: plain TypeScript, NO JSX. It has
`export default { id: "prompt-optimizer", tui }`, with types from
`@opencode-ai/plugin/tui` (TuiPlugin / TuiPluginApi; see
`node_modules/@opencode-ai/plugin/dist/tui.d.ts`). Build UI from `api.ui.*`
components. If raw elements are needed (e.g. a sidebar slot), do what the installed
oh-my-openagent TUI plugin does: `const solid = await import("@opentui/solid")`,
then `solid.createElement("box"|"text")`, `solid.setProp`, and `solid.insert`.
Reference: `~/.cache/opencode/packages/oh-my-openagent@latest/node_modules/oh-my-openagent/dist/tui.js`
lines 81830-81958.
- It registers the palette command "Show optimized prompt" as slash `/optimized`,
  category "Prompt Optimizer". Preferred:
  `api.keymap.registerLayer({ commands: [{ name: "prompt-optimizer.show", title, category, namespace: "palette", slashName: "optimized", run() {…} }] })`.
  The deprecated `api.command.register` is a fallback. Dispose through `api.lifecycle.onDispose`.
- run(): the session comes from `api.route.current` (`name === "session"`, `params.sessionID`).
  Walk `api.state.session.messages(sessionID)` newest-first. For each user message,
  `api.state.part(message.id)` gives its parts; find a text part with
  `metadata?.promptOptimizer`. If found, open a large dialog with `api.ui.dialog.replace`. It has the title
  `"Optimized prompt · <optimizerModel>"`, then the metadata line (target, turns, `candidate k/N by judge`, ms),
  then `part.text` in a `scrollbox`, then a key hint. These are raw `@opentui/solid` elements; the dialog height
  is capped to fit the terminal. While the dialog is open, a priority-1 `api.keymap.registerLayer` layer scrolls
  it: ↑↓/j/k, PgUp/PgDn, Home/End. Enter closes it. The layer is removed in the dialog's `onClose`. The mouse
  wheel scrolls natively. DialogAlert can't scroll and cuts off tall text, and opencode's session keys make PgDn
  close it. If `@opentui/solid` is unavailable, fall back to `api.ui.DialogAlert` with the metadata first,
  so it is never the part that gets cut off. Otherwise show a toast: "No optimized prompt in this session yet".
- Visual only. Nothing is sent to the model.

## Tests

- `bun test` runs the `test/*.test.ts` unit tests. They must not touch the network
  or real user config. Use `test/mock-openai.ts` (`startMock({ port: 0, log, fail })`)
  for HTTP.
- `bun test/e2e.ts` runs the real `opencode serve` with isolated XDG_CONFIG_HOME,
  XDG_DATA_HOME, and XDG_STATE_HOME temp dirs. It configures a mock OpenAI-compatible
  provider and asserts the full flow (see the E task).
- Never modify `~/.config/opencode` or `~/.local/share/opencode` in tests. Never kill
  opencode processes you didn't start: the user runs opencode on this machine.
