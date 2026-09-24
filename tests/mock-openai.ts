// Tiny OpenAI-compatible /v1/chat/completions mock (stream + non-stream) for tests.
//   optimizer calls (last user msg has <original_prompt>) -> <optimized_prompt>OPTIMIZED#<n>: <original></optimized_prompt>
//   judge calls (last user msg has <candidate ...>)        -> picks the LAST candidate
//   anything else (the target chat model, titles)          -> "MOCK REPLY"
// Every request is appended to `log` as one JSON line: {path, auth, body}.
// CLI: bun tests/mock-openai.ts [port=4010] [logfile]
import { appendFileSync } from "node:fs"

const text = (c: any): string =>
  typeof c === "string" ? c : Array.isArray(c) ? c.map((p: any) => p?.text ?? "").join("") : ""

export function startMock(opts: { port?: number; log?: string; fail?: (body: any) => boolean } = {}) {
  let n = 0
  return Bun.serve({
    port: opts.port ?? 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url)
      if (url.pathname.endsWith("/models")) return Response.json({ object: "list", data: [{ id: "mock", object: "model" }] })
      if (!url.pathname.endsWith("/chat/completions")) return new Response("not found", { status: 404 })
      const body: any = await req.json()
      if (opts.log) appendFileSync(opts.log, JSON.stringify({ path: url.pathname, auth: req.headers.get("authorization"), body }) + "\n")
      if (opts.fail?.(body)) return Response.json({ error: { message: "mock failure" } }, { status: 500 })

      const lastUser = text([...(body.messages ?? [])].reverse().find((m: any) => m.role === "user")?.content)
      const orig = lastUser.match(/<original_prompt>\s*([\s\S]*?)\s*<\/original_prompt>/)
      let content = "MOCK REPLY"
      if (/<candidate\b/.test(lastUser))
        content = `<reason>mock judge picked the last one</reason>\n<best>${lastUser.match(/<candidate\b/g)!.length}</best>`
      else if (orig) content = `<optimized_prompt>\nOPTIMIZED#${++n}: ${orig[1]}\n</optimized_prompt>`

      const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
      if (!body.stream)
        return Response.json({
          id: "mock", object: "chat.completion", created: 0, model: body.model, usage,
          choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
        })
      const chunk = (o: object) =>
        `data: ${JSON.stringify({ id: "mock", object: "chat.completion.chunk", created: 0, model: body.model, ...o })}\n\n`
      const sse =
        chunk({ choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] }) +
        chunk({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage }) +
        "data: [DONE]\n\n"
      return new Response(sse, { headers: { "content-type": "text/event-stream" } })
    },
  })
}

if (import.meta.main) {
  const s = startMock({ port: Number(Bun.argv[2] ?? 4010), log: Bun.argv[3] })
  console.log(`mock openai listening on ${s.url}`)
}
