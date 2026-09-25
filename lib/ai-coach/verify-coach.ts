import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { COACH_EMAIL } from '@/lib/constants'

// ID-token verification only needs the project id (Google's public signing
// keys are fetched over HTTPS), not a service-account credential — so this
// works the same locally and on Vercel with no extra secrets. Uses its own
// named app so it never collides with any other firebase-admin usage.
const APP_NAME = 'ai-coach-verify'
const verifyApp =
  getApps().find((a) => a.name === APP_NAME) ??
  initializeApp({ projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'team-haim' }, APP_NAME)

/**
 * Gate for every /api/ai-coach/* route: the AI coach is coach-only. Returns
 * an error response for anyone who isn't the verified coach account, so a
 * signed-in athlete calling the API directly gets a 403, not the agent.
 */
export async function requireCoach(req: NextRequest): Promise<NextResponse | null> {
  const header = req.headers.get('authorization') || ''
  const idToken = header.startsWith('Bearer ') ? header.slice(7) : null
  if (!idToken) return NextResponse.json({ error: 'Missing Authorization bearer token' }, { status: 401 })
  try {
    const decoded = await getAuth(verifyApp).verifyIdToken(idToken)
    if (decoded.email?.toLowerCase() !== COACH_EMAIL.toLowerCase() || decoded.email_verified === false) {
      return NextResponse.json({ error: 'The AI coach is only available to the coach account' }, { status: 403 })
    }
    return null
  } catch (err) {
    console.error('AI coach: token verification failed:', err)
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }
}
