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

    const byAthlete = new Map<string, { title: string; distance?: number }>()
    for (const { data } of workouts) {
      if (data.athleteId && !byAthlete.has(data.athleteId)) {
        byAthlete.set(data.athleteId, {
          title: data.workout?.title || 'אימון',
          distance: data.workout?.distance ?? undefined,
        })
      }
    }

    const results: string[] = []
    for (const [athleteId, workout] of byAthlete.entries()) {
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
