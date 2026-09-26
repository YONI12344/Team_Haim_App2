// Server-side check that a request really comes from the coach. The page's CoachLayout only hides
// the UI; this is what stops anyone else from calling the AI (and spending the API key) directly.
// Verifies the caller's Firebase ID token against Google's public keys -- no service account needed.

import { createRemoteJWKSet, jwtVerify } from 'jose'
import { isCoachEmail } from '@/lib/constants'

const PROJECT_ID = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'team-haim'
const JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'),
)

export async function verifyCoach(authHeader: string | null): Promise<{ ok: true; uid: string } | { ok: false; status: number; error: string }> {
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : ''
  if (!token) return { ok: false, status: 401, error: 'Sign in as the coach.' }
  try {
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: `https://securetoken.google.com/${PROJECT_ID}`,
      audience: PROJECT_ID,
    })
    const email = typeof payload.email === 'string' ? payload.email : null
    if (!isCoachEmail(email) || payload.email_verified !== true || !payload.sub) {
      return { ok: false, status: 403, error: 'Only the coach can use the AI Coach.' }
    }
    return { ok: true, uid: payload.sub }
  } catch {
    return { ok: false, status: 401, error: 'Your sign-in expired. Refresh the page.' }
  }
}
