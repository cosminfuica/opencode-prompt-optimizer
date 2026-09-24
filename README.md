# opencode-prompt-optimizer

An OpenCode plugin that rewrites your prompt with a small model before the main model sees it.

[![npm version](https://img.shields.io/npm/v/@cosminfuica/opencode-prompt-optimizer.svg)](https://www.npmjs.com/package/@cosminfuica/opencode-prompt-optimizer)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

```text
you ──> optimizer model (rewrites the prompt) ──> your OpenCode model
```

Quick, terse requests leave a coding agent guessing. This [OpenCode](https://opencode.ai) plugin sends your messages
through an optimizer model first, which rewrites each one into a clear, explicit request for the model that will
receive it. Your main model gets the rewrite. Your chat still shows exactly what you typed. The built-in prompts are
conservative: they tell the optimizer to keep your intent and language, copy file paths, errors and code exactly,
leave an already-clear prompt essentially unchanged, and never do the task itself.

## Features

- **Your chat stays yours.** The rewrite is stored as a hidden (`synthetic`) part of your message, and a transform
  hook swaps it in for your text on every model request. Your message bubble, history, fork, copy and revert all use
  what you typed.
- **A prompt for each target model.** Built-in optimizer prompts for Claude, GPT and Gemini, plus a general default,
  are chosen by the model your message is going to. You can replace them with your own, matched by glob.
- **Several candidates and a judge.** With `turns` > 1, the plugin writes N rewrites, either in parallel or each one
  refining the last, and one more call picks the best.
- **Any OpenAI-compatible model.** Reuse a provider from your OpenCode config, whose base URL and API key are picked
  up for you, or point the plugin at a custom endpoint such as OpenRouter, Ollama or LM Studio. `<think>` blocks from
  reasoning models are stripped.
- **Fails safe.** If the optimizer fails or times out, your original prompt is sent, and a warning toast says why.
- **You can see what was sent.** A toast previews the rewrite, and `/optimized` opens the full text of the latest
  optimized prompt in a scrollable dialog.
- **Stays out of the way.** Short messages, slash commands, subagent sessions and other plugins' automated prompts
  pass through unchanged.
- **Live config.** The config file is re-read on every message, so edits apply without restarting OpenCode.
- **No runtime dependencies.**

## Installation

Add the plugin to `opencode.json`, either the global `~/.config/opencode/opencode.json` or the one in your project:

```json
{
  "plugin": ["@cosminfuica/opencode-prompt-optimizer"]
}
```

OpenCode installs it from npm automatically the next time it starts. The optimizer uses your OpenCode `small_model`.
If you haven't set one, choose a `model` in the [configuration](#configuration).

For the `/optimized` command, add the same entry to the `tui.json` next to it (`~/.config/opencode/tui.json` for the
global setup). Or let OpenCode add both entries for you:

```sh
opencode plugin @cosminfuica/opencode-prompt-optimizer -g   # drop -g to install for the current project only
```

**Requirements:** OpenCode (tested with 1.18.32), and an optimizer model reachable through an OpenAI-compatible
`/chat/completions` API. OAuth and subscription logins, which have no API key, can't be used as the optimizer.

## Usage

Chat as usual. For each message:

1. A toast shows `Optimizing with <model>…`.
2. The optimizer rewrites your message, and a `✨ Prompt optimized` toast previews the result.
3. The target model gets the rewrite. Your message in the chat stays as you typed it.

Set `"toast": false` to hide these two toasts.

Here is one of the examples from the built-in `prompts/default.md`. You type:

```text
login is broken after my last change, getting TypeError: Cannot read properties of undefined (reading 'id') in src/auth/session.ts, pls fix
```

and the target model gets a rewrite like this:

```text
Login broke after my last change. The error is:

TypeError: Cannot read properties of undefined (reading 'id')

It points at src/auth/session.ts. Starting from that file and my recent changes, find the cause and fix it so login works again.
```

The prompt's other example shows that a short, clear request stays short: `fix the typo in teh README install section`
becomes `Fix the typo in the install section of the README.`

### See the optimized prompt

Type `/optimized`, or pick **Show optimized prompt** in the command palette (`ctrl+p`). It opens the latest optimized
prompt of the current session. Its header shows the optimizer model, the target model, the number of turns and how
long the optimization took. With several candidates, it also shows which one won and whether the judge picked it.

To scroll, use `↑`/`↓` or `j`/`k` for a line, `PgUp`/`PgDn` for a page, `Home`/`End` for the top or bottom, or the
mouse wheel. `Enter` or `Esc` closes the dialog. The command needs the `tui.json` entry from
[Installation](#installation).

### What isn't optimized

These messages go to the model unchanged, with no toast:

- messages shorter than `minChars` (20 characters by default), such as "yes" or "continue"
- slash commands
- messages in subagent (task) sessions
- messages that match `skipPatterns`, which by default cover other plugins' automated prompts and text that starts
  like a slash command

To pause the optimizer, set `"enabled": false` in `prompt-optimizer.jsonc`. It applies from the next message, with no
restart.

## Configuration

Every setting is optional. There are two places to put them:

1. **The config file** at `~/.config/opencode/prompt-optimizer.jsonc` (`$XDG_CONFIG_HOME` is respected, and
   `prompt-optimizer.json` works too). Set `$OPENCODE_PROMPT_OPTIMIZER_CONFIG` to use another path. The file is
   JSONC, so comments and trailing commas are allowed. It's re-read on every message, so edits apply without a
   restart.
2. **Plugin options** in `opencode.json`, read when OpenCode starts:

   ```json
   {
     "plugin": [
       ["@cosminfuica/opencode-prompt-optimizer", { "model": "openai/gpt-5-mini", "turns": 2 }]
     ]
   }
   ```

Both accept the same keys and use the same validation. If both set a key, the config file wins for that top-level key.
[`examples/`](examples/) has a fully commented `prompt-optimizer.jsonc`, plus `opencode.json` and `tui.json`.

| Key | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `model` | OpenCode's `small_model` | The optimizer model: `"provider/model"` from your OpenCode config, or the raw model name when `baseURL` is set. |
| `baseURL` | none | A custom OpenAI-compatible endpoint (`…/v1`). Requires `model`. |
| `apiKey` | none | API key for `baseURL`, ignored without it. OpenCode's provider keys are never sent to a custom `baseURL`. |
| `headers` | `{}` | Extra HTTP headers for optimizer requests. |
| `body` | `{}` | Extra request-body fields for every call, e.g. `temperature`, `max_tokens`, `reasoning_effort`. |
| `turns` | `1` | Rewrite calls per message, 1 to 8. With N > 1, one more judge call picks the best: N + 1 calls in total. |
| `strategy` | `"parallel"` | How the N calls run: `"parallel"` makes N independent rewrites at once, `"refine"` makes them one after another, each improving the previous one. |
| `timeoutMs` | `60000` | Timeout for each request, in milliseconds (at least 1000). |
| `minChars` | `20` | Messages shorter than this, after trimming, are sent unchanged. |
| `skipPatterns` | see below | Regexes. A message that matches any of them is sent unchanged. |
| `toast` | `true` | Show the "Optimizing…" and "Prompt optimized" toasts. Failure toasts always show. |
| `prompts` | built-ins | Optimizer system prompts, chosen by the **target** model. See [Prompts per target model](#prompts-per-target-model). |
| `judgePrompt` | `prompts/judge.md` | System prompt for the judge call. |

Any string in the config file can use `{env:VAR}` and `{file:path}`. The path is relative to the config file, and
`~/` means your home directory. `opencode.json` supports the same syntax.

A config error never blocks your message: your original prompt is sent, and a warning toast names the problem.

The default `skipPatterns` skip other plugins' automated prompts and text that starts like a slash command. Setting
`skipPatterns` replaces this list:

```json
["<!--\\s*OMO_INTERNAL", "^\\s*\\[SYSTEM DIRECTIVE", "^/[\\w.-]+(\\s|$)"]
```

### Choosing the optimizer model

A `"provider/model"` from your OpenCode config reuses that provider's base URL, API key and headers:

```jsonc
{ "model": "openai/gpt-5-mini" }
```

This works for providers with an OpenAI-compatible chat API: `@ai-sdk/openai-compatible` providers with a `baseURL`,
OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral, DeepSeek and xAI. For anything else, set a custom endpoint:

```jsonc
// OpenRouter
{ "baseURL": "https://openrouter.ai/api/v1", "apiKey": "{env:OPENROUTER_API_KEY}", "model": "google/gemini-2.5-flash" }
```

```jsonc
// Ollama
{ "baseURL": "http://localhost:11434/v1", "model": "qwen3:8b" }
```

```jsonc
// LM Studio
{ "baseURL": "http://localhost:1234/v1", "model": "qwen2.5-7b-instruct", "body": { "temperature": 0.3, "max_tokens": 2048 } }
```

### Prompts per target model

The keys in `prompts` are case-insensitive globs (`*`, `?`), matched against the target model as
`"providerID/modelID"`. They're tried in order and the first match wins. `default` is the fallback. Values are inline
text or `{file:…}`.

```jsonc
{
  "prompts": {
    "anthropic/claude-opus-*": "{file:~/prompts/opus.md}",
    "ollama/*": "Rewrite the prompt to be short and explicit. Reply inside <optimized_prompt></optimized_prompt>.",
    "default": "{file:~/prompts/default.md}"
  }
}
```

Without `prompts`, the built-ins apply: `*claude*` uses `prompts/anthropic.md`, `*gpt*` uses `prompts/gpt.md`,
`*gemini*` uses `prompts/gemini.md`, and everything else uses `prompts/default.md`. Your own `prompts` map replaces
them. If it has no `default` key, the built-in default is the fallback.

A custom prompt must tell the model to reply inside `<optimized_prompt>…</optimized_prompt>`. A reply with no
non-empty block, or one cut off at `max_tokens`, is discarded. A custom `judgePrompt` must make the judge reply with
`<best>k</best>`, where k is the 1-based index of the winner.

### Several candidates

```jsonc
{ "turns": 3, "strategy": "parallel" }   // 3 rewrites at once + 1 judge = 4 calls, latency of about 2 calls
{ "turns": 3, "strategy": "refine" }     // rewrite → improve → improve, then judge = 4 calls in a row
```

With `parallel`, failed calls are dropped. With `refine`, a failed call ends the chain and the candidates so far are
kept. If only one candidate is left, it's used without a judge call. If the judge call fails or gives no valid
answer, `parallel` uses the first candidate and `refine` uses the last one. If every call fails, your original
prompt is sent.

## Troubleshooting

- **Logs:** OpenCode writes them to `~/.local/share/opencode/log/`. Run `opencode --print-logs` to see them live.
  `grep prompt-optimizer ~/.local/share/opencode/log/*.log` finds this plugin's entries. Failures are logged at WARN.
- **A "Sent your original prompt — …" toast** means the optimizer failed and your original went through. The toast
  says why, for example: no optimizer model is set, the model wasn't found, there's no base URL, an HTTP error, a
  timeout, a reply cut off at `max_tokens` (raise it in `body`), a reply with no `<optimized_prompt>` block, or an
  invalid config.
- **Plugin not loading:** run `opencode --print-logs --log-level INFO` and look for `failed to load plugin`.
  `opencode debug config` shows the resolved `plugin` list.
- **No `/optimized` command:** add the plugin to `tui.json` as well.
- **Updating:** OpenCode keeps using its cached copy of an unpinned plugin. To update, pin a version
  (`"@cosminfuica/opencode-prompt-optimizer@0.1.0"`) or delete
  `~/.cache/opencode/packages/@cosminfuica/opencode-prompt-optimizer@latest`, then restart OpenCode.
- **Plugin order:** plugins run in the order of the `plugin` array. Some plugins edit the text of your message, for
  example keyword modes or AGENTS.md injection. If the optimizer is listed after them, it sees their text and is told
  to keep it verbatim. If it's listed before them, it optimizes only what you typed, and their text stays around the
  rewrite.

## How it works

The package has two halves, and OpenCode loads both through `package.json`.

**Server plugin** (`dist/index.js`, from `main` and `exports["./server"]`), loaded from `opencode.json`:

- `chat.message` runs when you send a message. Unless the message is skipped, it resolves the optimizer endpoint and
  runs the rewrite calls, plus the judge call when there are several candidates. Then it appends the result to your
  message as a hidden `synthetic` text part. That part's `metadata.promptOptimizer` holds your original text, the
  models, the candidates, the chosen index and the timing. Your own text part isn't changed.
- `experimental.chat.messages.transform` runs before every model request, on that request's copy of the history, and
  swaps the optimized text in for your words. Earlier messages stay optimized too.
- `command.execute.before` marks slash-command runs so their rendered templates aren't optimized.

**TUI plugin** (`dist/tui.js`, from `exports["./tui"]`), loaded from `tui.json`: it registers `/optimized`, which reads
that metadata from the session and shows it. It only displays the prompt. Nothing is sent to the model.

Each hook catches its own errors, so a failure never blocks your message. Your original prompt goes through instead.
Each optimized message waits for one optimizer round trip, or N + 1 calls with `turns` > 1, before the main model
starts. If the transform hook ever stops running (for example after an OpenCode API change), the model gets both your
original and the optimized text. That's degraded, not broken.

```text
.
├── src/
│   ├── index.ts        server entry: exports only PromptOptimizerPlugin
│   ├── hooks.ts        chat.message, command.execute.before, messages.transform
│   ├── optimizer.ts    endpoint resolution, HTTP calls, turns + judge
│   ├── config.ts       config loading, validation, prompt selection
│   └── tui.ts          TUI entry: the /optimized command and dialog
├── prompts/            built-in optimizer prompts (anthropic, gpt, gemini, default) and the judge prompt
├── tests/              unit tests, e2e and TUI smoke tests, a live test script, a mock OpenAI server
├── examples/           opencode.json, tui.json, prompt-optimizer.jsonc
├── docs/design.md      the full design and module contracts
├── dist/               compiled output (built by tsc, published, not committed)
└── package.json        main, exports["./server"] and exports["./tui"] point into dist/
```

The published package contains only `dist/` and `prompts/`, plus this README, the license and `package.json`.

## Development

You need [Bun](https://bun.sh) (tested with 1.4.2). The e2e and TUI smoke tests also need `opencode` on your `PATH`,
and the TUI smoke test needs `tmux`.

```sh
git clone https://github.com/cosminfuica/opencode-prompt-optimizer.git
cd opencode-prompt-optimizer
bun install
bun run build        # tsc -> dist/
bun test             # unit tests (no network, no real config)
bun run typecheck
```

More checks:

```sh
bun run e2e          # build, then real `opencode serve` + a mock provider in temp XDG dirs (E2E_KEEP=1 keeps them)
bun run tui-smoke    # build, then the real OpenCode TUI in tmux: /optimized, including scrolling a long prompt
npm pack --dry-run   # list what would be published
OC_URL=http://127.0.0.1:4599 bun tests/live.ts <provider/model>   # one real optimization via `opencode serve --port 4599`
```

The e2e test reuses your OpenCode package cache (`~/.cache/opencode`), so it can run offline. Set `E2E_FRESH_CACHE=1`
to isolate the cache too. The first run then downloads packages.

### Load your local copy in OpenCode

Build, then put the absolute path of your checkout in `plugin` in both `opencode.json` and `tui.json`, instead of the
npm name:

```json
{
  "plugin": ["/absolute/path/to/opencode-prompt-optimizer"]
}
```

OpenCode loads the checkout through its `package.json`, so it runs `dist/`. After a change, run `bun run build` and
restart OpenCode.

## Contributing

Issues and pull requests are welcome on
[GitHub](https://github.com/cosminfuica/opencode-prompt-optimizer/issues). Before you open a pull request:

- Run `bun test` and `bun run typecheck`. For changes to the hooks or the TUI, also run `bun run e2e` and
  `bun run tui-smoke`.
- Keep `src/index.ts` exporting only the plugin function, because OpenCode calls every export of the entry as a
  plugin.
- Import from `@opencode-ai/*` with `import type` only. It's an optional peer dependency, so OpenCode doesn't install
  it next to the plugin. `tests/index.test.ts` checks this rule and the one above.
- Hooks must never throw. On failure, the original prompt goes through.
- See [`docs/design.md`](docs/design.md) for the contracts between the modules.

## License

[MIT](LICENSE) © 2026 cosminfuica
