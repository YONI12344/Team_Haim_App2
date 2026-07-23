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

/** yyyy-MM-dd for "yesterday" in the given timezone. */
function localYesterday(timezone: string): string {
  try {
    const d = new Date()
    d.setUTCDate(d.getUTCDate() - 1)
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(d)
  } catch {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  }
}

export async function GET(request: NextRequest) {
  try {
    const accessToken = await getGoogleAccessToken()

    const workouts = await fsQuery('assignedWorkouts', [], accessToken)
    const logs = await fsQuery('logs', [], accessToken)
    const daysOff = await fsQuery('daysOff', [], accessToken)

    const athleteIds = new Set(
      workouts.map((w) => w.data.athleteId as string).filter(Boolean),
    )

    // Athlete marked this date (sick/trip/other) as no-workout — suppress
    // both the athlete's own reminder and the coach's "missed" alert for it.
    const isDayOff = (athleteId: string, dateStr: string) =>
      daysOff.some((d) => d.data.athleteId === athleteId && d.data.startDate <= dateStr && d.data.endDate >= dateStr)

    // The single coach account — fetched once, reused for every missed-workout alert below
    const coachRows = await fsQuery('users', [{ field: 'email', op: 'EQUAL', value: 'info.teamhaim@gmail.com' }], accessToken)
    const coach = coachRows[0] || null
    const coachTokens = coach ? await fsListTokens(coach.id, accessToken) : []

    const results: string[] = []
    const missedAlerts: string[] = []
    for (const athleteId of athleteIds) {
      const userDoc = await fsGetDoc('users', athleteId, accessToken)
      const tz: string = userDoc?.timezone || 'Asia/Jerusalem'

      // Send if athlete's local time is between 7–9 AM
      // Two crons cover different regions: eu runs at 05:00 UTC, us at 13:00 UTC
      const hour = localHour(tz)
      if (hour < 7 || hour > 9) continue

      const today = localDate(tz)

      // Coach alert: did the athlete leave yesterday's workout unfinished
      // with nothing logged? (skipped explicitly is not alerted — that's
      // an intentional choice, not a miss)
      if (coachTokens.length > 0 && userDoc?.mutedByCoach !== true && !isDayOff(athleteId, localYesterday(tz))) {
        const yesterday = localYesterday(tz)
        const yesterdayWorkout = workouts.find(
          (w) => w.data.athleteId === athleteId
            && w.data.scheduledDate === yesterday
            && w.data.status !== 'completed'
            && w.data.status !== 'skipped',
        )
        const hasYesterdayLog = logs.some(
          (l) => l.data.athleteId === athleteId && l.data.date === yesterday && l.data.actualDistance,
        )
        if (yesterdayWorkout && !hasYesterdayLog) {
          try {
            await sendFCMToAll(
              coachTokens,
              {
                title: `${userDoc?.name || 'ספורטאי'} לא סימן אימון אתמול`,
                body: yesterdayWorkout.data.workout?.title || 'אימון',
              },
              { url: `/coach/athletes/${athleteId}/planner`, type: 'missed_workout' },
              accessToken,
            )
            missedAlerts.push(athleteId)
          } catch (err) {
            console.error(`Missed-workout alert failed for ${athleteId}:`, err)
          }
        }
      }

      if (isDayOff(athleteId, today)) continue

      const todayWorkout = workouts.find(
        (w) => w.data.athleteId === athleteId && w.data.scheduledDate === today,
      )
      if (!todayWorkout) continue

      const athleteTokens = await fsListTokens(athleteId, accessToken)
      if (athleteTokens.length === 0) continue

      const title = todayWorkout.data.workout?.title || 'אימון'
      const distance = todayWorkout.data.workout?.distance
      const body = distance ? `${title} · ${distance} ק״מ` : title

      try {
        await sendFCMToAll(
          athleteTokens,
          { title: 'האימון של היום מחכה לך', body },
          { url: '/athlete/schedule', type: 'morning_workout' },
          accessToken,
        )
        results.push(athleteId)
      } catch (err) {
        console.error(`Morning reminder failed for ${athleteId}:`, err)
      }
    }

    return NextResponse.json({ sent: results.length, athletes: results, missedAlerts: missedAlerts.length })
  } catch (error) {
    console.error('Morning reminders error:', error)
    return NextResponse.json({ error: String(error) }, { status: 500 })
  }
}
