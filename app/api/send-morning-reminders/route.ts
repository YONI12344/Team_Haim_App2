import { NextResponse } from 'next/server'

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

export async function GET() {
  try {
    getAdminApp()
    const { getFirestore } = require('firebase-admin/firestore')
    const { getMessaging } = require('firebase-admin/messaging')

    const adminDb = getFirestore()
    const today = new Date().toISOString().slice(0, 10)

    const workoutsSnap = await adminDb
      .collection('assignedWorkouts')
      .where('scheduledDate', '==', today)
      .get()

    const byAthlete = new Map<string, { title: string; distance?: number }>()
    workoutsSnap.forEach((doc: any) => {
      const d = doc.data()
      if (!byAthlete.has(d.athleteId)) {
        byAthlete.set(d.athleteId, {
          title: d.workout?.title || 'אימון',
          distance: d.workout?.distance,
        })
      }
    })

    const messaging = getMessaging()
    const results: string[] = []

    for (const [athleteId, workout] of byAthlete.entries()) {
      const tokenDoc = await adminDb.collection('fcmTokens').doc(athleteId).get()
      if (!tokenDoc.exists) continue

      const { token } = tokenDoc.data()
      const body = workout.distance
        ? `${workout.title} · ${workout.distance} ק״מ`
        : workout.title

      try {
        await messaging.send({
          token,
          notification: { title: 'האימון של היום מחכה לך', body },
          data: { url: '/athlete/schedule', type: 'morning_workout' },
          android: {
            notification: { channelId: 'team-haim-default', priority: 'high', defaultSound: true },
          },
          apns: {
            payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
          },
        })
        results.push(athleteId)
      } catch {}
    }

    return NextResponse.json({ sent: results.length, athletes: results })
  } catch (error) {
    console.error('Morning reminders error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
