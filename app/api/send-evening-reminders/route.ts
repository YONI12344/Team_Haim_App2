import { NextResponse } from 'next/server'
import { getGoogleAccessToken, fsQuery, fsGetDoc, sendFCM } from '@/lib/google-auth'

const TARGET_HOUR = 19 // send at 7 PM athlete local time

function localHour(timezone: string): number {
  try {
    return parseInt(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: timezone }).format(new Date()),
      10,
    )
  } catch {
    return -1
  }
}

function localDate(timezone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(new Date())
  } catch {
    return new Date().toISOString().slice(0, 10)
  }
}

export async function GET() {
  try {
    const accessToken = await getGoogleAccessToken()

    const workouts = await fsQuery(
      'assignedWorkouts',
      [],
      accessToken,
    )

    const athleteIds = new Set(
      workouts
        .filter((w) => w.data.status !== 'completed' && w.data.status !== 'skipped')
        .map((w) => w.data.athleteId as string)
        .filter(Boolean),
    )

    const logs = await fsQuery('logs', [], accessToken)
    const loggedAthletes = new Set(
      logs
        .filter((l) => l.data.source !== 'strava')
        .map((l) => l.data.athleteId as string)
        .filter(Boolean),
    )

    const results: string[] = []
    for (const athleteId of athleteIds) {
      if (loggedAthletes.has(athleteId)) continue

      // Get athlete's timezone
      const userDoc = await fsGetDoc('users', athleteId, accessToken)
      const tz: string = userDoc?.timezone || 'Asia/Jerusalem'

      // Only send at 7 PM in the athlete's local timezone
      if (localHour(tz) !== TARGET_HOUR) continue

      // Only send if they have an incomplete workout today in their local date
      const today = localDate(tz)
      const hasTodayWorkout = workouts.some(
        (w) =>
          w.data.athleteId === athleteId &&
          w.data.scheduledDate === today &&
          w.data.status !== 'completed' &&
          w.data.status !== 'skipped',
      )
      if (!hasTodayWorkout) continue

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
