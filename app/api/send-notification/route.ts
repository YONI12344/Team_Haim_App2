import { NextRequest, NextResponse } from 'next/server'

function getAdminApp() {
  const { initializeApp, getApps, cert } = require('firebase-admin/app')
  if (getApps().length > 0) return getApps()[0]
  return initializeApp({
    credential: cert({
      projectId: process.env.FIREBASE_ADMIN_PROJECT_ID,
      clientEmail: process.env.FIREBASE_ADMIN_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, '\n'),
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

    const adminDb = getFirestore()
    const tokenDoc = await adminDb.collection('fcmTokens').doc(userId).get()

    if (!tokenDoc.exists) {
      return NextResponse.json({ error: 'No FCM token for user' }, { status: 404 })
    }

    const { token } = tokenDoc.data()

    const messaging = getMessaging()
    const response = await messaging.send({
      token,
      notification: { title, body },
      data: { ...data, url },
      android: {
        notification: {
          channelId: 'team-haim-default',
          priority: 'high',
          defaultSound: true,
        },
      },
      apns: {
        payload: {
          aps: { sound: 'default', badge: 1, contentAvailable: true },
        },
      },
    })

    return NextResponse.json({ success: true, messageId: response })
  } catch (error) {
    console.error('Send notification error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
