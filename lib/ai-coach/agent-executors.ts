'use client'

/**
 * Runs the AI assistant's tool calls (definitions: lib/ai-coach/agent-tools.ts)
 * in the coach's browser, with the coach's own Firestore permissions — the
 * same access the coach's planner already has, nothing more.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore'
import { differenceInCalendarDays, parseISO } from 'date-fns'
import { db } from '@/lib/firebase'
import { getJourney } from '@/lib/journey'
import type { Workout } from '@/lib/types'
import type { BlockWorkoutOut } from '@/lib/ai-coach-brain/backstops'
import { normalizeInvalidTypes } from '@/lib/ai-coach-brain/backstops'
import {
  AI_JOURNEY_ID,
  DAY_ORDER,
  effectiveLabSteps,
  fetchLatestStepTest,
  formatSets,
  runSeasonPipeline,
  targetOverrideFor,
  writeAiWorkout,
  type GenerationTarget,
} from '@/lib/ai-coach/season-pipeline'
import type { AgentToolName } from '@/lib/ai-coach/agent-tools'

export interface AgentToolContext {
  athleteId: string
  coachId: string
  libraryWorkouts: Workout[]
  uiLang: 'en' | 'he'
  /** Long-running tools (season generation) report progress here. */
  onProgress?: (msg: string) => void
}

export interface ToolRunResult {
  content: string
  isError: boolean
}

// Keeps a single tool result from blowing up the conversation (and its
// cost) — roughly 15K tokens.
const MAX_RESULT_CHARS = 60_000

// Profile fields the model has no use for (tokens, media, bookkeeping).
const PROFILE_OMIT = new Set([
  'fcmToken', 'fcmTokens', 'photoURL', 'avatarUrl', 'stravaAccessToken', 'stravaRefreshToken',
  'notificationSettings', 'lastLoginAt', 'role',
])

/** Firestore values → plain JSON (Timestamps become ISO strings). */
function plain(value: any): any {
  if (value == null) return value
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (Array.isArray(value)) return value.map(plain)
  if (typeof value === 'object') {
    const out: Record<string, any> = {}
    for (const [k, v] of Object.entries(value)) out[k] = plain(v)
    return out
  }
  return value
}

function ok(data: unknown): ToolRunResult {
  let text = JSON.stringify(data)
  if (text.length > MAX_RESULT_CHARS) {
    text = text.slice(0, MAX_RESULT_CHARS) + '… [truncated — ask for a narrower date range]'
  }
  return { content: text, isError: false }
}
const fail = (msg: string): ToolRunResult => ({ content: msg, isError: true })

async function getProfile(athleteId: string) {
  const snap = await getDoc(doc(db, 'users', athleteId))
  if (!snap.exists()) return null
  return snap.data() as any
}

const summarizeWorkout = (w: any) =>
  w && {
    type: w.type,
    title: w.title,
    description: w.description || undefined,
    distanceKm: w.distance ?? undefined,
    durationMin: w.duration ?? undefined,
    warmup: w.warmup || undefined,
    cooldown: w.cooldown || undefined,
    notes: w.notes || undefined,
    sets: Array.isArray(w.sets) && w.sets.length
      ? w.sets.map((s: any) => ({
          reps: s.reps, distanceMeters: s.distanceMeters ?? undefined, durationSec: s.durationSec ?? undefined,
          restBetweenReps: s.restBetweenReps ?? undefined, restAfterSet: s.restAfterSet ?? undefined, notes: s.notes ?? undefined,
          intervals: Array.isArray(s.intervals) && s.intervals.length
            ? s.intervals.map((iv: any) => ({ distanceMeters: iv.distanceMeters ?? undefined, durationSec: iv.durationSec ?? undefined, effort: iv.pace ?? undefined }))
            : undefined,
        }))
      : undefined,
    targetThresholdLevel: w.targetThresholdLevel ?? undefined,
    lactateTarget: w.bakkenLactateMin != null ? [w.bakkenLactateMin, w.bakkenLactateMax] : undefined,
    comparisonGroup: w.comparisonGroup ?? undefined,
    strengthBlocks: w.strengthBlocks ? plain(w.strengthBlocks) : undefined,
  }

const summarizeLog = (l: any) =>
  l && {
    date: l.date,
    actualDistanceKm: l.actualDistance ?? undefined,
    actualPace: l.actualPace ?? undefined,
    durationMin: l.durationMin ?? undefined,
    effort: l.effort ?? undefined,
    comment: l.comment || undefined,
    avgHr: l.averageHeartRate ?? undefined,
    elevationGain: l.elevationGain ?? undefined,
    activityType: l.activityType ?? undefined,
    source: l.source ?? undefined,
    splits: Array.isArray(l.splitLogs) && l.splitLogs.length
      ? l.splitLogs.map((s: any) => ({
          set: s.setIndex, rep: s.repIndex, distance: s.distance, time: s.time, pace: s.pace,
          hr: s.avgHr ?? undefined, lactate: s.lactate ?? undefined, rest: s.rest, notes: s.notes,
        }))
      : undefined,
  }

async function getWorkouts(athleteId: string, from: string, to: string): Promise<ToolRunResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return fail('from/to must be yyyy-MM-dd')
  if (from > to) return fail('from must be on or before to')
  if (differenceInCalendarDays(parseISO(to), parseISO(from)) > 180) return fail('Range too long — max 180 days per call.')

  const [assignedSnap, logsSnap] = await Promise.all([
    getDocs(query(
      collection(db, 'assignedWorkouts'),
      where('athleteId', '==', athleteId),
      where('scheduledDate', '>=', from),
      where('scheduledDate', '<=', to),
    )),
    getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId))),
  ])
  const logs = logsSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .filter((l) => l.date >= from && l.date <= to)
  const usedLogIds = new Set<string>()

  const workouts = assignedSnap.docs
    .map((d) => ({ id: d.id, ...(d.data() as any) }))
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
    .map((a) => {
      const log = logs.find((l) => l.assignedWorkoutId === a.id)
        ?? logs.find((l) => !l.assignedWorkoutId && l.workoutId === a.workoutId && l.date === a.scheduledDate)
      if (log) usedLogIds.add(log.id)
      return {
        assignedWorkoutId: a.id,
        date: a.scheduledDate,
        session: a.session || undefined,
        status: a.status,
        aiGenerated: a.source === 'bakken' || undefined,
        movedByAthlete: a.movedByAthlete ? { from: a.movedFromDate } : undefined,
        athleteNotes: a.athleteNotes || undefined,
        plan: summarizeWorkout(a.workout),
        log: summarizeLog(log),
      }
    })

  const unplannedActivities = logs
    .filter((l) => !usedLogIds.has(l.id))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => ({ title: l.workoutTitle || l.stravaName || undefined, ...summarizeLog(l) }))

  return ok({ from, to, workouts, unplannedActivities })
}

async function getLabTests(athleteId: string): Promise<ToolRunResult> {
  const snap = await getDocs(query(collection(db, 'lactateTests'), where('athleteId', '==', athleteId)))
  const tests = snap.docs
    .map((d) => plain(d.data()))
    .sort((a: any, b: any) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, 12)
  return ok({ tests })
}

async function createWorkouts(ctx: AgentToolContext, workouts: BlockWorkoutOut[]): Promise<ToolRunResult> {
  if (!Array.isArray(workouts) || workouts.length === 0) return fail('workouts[] is empty')
  const profile = await getProfile(ctx.athleteId)
  if (!profile) return fail('Athlete profile not found')
  const lang: 'en' | 'he' = profile.preferredLanguage === 'en' ? 'en' : 'he'
  for (const w of workouts) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w?.date || '')) return fail(`Invalid date on "${w?.title}": use yyyy-MM-dd`)
  }
  normalizeInvalidTypes(workouts, lang)
  const labSteps = effectiveLabSteps(await fetchLatestStepTest(ctx.athleteId), profile.physiology)

  const created: Array<{ assignedWorkoutId: string; date: string; title: string }> = []
  for (const w of workouts) {
    if (w.type === 'rest') continue
    const { assignedWorkoutId } = await writeAiWorkout({ athleteId: ctx.athleteId, coachId: ctx.coachId, workout: w, lang, labSteps })
    created.push({ assignedWorkoutId, date: w.date, title: w.title })
  }
  return ok({ created })
}

const UPDATABLE_FIELDS = [
  'type', 'title', 'description', 'distance', 'duration', 'warmup', 'cooldown', 'notes',
  'targetThresholdLevel', 'comparisonGroup', 'thresholdDistance', 'bakkenLactateMin', 'bakkenLactateMax',
] as const

async function updateWorkout(
  ctx: AgentToolContext,
  input: { assignedWorkoutId: string; date?: string; changes?: Partial<BlockWorkoutOut> },
): Promise<ToolRunResult> {
  const ref = doc(db, 'assignedWorkouts', input.assignedWorkoutId)
  const snap = await getDoc(ref)
  if (!snap.exists()) return fail('No workout with that assignedWorkoutId')
  const a = snap.data() as any
  if (a.athleteId !== ctx.athleteId) return fail("That workout belongs to a different athlete")
  if (a.status === 'completed') return fail('That workout is already completed — it cannot be changed.')
  if (input.date && !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return fail('date must be yyyy-MM-dd')

  const changes = input.changes || {}
  const profile = await getProfile(ctx.athleteId)
  const lang: 'en' | 'he' = profile?.preferredLanguage === 'en' ? 'en' : 'he'
  const nextWorkout: Record<string, any> = { ...(a.workout || {}) }
  for (const key of UPDATABLE_FIELDS) {
    if (key in changes) nextWorkout[key] = (changes as any)[key] ?? null
  }
  if ('sets' in changes) nextWorkout.sets = formatSets(changes.sets, lang)
  if ('type' in changes) {
    const probe = [{ ...changes, date: a.scheduledDate } as BlockWorkoutOut]
    normalizeInvalidTypes(probe, lang)
    nextWorkout.type = probe[0].type
  }
  nextWorkout.updatedAt = new Date()

  const update: Record<string, any> = { workout: nextWorkout, updatedAt: serverTimestamp() }
  if (input.date) update.scheduledDate = input.date
  if (changes.session) update.session = changes.session
  if ('bakkenLactateMin' in changes || 'bakkenLactateMax' in changes) {
    const labSteps = effectiveLabSteps(await fetchLatestStepTest(ctx.athleteId), profile?.physiology)
    update.targetOverride = targetOverrideFor(labSteps, nextWorkout.bakkenLactateMin, nextWorkout.bakkenLactateMax) ?? null
  }
  await updateDoc(ref, update)
  return ok({ updated: input.assignedWorkoutId, date: update.scheduledDate ?? a.scheduledDate, title: nextWorkout.title })
}

async function deleteWorkouts(ctx: AgentToolContext, ids: string[]): Promise<ToolRunResult> {
  const deleted: string[] = []
  const skipped: Array<{ id: string; reason: string }> = []
  for (const id of ids) {
    const ref = doc(db, 'assignedWorkouts', id)
    const snap = await getDoc(ref)
    if (!snap.exists()) { skipped.push({ id, reason: 'not found' }); continue }
    const a = snap.data() as any
    if (a.athleteId !== ctx.athleteId) { skipped.push({ id, reason: 'different athlete' }); continue }
    if (a.status === 'completed') { skipped.push({ id, reason: 'completed' }); continue }
    await deleteDoc(ref)
    deleted.push(`${a.scheduledDate} ${a.workout?.title || ''}`.trim())
  }
  return ok({ deleted, skipped })
}

async function updatePlanSettings(ctx: AgentToolContext, input: Record<string, any>): Promise<ToolRunResult> {
  const profile = await getProfile(ctx.athleteId)
  if (!profile) return fail('Athlete profile not found')
  const update: Record<string, any> = {}
  if (input.weekSchedule && typeof input.weekSchedule === 'object') {
    const merged = { ...(profile.weekSchedule || {}), ...input.weekSchedule }
    const full = Object.fromEntries(DAY_ORDER.map((d) => [d, merged[d] === 'off' || merged[d] === 'rest' ? merged[d] : 'workout']))
    update.weekSchedule = full
    update.daysPerWeek = DAY_ORDER.filter((d) => full[d] === 'workout').length
  }
  for (const key of ['longRunDay', 'weeklyMileage', 'goalRaceEvent', 'goalRaceDistance', 'goalRaceDate', 'goalRaceTarget'] as const) {
    if (key in input) update[key] = input[key]
  }
  if ('coachNotes' in input) update.coachPrivateNotes = input.coachNotes
  if (Object.keys(update).length === 0) return fail('Nothing to update')
  await updateDoc(doc(db, 'users', ctx.athleteId), update)
  return ok({ updated: Object.keys(update) })
}

export async function runAgentTool(name: string, input: any, ctx: AgentToolContext): Promise<ToolRunResult> {
  try {
    switch (name as AgentToolName) {
      case 'get_athlete_profile': {
        const profile = await getProfile(ctx.athleteId)
        if (!profile) return fail('Athlete profile not found')
        const clean = Object.fromEntries(Object.entries(plain(profile)).filter(([k]) => !PROFILE_OMIT.has(k)))
        return ok({ athleteId: ctx.athleteId, ...clean })
      }
      case 'get_workouts':
        return await getWorkouts(ctx.athleteId, input?.from, input?.to)
      case 'get_lab_tests':
        return await getLabTests(ctx.athleteId)
      case 'get_season_plan': {
        const journey = await getJourney(ctx.athleteId, AI_JOURNEY_ID)
        return ok(journey ? plain(journey) : { journey: null, note: 'No AI season exists for this athlete yet.' })
      }
      case 'generate_season_plan': {
        const result = await runSeasonPipeline({
          athleteId: ctx.athleteId,
          coachId: ctx.coachId,
          target: (input?.target || 'current_stage') as GenerationTarget,
          forceRestart: !!input?.restart,
          libraryWorkouts: ctx.libraryWorkouts,
          uiLang: ctx.uiLang,
          onProgress: ctx.onProgress,
        })
        if (!result.ok) return fail(result.error)
        return ok({
          written: result.written,
          summary: result.summary,
          firstBlockSummary: result.firstBlockSummary,
          warning: result.warning,
          phases: result.journey.stages.map((s) => ({ name: s.name, type: s.type, from: s.startDate, to: s.endDate, weeklyKm: s.weeklyVolumeKm })),
        })
      }
      case 'create_workouts':
        return await createWorkouts(ctx, input?.workouts)
      case 'update_workout':
        return await updateWorkout(ctx, input)
      case 'delete_workouts':
        return await deleteWorkouts(ctx, Array.isArray(input?.assignedWorkoutIds) ? input.assignedWorkoutIds : [])
      case 'update_plan_settings':
        return await updatePlanSettings(ctx, input || {})
      default:
        return fail(`Unknown tool: ${name}`)
    }
  } catch (err) {
    console.error(`AI coach tool ${name} failed:`, err)
    return fail(`Tool failed: ${String(err)}`)
  }
}
