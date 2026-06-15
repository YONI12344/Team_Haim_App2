/**
 * Google OAuth2 + Firestore REST + FCM HTTP v1 helpers
 * Zero service-account JSON key required.
 *
 * HOW TO GET THE THREE ENV VARS (one-time setup):
 * ─────────────────────────────────────────────────
 * 1. Google Cloud Console → APIs & Services → Credentials
 *    → "+ Create Credentials" → OAuth 2.0 Client ID → Desktop app
 *    → copy Client ID and Client Secret
 *
 * 2. Open this URL in your browser (replace YOUR_CLIENT_ID):
 *    https://accounts.google.com/o/oauth2/v2/auth
 *      ?client_id=YOUR_CLIENT_ID
 *      &redirect_uri=http://localhost
 *      &response_type=code
 *      &scope=https://www.googleapis.com/auth/firebase.messaging%20https://www.googleapis.com/auth/datastore
 *      &access_type=offline
 *      &prompt=consent
 *    Sign in with your Firebase project owner account.
 *    Copy the `code=...` value from the redirect URL.
 *
 * 3. Exchange the code for tokens (run in terminal):
 *    curl -X POST https://oauth2.googleapis.com/token \
 *      -d "client_id=CLIENT_ID&client_secret=CLIENT_SECRET \
 *          &code=CODE&grant_type=authorization_code \
 *          &redirect_uri=http://localhost"
 *    Copy the `refresh_token` from the JSON response.
 *
 * 4. Add to Vercel Environment Variables:
 *    GOOGLE_OAUTH_CLIENT_ID      = the client_id
 *    GOOGLE_OAUTH_CLIENT_SECRET  = the client_secret
 *    GOOGLE_OAUTH_REFRESH_TOKEN  = the refresh_token
 */

const PROJECT_ID =
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'team-haim'

// ── OAuth2 access token ───────────────────────────────────────────────────────

export async function getGoogleAccessToken(): Promise<string> {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      'Missing OAuth credentials. Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN.',
    )
  }

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }).toString(),
  })

  const json = await res.json()
  if (!json.access_token) {
    throw new Error(`Token refresh failed: ${JSON.stringify(json)}`)
  }
  return json.access_token as string
}

// ── Firestore REST helpers ────────────────────────────────────────────────────

function parseValue(v: any): any {
  if (v == null) return null
  if ('stringValue' in v) return v.stringValue
  if ('integerValue' in v) return Number(v.integerValue)
  if ('doubleValue' in v) return v.doubleValue
  if ('booleanValue' in v) return v.booleanValue
  if ('nullValue' in v) return null
  if ('timestampValue' in v) return v.timestampValue
  if ('arrayValue' in v) return (v.arrayValue?.values || []).map(parseValue)
  if ('mapValue' in v) return parseFields(v.mapValue?.fields || {})
  return null
}

function parseFields(fields: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, parseValue(v)]))
}

const FS_BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`

/** Read a single Firestore document by collection + id. Returns null if not found. */
export async function fsGetDoc(
  collection: string,
  id: string,
  accessToken: string,
): Promise<Record<string, any> | null> {
  const res = await fetch(`${FS_BASE}/${collection}/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`fsGetDoc ${collection}/${id}: ${res.status} ${await res.text()}`)
  const doc = await res.json()
  return parseFields(doc.fields || {})
}

type FieldOp = 'EQUAL' | 'NOT_EQUAL' | 'ARRAY_CONTAINS'
type FSFilter = { field: string; op: FieldOp; value: string }

/** Run a structured query against a Firestore collection. */
export async function fsQuery(
  collectionId: string,
  filters: FSFilter[],
  accessToken: string,
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const makeFieldFilter = (f: FSFilter) => ({
    fieldFilter: {
      field: { fieldPath: f.field },
      op: f.op,
      value: { stringValue: f.value },
    },
  })

  const where =
    filters.length === 1
      ? makeFieldFilter(filters[0])
      : { compositeFilter: { op: 'AND', filters: filters.map(makeFieldFilter) } }

  const res = await fetch(`${FS_BASE}:runQuery`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId }], where } }),
  })

  if (!res.ok) throw new Error(`fsQuery ${collectionId}: ${res.status} ${await res.text()}`)

  const rows: any[] = await res.json()
  return rows
    .filter((r) => r.document)
    .map((r) => {
      const parts: string[] = r.document.name.split('/')
      return { id: parts[parts.length - 1], data: parseFields(r.document.fields || {}) }
    })
}

// ── FCM HTTP v1 ───────────────────────────────────────────────────────────────

export async function sendFCM(
  fcmToken: string,
  notification: { title: string; body: string },
  data: Record<string, string>,
  accessToken: string,
): Promise<string> {
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          notification,
          data,
          android: {
            priority: 'high',
            notification: { channel_id: 'team-haim-default', sound: 'default' },
          },
          apns: {
            payload: { aps: { sound: 'default', badge: 1, 'content-available': 1 } },
          },
        },
      }),
    },
  )

  if (!res.ok) {
    throw new Error(`FCM send failed ${res.status}: ${await res.text()}`)
  }
  const json = await res.json()
  return (json.name as string) || 'sent'
}
