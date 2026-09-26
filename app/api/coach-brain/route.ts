// Coach-only AI Coach API. Checks the caller is the coach, then runs the TeamHaim brain
// (lib/haim-brain/coach-ai.ts) on the athlete data the page sent. Never writes to Firestore.

import { NextRequest, NextResponse } from 'next/server'
import { verifyCoach } from '@/lib/haim-brain/verify-coach'
import { CoachAIError, runCoachAI } from '@/lib/haim-brain/coach-ai'

export const runtime = 'nodejs'
// A full season takes the model a few minutes to write.
export const maxDuration = 300

export async function POST(req: NextRequest) {
  const auth = await verifyCoach(req.headers.get('authorization'))
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status })

  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ error: 'Bad request.' }, { status: 400 }) }
  try {
    return NextResponse.json(await runCoachAI(body))
  } catch (e: any) {
    if (e instanceof CoachAIError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: e?.message ? `The AI couldn't answer: ${e.message}` : "The AI couldn't answer. Try again." }, { status: 502 })
  }
}
