import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAccessToken, fsQuery, fsGetDoc, sendFCM } from '@/lib/google-auth'

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

export async function GET(request: NextRequest) {
  try {
    const accessToken = await getGoogleAccessToken()

    const workouts = await fsQuery('assignedWorkouts', [], accessToken)
    const logs = await fsQuery('logs', [], accessToken)

    const loggedAthletes = new Set(
      logs
        .filter((l) => l.data.source !== 'strava')
        .map((l) => l.data.athleteId as string)
        .filter(Boolean),
    )

    const athleteIds = new Set(
      workouts
        .filter((w) => w.data.status !== 'completed' && w.data.status !== 'skipped')
        .map((w) => w.data.athleteId as string)
        .filter(Boolean),
    )

    const results: string[] = []
    for (const athleteId of athleteIds) {
      if (loggedAthletes.has(athleteId)) continue

      const userDoc = await fsGetDoc('users', athleteId, accessToken)
      const tz: string = userDoc?.timezone || 'Asia/Jerusalem'

      // Send if athlete's local time is between 19–21 (7–9 PM)
      // Two crons cover different regions: eu runs at 16:00 UTC, us at 23:00 UTC
      const hour = localHour(tz)
      if (hour < 19 || hour > 21) continue

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
