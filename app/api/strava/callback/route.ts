import { NextRequest, NextResponse } from 'next/server'
import { exchangeStravaCode } from '@/lib/strava'
import { db } from '@/lib/firebase'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code')

    if (!code) {
      return NextResponse.redirect(
        new URL(
          '/error?message=No authorization code from Strava',
          request.url,
        ),
      )
    }

    console.log('🚴 Strava OAuth - Exchanging code for token...')

    // Exchange code for access token
    const tokenData = await exchangeStravaCode(code)
    const athlete = tokenData.athlete

    console.log(`✅ Strava auth successful for athlete: ${athlete.firstname} ${athlete.lastname}`)

    // Store Strava credentials in Firestore
    const stravaRef = doc(db, 'strava_connections', `strava_${athlete.id}`)
    await setDoc(
      stravaRef,
      {
        stravaId: athlete.id,
        username: athlete.username,
        name: `${athlete.firstname} ${athlete.lastname}`,
        email: athlete.email,
        accessToken: tokenData.access_token,
        refreshToken: tokenData.refresh_token,
        expiresAt: tokenData.expires_at,
        connectedAt: serverTimestamp(),
        lastSync: null,
      },
      { merge: true },
    )

    // Redirect to athlete dashboard with Strava connected
    return NextResponse.redirect(
      new URL(
        `/athlete?strava=connected&name=${encodeURIComponent(`${athlete.firstname} ${athlete.lastname}`)}`,
        request.url,
      ),
    )
  } catch (error) {
    console.error('❌ Strava callback error:', error)
    return NextResponse.redirect(
      new URL(
        `/error?message=${encodeURIComponent(error instanceof Error ? error.message : 'Strava connection failed')}`,
        request.url,
      ),
    )
  }
}
