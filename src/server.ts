import { PromptOptimizerPlugin } from "./index.ts"
import { ID, setup } from "./v2.ts"

// v1 invokes server; v2 invokes setup. All SDK imports are erased types.
export default { id: ID, server: PromptOptimizerPlugin, setup }
