import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAccessToken, fsListTokens, sendFCMToAll } from '@/lib/google-auth'

export async function POST(req: NextRequest) {
  try {
    const { userId, title, body, data = {}, url = '/' } = await req.json()

    if (!userId || !title || !body) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const accessToken = await getGoogleAccessToken()

    // Every device this user has registered notifications on — not just
    // whichever one registered most recently (see fsListTokens).
    const tokens = await fsListTokens(userId, accessToken)
    if (tokens.length === 0) {
      return NextResponse.json({ error: 'No FCM token for user' }, { status: 404 })
    }

    const stringData: Record<string, string> = { url }
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') stringData[k] = v
    }

    const sent = await sendFCMToAll(tokens, { title, body }, stringData, accessToken)
    return NextResponse.json({ success: sent > 0, sent, total: tokens.length })
  } catch (error) {
    console.error('Send notification error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
