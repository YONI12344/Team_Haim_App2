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

    const byAthlete = new Map<string, { title: string; distance?: number; scheduledDate: string }>()
    for (const { data } of workouts) {
      if (!data.athleteId || byAthlete.has(data.athleteId)) continue
      byAthlete.set(data.athleteId, {
        title: data.workout?.title || 'אימון',
        distance: data.workout?.distance ?? undefined,
        scheduledDate: data.scheduledDate || '',
      })
    }

    const results: string[] = []
    for (const [athleteId, workout] of byAthlete.entries()) {
      const userDoc = await fsGetDoc('users', athleteId, accessToken)
      const tz: string = userDoc?.timezone || 'Asia/Jerusalem'

      // Send if athlete's local time is between 7–9 AM
      // Two crons cover different regions: eu runs at 05:00 UTC, us at 13:00 UTC
      const hour = localHour(tz)
      if (hour < 7 || hour > 9) continue

      const today = localDate(tz)
      if (workout.scheduledDate !== today) continue

      const tokenDoc = await fsGetDoc('fcmTokens', athleteId, accessToken)
      if (!tokenDoc?.token) continue

      const body = workout.distance
        ? `${workout.title} · ${workout.distance} ק״מ`
        : workout.title

      try {
        await sendFCM(
          tokenDoc.token,
          { title: 'האימון של היום מחכה לך', body },
          { url: '/athlete/schedule', type: 'morning_workout' },
          accessToken,
        )
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
