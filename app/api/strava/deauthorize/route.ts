import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  try {
    const { accessToken } = await request.json()
    if (!accessToken) return NextResponse.json({ error: 'Missing accessToken' }, { status: 400 })
    const res = await fetch('https://www.strava.com/oauth/deauthorize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}` }
    })
    return NextResponse.json({ success: res.ok, status: res.status })
  } catch (error) {
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
