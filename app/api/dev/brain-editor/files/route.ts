import { NextRequest, NextResponse } from 'next/server'
import { readFile, writeFile } from 'fs/promises'
import path from 'path'

// Local-only editor for the Bakken brain content — reads/writes the real
// files on disk (brain.json, coach-voice.json, safety-rules.json).
// Deliberately gated to development: Vercel's deployed serverless
// filesystem is read-only anyway (a write there would just fail), but this
// blocks it explicitly rather than relying on that as the only defense —
// editing the live brain should only ever happen through a reviewed git
// commit, not a stray write from whoever has the deployed URL open.
const FILES: Record<string, string> = {
  brain: 'lib/bakken/brain.json',
  coachVoice: 'lib/bakken/coach-voice.json',
  safetyRules: 'lib/bakken/safety-rules.json',
}

function guardDev() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'The brain editor only works when running locally (npm run dev), not on the deployed site.' }, { status: 403 })
  }
  return null
}

export async function GET() {
  const guard = guardDev()
  if (guard) return guard
  try {
    const result: Record<string, unknown> = {}
    for (const [key, relPath] of Object.entries(FILES)) {
      const content = await readFile(path.join(process.cwd(), relPath), 'utf8')
      result[key] = JSON.parse(content)
    }
    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const guard = guardDev()
  if (guard) return guard
  try {
    const body = await req.json()
    const { file, content } = body as { file: string; content: unknown }
    const relPath = FILES[file]
    if (!relPath) {
      return NextResponse.json({ error: `Unknown file key "${file}"` }, { status: 400 })
    }
    // Validate it's real, parseable JSON before writing — a malformed save
    // would otherwise silently corrupt the file the actual generation
    // pipeline imports at build time.
    const serialized = JSON.stringify(content, null, 2) + '\n'
    JSON.parse(serialized)
    await writeFile(path.join(process.cwd(), relPath), serialized, 'utf8')
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
