<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset=".github/readme/banner-dark.svg">
    <img src=".github/readme/banner-light.svg" alt="Prompt Optimizer - A little ghostwriter for your OpenCode prompts" width="100%">
  </picture>

  <p>An OpenCode plugin that rewrites your messages with a small model before your main model reads them, turning rushed requests into clear, specific ones. Your chat keeps showing exactly what you typed, and if the rewrite fails, your original goes through.</p>

  <p>
    <a href="https://github.com/cosminfuica/opencode-prompt-optimizer/stargazers"><img src="https://img.shields.io/github/stars/cosminfuica/opencode-prompt-optimizer?style=social" alt="Stars"></a>
    &nbsp;
    <a href="package.json"><img src="https://img.shields.io/badge/version-0.1.0-blue" alt="Version"></a>
    &nbsp;
    <a href="https://github.com/cosminfuica/opencode-prompt-optimizer/actions/workflows/ci.yml"><img src="https://github.com/cosminfuica/opencode-prompt-optimizer/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
    &nbsp;
    <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT"></a>
  </p>

  <p>
    <a href="#quick-start"><b>Quick start</b></a> &middot;
    <a href="#usage"><b>Usage</b></a> &middot;
    <a href="#configuration"><b>Configuration</b></a> &middot;
    <a href="#contributing"><b>Contributing</b></a>
  </p>

https://github.com/user-attachments/assets/0c7bc5de-f548-4fc0-84d2-2f2d384179fa

</div>

---

<table>
<tr>
<td width="55%"><img src=".github/readme/feature-1.gif" alt="OpenCode with Prompt Optimizer: a rushed message in the chat, then a toast titled Prompt optimized that shows the clear rewrite"></td>
<td width="45%">
<h3>Rushed messages reach your model as clear requests</h3>
A small model rewrites each message before your main model sees it. The built-in prompts are tuned for Claude, GPT and Gemini, picked by the model you're talking to, and tell the optimizer to keep file paths, errors and code verbatim.
</td>
</tr>
<tr>
<td width="45%">
<h3>Your chat keeps your words</h3>
The rewrite rides along as a hidden part of your message, so history, fork, copy and revert all use what you typed. A toast previews each rewrite, and <code>/optimized</code> opens the full text with its models and timing.
</td>
<td width="55%"><img src=".github/readme/feature-2.gif" alt="The chat still shows the rushed message while the /optimized dialog shows the rewrite, the optimizer model and the target model"></td>
</tr>
<tr>
<td width="55%"><img src=".github/readme/feature-3.gif" alt="Three draft cards land one by one, a gold star marks candidate 2, and the metadata reads 3 turns, candidate 2 of 3 by judge"></td>
<td width="45%">
<h3>Several drafts compete, a judge keeps the best</h3>
Set <code>turns</code> up to 8 and the optimizer writes that many rewrites, all at once or each improving the last. One more call judges them and sends the winner.
</td>
</tr>
</table>

---

## Quick start

```console
$ git clone https://github.com/cosminfuica/opencode-prompt-optimizer.git
$ cd opencode-prompt-optimizer
$ bun install && bun run build
$ opencode plugin "$PWD" -g
┌  Install plugin /home/dev/opencode-prompt-optimizer
│
◇  Plugin package ready
│
◇  Detected server + tui targets
│
◇  Plugin config updated
│
●  Added to /home/dev/.config/opencode/opencode.jsonc
│
●  Added to /home/dev/.config/opencode/tui.json
│
◆  Installed /home/dev/opencode-prompt-optimizer
│
●  Scope: global (/home/dev/.config/opencode)
│
└  Done
```

You need [Bun](https://bun.sh) and [OpenCode](https://opencode.ai) (tested with Bun 1.4.2 and OpenCode 1.18.33). Start (or restart) OpenCode and send a message of 20 characters or more: a toast shows the optimizer at work, then a preview of the rewrite. The rewriting uses your OpenCode `small_model`; to pick another model, see [Configuration](#configuration).

## Usage

| Command or setting | What it does |
|--------------------|--------------|
| `/optimized` | Opens the session's latest rewrite with the optimizer model, the target model, the turns and the time it took. Also in the command palette (<kbd>Ctrl</kbd>+<kbd>P</kbd>) as "Show optimized prompt". |
| `model` | The optimizer: a `"provider/model"` from your OpenCode config, or the raw model name when `baseURL` is set. Defaults to OpenCode's `small_model`. |
| `baseURL`, `apiKey` | A custom OpenAI-compatible endpoint (the `/v1` root) and its key. OpenCode's provider keys are never sent there. |
| `turns`, `strategy` | Rewrites per message, 1 to 8 (default 1), written `"parallel"` (default) or `"refine"` (each improving the last). Above 1, one more call picks the best. |
| `prompts`, `judgePrompt` | Your own system prompts, keyed by case-insensitive globs matched against the target `provider/model`; `default` is the fallback. An optimizer prompt must ask for the reply inside `<optimized_prompt>` tags, a judge prompt for `<best>k</best>`. |
| `minChars`, `skipPatterns` | Messages shorter than 20 characters (default) or matching one of these regexes go through unchanged. |
| `enabled`, `toast` | Pause the plugin, or hide the progress and success toasts. Failure toasts always show. |
| `timeoutMs`, `headers`, `body` | Per-request timeout (default 60000 ms), extra HTTP headers, and extra request fields such as `temperature` or `max_tokens`. |

Every setting is optional. A config file with three drafts and a judge:

```jsonc
// ~/.config/opencode/prompt-optimizer.jsonc
{
  "model": "openai/gpt-5-mini",
  "turns": 3,
  "strategy": "parallel"
}
```

## Configuration

<details>
<summary><b>How does it work?</b></summary>

The `chat.message` hook sends your text to the optimizer and attaches the rewrite to your message as a hidden (`synthetic`) part. Before every model request, the `experimental.chat.messages.transform` hook swaps it in for your words, so earlier messages stay optimized too. Every hook catches its own errors, so a failure never blocks a message. [docs/design.md](docs/design.md) has the module contracts.

</details>

<details>
<summary><b>Which messages are left alone, and what does it cost?</b></summary>

Messages shorter than `minChars`, slash commands, subagent sessions and anything matching `skipPatterns` (by default, other plugins' automated prompts and text that starts like a slash command) go through unchanged, with no extra call. Every other message waits for one optimizer call before the main model starts, or N + 1 calls with `turns` set to N; `"parallel"` keeps the wait near two calls. A small or local model keeps both the wait and the cost low.

</details>

<details>
<summary><b>Which model does the rewriting?</b></summary>

OpenCode's `small_model`, unless you set `model`. A `"provider/model"` from your OpenCode config reuses that provider's base URL, headers and API key, including a key saved with `opencode auth login`. It works for providers with an OpenAI-compatible chat API: `@ai-sdk/openai-compatible` providers, OpenAI, Anthropic, Google, OpenRouter, Groq, Mistral, DeepSeek and xAI.

</details>

<details>
<summary><b>Can I use a local model, OpenRouter or another endpoint?</b></summary>

Yes. Set `baseURL` to any OpenAI-compatible `/v1` root and `model` to the raw model name. `<think>` blocks from reasoning models are stripped.

```jsonc
// Ollama
{ "baseURL": "http://localhost:11434/v1", "model": "qwen3:8b" }
// OpenRouter
{
  "baseURL": "https://openrouter.ai/api/v1",
  "apiKey": "{env:OPENROUTER_API_KEY}",
  "model": "google/gemini-2.5-flash"
}
```

</details>

<details>
<summary><b>Where do settings go, and do I need to restart?</b></summary>

In `~/.config/opencode/prompt-optimizer.jsonc` (`$XDG_CONFIG_HOME` is respected, `prompt-optimizer.json` works too, and `$OPENCODE_PROMPT_OPTIMIZER_CONFIG` points to another file). It's re-read on every message, so edits apply without a restart. The same keys work as plugin options in `opencode.json`, read when OpenCode starts; the file wins for any key both set. Any string can use `{env:VAR}` and `{file:path}`. [examples/](examples/) has a fully commented config.

</details>

<details>
<summary><b>Can I set it up without the <code>opencode plugin</code> command?</b></summary>

Yes. Put your checkout's absolute path in `plugin` in `opencode.json` (the global one in `~/.config/opencode/` or your project's) for the rewriting, and the same entry in the `tui.json` next to it for `/optimized`. Without `-g`, `opencode plugin` writes them for the current project only.

```json
{ "plugin": ["/absolute/path/to/opencode-prompt-optimizer"] }
```

</details>

<details>
<summary><b>What are the known limits, and where are the logs?</b></summary>

- The optimizer needs an API key: OAuth and subscription logins (such as ChatGPT or Claude Pro) can't be used, and providers with an Anthropic-format or `${VAR}` URL need a custom `baseURL`.
- It isn't published to npm; install it from a local build as in [Quick start](#quick-start), and update with `git pull && bun run build`, then restart OpenCode.
- OpenCode's session-title request skips the transform hook, so the title model sees your first message and its rewrite.
- When a rewrite fails, your original is sent and a toast says why. The logs have the details: `grep prompt-optimizer ~/.local/share/opencode/log/*.log`.

</details>

## Contributing

```bash
git clone https://github.com/cosminfuica/opencode-prompt-optimizer.git
cd opencode-prompt-optimizer
bun install
bun test && bun run typecheck
```

Found a bug or want a feature? [Open an issue](https://github.com/cosminfuica/opencode-prompt-optimizer/issues). For changes to the hooks or the TUI, also run `bun run e2e` and `bun run tui-smoke` (they need `opencode` on your `PATH`, and the TUI test needs `tmux`); [docs/design.md](docs/design.md) describes the contracts between the modules.

## License

MIT - see [LICENSE](LICENSE).
