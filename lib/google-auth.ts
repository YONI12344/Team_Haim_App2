const PROJECT_ID = 'team-haim'

export async function getGoogleAccessToken(): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: process.env.GOOGLE_OAUTH_REFRESH_TOKEN!,
      client_id: process.env.GOOGLE_OAUTH_CLIENT_ID!,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET!,
    }).toString(),
  })
  const json = await res.json()
  if (!json.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(json)}`)
  return json.access_token as string
}

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

type FSFilter = { field: string; op: 'EQUAL' | 'NOT_EQUAL'; value: string }

export async function fsQuery(
  collectionId: string,
  filters: FSFilter[],
  accessToken: string,
): Promise<Array<{ id: string; data: Record<string, any> }>> {
  const makeFilter = (f: FSFilter) => ({
    fieldFilter: { field: { fieldPath: f.field }, op: f.op, value: { stringValue: f.value } },
  })
  const where =
    filters.length === 1
      ? makeFilter(filters[0])
      : { compositeFilter: { op: 'AND', filters: filters.map(makeFilter) } }

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

/**
 * Every registered push token for a user, across every device — logging in
 * on a second device (e.g. a coach opening this on their MacBook after
 * already granting notifications on their iPhone) used to silently
 * overwrite the single fcmTokens/{userId} doc, so only whichever device
 * registered LAST ever received anything again. Tokens now live in a
 * fcmTokens/{userId}/tokens/{tokenDocId} subcollection, one doc per device
 * (see lib/notifications.ts), so every registered device keeps getting
 * notified independently.
 *
 * Falls back to the old flat fcmTokens/{userId} doc when the subcollection
 * is empty, so a device that hasn't reopened the app since this migration
 * (and so hasn't written into the new subcollection yet) doesn't go silent
 * in the meantime — lib/notifications.ts's self-heal re-registration will
 * naturally move it over the next time that device's app is opened.
 */
export async function fsListTokens(userId: string, accessToken: string): Promise<string[]> {
  const res = await fetch(
    `${FS_BASE}/fcmTokens/${encodeURIComponent(userId)}:runQuery`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'tokens' }] } }),
    },
  )
  if (!res.ok) throw new Error(`fsListTokens ${userId}: ${res.status} ${await res.text()}`)
  const rows: any[] = await res.json()
  const tokens = rows
    .filter((r) => r.document)
    .map((r) => parseFields(r.document.fields || {}).token as string | undefined)
    .filter((t): t is string => !!t)
  if (tokens.length > 0) return tokens

  const legacy = await fsGetDoc('fcmTokens', userId, accessToken)
  return legacy?.token ? [legacy.token as string] : []
}

export async function sendFCM(
  fcmToken: string,
  notification: { title: string; body: string },
  data: Record<string, string>,
  accessToken: string,
): Promise<string> {
  // Data-only message: no top-level `notification` field. FCM/browsers
  // auto-display a system notification whenever a `notification` field is
  // present, and our service worker's onBackgroundMessage ALSO calls
  // showNotification() — together that showed every push twice. Putting
  // title/body inside `data` means only our own showNotification() call
  // (in public/firebase-messaging-sw.js) displays anything.
  const res = await fetch(
    `https://fcm.googleapis.com/v1/projects/${PROJECT_ID}/messages:send`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        message: {
          token: fcmToken,
          data: { ...data, title: notification.title, body: notification.body },
          webpush: { headers: { Urgency: 'high' } },
        },
      }),
    },
  )
  if (!res.ok) throw new Error(`FCM send failed ${res.status}: ${await res.text()}`)
  const json = await res.json()
  return (json.name as string) || 'sent'
}

/** Sends to every one of a user's registered device tokens (see
 *  fsListTokens) in parallel — one dead/unregistered token must never
 *  block delivery to the user's other devices. Returns how many actually
 *  sent, for callers that only care whether at least one got through. */
export async function sendFCMToAll(
  tokens: string[],
  notification: { title: string; body: string },
  data: Record<string, string>,
  accessToken: string,
): Promise<number> {
  const results = await Promise.allSettled(tokens.map((t) => sendFCM(t, notification, data, accessToken)))
  return results.filter((r) => r.status === 'fulfilled').length
}
