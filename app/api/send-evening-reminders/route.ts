import { NextResponse } from 'next/server'
import { getGoogleAccessToken, fsQuery, fsGetDoc, sendFCM } from '@/lib/google-auth'

export async function GET() {
  try {
    const today = new Date().toISOString().slice(0, 10)
    const accessToken = await getGoogleAccessToken()

    const workouts = await fsQuery(
      'assignedWorkouts',
      [{ field: 'scheduledDate', op: 'EQUAL', value: today }],
      accessToken,
    )

    const athleteIds = new Set(
      workouts
        .filter((w) => w.data.status !== 'completed' && w.data.status !== 'skipped')
        .map((w) => w.data.athleteId as string)
        .filter(Boolean),
    )

    const logs = await fsQuery(
      'logs',
      [{ field: 'date', op: 'EQUAL', value: today }],
      accessToken,
    )
    const loggedAthletes = new Set(
      logs
        .filter((l) => l.data.source !== 'strava')
        .map((l) => l.data.athleteId as string)
        .filter(Boolean),
    )

    const results: string[] = []
    for (const athleteId of athleteIds) {
      if (loggedAthletes.has(athleteId)) continue

      const tokenDoc = await fsGetDoc('fcmTokens', athleteId, accessToken)
      if (!tokenDoc?.token) continue

      try {
        await sendFCM(
          tokenDoc.token,
          { title: 'שכחת לדווח על האימון?', body: 'לחץ כאן לדיווח על האימון של היום' },
          { url: '/athlete/schedule', type: 'evening_reminder' },
          accessToken,
        )
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
