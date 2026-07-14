import { generateText } from "ai"

// Text generation via the Vercel AI Gateway (Anthropic, zero-config in v0).
// Returns an Anthropic-Messages-compatible shape so the studio client is unchanged:
//   { content: [{ type: "text", text }] }  on success
//   { error: { message, type } }           on failure
export const maxDuration = 60

const MODEL = process.env.CLAUDE_MODEL || "anthropic/claude-sonnet-4.6"
const MAX_TOKENS = Number.parseInt(process.env.CLAUDE_MAX_TOKENS || "2048", 10)

export async function POST(req) {
  let body
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: { message: "Invalid JSON body." } }, { status: 400 })
  }

  const { messages, system } = body || {}
  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: { message: "messages array required" } }, { status: 400 })
  }

  try {
    const { text } = await generateText({
      model: MODEL,
      system: system || "",
      messages,
      maxOutputTokens: MAX_TOKENS,
    })
    return Response.json({ content: [{ type: "text", text }] })
  } catch (e) {
    const message = e?.message || "Upstream call to the model failed."
    // Surface transient/upstream signals so the client's retry logic can react.
    const status = e?.statusCode || e?.status || 502
    return Response.json({ error: { message, type: `upstream_${status}` } }, { status: 502 })
  }
}

export function GET() {
  return Response.json({ error: { message: "POST only" } }, { status: 405 })
}
