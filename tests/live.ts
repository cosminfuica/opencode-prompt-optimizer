// Live smoke test against YOUR opencode providers (read-only): resolves the optimizer model the way the
// plugin does, via a running `opencode serve`, then runs one real optimization (turns=2 -> 2 rewrites + judge).
//   opencode serve --port 4599 &   then   OC_URL=http://127.0.0.1:4599 bun tests/live.ts [provider/model]
import { createOpencodeClient } from "@opencode-ai/sdk"
import { loadConfig, selectPrompt } from "../src/config.ts"
import { optimize, resolveEndpoint } from "../src/optimizer.ts"

const client = createOpencodeClient({ baseUrl: process.env.OC_URL ?? "http://127.0.0.1:4599" })
const cfg = await loadConfig("/nonexistent")          // built-in prompts + defaults
const endpoint = await resolveEndpoint({ ...cfg, model: Bun.argv[2] ?? "cli-proxy-api/claude-sonnet-5-fast" }, client as any)
console.log(`endpoint: ${endpoint.baseURL} model=${endpoint.model} key=${endpoint.apiKey ? "yes" : "no"}`)

const target = "cli-proxy-api/claude-opus-5-5"
const prompt = "the login page is slow sometimes, can u look into it and maybe fix, its in src/auth i think. dont break the tests"
const r = await optimize({
  endpoint, system: selectPrompt(cfg, target), judgeSystem: cfg.judgePrompt,
  prompt, target, turns: 2, strategy: "parallel", timeoutMs: 120_000,
})
console.log(`\nORIGINAL:\n${prompt}\n`)
r.candidates.forEach((c, i) => console.log(`--- candidate ${i + 1}${i === r.chosen ? " (chosen)" : ""}\n${c}\n`))
console.log(`judged=${r.judged} ms=${r.ms}`)
