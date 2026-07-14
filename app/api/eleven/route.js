// Serverless proxy for ElevenLabs — solves CORS and keeps voice keys off the wire.
// Key resolution: server env ELEVENLABS_API_KEY, else the x-el-key request header.
export const maxDuration = 60

const ALLOWED = [/^voices$/, /^text-to-speech\/[A-Za-z0-9]+$/]

function resolveKey(req) {
  return process.env.ELEVENLABS_API_KEY || req.headers.get("x-el-key")
}

function checkPath(path) {
  return ALLOWED.some((re) => re.test(path))
}

export async function GET(req) {
  const { searchParams } = new URL(req.url)
  const path = String(searchParams.get("path") || "")
  if (!checkPath(path)) return Response.json({ error: "path not allowed" }, { status: 400 })

  const key = resolveKey(req)
  if (!key) {
    return Response.json(
      { error: "No ElevenLabs key: set ELEVENLABS_API_KEY on the server or send x-el-key." },
      { status: 401 },
    )
  }

  const qs = searchParams.get("qs") ? `?${String(searchParams.get("qs"))}` : ""
  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/${path}${qs}`, {
      method: "GET",
      headers: { "xi-api-key": key },
    })
    const text = await r.text()
    return new Response(text, {
      status: r.status,
      headers: { "content-type": r.headers.get("content-type") || "application/json" },
    })
  } catch {
    return Response.json({ error: "Upstream call to ElevenLabs failed." }, { status: 502 })
  }
}

export async function POST(req) {
  const { searchParams } = new URL(req.url)
  const path = String(searchParams.get("path") || "")
  if (!checkPath(path)) return Response.json({ error: "path not allowed" }, { status: 400 })

  const key = resolveKey(req)
  if (!key) {
    return Response.json(
      { error: "No ElevenLabs key: set ELEVENLABS_API_KEY on the server or send x-el-key." },
      { status: 401 },
    )
  }

  const qs = searchParams.get("qs") ? `?${String(searchParams.get("qs"))}` : ""
  let payload
  try {
    payload = await req.json()
  } catch {
    payload = {}
  }

  try {
    const r = await fetch(`https://api.elevenlabs.io/v1/${path}${qs}`, {
      method: "POST",
      headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify(payload || {}),
    })
    const ct = r.headers.get("content-type") || "application/json"
    if (ct.includes("audio")) {
      const buf = await r.arrayBuffer()
      return new Response(buf, { status: r.status, headers: { "content-type": ct } })
    }
    const text = await r.text()
    return new Response(text, { status: r.status, headers: { "content-type": ct } })
  } catch {
    return Response.json({ error: "Upstream call to ElevenLabs failed." }, { status: 502 })
  }
}
