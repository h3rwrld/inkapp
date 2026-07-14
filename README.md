# INKSAINT — dark fiction universe console

A full AI writing studio for dark romance, suspense, and screen: story building, character vault,
plot engines, a Markdown + Fountain writing desk, six AI agents (plus custom agents and a
roundtable), canon intelligence tools, a songwriting connectivity grid, ElevenLabs narration, and a
project shelf with JSON/TXT/Markdown/PDF export.

## Stack

- **Framework:** Next.js (App Router) + React
- **AI:** text generation runs through the [Vercel AI SDK](https://ai-sdk.dev) and the AI Gateway,
  so no raw Anthropic key is required in v0.
- **API routes:**
  - `app/api/claude/route.js` — text generation via the AI Gateway (Anthropic). Returns an
    Anthropic-Messages-compatible shape so the studio UI is unchanged.
  - `app/api/eleven/route.js` — proxies ElevenLabs TTS; keeps voice keys off the wire.
- **Storage:** browser `localStorage` (auto-save + project shelf), with JSON import/export.

## Environment variables

- `AI_GATEWAY_API_KEY` — used by the AI Gateway when not deployed on Vercel OIDC. On Vercel this is
  handled automatically.
- `CLAUDE_MODEL` — optional, defaults to `anthropic/claude-sonnet-4.6`.
- `CLAUDE_MAX_TOKENS` — optional, defaults to `2048`.
- `ELEVENLABS_API_KEY` — optional. If set, the Audio Room works without pasting a key in the UI.

## Local development

```bash
npm install
npm run dev
```
