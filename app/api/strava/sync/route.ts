import { NextRequest, NextResponse } from 'next/server'
import { getStravaActivities, refreshStravaToken } from '@/lib/strava'

export async function POST(request: NextRequest) {
  try {
    const { userId, accessToken, refreshToken, expiresAt, priorityDate } = await request.json()

    if (!userId || !accessToken) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }

    // Refresh token if needed
    let currentToken = accessToken
    if (Date.now() / 1000 > expiresAt - 300) {
      const refreshed = await refreshStravaToken(refreshToken)
      currentToken = refreshed.access_token
    }

    // Fetch last 30 activities from Strava (cheap — one API call)
    const activities = await getStravaActivities(currentToken, 30)

    // Map activities to a date lookup
    const activitiesByDate: Record<string, any[]> = {}
    activities.forEach((activity) => {
      const date = activity.start_date_local.split('T')[0]
      if (!activitiesByDate[date]) activitiesByDate[date] = []
      activitiesByDate[date].push(activity)
    })

    // Full detail + laps costs 2 extra API calls PER activity — fetching
    // that for all 30 would burn ~60 calls on a single sync click, which
    // can exhaust Strava's 100-requests-per-15-minutes read limit after
    // just a couple of syncs (every sync after that fails with 429 until
    // the window resets). Workout-matching only ever needs recent data, so
    // only activities from the last week get the expensive detail+laps
    // fetch; older ones fall back to the basic list data (no rep splits,
    // but still enough for date/distance/pace).
    const RECENT_DAYS = 7
    const cutoffMs = Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000
    // The day the coach/athlete is actually looking at right now (e.g.
    // right after a "reset day" debug + resync, specifically to force a
    // fresh recompute) always gets the full fetch too, however old it is —
    // otherwise resyncing an older day silently falls back to sparse list
    // data with no rep splits at all, and a genuinely-fixed matching
    // algorithm looks like it "didn't work" because the real lap data was
    // never re-fetched in the first place.
    const isRecent = (a: typeof activities[number]) =>
      new Date(a.start_date_local).getTime() >= cutoffMs || a.start_date_local.split('T')[0] === priorityDate

    const fullActivities = await Promise.all(
      activities.map(async (activity) => {
        if (!isRecent(activity)) return activity
        try {
          const [actRes, lapsRes] = await Promise.all([
            fetch(`https://www.strava.com/api/v3/activities/${activity.id}`, {
              headers: { Authorization: `Bearer ${currentToken}` }
            }),
            fetch(`https://www.strava.com/api/v3/activities/${activity.id}/laps`, {
              headers: { Authorization: `Bearer ${currentToken}` }
            })
          ])
          const actData = actRes.ok ? await actRes.json() : activity
          const lapsData = lapsRes.ok ? await lapsRes.json() : []
          actData._laps = Array.isArray(lapsData) ? lapsData : []
          return actData
        } catch(e) {}
        return activity
      })
    )

    // Build sync results
    const results = fullActivities.map((activity) => {
      const date = activity.start_date_local.split('T')[0]
      const distanceKm = Math.round((activity.distance / 1000) * 100) / 100
      // Strava's moving_time silently drops anything it detects as "not
      // moving" (a traffic light, tying a shoelace) — elapsed_time is the
      // real wall-clock duration, which is what the athlete's own watch
      // displays as the activity's time/average pace. Using moving_time
      // here made the app's average pace look faster than what the
      // athlete actually saw on their wrist for the exact same run.
      const elapsedTime = activity.elapsed_time || activity.moving_time
      const durationMin = Math.round(elapsedTime / 60)

      // Calculate average pace
      let avgPace = ''
      if (activity.distance > 0) {
        const paceSecPerKm = elapsedTime / (activity.distance / 1000)
        const paceMin = Math.floor(paceSecPerKm / 60)
        const paceSec = Math.round(paceSecPerKm % 60)
        avgPace = `${paceMin}:${paceSec.toString().padStart(2, '0')}/km`
      }

      // Use laps if athlete pressed lap button, otherwise use km splits
      const laps = (activity as any)._laps || []
      const splits = laps.length > 1 ? laps : ((activity as any).splits_metric || [])
      const isLapBased = laps.length > 1
      const splitLogs = splits.slice(0, 40).map((split: any, i: number) => {
        const splitElapsed = split.elapsed_time || split.moving_time
        const splitDistKm = split.distance / 1000
        const splitPaceSecPerKm = splitElapsed / splitDistKm
        const splitPaceMin = Math.floor(splitPaceSecPerKm / 60)
        const splitPaceSec = Math.round(splitPaceSecPerKm % 60)
        const splitMin = Math.floor(splitElapsed / 60)
        const splitSec = Math.round(splitElapsed % 60)
        return {
          setIndex: 0,
          repIndex: i,
          distance: isLapBased ? `${Math.round(split.distance)}m` : `${Math.round(split.distance)}m`,
          distanceKm: Math.round(splitDistKm * 100) / 100,
          time: `${splitMin}:${splitSec.toString().padStart(2, '0')}`,
          pace: `${splitPaceMin}:${splitPaceSec.toString().padStart(2, '0')}/km`,
          heartRate: split.average_heartrate ? Math.round(split.average_heartrate) : null,
          elevationDiff: split.elevation_difference ? Math.round(split.elevation_difference) : null,
          paceZone: split.pace_zone || null,
          lapIndex: isLapBased ? i + 1 : null,
          notes: split.pace_zone ? `Zone ${split.pace_zone}` : '',
        }
      })

      return {
        stravaActivityId: activity.id,
        stravaName: activity.name,
        stravaType: activity.type,
        startTime: activity.start_date_local || null,
        date,
        distanceKm,
        durationMin,
        avgPace,
        elevationGain: activity.total_elevation_gain,
        averageHeartRate: (activity as any).average_heartrate || null,
        maxHeartRate: (activity as any).max_heartrate || null,
        splitLogs,
        athleteId: userId,
      }
    })

    return NextResponse.json({
      success: true,
      activities: results,
      count: results.length,
      dates: Object.keys(activitiesByDate),
    })
  } catch (error) {
    console.error('Strava sync error:', error)
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Sync failed' },
      { status: 500 },
    )
  }
}
