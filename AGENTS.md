# PROJECT KNOWLEDGE BASE

**Generated:** 2026-10-02 16:31 +03:00
**Commit:** 059480a
**Branch:** main

## OVERVIEW
OpenCode plugin: a small model (any OpenAI-compatible chat API) rewrites the user's prompt before the main model sees it; the chat still shows the original. TypeScript ESM on Bun (opencode embeds it), compiled by `tsc` 7 to `dist/`; zero runtime dependencies.

## STRUCTURE
```
opencode-prompt-optimizer/
├── src/               # server half (index/hooks/config/optimizer) + TUI half (tui.ts); see src/AGENTS.md
├── prompts/           # built-in system prompts read at runtime; listed in package.json "files"
├── tests/             # bun unit tests + standalone e2e/TUI scripts; see tests/AGENTS.md
├── docs/design.md     # module contracts (the spec); README sends contributors here
├── examples/          # opencode.json, tui.json, prompt-optimizer.jsonc; parsed by tests/config.test.ts
└── .github/readme/    # README media + BRIEF.md art direction + tools/ (asset generators); not shipped
```

## WHERE TO LOOK
| Task | Location | Notes |
|------|----------|-------|
| When/how a prompt is rewritten or skipped | src/hooks.ts | contract: docs/design.md "Hooks" |
| Add or change a config key | src/config.ts | sync checklist in src/AGENTS.md |
| Optimizer model, endpoint, judge | src/optimizer.ts | OpenAI chat-completions only |
| `/optimized` dialog | src/tui.ts | layout guarded by `bun run tui-smoke` |
| Rewrite quality, per-model style | prompts/*.md | tag contract under ANTI-PATTERNS |
| New provider base URL | `KNOWN` in src/optimizer.ts:14 | provider npm package -> OpenAI-compatible root |
| User-facing docs | README.md, examples/ | defaults must match src/config.ts |
| CI | .github/workflows/ci.yml | `check` + `e2e` jobs |

## CODE MAP
Refs = src references (LSP) + test call sites.

| Symbol | Type | Location | Refs | Role |
|--------|------|----------|------|------|
| PromptOptimizerPlugin | const | src/index.ts:8 | 1 | server entry; wires real deps into createHooks |
| createHooks | fn | src/hooks.ts:66 | 3 | returns the 3 hooks; every runtime dep injected |
| loadConfig | fn | src/config.ts:31 | 24 | file + plugin options -> validated Config, every message |
| selectPrompt | fn | src/config.ts:120 | 11 | target `provider/model` glob -> optimizer system prompt |
| resolveEndpoint | fn | src/optimizer.ts:25 | 18 | optimizer model -> baseURL/apiKey/headers |
| optimize | fn | src/optimizer.ts:150 | 20 | N candidates (parallel/refine) + judge |
| chat | fn | src/optimizer.ts:63 | 12 | one non-streaming `/chat/completions` POST |
| extractTag | fn | src/optimizer.ts:109 | 10 | parses `<optimized_prompt>` / `<best>` |
| default export | object | src/tui.ts:131 | 6 | `{ id, tui }`; registers `/optimized` |
| startMock | fn | tests/mock-openai.ts:13 | 4 | mock OpenAI server for unit tests, e2e, tui-smoke |

## CONVENTIONS
- Relative imports end in `.ts` (`./config.ts`); `rewriteRelativeImportExtensions` emits `.js` in dist/. `verbatimModuleSyntax` is on: types need `import type`.
- `@opencode-ai/*` imports in src/ are type-only: `@opencode-ai/plugin` is an optional peer, absent at runtime, so a value import fails to load silently (enforced by tests/index.test.ts).
- Bun APIs are fine in src (`Bun.JSONC.parse`); Node is not a target.
- No formatter or linter config: no semicolons, double quotes, 2-space indent, long lines (up to ~180 cols). Match surrounding code.
- `// ponytail:` marks a deliberate shortcut with its ceiling and upgrade path (hooks.ts:58, optimizer.ts:52, optimizer.ts:112, tui.ts:59, tests/e2e.ts:56). Use it for new ones.
- Comments on opencode-specific behavior name the opencode version observed (e.g. hooks.ts:56 "opencode 1.18.33").
- devDependencies are pinned exactly; Renovate automerges minor/patch/pin/digest once CI passes. CI e2e installs `opencode-ai@<@opencode-ai/plugin version>`, so bumping that dep changes the opencode under test.

## ANTI-PATTERNS (THIS PROJECT)
- Exporting anything besides `PromptOptimizerPlugin` from src/index.ts: opencode calls every export as a plugin.
- A TUI module exporting more than default `{ id, tui }`, or exporting `server`.
- Redesigning the synthetic-part + transform mechanism: docs/design.md:20 "the mechanism is fixed; don't redesign it".
- Using the raw optimizer reply when `<optimized_prompt>` is missing: a refusal or chatter would replace the user's prompt.
- Sending opencode provider keys to a custom `baseURL`; logging `apiKey`.
- Renaming `<optimized_prompt>`, `<best>`, `<original_prompt>` or `<candidate>` in one place: prompts/*.md, src/optimizer.ts and tests/mock-openai.ts change together.
- Reintroducing an npm install path or docs: PR #9 removed it; install is a local build (README known limits).

## UNIQUE STYLES
- docs/design.md is the module spec and is kept in step with code (the first-toast delay is documented there); update it with behavior changes.
- Optimizer prompts (anthropic/gemini/gpt/default.md) share one skeleton: Input, Rules in priority order, model-specific advice, Examples, Output format. Rules 1-6 are near-identical, so edit shared rules in all four.
- Error messages are user-facing (shown in the warning toast): lowercase, actionable, naming the key to change (e.g. `set "baseURL" in the plugin config`).

## COMMANDS
```bash
bun install --frozen-lockfile
bun run typecheck   # tsc --noEmit over src + tests
bun test            # tests/*.test.ts only
bun run build       # rm -rf dist && tsc -p tsconfig.build.json
bun run e2e         # build, then real `opencode serve` + mock provider
bun run tui-smoke   # build, then real opencode TUI in tmux
opencode plugin "$PWD" -g   # install this checkout (server + tui entries)
```

## NOTES
- dist/ is gitignored and is what opencode loads (package.json exports `.`, `./server`, `./tui`). Rebuild and restart opencode after src changes.
- Built-in prompts load via `new URL("../prompts/", import.meta.url)`: works from src/ and dist/; moving prompts/ or config.ts breaks it.
- Order in the opencode.json `plugin` array matters relative to other text-injecting plugins (docs/design.md:118-123).
- The session-title request skips the transform hook: the title model sees original + rewrite (known limit).
- Logs: `grep prompt-optimizer ~/.local/share/opencode/log/*.log`.
- Doc drift: design.md:14 says N rewrites run in parallel (`refine` exists too); design.md:127 `$CFG` = `${XDG_CONFIG_HOME:-~/.config}/opencode`; "tested with" opencode differs (design.md 1.18.32, README and devDeps 1.18.34).
