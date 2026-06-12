import { NextRequest, NextResponse } from 'next/server'
import { exchangeStravaCode } from '@/lib/strava'

export async function GET(request: NextRequest) {
  try {
    const code = request.nextUrl.searchParams.get('code')

    if (!code) {
      return NextResponse.redirect(
        new URL('/error?message=No authorization code from Strava', request.url),
      )
    }

    const tokenData = await exchangeStravaCode(code)
    const athlete = tokenData.athlete

    const params = new URLSearchParams({
      strava: 'connected',
      stravaId: String(athlete.id),
      stravaName: `${athlete.firstname} ${athlete.lastname}`,
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresAt: String(tokenData.expires_at),
    })

    return NextResponse.redirect(
      new URL(`/athlete?${params.toString()}`, request.url),
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
