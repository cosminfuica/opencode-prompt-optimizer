# src/ - plugin modules

## OVERVIEW
Server half (index.ts -> hooks.ts -> config.ts + optimizer.ts) plus TUI half (tui.ts, loaded separately via `exports["./tui"]`). Own file: score 22 (module boundary, 26 exports, most-referenced symbols).

## WHERE TO LOOK
| Concern | Anchor | Notes |
|---------|--------|-------|
| Skip rules, in order | hooks.ts:115-138 | command mark <10 s, config error, `enabled`, text/minChars/skipPatterns, child session, no model |
| Synthetic part append | hooks.ts:155 | metadata `promptOptimizer` = `PromptOptimizerMeta` (hooks.ts:24) |
| History rewrite for the model | hooks.ts:172-190 | replace-in-place, else `ignored: true` fallback |
| First-message toast delay | hooks.ts:54-59, 76 | 500 ms workaround for opencode 1.18.33 |
| Config path, merge, validation | config.ts:23, 31-118 | `fail()` -> `prompt-optimizer config <where>: <what>` |
| `{env:}` / `{file:}` substitution | config.ts:137 | file values only, single pass |
| Provider -> base URL + key | optimizer.ts:14, 25-61 | `KNOWN` map + catalogue `api.url` |
| Judge parse + fallback | optimizer.ts:184-199 | |
| `/optimized` command + dialog | tui.ts:110, 36-79 | |

## CONVENTIONS (module contracts)
### hooks.ts
- Only `import type` from config.ts/optimizer.ts; runtime functions arrive via `Deps`, so hook tests need no other module.
- SDK shapes are hand-written subsets (`HookClient`, `ProviderSource`; `Part` derived from `Hooks`). Extend them; keep `@opencode-ai/sdk` out of src.
- `output.parts`: append only, never reassign, never touch the user's parts. Transform: assign new objects to `output.messages[i]`; never reassign the array or mutate part objects (shared state).
- Every hook body sits in try/catch; toasts and logs go through `quiet()` (fire-and-forget, never awaited).
- `client.session.get` returns `{ error }` on HTTP failure instead of throwing: check `res.data` (hooks.ts:101); cache the child-session answer only on success.
- Failure toast ignores `cfg.toast`. Log messages start with `prompt-optimizer: ` (opencode drops `service`).
- `newPartID()` keeps opencode's ascending id shape so the synthetic part sorts after existing parts.

### config.ts
- Re-read on every message, built-in prompt files included (`readFileSync`); judge.md is read even when `turns` = 1 unless `judgePrompt` is set. Plugin options are captured once at startup.
- Shallow merge: plugin options are the base, file top-level keys replace them.
- `enabled: false` short-circuits validation of every other key and skips `{file:}` reads (config.ts:52-54, 82); only invalid JSONC or a non-boolean `enabled` still throw.
- A user `prompts` map replaces the built-in family map; only `default` is back-filled.
- New key: validate with `bool`/`str`/`int`/`strMap`, add to `Config` and the return object, then update the README Usage table, examples/prompt-optimizer.jsonc, the docs/design.md config table, and the `bad` table in tests/config.test.ts:132.

### optimizer.ts
- OpenAI chat-completions protocol only, `stream: false`. Body = `{ ...body, model, messages, stream }`: user `body` can't override those three.
- Catalogue `api.url` is trusted only for `@ai-sdk/openai-compatible` and `KNOWN` packages; `${VAR}` URLs throw.
- `extractTag`: last non-empty complete top-level block, ignoring blocks inside a closed `<think>`. `chat()` strips only a leading `<think>`.
- `parallel` = `Promise.allSettled`; `refine` = sequential, stops at the first failure keeping earlier candidates. Zero candidates rethrows the first error.
- Judge: `<best>k</best>` or a bare integer; anything else -> first (parallel) / last (refine) candidate with `judged: false`.
- `timeoutMs` is per request (covers the body read); no overall cap, so refine worst case is about turns x timeout + judge.

### tui.ts
- Builds elements with raw `@opentui/solid` calls (no JSX). opencode serves that module at runtime: dynamic import + `@ts-ignore`, never a dependency.
- Fallbacks: no solid or a render error -> `DialogAlert`; no `api.keymap.registerLayer` -> legacy `api.command.register`.
- Keymap layer `priority: 1` beats opencode's global pageup/pagedown/home/end; it is disposed with the dialog.
- `Meta` is redeclared locally (subset of `PromptOptimizerMeta`): keep the fields in sync.

## ANTI-PATTERNS
- Value imports from config.ts/optimizer.ts into hooks.ts.
- Awaiting toast/log calls, or letting their errors escape a hook.
- Static import of `@opentui/solid`, or adding it to package.json.
- Caching a failed `session.get` lookup as "not a child".
