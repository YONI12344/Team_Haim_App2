import { NextRequest, NextResponse } from 'next/server'
import { getGoogleAccessToken, fsQuery, fsGetDoc, fsListTokens, sendFCMToAll } from '@/lib/google-auth'

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
    const daysOff = await fsQuery('daysOff', [], accessToken)

    const isDayOff = (athleteId: string, dateStr: string) =>
      daysOff.some((d) => d.data.athleteId === athleteId && d.data.startDate <= dateStr && d.data.endDate >= dateStr)

    const athleteIds = new Set(
      workouts
        .filter((w) => w.data.status !== 'completed' && w.data.status !== 'skipped')
        .map((w) => w.data.athleteId as string)
        .filter(Boolean),
    )

    const results: string[] = []
    for (const athleteId of athleteIds) {
      const userDoc = await fsGetDoc('users', athleteId, accessToken)
      const tz: string = userDoc?.timezone || 'Asia/Jerusalem'

      // Send if athlete's local time is between 19–21 (7–9 PM)
      // Two crons cover different regions: eu runs at 16:00 UTC, us at 23:00 UTC
      const hour = localHour(tz)
      if (hour < 19 || hour > 21) continue

      const today = localDate(tz)
      if (isDayOff(athleteId, today)) continue

      const hasTodayWorkout = workouts.some(
        (w) =>
          w.data.athleteId === athleteId &&
          w.data.scheduledDate === today &&
          w.data.status !== 'completed' &&
          w.data.status !== 'skipped',
      )
      if (!hasTodayWorkout) continue

      // Skip only if they already logged something *today* — scoped by date
      // so logging once doesn't silence this reminder forever (the previous
      // check here had no date filter at all).
      const hasLoggedToday = logs.some(
        (l) => l.data.athleteId === athleteId && l.data.date === today && l.data.source !== 'strava',
      )
      if (hasLoggedToday) continue

      const athleteTokens = await fsListTokens(athleteId, accessToken)
      if (athleteTokens.length === 0) continue

      try {
        await sendFCMToAll(
          athleteTokens,
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
