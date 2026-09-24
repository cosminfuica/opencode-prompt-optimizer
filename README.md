# opencode-prompt-optimizer

An opencode plugin that rewrites your prompt with a small model before the main model sees it.

    you ──> prompt-optimizer (small model rewrites the prompt) ──> opencode target model

- **The original stays in the chat.** Your message bubble, history, fork, copy and revert all use what you typed.
- **The model sees only the optimized prompt.** It goes into a hidden (`synthetic`) part of your message, and a
  transform hook swaps it in for your text on every model request.
- **You can see what was sent.** A toast shows a preview, and `/optimized` (also in the command palette) opens the
  full text of the latest optimized prompt in this session. Scroll it with ↑↓, PgUp/PgDn, Home/End or the mouse wheel.
- **Failures fall back to your original.** On any error or timeout your original prompt is sent and a warning toast
  shows why.

## Install

Requirements: opencode ≥ 1.18 (tested on 1.18.32), and an optimizer model reachable through an OpenAI-compatible
`/chat/completions` API.

Add the package to `plugin` in `opencode.json` (global `~/.config/opencode/opencode.json` or a project's) and in the
`tui.json` next to it. opencode installs it from npm on the next start. The `tui.json` entry adds `/optimized`.

```jsonc
// opencode.json
{ "plugin": ["@cosminfuica/opencode-prompt-optimizer"] }
// tui.json
{ "plugin": ["@cosminfuica/opencode-prompt-optimizer"] }
```

Or let opencode edit both files: `opencode plugin @cosminfuica/opencode-prompt-optimizer -g` (drop `-g` for the
current project only). Then set the optimizer `model` (see below) and restart opencode.

opencode reuses its cached copy of an unpinned plugin. To update, pin a version
(`"@cosminfuica/opencode-prompt-optimizer@0.2.0"`) or delete
`~/.cache/opencode/packages/@cosminfuica/opencode-prompt-optimizer@latest`.

## Configuration

The config file is `~/.config/opencode/prompt-optimizer.jsonc` (or `.json`, or the path in
`$OPENCODE_PROMPT_OPTIMIZER_CONFIG`). It's JSONC: comments and trailing commas are allowed. **It is re-read on every
message, so edits apply without a restart.** Without a file, the defaults below apply. Every string supports
`{env:VAR}` and `{file:path}`, where the path is relative to the config file and `~/` means your home dir.

The same keys also work as plugin options in `opencode.json` (read at startup). A top-level key in the file replaces
the same option:

```jsonc
{ "plugin": [["@cosminfuica/opencode-prompt-optimizer", { "model": "openai/gpt-5-mini", "turns": 2 }]] }
```

[`examples/`](examples/) has a commented `prompt-optimizer.jsonc` plus `opencode.json` and `tui.json`.

| key | default | meaning |
|---|---|---|
| `enabled` | `true` | master switch |
| `model` | opencode `small_model` | `"provider/model"` from your opencode config, or the raw model name when `baseURL` is set |
| `baseURL` | — | custom OpenAI-compatible endpoint (`…/v1`) |
| `apiKey` | — | key for `baseURL`. opencode's provider keys are never sent to a custom `baseURL` |
| `headers` | `{}` | extra HTTP headers |
| `body` | `{}` | extra request-body fields for every call, e.g. `temperature`, `max_tokens`, `reasoning_effort` |
| `turns` | `1` | 1–8 rewrite calls. With N > 1, one more judge call picks the best: **N + 1 calls per message** |
| `strategy` | `"parallel"` | `parallel`: N independent rewrites at once. `refine`: each call improves the previous one (sequential, slower) |
| `timeoutMs` | `60000` | per-request timeout (≥ 1000) |
| `minChars` | `20` | shorter messages (after trimming) are sent unchanged |
| `skipPatterns` | see below | regexes. Matching messages are sent unchanged |
| `toast` | `true` | "optimizing…" and "optimized" toasts. Failure toasts always show |
| `prompts` | built-ins | optimizer system prompt, chosen by the **target** model (glob → text) |
| `judgePrompt` | `prompts/judge.md` | system prompt for the judge call |

Default `skipPatterns`: `["<!--\\s*OMO_INTERNAL", "^\\s*\\[SYSTEM DIRECTIVE", "^/[\\w.-]+(\\s|$)"]`. These skip
other plugins' automated prompts and text that looks like a slash command.

### Optimizer model

A provider from your opencode config reuses that provider's baseURL and API key:

```jsonc
{ "model": "openai/gpt-5-mini" }
```

This works for providers that expose an OpenAI-compatible chat API: `@ai-sdk/openai-compatible`, OpenAI, Anthropic,
Google, OpenRouter, Groq, Mistral, DeepSeek, xAI. Anything else needs a custom endpoint:

```jsonc
// OpenRouter
{ "baseURL": "https://openrouter.ai/api/v1", "apiKey": "{env:OPENROUTER_API_KEY}", "model": "google/gemini-2.5-flash" }
// Ollama
{ "baseURL": "http://localhost:11434/v1", "model": "qwen3:8b" }
// LM Studio
{ "baseURL": "http://localhost:1234/v1", "model": "qwen2.5-7b-instruct", "body": { "temperature": 0.3, "max_tokens": 2048 } }
```

### Prompts per target model

Keys are case-insensitive globs (`*`, `?`) matched against the target `"providerID/modelID"`. They're tried in order
and the first match wins. `default` is the fallback. If you leave out `prompts`, the built-ins apply: `*claude*`,
`*gpt*`, `*gemini*` and `default`, from the package's `prompts/*.md`. Without a `default` key, the built-in default
is used.

```jsonc
"prompts": {
  "anthropic/claude-opus-*": "{file:~/prompts/opus.md}",
  "ollama/*": "Rewrite the prompt to be short and explicit. Reply inside <optimized_prompt></optimized_prompt>.",
  "default": "{file:~/prompts/default.md}"
}
```

Custom prompts must tell the model to reply inside `<optimized_prompt>…</optimized_prompt>`. Judge prompts must reply
with `<best>k</best>`. A rewrite that has no non-empty `<optimized_prompt>` block, or that was cut off by `max_tokens`,
is discarded. If no rewrite is left, your original prompt is sent and a warning toast says why.

### Multiple turns

```jsonc
{ "turns": 3, "strategy": "parallel" }   // 3 rewrites in parallel + 1 judge = 4 calls, latency ≈ 2 calls
{ "turns": 3, "strategy": "refine" }     // rewrite → improve → improve, then judge = 4 sequential calls
```

### Turning it off quickly

Set `"enabled": false` in `prompt-optimizer.jsonc`. It applies from the next message, with no restart.

## Troubleshooting

- **Logs**: `~/.local/share/opencode/log/*.log` (or run `opencode --print-logs`). To find entries:
  `grep prompt-optimizer ~/.local/share/opencode/log/*.log`. Skips and failures are logged at WARN.
- **"Sent your original prompt — …" toast**: the optimizer failed. The message says why: model not found, no
  baseURL, HTTP status, timeout, a reply cut off at `max_tokens` (raise it in `body`), or a reply without an
  `<optimized_prompt>` block.
- **OAuth / subscription providers** (logins without an API key) can't be the optimizer. Use an API-key provider or
  a custom `baseURL`.
- **Plugin not loading**: run `opencode --print-logs --log-level INFO` and look for `failed to load plugin`.
  `opencode debug config` shows the resolved `plugin` list. `/optimized` also needs the `tui.json` entry.
- **Plugin order** (for plugins that inject text into your message, such as oh-my-openagent keyword modes and
  AGENTS.md injection). Plugins run in `plugin` array order. Listed after them (where `opencode plugin` puts it), the
  optimizer sees their injected text and keeps it verbatim. Listed first, it optimizes only what you typed, and their
  injections are kept around the optimized text.

## Limitations

- It adds latency: one optimizer round-trip per message, or N + 1 calls with `turns` > 1.
- Slash commands, subagent/task sessions and messages shorter than `minChars` aren't optimized.
- The optimized prompt is stored as a synthetic part of your message. If the transform hook stops running (for
  example after an opencode API change), the model gets both the original and the optimized text. That's degraded,
  not broken.

## Development

```sh
bun install
bun test                 # unit tests (no network, no real config)
bun run typecheck
bun run build            # tsc -> dist/
bun run e2e              # build, then real `opencode serve` + mock provider in temp XDG dirs (E2E_KEEP=1 keeps them)
bun run tui-smoke        # build, then the real opencode TUI in tmux: /optimized incl. scrolling an 85-line prompt
npm pack --dry-run       # what would be published
OC_URL=http://127.0.0.1:4599 bun tests/live.ts <provider/model>   # one real optimization via a running `opencode serve`
```

To run a local checkout in opencode, build it and put its absolute path in `plugin` in both `opencode.json` and
`tui.json`: `"plugin": ["/path/to/opencode-prompt-optimizer"]`. opencode loads `dist/` through `package.json`.

The e2e test reuses your opencode package cache (`~/.cache/opencode`) so it runs offline. Set `E2E_FRESH_CACHE=1` to
isolate the cache too. The first run then downloads packages.
