// Coach-only "In my words" API: rewrites plan days in the coach's own style for one athlete (lib/coach-voice).
// Separate from the brain's API. Never writes to Firestore: the coach approves and sends from the page.

import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { verifyCoach } from '@/lib/haim-brain/verify-coach'
import { daysText, parseWritten, voiceSystem, type CoachExample } from '@/lib/coach-voice/write'
import type { PlanDay } from '@/lib/haim-brain/plan'

export const runtime = 'nodejs'
export const maxDuration = 300

const MODEL = process.env.COACH_VOICE_MODEL || process.env.HAIM_BRAIN_MODEL || 'claude-opus-5'
const PRICING: Record<string, [number, number]> = { 'claude-opus-5': [5, 25], 'claude-sonnet-5': [3, 15], 'claude-haiku-4-5': [1, 5] }
const MAX_DAYS = 16

export async function POST(req: NextRequest) {
  const auth = await verifyCoach(req.headers.get('authorization'))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'No ANTHROPIC_API_KEY on the server.' }, { status: 500 })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }) }
  const days: PlanDay[] = (Array.isArray(body?.days) ? body.days : []).filter((d: any) => d && typeof d.date === 'string').slice(0, MAX_DAYS)
  if (!days.length) return NextResponse.json({ error: 'No workouts to write.' }, { status: 400 })
  const examples: CoachExample[] = Array.isArray(body?.examples) ? body.examples.slice(0, 15) : []
  const athlete = {
    firstName: String(body?.athlete?.firstName || '').slice(0, 40),
    gender: ['male', 'female'].includes(body?.athlete?.gender) ? body.athlete.gender : undefined,
  }

  try {
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.stream({
      model: MODEL,
      max_tokens: 16000,
      // The style examples are the same for every batch of one export, so they're cached.
      system: [{ type: 'text', text: voiceSystem(examples, athlete), cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `Write these ${days.length} sessions:\n\n${daysText(days)}` }],
    }).finalMessage()
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n')
    const [inP, outP] = PRICING[MODEL] || PRICING['claude-opus-5']
    const u = msg.usage
    const cost = (u.input_tokens * inP + (u.cache_read_input_tokens || 0) * inP * 0.1
      + (u.cache_creation_input_tokens || 0) * inP * 1.25 + u.output_tokens * outP) / 1_000_000
    const workouts = parseWritten(text, days)
    if (!workouts) return NextResponse.json({ error: "The rewrite came back unreadable. Try again.", cost, usage: u, model: MODEL }, { status: 502 })
    return NextResponse.json({ workouts, cost, usage: u, model: MODEL })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ? `The AI couldn't write this: ${e.message}` : "The AI couldn't write this. Try again." }, { status: 502 })
  }
}
