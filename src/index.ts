import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, selectPrompt } from "./config.ts"
import { createHooks } from "./hooks.ts"
import { optimize, resolveEndpoint } from "./optimizer.ts"

// Server entry (package.json "main"). Keep this the ONLY export: opencode calls every export as a plugin.
// The /optimized TUI command lives in ./tui.ts (package.json exports["./tui"]).
export const PromptOptimizerPlugin: Plugin = async ({ client }, options) =>
  createHooks({ client, loadConfig: () => loadConfig(undefined, { options }), selectPrompt, resolveEndpoint, optimize })
