import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import * as server from "../src/index.ts"
import tui from "../src/tui.ts"

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8")
const pkg = JSON.parse(read("../package.json"))

// opencode calls every export of the server entry as a plugin: an exported helper or constant breaks loading
test("server entry exports only the plugin, and it resolves to a hooks object", async () => {
  expect(Object.keys(server)).toEqual(["PromptOptimizerPlugin"])
  const hooks = await server.PromptOptimizerPlugin({ client: {} } as any)
  expect(Object.keys(hooks).sort()).toEqual(["chat.message", "command.execute.before", "experimental.chat.messages.transform"])
})

test("tui entry default-exports only { id, tui }, id = package name", () => {
  expect(Object.keys(tui).sort()).toEqual(["id", "tui"])
  expect(tui.id).toBe(pkg.name)
})

// @opencode-ai/plugin is an optional peer (types only), so opencode doesn't install it next to the plugin.
// A value import would fail to load at runtime, silently.
test("src has only type imports from @opencode-ai/*", () => {
  for (const f of readdirSync(new URL("../src/", import.meta.url)))
    expect(read(`../src/${f}`)).not.toMatch(/^import\s+(?!type\b)[^\n]*from\s+["']@opencode-ai\//m)
})
