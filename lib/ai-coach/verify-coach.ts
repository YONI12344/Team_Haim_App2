import 'server-only'
import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify, createRemoteJWKSet } from 'jose'
import { COACH_EMAIL } from '@/lib/constants'

// Verifies a Firebase Auth ID token by hand, with the `jose` library, rather
// than `firebase-admin`: firebase-admin pulls in grpc/protobuf native
// dependencies that Vercel's serverless bundler has repeatedly failed to
// trace correctly for this project (it worked under `next dev` but crashed
// every request in production with a bare 500 — no service-account
// credential is even needed for this, since verifying an ID token's
// signature only needs Google's public keys, fetched over HTTPS).
const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'team-haim'
const ISSUER = `https://securetoken.google.com/${PROJECT_ID}`
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

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
    const { payload } = await jwtVerify(idToken, JWKS, { issuer: ISSUER, audience: PROJECT_ID })
    const email = typeof payload.email === 'string' ? payload.email : undefined
    if (email?.toLowerCase() !== COACH_EMAIL.toLowerCase() || payload.email_verified === false) {
      return NextResponse.json({ error: 'The AI coach is only available to the coach account' }, { status: 403 })
    }
    return null
  } catch (err) {
    console.error('AI coach: token verification failed:', err)
    return NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 })
  }
}
