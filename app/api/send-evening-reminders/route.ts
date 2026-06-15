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

    // Athletes with a non-completed workout today
    const workoutsSnap = await db
      .collection('assignedWorkouts')
      .where('scheduledDate', '==', today)
      .get()

    const athleteIds = new Set<string>()
    workoutsSnap.forEach((doc: any) => {
      const d = doc.data()
      if (d.athleteId && d.status !== 'completed' && d.status !== 'skipped') {
        athleteIds.add(d.athleteId)
      }
    })

    // Athletes who already submitted a manual log today
    const logsSnap = await db.collection('logs').where('date', '==', today).get()
    const loggedAthletes = new Set<string>()
    logsSnap.forEach((doc: any) => {
      const d = doc.data()
      if (d.source !== 'strava') loggedAthletes.add(d.athleteId)
    })

    const messaging = getMessaging()
    const results: string[] = []

    for (const athleteId of athleteIds) {
      if (loggedAthletes.has(athleteId)) continue

      const tokenDoc = await db.collection('fcmTokens').doc(athleteId).get()
      if (!tokenDoc.exists) continue

      const { token } = tokenDoc.data()

      try {
        await messaging.send({
          token,
          notification: {
            title: 'שכחת לדווח על האימון?',
            body: 'לחץ כאן לדיווח על האימון של היום',
          },
          data: { url: '/athlete/schedule', type: 'evening_reminder' },
          android: {
            notification: { channelId: 'team-haim-default', priority: 'high' as const, defaultSound: true },
          },
          apns: {
            payload: { aps: { sound: 'default', badge: 1, contentAvailable: true } },
          },
        })
        results.push(athleteId)
      } catch (err) {
        console.error(`Evening reminder failed for ${athleteId}:`, err)
      }
    }

    return NextResponse.json({ sent: results.length, athletes: results })
  } catch (error) {
    console.error('Evening reminders error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
