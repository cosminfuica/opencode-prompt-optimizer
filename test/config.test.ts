import { afterAll, describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { configPath, globMatch, loadConfig, selectPrompt, type Config } from "../src/config.ts"

const tmp = mkdtempSync(join(tmpdir(), "po-config-"))
afterAll(() => rmSync(tmp, { recursive: true, force: true }))

const builtinDir = join(tmp, "builtin")
mkdirSync(builtinDir)
for (const n of ["anthropic", "gpt", "gemini", "default", "judge"]) writeFileSync(join(builtinDir, `${n}.md`), `  builtin ${n}\n`)

let n = 0
function write(text: string, dir = tmp): string {
  const p = join(dir, `cfg${n++}.jsonc`)
  writeFileSync(p, text)
  return p
}
const load = (text: string, env: Record<string, string | undefined> = {}) => loadConfig(write(text), { builtinDir, env })

describe("loadConfig", () => {
  test("missing file => defaults with built-in prompts", async () => {
    const cfg = await loadConfig(join(tmp, "nope.jsonc"), { builtinDir, env: {} })
    expect(cfg).toMatchObject({ enabled: true, turns: 1, strategy: "parallel", timeoutMs: 60000, minChars: 20, toast: true, headers: {}, body: {} })
    expect(cfg.path).toBeUndefined()
    expect(cfg.model).toBeUndefined()
    expect(cfg.skipPatterns.map((r) => r.source)).toEqual(["<!--\\s*OMO_INTERNAL", "^\\s*\\[SYSTEM DIRECTIVE", "^/[\\w.-]+(\\s|$)"].map((s) => new RegExp(s).source))
    expect(Object.keys(cfg.prompts)).toEqual(["*claude*", "*gpt*", "*gemini*", "default"])
    expect(cfg.prompts["*gpt*"]).toBe("builtin gpt")
    expect(cfg.judgePrompt).toBe("builtin judge")
  })

  test("default skipPatterns match what they should", async () => {
    const { skipPatterns } = await loadConfig(join(tmp, "nope.jsonc"), { builtinDir, env: {} })
    const skip = (s: string) => skipPatterns.some((r) => r.test(s))
    expect(skip("<!-- OMO_INTERNAL -->x")).toBe(true)
    expect(skip("  [SYSTEM DIRECTIVE: foo]")).toBe(true)
    expect(skip("/review this")).toBe(true)
    expect(skip("please fix src/a.ts")).toBe(false)
  })

  test("missing built-in prompt file => clear error", async () => {
    const empty = mkdtempSync(join(tmp, "empty-"))
    await expect(loadConfig(join(tmp, "nope.jsonc"), { builtinDir: empty, env: {} })).rejects.toThrow(/cannot read built-in prompt .*anthropic\.md/)
  })

  test("JSONC comments + trailing commas, unknown keys ignored", async () => {
    const p = write(`// top\n{\n  /* block */ "turns": 3, // three\n  "strategy": "refine",\n  "whatever": 1,\n  "prompts": { "*x*": "X", "default": "D", },\n  "judgePrompt": "J",\n}\n`)
    const cfg = await loadConfig(p, { builtinDir, env: {} })
    expect(cfg.path).toBe(p)
    expect(cfg.turns).toBe(3)
    expect(cfg.strategy).toBe("refine")
    expect(cfg.prompts).toEqual({ "*x*": "X", default: "D" })
    expect(cfg.judgePrompt).toBe("J")
  })

  test("prompts without default get the built-in default", async () => {
    const cfg = await load(`{"prompts": {"*x*": "X"}}`)
    expect(cfg.prompts).toEqual({ "*x*": "X", default: "builtin default" })
  })

  test("repo example prompt-optimizer.jsonc parses", async () => {
    // mirror the install layout: $CFG/prompt-optimizer.jsonc + $CFG/plugins/prompt-optimizer/prompts/*.md
    const cfgDir = join(tmp, "example")
    const promptDir = join(cfgDir, "plugins/prompt-optimizer/prompts")
    mkdirSync(promptDir, { recursive: true })
    for (const n of ["anthropic", "gpt", "gemini", "default", "judge"]) writeFileSync(join(promptDir, `${n}.md`), `ex ${n}\n`)
    const p = join(cfgDir, "prompt-optimizer.jsonc")
    writeFileSync(p, readFileSync(join(import.meta.dir, "../prompt-optimizer.jsonc"), "utf8"))
    const cfg = await loadConfig(p, { builtinDir, env: {} })
    expect(cfg).toMatchObject({ enabled: true, model: "cli-proxy-api/claude-sonnet-5-fast", turns: 1, strategy: "parallel", timeoutMs: 60000, minChars: 20, toast: true })
    expect(cfg.prompts).toEqual({ "*claude*": "ex anthropic", "*gpt*": "ex gpt", "*gemini*": "ex gemini", default: "ex default" })
    expect(cfg.judgePrompt).toBe("ex judge")
    expect(cfg.skipPatterns).toHaveLength(3)
  })

  test("{env:} and {file:} substitution, recursive, relative and ~", async () => {
    const home = join(tmp, "home")
    const sub = join(tmp, "sub")
    mkdirSync(home, { recursive: true })
    mkdirSync(sub, { recursive: true })
    writeFileSync(join(home, "key.txt"), "  sk-home \n")
    writeFileSync(join(sub, "p.md"), "\nrelative prompt\n")
    const p = write(`{
      "model": "m", "baseURL": "http://x/{env:HOST_PART}/v1",
      "apiKey": "{file:~/key.txt}",
      "headers": { "X-A": "{env:A}-{env:MISSING}" },
      "body": { "nested": ["{env:A}", { "deep": "{env:A}" }], "n": 1 },
      "prompts": { "*a*": "{file:./sub/p.md}", "default": "{file:sub/p.md} + {env:A}" },
      "judgePrompt": "{env:J}"
    }`)
    const cfg = await loadConfig(p, { builtinDir, env: { HOME: home, HOST_PART: "h", A: "aa", J: "{env:A}" } })
    expect(cfg.baseURL).toBe("http://x/h/v1")
    expect(cfg.apiKey).toBe("sk-home")
    expect(cfg.headers).toEqual({ "X-A": "aa-" })
    expect(cfg.body).toEqual({ nested: ["aa", { deep: "aa" }], n: 1 })
    expect(cfg.prompts).toEqual({ "*a*": "relative prompt", default: "relative prompt + aa" })
    expect(cfg.judgePrompt).toBe("{env:A}") // substituted values are not re-expanded
  })

  test("unreadable {file:} => error naming config path", async () => {
    const p = write(`{"judgePrompt": "{file:./does-not-exist.md}"}`)
    await expect(loadConfig(p, { builtinDir, env: {} })).rejects.toThrow(`prompt-optimizer config ${p}: cannot read {file:./does-not-exist.md}`)
  })

  const bad: [string, RegExp][] = [
    [`{"turns": 0}`, /"turns" must be an integer 1\.\.8/],
    [`{"turns": 9}`, /"turns" must be an integer 1\.\.8/],
    [`{"turns": 1.5}`, /"turns" must be an integer 1\.\.8/],
    [`{"turns": "2"}`, /"turns" must be an integer 1\.\.8/],
    [`{"strategy": "fast"}`, /"strategy" must be "parallel" or "refine"/],
    [`{"timeoutMs": 999}`, /"timeoutMs" must be an integer >= 1000/],
    [`{"minChars": -1}`, /"minChars" must be an integer >= 0/],
    [`{"skipPatterns": "x"}`, /"skipPatterns" must be an array of strings/],
    [`{"skipPatterns": [1]}`, /"skipPatterns" must be an array of strings/],
    [`{"skipPatterns": ["("]}`, /invalid skipPatterns regex "\("/],
    [`{"prompts": {"a": 1}}`, /"prompts" must be an object of strings/],
    [`{"prompts": []}`, /"prompts" must be an object of strings/],
    [`{"headers": {"a": true}}`, /"headers" must be an object of strings/],
    [`{"body": [1]}`, /"body" must be an object/],
    [`{"enabled": "yes"}`, /"enabled" must be a boolean/],
    [`{"toast": 1}`, /"toast" must be a boolean/],
    [`{"model": 1}`, /"model" must be a string/],
    [`{"baseURL": 1, "model": "m"}`, /"baseURL" must be a string/],
    [`{"apiKey": 1}`, /"apiKey" must be a string/],
    [`{"judgePrompt": 1}`, /"judgePrompt" must be a string/],
    [`{"baseURL": "http://x/v1"}`, /"model" is required when "baseURL" is set/],
    [`{"turns": }`, /invalid JSONC/],
    [`[1]`, /top level must be an object/],
  ]
  for (const [text, err] of bad) {
    test(`rejects ${text}`, async () => {
      const p = write(text)
      const e = await loadConfig(p, { builtinDir, env: {} }).then(() => undefined, (e: Error) => e)
      expect(e?.message).toStartWith(`prompt-optimizer config ${p}: `)
      expect(e?.message).toMatch(err)
    })
  }
})

describe("configPath", () => {
  test("env override wins", () => {
    expect(configPath({ OPENCODE_PROMPT_OPTIMIZER_CONFIG: "/x/y.jsonc", XDG_CONFIG_HOME: tmp })).toBe("/x/y.jsonc")
  })

  test("jsonc, then json, then jsonc when neither exists", () => {
    const xdg = mkdtempSync(join(tmp, "xdg-"))
    const dir = join(xdg, "opencode")
    mkdirSync(dir)
    expect(configPath({ XDG_CONFIG_HOME: xdg })).toBe(join(dir, "prompt-optimizer.jsonc"))
    writeFileSync(join(dir, "prompt-optimizer.json"), "{}")
    expect(configPath({ XDG_CONFIG_HOME: xdg })).toBe(join(dir, "prompt-optimizer.json"))
    writeFileSync(join(dir, "prompt-optimizer.jsonc"), "{}")
    expect(configPath({ XDG_CONFIG_HOME: xdg })).toBe(join(dir, "prompt-optimizer.jsonc"))
  })

  test("falls back to $HOME/.config", () => {
    expect(configPath({ HOME: "/h" })).toBe("/h/.config/opencode/prompt-optimizer.jsonc")
  })

  test("loadConfig() without path uses configPath(opts.env)", async () => {
    const p = write(`{"turns": 2}`)
    const cfg = await loadConfig(undefined, { builtinDir, env: { OPENCODE_PROMPT_OPTIMIZER_CONFIG: p } })
    expect(cfg.turns).toBe(2)
    expect(cfg.path).toBe(p)
  })
})

describe("selectPrompt / globMatch", () => {
  const cfg = (prompts: Record<string, string>) => ({ prompts }) as Config

  test("insertion order, first match wins, default skipped during matching", () => {
    const c = cfg({ default: "D", "*claude*": "C", "anthropic/*": "A", "*gpt*": "G" })
    expect(selectPrompt(c, "anthropic/claude-sonnet-5")).toBe("C")
    expect(selectPrompt(c, "anthropic/other")).toBe("A")
    expect(selectPrompt(c, "openai/GPT-5")).toBe("G")
    expect(selectPrompt(c, "google/gemini")).toBe("D")
    expect(selectPrompt(cfg({ "*": "ALL", default: "D" }), "default")).toBe("ALL")
  })

  test("no match and no default => throws", () => {
    expect(() => selectPrompt(cfg({ "*x*": "X" }), "a/b")).toThrow(/no prompt matches "a\/b"/)
  })

  test("globMatch: case-insensitive, anchored, ? and regex specials", () => {
    expect(globMatch("*CLAUDE*", "anthropic/claude-3")).toBe(true)
    expect(globMatch("claude", "anthropic/claude")).toBe(false)
    expect(globMatch("openai/gpt-?", "openai/gpt-5")).toBe(true)
    expect(globMatch("openai/gpt-?", "openai/gpt-55")).toBe(false)
    expect(globMatch("a.b/c+d(e)", "a.b/c+d(e)")).toBe(true)
    expect(globMatch("a.b", "axb")).toBe(false)
    expect(globMatch("[x]*", "[x]y")).toBe(true)
  })
})
