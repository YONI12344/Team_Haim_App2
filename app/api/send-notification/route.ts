import { NextRequest, NextResponse } from 'next/server'

function getAdminApp() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app')
  if (getApps().length > 0) return getApps()[0]
  return initializeApp({
    credential: cert({
      projectId: 'team-haim',
      clientEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      privateKey: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
  })
}

export async function POST(req: NextRequest) {
  try {
    const { userId, title, body, data = {}, url = '/' } = await req.json()

    if (!userId || !title || !body) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    getAdminApp()
    const { getFirestore } = require('firebase-admin/firestore')
    const { getMessaging } = require('firebase-admin/messaging')

    const tokenDoc = await getFirestore().collection('fcmTokens').doc(userId).get()
    if (!tokenDoc.exists) {
      return NextResponse.json({ error: 'No FCM token for user' }, { status: 404 })
    }

    const { token } = tokenDoc.data()

    // FCM data values must all be strings
    const stringData: Record<string, string> = { url }
    for (const [k, v] of Object.entries(data)) {
      if (typeof v === 'string') stringData[k] = v
    }

    const messageId = await getMessaging().send({
      token,
      notification: { title, body },
      data: stringData,
      android: {
        notification: { channelId: 'team-haim-default', priority: 'high' as const, defaultSound: true },
      },
      apns: {
        payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
      },
    })

    return NextResponse.json({ success: true, messageId })
  } catch (error) {
    console.error('Send notification error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
