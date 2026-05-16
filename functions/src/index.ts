/**
 * Cloud Functions for Team Haim - Google Sheets auto sync.
 *
 * Triggers:
 *   - logs/{logId}        (athlete saves/edits a workout log)
 *   - workouts/{workoutId} (coach assigns/edits a workout)
 *   - users/{userId}      (athlete profile updated)
 *   - goals/{goalId}      (goals updated)
 *
 * All triggers funnel into `syncAthleteToSheet(athleteId)` which:
 *   1. Reads athlete profile / workouts / logs / goals from Firestore.
 *   2. Reads the master Google Sheet ID from `settings/googleSheets`.
 *   3. Ensures a tab exists for the athlete (named after their name).
 *   4. Writes a header row + one row per day with workout & log data.
 *   5. Color-codes rows by workout type.
 *   6. Updates `settings/googleSheets.lastSyncAt`.
 *
 * Service Account credentials come from environment variables:
 *   - GOOGLE_SERVICE_ACCOUNT_EMAIL
 *   - GOOGLE_PRIVATE_KEY  (with literal "\n" sequences for newlines)
 */

import * as functions from 'firebase-functions/v1'
import * as admin from 'firebase-admin'
import {google, sheets_v4} from 'googleapis'

admin.initializeApp()

const db = admin.firestore()

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
})

const sheetsApi = google.sheets({version: 'v4', auth})

const SETTINGS_DOC = 'settings/googleSheets'

// ---------------------------------------------------------------------------
// Triggers
// ---------------------------------------------------------------------------

// Trigger 1: When athlete saves or edits workout log
export const syncLogToSheets = functions.region('europe-west1').firestore
  .document('logs/{logId}')
  .onWrite(async (change) => {
    const log = change.after.exists ? change.after.data() : null
    const athleteId = log?.athleteId ||
      (change.before.exists ? change.before.data()?.athleteId : undefined)
    if (!athleteId) return
    await safeSync(athleteId, 'log')
  })

// Trigger 2: When coach assigns or edits workout
export const syncWorkoutToSheets = functions.region('europe-west1').firestore
  .document('workouts/{workoutId}')
  .onWrite(async (change) => {
    const workout = change.after.exists ? change.after.data() : null
    const athleteId = workout?.assignedTo ||
      (change.before.exists ? change.before.data()?.assignedTo : undefined)
    if (!athleteId) return
    await safeSync(athleteId, 'workout')
  })

// Trigger 3: When athlete profile is updated
export const syncProfileToSheets = functions.region('europe-west1').firestore
  .document('users/{userId}')
  .onWrite(async (change, context) => {
    if (!change.after.exists) return
    await safeSync(context.params.userId as string, 'profile')
  })

// Trigger 4: When goals are updated
export const syncGoalsToSheets = functions.region('europe-west1').firestore
  .document('goals/{goalId}')
  .onWrite(async (change) => {
    const goal = change.after.exists ? change.after.data() : null
    const athleteId = goal?.athleteId ||
      (change.before.exists ? change.before.data()?.athleteId : undefined)
    if (!athleteId) return
    await safeSync(athleteId, 'goal')
  })

// Manual / "Sync All Now" callable used by the coach settings page.
export const syncAllAthletesNow = functions.region('europe-west1').https.onCall(async (_data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be signed in to trigger a sync.'
    )
  }

  const usersSnap = await db.collection('users').get()
  const athleteIds = usersSnap.docs
    .filter((d) => {
      const role = d.data().role
      return !role || role === 'athlete'
    })
    .map((d) => d.id)

  let succeeded = 0
  const errors: Array<{athleteId: string; message: string}> = []
  for (const id of athleteIds) {
    try {
      await syncAthleteToSheet(id)
      succeeded++
    } catch (err) {
      errors.push({athleteId: id, message: (err as Error).message})
    }
  }

  return {total: athleteIds.length, succeeded, errors}
})

/**
 * Manual test trigger for the Google Sheets sync.
 *
 * Callable from the client (or `firebase functions:shell`) with:
 *   - `{ athleteId: "<id>" }` to sync a single athlete, or
 *   - `{}` to sync every athlete.
 *
 * Emits clearly-tagged INFO / ERROR logs at every step so you can confirm in
 * the Firebase console (Functions > Logs) whether the sync succeeded or
 * failed, and how long it took.
 */
export const testSheetsSync = functions.region('europe-west1').https.onCall(async (data, context) => {
  const startedAt = Date.now()
  const callerUid = context.auth?.uid ?? 'anonymous'
  const requestedAthleteId =
    typeof data?.athleteId === 'string' && data.athleteId.trim() ?
      data.athleteId.trim() :
      null

  functions.logger.info(
    '[testSheetsSync] START',
    {caller: callerUid, athleteId: requestedAthleteId ?? 'ALL'}
  )

  if (!context.auth) {
    functions.logger.error(
      '[testSheetsSync] FAILED - unauthenticated caller'
    )
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be signed in to trigger a test sync.'
    )
  }

  // Verify the master sheet is configured up-front so we can log it clearly.
  const settingsSnap = await db.doc(SETTINGS_DOC).get()
  const spreadsheetId = settingsSnap.exists ?
    (settingsSnap.data()?.sheetId as string | undefined) :
    undefined
  if (!spreadsheetId) {
    functions.logger.error(
      '[testSheetsSync] FAILED - no master sheet ID configured in settings/googleSheets'
    )
    throw new functions.https.HttpsError(
      'failed-precondition',
      'No master Google Sheet ID is configured. Save one in coach settings first.'
    )
  }
  functions.logger.info('[testSheetsSync] using spreadsheet', {spreadsheetId})

  // Build the list of athletes to sync.
  let athleteIds: string[]
  if (requestedAthleteId) {
    athleteIds = [requestedAthleteId]
  } else {
    const usersSnap = await db.collection('users').get()
    athleteIds = usersSnap.docs
      .filter((d) => {
        const role = d.data().role
        return !role || role === 'athlete'
      })
      .map((d) => d.id)
  }

  let succeeded = 0
  const errors: Array<{athleteId: string; message: string}> = []
  for (const id of athleteIds) {
    try {
      await syncAthleteToSheet(id)
      succeeded++
      functions.logger.info('[testSheetsSync] athlete OK', {athleteId: id})
    } catch (err) {
      const message = (err as Error)?.message ?? String(err)
      errors.push({athleteId: id, message})
      functions.logger.error(
        '[testSheetsSync] athlete FAILED',
        {athleteId: id, message, err}
      )
    }
  }

  const durationMs = Date.now() - startedAt
  const ok = errors.length === 0
  const result = {
    ok,
    total: athleteIds.length,
    succeeded,
    failed: errors.length,
    errors,
    durationMs,
    spreadsheetId,
  }

  if (ok) {
    functions.logger.info('[testSheetsSync] SUCCESS', result)
  } else {
    functions.logger.error('[testSheetsSync] COMPLETED WITH ERRORS', result)
  }

  return result
})

// ---------------------------------------------------------------------------
// Sync implementation
// ---------------------------------------------------------------------------

/** Wrap syncAthleteToSheet with logging so trigger errors don't crash. */
async function safeSync(athleteId: string, source: string): Promise<void> {
  try {
    await syncAthleteToSheet(athleteId)
    functions.logger.info(
      `Google Sheets sync OK (source=${source}, athlete=${athleteId})`
    )
  } catch (err) {
    functions.logger.error(
      `Google Sheets sync failed (source=${source}, athlete=${athleteId})`,
      err
    )
  }
}

interface RowData {
  date: string
  day: string
  workoutType: string
  plannedKm: string
  plannedPace: string
  actualKm: string
  actualPace: string
  effort: string
  comment: string
  coachNotes: string
}

const HEADERS = [
  'תאריך / Date',
  'יום / Day',
  'סוג אימון / Workout Type',
  'ק"מ מתוכנן / Planned KM',
  'קצב מתוכנן / Planned Pace',
  'ק"מ בפועל / Actual KM',
  'קצב בפועל / Actual Pace',
  'מאמץ / Effort',
  'הערה / Comment',
  'הערות מאמן / Coach Notes',
]

// Pastel-ish colors per workout type for row formatting.
const WORKOUT_COLORS: Record<string, {red: number; green: number; blue: number}> = {
  easy: {red: 0.85, green: 0.95, blue: 0.85},
  long_run: {red: 0.80, green: 0.90, blue: 1.00},
  tempo: {red: 1.00, green: 0.90, blue: 0.75},
  intervals: {red: 1.00, green: 0.85, blue: 0.85},
  hill_repeats: {red: 0.95, green: 0.80, blue: 0.85},
  fartlek: {red: 0.95, green: 0.90, blue: 0.70},
  recovery: {red: 0.90, green: 1.00, blue: 0.95},
  strength: {red: 0.85, green: 0.85, blue: 0.95},
  cross_training: {red: 0.92, green: 0.92, blue: 0.92},
  rest: {red: 0.97, green: 0.97, blue: 0.97},
  race: {red: 1.00, green: 0.80, blue: 0.50},
  time_trial: {red: 1.00, green: 0.92, blue: 0.60},
}

export async function syncAthleteToSheet(athleteId: string): Promise<void> {
  if (!athleteId) return

  const startedAt = Date.now()
  functions.logger.info(`[syncAthleteToSheet] start athlete=${athleteId}`)

  const settingsSnap = await db.doc(SETTINGS_DOC).get()
  const spreadsheetId = settingsSnap.exists ?
    (settingsSnap.data()?.sheetId as string | undefined) :
    undefined

  if (!spreadsheetId) {
    functions.logger.info(
      'Skipping sync - no master sheet ID configured in settings/googleSheets.'
    )
    return
  }

  const userSnap = await db.doc(`users/${athleteId}`).get()
  if (!userSnap.exists) {
    functions.logger.warn(`No user document for athleteId=${athleteId}`)
    return
  }
  const user = userSnap.data() as Record<string, unknown>
  const athleteName =
    (user.name as string) ||
    (user.displayName as string) ||
    (user.email as string) ||
    athleteId

  // Workouts: support either top-level `assignedTo == athleteId` or
  // `athleteId == athleteId` so this works with the existing data model
  // (Workout / AssignedWorkout in lib/types.ts).
  const [workoutsAssigned, workoutsLegacy, logsSnap] = await Promise.all([
    db.collection('workouts').where('assignedTo', '==', athleteId).get()
      .catch(() => null),
    db.collection('workouts').where('athleteId', '==', athleteId).get()
      .catch(() => null),
    db.collection('logs').where('athleteId', '==', athleteId).get()
      .catch(() => null),
  ])

  const workoutDocs = [
    ...(workoutsAssigned?.docs ?? []),
    ...(workoutsLegacy?.docs ?? []),
  ]
  const logDocs = logsSnap?.docs ?? []

  // Index logs by ISO date (YYYY-MM-DD) for quick lookup.
  const logsByDate = new Map<string, FirebaseFirestore.DocumentData>()
  for (const d of logDocs) {
    const data = d.data()
    const dateKey = normalizeDate(data.date || data.scheduledDate)
    if (dateKey) logsByDate.set(dateKey, data)
  }

  // Build one row per workout (sorted by date), pulling matching log if any.
  const rows: RowData[] = []
  const seenDates = new Set<string>()
  for (const d of workoutDocs) {
    const w = d.data()
    const dateKey = normalizeDate(w.scheduledDate || w.date)
    if (!dateKey || seenDates.has(dateKey)) continue
    seenDates.add(dateKey)
    const log = logsByDate.get(dateKey)
    rows.push(buildRow(dateKey, w, log))
  }

  // Include logs that have no matching workout (free-form logs).
  for (const [dateKey, log] of logsByDate) {
    if (seenDates.has(dateKey)) continue
    seenDates.add(dateKey)
    rows.push(buildRow(dateKey, undefined, log))
  }

  rows.sort((a, b) => a.date.localeCompare(b.date))

  // Make sure athlete tab exists, then overwrite its contents.
  const sheetTitle = sanitizeSheetTitle(athleteName)
  const sheetId = await ensureSheetTab(spreadsheetId, sheetTitle)

  const values: string[][] = [HEADERS, ...rows.map(rowToValues)]

  await sheetsApi.spreadsheets.values.clear({
    spreadsheetId,
    range: `'${sheetTitle}'`,
  })

  await sheetsApi.spreadsheets.values.update({
    spreadsheetId,
    range: `'${sheetTitle}'!A1`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {values},
  })

  // Format header row + color code rows by workout type.
  const formatRequests: sheets_v4.Schema$Request[] = [
    {
      repeatCell: {
        range: {sheetId, startRowIndex: 0, endRowIndex: 1},
        cell: {
          userEnteredFormat: {
            backgroundColor: {red: 0.10, green: 0.15, blue: 0.30},
            textFormat: {
              foregroundColor: {red: 1, green: 0.84, blue: 0.40},
              bold: true,
            },
            horizontalAlignment: 'CENTER',
          },
        },
        fields:
          'userEnteredFormat(backgroundColor,textFormat,horizontalAlignment)',
      },
    },
    {
      updateSheetProperties: {
        properties: {
          sheetId,
          gridProperties: {frozenRowCount: 1},
        },
        fields: 'gridProperties.frozenRowCount',
      },
    },
  ]

  rows.forEach((r, idx) => {
    const color = WORKOUT_COLORS[r.workoutType]
    if (!color) return
    formatRequests.push({
      repeatCell: {
        range: {
          sheetId,
          startRowIndex: idx + 1,
          endRowIndex: idx + 2,
          startColumnIndex: 0,
          endColumnIndex: HEADERS.length,
        },
        cell: {userEnteredFormat: {backgroundColor: color}},
        fields: 'userEnteredFormat.backgroundColor',
      },
    })
  })

  if (formatRequests.length > 0) {
    await sheetsApi.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {requests: formatRequests},
    })
  }

  await db.doc(SETTINGS_DOC).set(
    {
      lastSyncAt: admin.firestore.FieldValue.serverTimestamp(),
      lastSyncAthleteId: athleteId,
    },
    {merge: true}
  )

  functions.logger.info(
    `[syncAthleteToSheet] done athlete=${athleteId} rows=${rows.length} ` +
    `durationMs=${Date.now() - startedAt}`
  )
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRow(
  dateKey: string,
  workout?: FirebaseFirestore.DocumentData,
  log?: FirebaseFirestore.DocumentData
): RowData {
  const day = new Date(dateKey + 'T00:00:00Z').toLocaleDateString('en-US', {
    weekday: 'long',
    timeZone: 'UTC',
  })
  const workoutType = (workout?.type as string) || (log?.type as string) || ''
  return {
    date: dateKey,
    day,
    workoutType,
    plannedKm: stringify(workout?.distance ?? workout?.plannedKm),
    plannedPace: stringify(workout?.pace ?? workout?.plannedPace),
    actualKm: stringify(log?.actualDistance ?? log?.actualKm),
    actualPace: stringify(log?.actualPace),
    effort: stringify(log?.effort ?? log?.perceivedEffort),
    comment: stringify(log?.comment ?? log?.athleteNotes),
    coachNotes: stringify(workout?.coachNotes ?? workout?.notes ?? workout?.coachFeedback),
  }
}

function rowToValues(r: RowData): string[] {
  return [
    r.date,
    r.day,
    r.workoutType,
    r.plannedKm,
    r.plannedPace,
    r.actualKm,
    r.actualPace,
    r.effort,
    r.comment,
    r.coachNotes,
  ]
}

function stringify(value: unknown): string {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (value instanceof Date) return value.toISOString()
  // Firestore Timestamp duck-typing.
  if (typeof (value as {toDate?: () => Date}).toDate === 'function') {
    return (value as {toDate: () => Date}).toDate().toISOString()
  }
  try {
    return JSON.stringify(value)
  } catch {
    return ''
  }
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null
  if (typeof value === 'string') {
    // Already YYYY-MM-DD?
    const match = value.match(/^(\d{4}-\d{2}-\d{2})/)
    if (match) return match[1]
    const d = new Date(value)
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10)
    return null
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10)
  if (typeof (value as {toDate?: () => Date}).toDate === 'function') {
    return (value as {toDate: () => Date}).toDate().toISOString().slice(0, 10)
  }
  return null
}

function sanitizeSheetTitle(name: string): string {
  // Google Sheets tab name limits: max 100 chars, cannot contain : \ / ? * [ ]
  const cleaned = name.replace(/[:\\/?*\[\]]/g, ' ').trim()
  return (cleaned || 'Athlete').slice(0, 100)
}

async function ensureSheetTab(
  spreadsheetId: string,
  title: string
): Promise<number> {
  const meta = await sheetsApi.spreadsheets.get({spreadsheetId})
  const existing = meta.data.sheets?.find(
    (s) => s.properties?.title === title
  )
  if (existing?.properties?.sheetId !== undefined &&
      existing.properties.sheetId !== null) {
    return existing.properties.sheetId
  }

  const addResp = await sheetsApi.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{addSheet: {properties: {title}}}],
    },
  })
  const newSheet = addResp.data.replies?.[0]?.addSheet?.properties
  if (newSheet?.sheetId === undefined || newSheet.sheetId === null) {
    throw new Error(`Failed to create sheet tab "${title}"`)
  }
  return newSheet.sheetId
}
