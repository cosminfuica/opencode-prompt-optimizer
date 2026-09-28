import type { Plugin } from "@opencode-ai/plugin"
import { loadConfig, selectPrompt } from "./config.ts"
import { createHooks } from "./hooks.ts"
import { optimize, resolveEndpoint } from "./optimizer.ts"

// Legacy v1 entry. The ./server subpath also supplies the native v2 setup API.
export const PromptOptimizerPlugin: Plugin = async ({ client }, options) =>
  createHooks({ client, loadConfig: () => loadConfig(undefined, { options }), selectPrompt, resolveEndpoint, optimize })

export default { id: "@cosminfuica/opencode-prompt-optimizer", server: PromptOptimizerPlugin }
