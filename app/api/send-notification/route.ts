import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAccessToken, fsGetDoc, sendFCM } from '@/lib/google-auth'

export async function POST(req: NextRequest) {
  try {
    const { userId, title, body, data = {}, url = '/' } = await req.json()

    if (!userId || !title || !body) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    const accessToken = await getGoogleAccessToken()

    const tokenDoc = await fsGetDoc('fcmTokens', userId, accessToken)
    if (!tokenDoc?.token) {
      return NextResponse.json({ error: 'No FCM token for user' }, { status: 404 })
    }

    const stringData: Record<string, string> = { url }
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') stringData[k] = v
    }

    const messageId = await sendFCM(tokenDoc.token, { title, body }, stringData, accessToken)
    return NextResponse.json({ success: true, messageId })
  } catch (error) {
    console.error('Send notification error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
