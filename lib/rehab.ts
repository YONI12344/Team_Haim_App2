/**
 * lib/rehab.ts
 *
 * Injury rehab: cases (coach-written), daily pain check-ins (athlete) and
 * finished rehab sessions (athlete, from Lift Mode's rehab mode). Three
 * top-level collections, each carrying athleteId so the rules can scope
 * reads; queries filter on athleteId only and sort/filter the rest
 * client-side, so no composite indexes are needed.
 */

import {
  addDoc,
  collection,
  doc,
  type FieldValue,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore'
import { addDays, differenceInCalendarDays, format, parseISO } from 'date-fns'
import { db } from '@/lib/firebase'
import type { AssignedWorkout, RehabCase, RehabCheckin, RehabReport, RehabSessionLog, Workout } from '@/lib/types'

/** The rule every rehab exercise is held to: pain never above this. */
export const PAIN_LIMIT = 2

export type PainZone = 'ok' | 'back' | 'stop'

/** 0-2 carry on · 3-4 step back · 5+ stop for today. */
export function painZone(pain: number): PainZone {
  if (pain <= PAIN_LIMIT) return 'ok'
  if (pain <= 4) return 'back'
  return 'stop'
}

/** Tailwind classes per zone, in the poster inks (pine / ochre / rust). */
export const PAIN_ZONE_CLASSES: Record<PainZone, { solid: string; soft: string; text: string }> = {
  ok: { solid: 'bg-pine text-stock border-pine', soft: 'bg-pine/10 border-pine/30', text: 'text-pine' },
  back: { solid: 'bg-ochre text-ink border-ochre', soft: 'bg-ochre/15 border-ochre/40', text: 'text-ochre-deep' },
  stop: { solid: 'bg-rust text-stock border-rust', soft: 'bg-rust/10 border-rust/35', text: 'text-rust' },
}

/**
 * Where it hurts, as tapped on the body map (components/rehab/body-map.tsx,
 * react-muscle-highlighter's front/back models). An area key is
 * `${view}:${slug}`, e.g. 'back:calves'; the side is stored separately.
 */
export type BodyView = 'front' | 'back'

export const BODY_AREAS: { key: string; view: BodyView; slug: string; he: string; en: string }[] = [
  { key: 'back:calves', view: 'back', slug: 'calves', he: 'שוק אחורית (תאומים / סולאוס)', en: 'Calf (gastrocnemius / soleus)' },
  { key: 'back:ankles', view: 'back', slug: 'ankles', he: 'גיד אכילס', en: 'Achilles tendon' },
  { key: 'back:feet', view: 'back', slug: 'feet', he: 'עקב / כף רגל', en: 'Heel / sole' },
  { key: 'front:tibialis', view: 'front', slug: 'tibialis', he: 'שוק קדמית', en: 'Shin' },
  { key: 'front:calves', view: 'front', slug: 'calves', he: 'שוק פנימית', en: 'Inner lower leg' },
  { key: 'front:ankles', view: 'front', slug: 'ankles', he: 'קרסול', en: 'Ankle' },
  { key: 'front:feet', view: 'front', slug: 'feet', he: 'כף רגל', en: 'Foot' },
  { key: 'front:knees', view: 'front', slug: 'knees', he: 'ברך', en: 'Knee' },
  { key: 'front:quadriceps', view: 'front', slug: 'quadriceps', he: 'ירך קדמית', en: 'Quadriceps' },
  { key: 'back:hamstring', view: 'back', slug: 'hamstring', he: 'ירך אחורית', en: 'Hamstring' },
  { key: 'front:adductors', view: 'front', slug: 'adductors', he: 'מפשעה / ירך פנימית', en: 'Groin / inner thigh' },
  { key: 'back:adductors', view: 'back', slug: 'adductors', he: 'ירך פנימית', en: 'Inner thigh' },
  { key: 'back:gluteal', view: 'back', slug: 'gluteal', he: 'ישבן / אגן', en: 'Glutes / hip' },
  { key: 'back:lower-back', view: 'back', slug: 'lower-back', he: 'גב תחתון', en: 'Lower back' },
  { key: 'back:upper-back', view: 'back', slug: 'upper-back', he: 'גב עליון', en: 'Upper back' },
  { key: 'front:abs', view: 'front', slug: 'abs', he: 'בטן', en: 'Abdomen' },
  { key: 'front:obliques', view: 'front', slug: 'obliques', he: 'צד הבטן', en: 'Side of the abdomen' },
  { key: 'front:chest', view: 'front', slug: 'chest', he: 'חזה', en: 'Chest' },
  { key: 'front:deltoids', view: 'front', slug: 'deltoids', he: 'כתף', en: 'Shoulder' },
  { key: 'back:deltoids', view: 'back', slug: 'deltoids', he: 'כתף אחורית', en: 'Back of the shoulder' },
  { key: 'front:trapezius', view: 'front', slug: 'trapezius', he: 'שריר הטרפז', en: 'Trapezius' },
  { key: 'back:trapezius', view: 'back', slug: 'trapezius', he: 'שריר הטרפז', en: 'Trapezius' },
  { key: 'front:neck', view: 'front', slug: 'neck', he: 'צוואר', en: 'Neck' },
  { key: 'back:neck', view: 'back', slug: 'neck', he: 'עורף', en: 'Back of the neck' },
  { key: 'front:head', view: 'front', slug: 'head', he: 'ראש', en: 'Head' },
  { key: 'back:head', view: 'back', slug: 'head', he: 'ראש', en: 'Head' },
  { key: 'front:biceps', view: 'front', slug: 'biceps', he: 'זרוע קדמית', en: 'Biceps' },
  { key: 'back:triceps', view: 'back', slug: 'triceps', he: 'זרוע אחורית', en: 'Triceps' },
  { key: 'front:triceps', view: 'front', slug: 'triceps', he: 'זרוע', en: 'Upper arm' },
  { key: 'front:forearm', view: 'front', slug: 'forearm', he: 'אמה', en: 'Forearm' },
  { key: 'back:forearm', view: 'back', slug: 'forearm', he: 'אמה', en: 'Forearm' },
  { key: 'front:hands', view: 'front', slug: 'hands', he: 'כף יד', en: 'Hand' },
  { key: 'back:hands', view: 'back', slug: 'hands', he: 'כף יד', en: 'Hand' },
]

/** Older cases saved before the body map used plain keys. */
const LEGACY_AREAS: Record<string, { he: string; en: string }> = {
  calf: { he: 'שוק אחורית (תאומים / סולאוס)', en: 'Calf' },
  achilles: { he: 'גיד אכילס', en: 'Achilles tendon' },
  other: { he: 'אחר', en: 'Other' },
}

export function areaLabel(key: string, language: 'he' | 'en'): string {
  const a = BODY_AREAS.find((x) => x.key === key)
  if (a) return a[language]
  return LEGACY_AREAS[key]?.[language] || key
}

export function parseAreaKey(key: string): { view: BodyView; slug: string } | null {
  const [view, slug] = key.split(':')
  if ((view === 'front' || view === 'back') && slug) return { view, slug }
  return null
}

export function sideLabel(side: RehabCase['side'], language: 'he' | 'en'): string | null {
  if (!side) return null
  const he = { left: 'שמאל', right: 'ימין', both: 'שתי הרגליים' }
  const en = { left: 'left', right: 'right', both: 'both sides' }
  return (language === 'he' ? he : en)[side]
}

export const todayStr = () => format(new Date(), 'yyyy-MM-dd')

/** Day 1 is the day of the injury. */
export function rehabDayNumber(c: Pick<RehabCase, 'injuryDate'>, onDate = new Date()): number {
  return differenceInCalendarDays(onDate, parseISO(c.injuryDate)) + 1
}

function toDate(v: unknown): Date {
  const ts = v as { toDate?: () => Date } | undefined
  return ts?.toDate?.() || new Date()
}

// ---------- Cases ----------

export async function listRehabCases(athleteId: string): Promise<RehabCase[]> {
  const snap = await getDocs(query(collection(db, 'rehabCases'), where('athleteId', '==', athleteId)))
  return snap.docs
    .map((d) => {
      const data = d.data()
      return { ...data, id: d.id, createdAt: toDate(data.createdAt), updatedAt: toDate(data.updatedAt) } as RehabCase
    })
    .sort((a, b) => b.injuryDate.localeCompare(a.injuryDate))
}

/** The case new check-ins and sessions belong to: the most recent active one. */
export function currentCase(cases: RehabCase[]): RehabCase | null {
  return cases.find((c) => c.status === 'active') || null
}

export type RehabCaseInput = Pick<RehabCase, 'title' | 'bodyArea' | 'side' | 'injuryDate' | 'goal' | 'coachNotes'> & { reportId?: string | null }

export async function createRehabCase(athleteId: string, input: RehabCaseInput, createdBy: string): Promise<string> {
  const ref = await addDoc(collection(db, 'rehabCases'), {
    athleteId,
    title: input.title.trim(),
    bodyArea: input.bodyArea,
    side: input.side || null,
    injuryDate: input.injuryDate,
    goal: input.goal?.trim() || null,
    coachNotes: input.coachNotes?.trim() || null,
    reportId: input.reportId || null,
    status: 'active',
    resolvedDate: null,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateRehabCase(
  caseId: string,
  patch: Partial<RehabCaseInput & Pick<RehabCase, 'status' | 'resolvedDate'>>,
): Promise<void> {
  const clean: { [key: string]: string | null | FieldValue } = { updatedAt: serverTimestamp() }
  for (const [k, v] of Object.entries(patch)) clean[k] = (v ?? null) as string | null
  await updateDoc(doc(db, 'rehabCases', caseId), clean)
}

// ---------- Pain reports (athlete -> coach) ----------

export const PAIN_TRIGGERS: { key: string; he: string; en: string }[] = [
  { key: 'running', he: 'בריצה', en: 'While running' },
  { key: 'after_running', he: 'אחרי ריצה', en: 'After running' },
  { key: 'walking', he: 'בהליכה', en: 'Walking' },
  { key: 'morning', he: 'בצעדים הראשונים בבוקר', en: 'First steps in the morning' },
  { key: 'stairs', he: 'במדרגות', en: 'On stairs' },
  { key: 'rest', he: 'גם במנוחה', en: 'Even at rest' },
  { key: 'touch', he: 'בלחיצה על המקום', en: 'When pressed' },
]

export function triggerLabel(key: string, language: 'he' | 'en'): string {
  return PAIN_TRIGGERS.find((x) => x.key === key)?.[language] || key
}

export async function listRehabReports(athleteId?: string): Promise<RehabReport[]> {
  const col = collection(db, 'rehabReports')
  const snap = await getDocs(athleteId ? query(col, where('athleteId', '==', athleteId)) : query(col, where('status', '==', 'new')))
  return snap.docs
    .map((d) => {
      const data = d.data()
      return { ...data, id: d.id, createdAt: toDate(data.createdAt), updatedAt: toDate(data.updatedAt) } as RehabReport
    })
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
}

export async function createRehabReport(
  input: Pick<RehabReport, 'athleteId' | 'areaKey' | 'side' | 'pain' | 'since' | 'triggers' | 'notes'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'rehabReports'), {
    athleteId: input.athleteId,
    areaKey: input.areaKey,
    side: input.side || null,
    pain: input.pain,
    since: input.since,
    triggers: input.triggers,
    notes: input.notes?.trim() || null,
    status: 'new',
    caseId: null,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return ref.id
}

export async function updateRehabReport(reportId: string, patch: Pick<RehabReport, 'status'> & { caseId?: string | null }): Promise<void> {
  await updateDoc(doc(db, 'rehabReports', reportId), { ...patch, updatedAt: serverTimestamp() })
}

// ---------- Check-ins ----------

export async function listRehabCheckins(athleteId: string, caseId?: string): Promise<RehabCheckin[]> {
  const snap = await getDocs(query(collection(db, 'rehabCheckins'), where('athleteId', '==', athleteId)))
  return snap.docs
    .map((d) => {
      const data = d.data()
      return { ...data, id: d.id, updatedAt: toDate(data.updatedAt) } as RehabCheckin
    })
    .filter((c) => !caseId || c.caseId === caseId)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export async function saveRehabCheckin(
  input: Pick<RehabCheckin, 'caseId' | 'athleteId' | 'date' | 'morningPain' | 'eveningPain' | 'feeling' | 'notes'>,
): Promise<void> {
  const id = `${input.caseId}_${input.date}`
  await setDoc(
    doc(db, 'rehabCheckins', id),
    {
      caseId: input.caseId,
      athleteId: input.athleteId,
      date: input.date,
      morningPain: input.morningPain ?? null,
      eveningPain: input.eveningPain ?? null,
      feeling: input.feeling ?? null,
      notes: input.notes?.trim() || null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

/** One-tap save from the home screen: writes only the pain value tapped, keeping the rest of that day's check-in. */
export async function saveRehabPain(
  input: Pick<RehabCheckin, 'caseId' | 'athleteId' | 'date'>,
  field: 'morningPain' | 'eveningPain',
  value: number,
): Promise<void> {
  await setDoc(
    doc(db, 'rehabCheckins', `${input.caseId}_${input.date}`),
    { caseId: input.caseId, athleteId: input.athleteId, date: input.date, [field]: value, updatedAt: serverTimestamp() },
    { merge: true },
  )
}

// ---------- Sessions ----------

export async function listRehabSessions(athleteId: string, caseId?: string): Promise<RehabSessionLog[]> {
  const snap = await getDocs(query(collection(db, 'rehabSessions'), where('athleteId', '==', athleteId)))
  return snap.docs
    .map((d) => {
      const data = d.data()
      return { ...data, id: d.id, createdAt: toDate(data.createdAt), updatedAt: toDate(data.updatedAt) } as RehabSessionLog
    })
    // A session logged before any case existed still belongs on the
    // athlete's only/current journey, so caseId-less logs are kept.
    .filter((s) => !caseId || !s.caseId || s.caseId === caseId)
    .sort((a, b) => a.date.localeCompare(b.date))
}

/** The athlete's assigned rehab workouts, oldest first. */
export async function listRehabAssignments(athleteId: string): Promise<AssignedWorkout[]> {
  const snap = await getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId)))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as AssignedWorkout)
    .filter((a) => a.workout?.type === 'rehab')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
}

/** Rehab workout templates in the Workout Library. */
export async function listRehabTemplates(): Promise<Workout[]> {
  const snap = await getDocs(query(collection(db, 'workouts'), where('type', '==', 'rehab')))
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }) as Workout)
    .filter((w) => !w.libraryHidden && !!w.strengthBlocks?.length)
}

/**
 * Put a rehab template on the athlete's calendar: `days` sessions starting
 * at `startDate`, skipping every `restEvery`-th day (6 on, 1 off by
 * default, matching "5-6 times a week"). Same document shape the planner
 * writes, so the session shows up in the athlete's schedule as usual.
 */
export async function assignRehabProgram(opts: {
  athleteId: string
  workout: Workout
  startDate: string
  days: number
  restEvery?: number
  assignedBy: string
}): Promise<number> {
  const restEvery = opts.restEvery ?? 7
  let created = 0
  for (let i = 0; created < opts.days && i < opts.days * 2; i++) {
    if (restEvery > 0 && (i + 1) % restEvery === 0) continue
    const date = format(addDays(parseISO(opts.startDate), i), 'yyyy-MM-dd')
    await addDoc(collection(db, 'assignedWorkouts'), {
      workoutId: opts.workout.id,
      workout: opts.workout,
      athleteId: opts.athleteId,
      assignedBy: opts.assignedBy,
      scheduledDate: date,
      status: 'scheduled',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    created++
  }
  return created
}

// ---------- Journey summary ----------

export interface RehabPoint {
  date: string
  morning: number | null
  evening: number | null
  session: number | null
}

/** One point per day that has any data, for the pain-over-time chart. */
export function buildRehabSeries(checkins: RehabCheckin[], sessions: RehabSessionLog[]): RehabPoint[] {
  const byDate = new Map<string, RehabPoint>()
  const at = (date: string) => {
    let p = byDate.get(date)
    if (!p) { p = { date, morning: null, evening: null, session: null }; byDate.set(date, p) }
    return p
  }
  for (const c of checkins) {
    const p = at(c.date)
    if (typeof c.morningPain === 'number') p.morning = c.morningPain
    if (typeof c.eveningPain === 'number') p.evening = c.eveningPain
  }
  for (const s of sessions) {
    if (typeof s.maxPain !== 'number') continue
    const p = at(s.date)
    p.session = p.session == null ? s.maxPain : Math.max(p.session, s.maxPain)
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date))
}

function avg(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((s, v) => s + v, 0) / values.length) * 10) / 10 : null
}

/** Average of every pain reading (morning + evening) from `fromDaysAgo` up to `toDaysAgo` days ago, inclusive. */
export function averagePain(checkins: RehabCheckin[], fromDaysAgo: number, toDaysAgo: number, today = new Date()): number | null {
  const from = format(addDays(today, -fromDaysAgo), 'yyyy-MM-dd')
  const to = format(addDays(today, -toDaysAgo), 'yyyy-MM-dd')
  const vals: number[] = []
  for (const c of checkins) {
    if (c.date < from || c.date > to) continue
    if (typeof c.morningPain === 'number') vals.push(c.morningPain)
    if (typeof c.eveningPain === 'number') vals.push(c.eveningPain)
  }
  return avg(vals)
}
