import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, selectPrompt } from "./config.ts"
import { createHooks } from "./hooks.ts"
import { optimize, resolveEndpoint } from "./optimizer.ts"

// OpenCode v1 loads named plugin functions; v2 loads a default plugin module.
// Keep both entry styles pointed at the same implementation so one package supports both versions.
// The /optimized TUI command lives in ./tui.ts (package.json exports["./tui"]).
export const PromptOptimizerPlugin: Plugin = async ({ client }, options) =>
  createHooks({ client, loadConfig: () => loadConfig(undefined, { options }), selectPrompt, resolveEndpoint, optimize })

export default { id: "@cosminfuica/opencode-prompt-optimizer", server: PromptOptimizerPlugin }
