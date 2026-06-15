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
      .where('status', '==', 'scheduled')
      .get()

    const athleteIds = new Set<string>()
    workoutsSnap.forEach((doc: any) => athleteIds.add(doc.data().athleteId))

    const logsSnap = await adminDb
      .collection('logs')
      .where('date', '==', today)
      .get()

    const loggedAthletes = new Set<string>()
    logsSnap.forEach((doc: any) => {
      const d = doc.data()
      if (d.source !== 'strava') loggedAthletes.add(d.athleteId)
    })

    const messaging = getMessaging()
    const results: string[] = []

    for (const athleteId of athleteIds) {
      if (loggedAthletes.has(athleteId)) continue

      const tokenDoc = await adminDb.collection('fcmTokens').doc(athleteId).get()
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
    console.error('Evening reminders error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
