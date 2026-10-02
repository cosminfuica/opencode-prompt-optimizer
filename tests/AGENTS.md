# tests/ - unit suite and real-opencode harnesses

## OVERVIEW
Two tiers: `bun test` collects `*.test.ts` (fakes + local servers); standalone scripts drive a real opencode against built dist/. Own file: score 8, distinct domain (mock provider, real-opencode and tmux harnesses).

## WHERE TO LOOK
| File | Run by | Covers |
|------|--------|--------|
| config.test.ts | bun test | loadConfig/configPath/selectPrompt/globMatch; bad-config table L132; parses examples/ |
| hooks.test.ts | bun test | createHooks through `setup()` (L15): fake client + fake deps, failure flags |
| optimizer.test.ts | bun test | chat/optimize/resolveEndpoint/extractTag against local servers |
| tui.test.ts | bun test | `/optimized` through a `fake()` TUI api (L9) |
| index.test.ts | bun test | entry export shapes; type-only `@opencode-ai/*` imports in src |
| mock-openai.ts | helper + CLI | `startMock({ port, log, fail, slowMs })`; `bun tests/mock-openai.ts [port] [logfile]` |
| e2e.ts | `bun run e2e` | real `opencode serve` + mock: call order, metadata, history, live `enabled: false` |
| tui-smoke.ts | `bun run tui-smoke` | real TUI in tmux: first-message toast title, dialog scroll/resize/close |
| live.ts | manual only | one real optimization with your own providers; not in CI |

## CONVENTIONS
### mock-openai.ts
- Routes on the last user message: `<candidate` -> judge reply picking the LAST candidate; `<original_prompt>` -> `<optimized_prompt>OPTIMIZED#<n>: <original>`; anything else -> `MOCK REPLY` (target model, titles).
- `n` is global per mock instance: assert with `/OPTIMIZED#\d+/`, never a fixed number.
- `fail(body)` -> HTTP 500; `slowMs` delays optimizer/judge replies only; `log` appends JSONL `{ path, auth, body }`.

### Unit tests
- Unit tests touch no network and no real config: servers on `port: 0` + `127.0.0.1`, stopped in `finally { s.stop(true) }`; `loadConfig(path, { builtinDir, env })` injection; temp dirs `mkdtempSync(join(tmpdir(), "po-…-"))`, removed in `afterAll`.
- `process.env` changes only inside try/finally, names prefixed `PO_T_`/`PO_TEST_`, deleted afterwards.
- Fakes mirror real SDK quirks: the fake `session.get` returns `{ error }` (hooks.test.ts:29).
- Time in hooks tests: `jest.useFakeTimers()`, `advanceTimersByTime(FIRST_TOAST_DELAY_MS)`, `setSystemTime`; wait on microtasks with `while (…) await null`, never sleeps.
- Timeout tests use servers that sleep 5-10x past `timeoutMs` (2000 vs 200, 1500 vs 300); keep that margin.
- Only `startMock` is shared; `setup`, `fake`, `fixed`, `write` stay file-local.
- Tags like `review probe P7`, `M3 (P3)`, `P2-5` point to a REVIEW.md that is not in the repo; keep them as-is.

### Scripts
- e2e/tui-smoke need `opencode` on PATH (`OPENCODE_BIN` overrides); tui-smoke also needs `tmux`.
- Both isolate HOME and XDG config/data/state in temp dirs but reuse the real `~/.cache`; e2e isolates it with `E2E_FRESH_CACHE=1` (slow, needs network). `E2E_KEEP=1` keeps the temp dir.
- live.ts: `opencode serve --port 4599 &`, then `OC_URL=http://127.0.0.1:4599 bun tests/live.ts <provider/model> [target]`. It value-imports `@opencode-ai/sdk` (fine outside src) and is typechecked, so SDK bumps can break `bun run typecheck` here.

## ANTI-PATTERNS
- Adding a test after the `mock.module("@opentui/solid")` test in tui.test.ts (L92 "keep last"): the mock stays registered for the rest of the process.
- Running `bun tests/e2e.ts` or `bun tests/tui-smoke.ts` directly: stale or missing dist/. Use the package scripts, and never build concurrently (`rm -rf dist`).
- Lowering `slowMs: 700` in tui-smoke.ts: the first message must render after the session view opens.
- Editing examples/* without updating config.test.ts:86-101, which asserts their values and the placeholder path.
- Touching `~/.config/opencode` or `~/.local/share/opencode`, or killing opencode processes you didn't start (docs/design.md:422).
- A `.test.ts` suffix on a script (bun test collects it) or a unit test without one (it never runs).
