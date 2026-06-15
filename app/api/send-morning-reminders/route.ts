import { NextResponse } from 'next/server'

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

export async function GET() {
  try {
    getAdminApp()
    const { getFirestore } = require('firebase-admin/firestore')
    const { getMessaging } = require('firebase-admin/messaging')

    const db = getFirestore()
    const today = new Date().toISOString().slice(0, 10)

    const workoutsSnap = await db
      .collection('assignedWorkouts')
      .where('scheduledDate', '==', today)
      .get()

    // One notification per athlete — first workout wins
    const byAthlete = new Map<string, { title: string; distance?: number }>()
    workoutsSnap.forEach((doc: any) => {
      const d = doc.data()
      if (d.athleteId && !byAthlete.has(d.athleteId)) {
        byAthlete.set(d.athleteId, {
          title: d.workout?.title || 'אימון',
          distance: d.workout?.distance ?? undefined,
        })
      }
    })

    const messaging = getMessaging()
    const results: string[] = []

    for (const [athleteId, workout] of byAthlete.entries()) {
      const tokenDoc = await db.collection('fcmTokens').doc(athleteId).get()
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
            notification: { channelId: 'team-haim-default', priority: 'high' as const, defaultSound: true },
          },
          apns: {
            payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
          },
        })
        results.push(athleteId)
      } catch (err) {
        console.error(`Morning reminder failed for ${athleteId}:`, err)
      }
    }

    return NextResponse.json({ sent: results.length, athletes: results })
  } catch (error) {
    console.error('Morning reminders error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
