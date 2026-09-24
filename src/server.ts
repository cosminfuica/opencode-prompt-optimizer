import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, selectPrompt } from "./config.ts"
import { createHooks } from "./hook.ts"
import { optimize, resolveEndpoint } from "./optimizer.ts"

// The ONLY export: opencode treats every export of a server plugin module as a plugin.
export const PromptOptimizer: Plugin = async ({ client }) =>
  createHooks({ client, loadConfig: () => loadConfig(), selectPrompt, resolveEndpoint, optimize })
