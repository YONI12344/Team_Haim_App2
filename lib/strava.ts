// 🚴 Strava API Integration

export interface StravaActivity {
  id: number
  name: string
  type: string
  distance: number // meters
  moving_time: number // seconds
  elapsed_time: number
  start_date: string // ISO date
  start_date_local: string
  average_speed: number
  max_speed: number
  average_heartrate?: number
  max_heartrate?: number
  elevation_gain: number
}

export interface StravaAthlete {
  id: number
  username: string
  firstname: string
  lastname: string
  email?: string
}

export interface StravaTokenResponse {
  token_type: string
  expires_at: number
  expires_in: number
  refresh_token: string
  access_token: string
  athlete: StravaAthlete
}

/**
 * Exchange Strava authorization code for access token
 */
export async function exchangeStravaCode(code: string): Promise<StravaTokenResponse> {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      code,
      grant_type: 'authorization_code',
    }).toString(),
  })

  if (!response.ok) {
    throw new Error(`Strava OAuth failed: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Get Strava athlete's recent activities
 */
export async function getStravaActivities(
  accessToken: string,
  limit: number = 50,
): Promise<StravaActivity[]> {
  const response = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?per_page=${limit}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error(`Failed to fetch Strava activities: ${response.statusText}`)
  }

  return response.json()
}

/**
 * Map Strava activity to app workout format
 */
export function mapStravaToWorkout(activity: StravaActivity, athleteId: string) {
  return {
    id: `strava_${activity.id}`,
    title: activity.name,
    type: mapStravaActivityType(activity.type),
    distance: Math.round((activity.distance / 1000) * 100) / 100, // km
    duration: Math.round(activity.moving_time / 60), // minutes
    date: new Date(activity.start_date).toISOString(),
    athleteId,
    source: 'strava',
    stravaId: activity.id,
  }
}

/**
 * Map Strava activity type to app workout type
 */
function mapStravaActivityType(stravaType: string): string {
  const typeMap: Record<string, string> = {
    Run: 'easy',
    TrailRun: 'easy',
    Track: 'intervals',
    Swim: 'cross_training',
    Bike: 'cross_training',
    Walk: 'recovery',
  }

  return typeMap[stravaType] || 'easy'
}

/**
 * Refresh Strava access token
 */
export async function refreshStravaToken(refreshToken: string): Promise<StravaTokenResponse> {
  const response = await fetch('https://www.strava.com/oauth/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: process.env.STRAVA_CLIENT_ID!,
      client_secret: process.env.STRAVA_CLIENT_SECRET!,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }).toString(),
  })

  if (!response.ok) {
    throw new Error(`Strava token refresh failed: ${response.statusText}`)
  }

  return response.json()
}
