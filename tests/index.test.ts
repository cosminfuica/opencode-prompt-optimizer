import { expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import * as server from "../src/index.ts"
import tui from "../src/tui.ts"

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8")
const pkg = JSON.parse(read("../package.json"))

test("server entry supports OpenCode v1's named plugin and v2's default module", async () => {
  expect(Object.keys(server).sort()).toEqual(["PromptOptimizerPlugin", "default"])
  expect(server.default).toEqual({ id: pkg.name, server: server.PromptOptimizerPlugin })
  for (const plugin of [server.PromptOptimizerPlugin, server.default.server]) {
    const hooks = await plugin({ client: {} } as any)
    expect(Object.keys(hooks).sort()).toEqual(["chat.message", "command.execute.before", "experimental.chat.messages.transform"])
  }
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
