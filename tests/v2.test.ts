import { afterEach, beforeEach, expect, test } from "bun:test"
import { setup, withTimeout } from "../src/v2.ts"

const previousConfig = process.env.OPENCODE_PROMPT_OPTIMIZER_CONFIG
beforeEach(() => { process.env.OPENCODE_PROMPT_OPTIMIZER_CONFIG = `/tmp/optimizer-test-${crypto.randomUUID()}.json` })
afterEach(() => {
  if (previousConfig === undefined) delete process.env.OPENCODE_PROMPT_OPTIMIZER_CONFIG
  else process.env.OPENCODE_PROMPT_OPTIMIZER_CONFIG = previousConfig
})

async function harness(options: Record<string, unknown> = {}) {
  const hooks: Record<string, (event: any) => Promise<void> | void> = {}
  const commands: Record<string, any> = {}
  const calls: any[] = []
  const prompts: any[] = []
  const state = { parentID: undefined as string | undefined, model: { providerID: "test", id: "selected", variant: "low" } as any }
  const replies: (string | Error)[] = []
  const response = () => {
    const reply = replies.shift() ?? "<optimized_prompt>Clear rewritten request</optimized_prompt>"
    if (reply instanceof Error) throw reply
    return { text: reply }
  }
  const ctx: any = {
    options,
    session: {
      get: async () => ({ ...state, location: { directory: "/project" } }),
      hook: async (name: string, fn: any) => { hooks[name] = fn },
      generate: async (input: any) => {
        const event = { sessionID: input.sessionID, model: state.model, system: [{ type: "text", text: "agent instructions" }],
          messages: [{ role: "user", content: [{ type: "text", text: input.prompt }] }], tools: { shell: {} }, options: {} }
        await hooks.generate!(event)
        calls.push(event)
        return response()
      },
      prompt: async (input: any) => {
        prompts.push(input)
        await hooks.prompt!({ sessionID: input.sessionID, prompt: { text: input.text }, delivery: input.delivery })
      },
    },
    generate: { text: async (input: any) => { calls.push(input); return response() } },
    model: { default: async () => ({ data: { providerID: "fallback", id: "default" } }) },
    command: { reload: async () => {}, transform: async (fn: any) => fn({ add: (cmd: any) => { commands[cmd.name] = cmd } }) },
  }
  await setup(ctx)
  const send = async (text = "Please fix the login failure in src/auth.ts", metadata = {}) => {
    const event: any = { sessionID: "ses_test", messageID: "msg_test", prompt: { text, files: [{ uri: "file:///test" }] }, metadata, delivery: "queue" }
    await hooks.prompt!(event)
    return event
  }
  return { hooks, commands, calls, prompts, state, replies, send, ctx }
}

test("v2 uses isolated generation with the selected model and preserves chat history and attachments", async () => {
  const h = await harness({ body: { temperature: 0.2 } })
  const event = await h.send(undefined, { otherPlugin: "keep" })
  expect(event.prompt.text).toBe("Please fix the login failure in src/auth.ts")
  expect(event.prompt.files).toHaveLength(1)
  expect(event.metadata).toMatchObject({ otherPlugin: "keep", promptOptimizer: {
    target: "test/selected", optimizerModel: "test/selected", prompt: "Clear rewritten request",
  } })
  expect(h.calls[0].model.variant).toBe("low")
  expect(Object.keys(h.calls[0]).sort()).toEqual(["model", "prompt"])
  expect(h.calls[0].prompt).toContain("<original_prompt>")
  expect(h.calls[0].prompt).not.toContain("agent instructions")
  const content = [{ type: "text", text: "skill instructions" }, { type: "text", text: event.prompt.text }, { type: "media", media: {} }]
  const message = { role: "user", content, metadata: event.metadata }
  const context = { messages: [message, { role: "assistant", content, metadata: event.metadata }] }
  await h.hooks.context!(context)
  expect(context.messages[0]!.content[1]!.text).toBe("Clear rewritten request")
  expect(content[1]!.text).toBe(event.prompt.text)
  expect(context.messages[0]!.content[0]).toEqual(content[0])
  expect(context.messages[0]!.content[2]).toEqual(content[2])
  expect(context.messages[1]!.content).toBe(content)
})

test("configuration disables optimization and skips short, automated, command and child prompts", async () => {
  const disabled = await harness({ enabled: false })
  await disabled.send()
  expect(disabled.calls).toHaveLength(0)
  const h = await harness()
  for (const text of ["", "yes", "/review this very long request", "[SYSTEM DIRECTIVE long automated request]"]) await h.send(text)
  h.state.parentID = "ses_parent"
  await h.send()
  expect(h.calls).toHaveLength(0)
})

test("custom prompts, refine candidates and judge selection use the shared optimizer", async () => {
  const h = await harness({ turns: 2, strategy: "refine", prompts: { "*selected": "CUSTOM SYSTEM", default: "DEFAULT" }, judgePrompt: "CUSTOM JUDGE" })
  h.replies.push("<optimized_prompt>first</optimized_prompt>", "<optimized_prompt>second</optimized_prompt>", "<best>2</best>")
  const event = await h.send()
  expect(event.metadata.promptOptimizer).toMatchObject({ prompt: "second", candidates: ["first", "second"], chosen: 1, judged: true })
  expect(h.calls[0].prompt).toContain("CUSTOM SYSTEM")
  expect(h.calls[1].prompt).toContain("<previous_attempt>\nfirst")
  expect(h.calls[2].prompt).toContain("CUSTOM JUDGE")
})

test("model override uses native configured provider and preserves model ids containing slashes", async () => {
  const h = await harness({ model: "openrouter/vendor/model" })
  const event = await h.send()
  expect(h.calls[0].model).toEqual({ providerID: "openrouter", id: "vendor/model" })
  expect(event.metadata.promptOptimizer.optimizerModel).toBe("openrouter/vendor/model")
})

test("unselected session uses location default and model changes apply on the next prompt", async () => {
  const h = await harness()
  h.state.model = undefined
  expect((await h.send()).metadata.promptOptimizer.target).toBe("fallback/default")
  h.state.model = { providerID: "other", id: "new" }
  expect((await h.send()).metadata.promptOptimizer.target).toBe("other/new")
})

test("refusals, provider failures and invalid config preserve prompt and report failure", async () => {
  for (const reply of ["I cannot help.", new Error("provider unavailable")]) {
    const h = await harness()
    h.replies.push(reply)
    const event = await h.send()
    expect(event.metadata.promptOptimizer).toBeUndefined()
    expect(event.metadata.promptOptimizerError).toBeString()
    expect(event.prompt.text).toBe("Please fix the login failure in src/auth.ts")
  }
  const h = await harness({ turns: 0 })
  expect((await h.send()).metadata.promptOptimizerError).toContain("turns")
})

test("/optimize sends exactly once, preserving attachments and delivery", async () => {
  const h = await harness()
  const prompt = { text: "Please fix the login failure in src/auth.ts", files: [{ uri: "file:///test" }] }
  await h.commands.optimize.execute({ sessionID: "ses_test", prompt, delivery: "queue" })
  expect(h.prompts).toEqual([{ sessionID: "ses_test", ...prompt, delivery: "queue" }])
  expect(h.calls).toHaveLength(1)
  await expect(h.commands.optimize.execute({ sessionID: "ses_test", prompt: { text: "" } })).rejects.toThrow("Usage:")
})

test("optimizer never registers a hook on session auxiliary generation", async () => {
  const h = await harness()
  expect(h.hooks.generate).toBeUndefined()
})

test("timeout releases caller even if the provider does not respond", async () => {
  await expect(withTimeout(new Promise(() => {}), 10)).rejects.toThrow("timed out")
  expect(await withTimeout(Promise.resolve("done"), 10)).toBe("done")
})
