'use client'

/**
 * The full-season generation pipeline, shared by the plan-settings panel
 * (components/coach/ai-plan-settings.tsx) and the coach's chat agent
 * (components/coach/ai-coach-agent.tsx, via its generate_season_plan tool),
 * so both run the exact same code path:
 *
 *   1. one skeleton call (/api/ai-coach/generate-skeleton) decides phase
 *      lengths / volume ramp — only the date arithmetic is code;
 *   2. the season is split into ~14-day Sunday-aligned blocks, each filled by
 *      /api/ai-coach/generate-plan;
 *   3. every block passes through the deterministic backstops
 *      (lib/ai-coach-brain/backstops.ts) before anything is written;
 *   4. workouts are written to the normal workouts/assignedWorkouts
 *      collections (source:'bakken'), so the coach edits them like any other
 *      workout and the athlete sees them through the usual 2-week window.
 *
 * Runs in the coach's browser with the coach's own Firestore permissions.
 * Everything it reads (week schedule, cutback settings, recurring
 * activities...) comes from the athlete's profile, so callers must persist
 * any settings they want applied before calling it.
 */

import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { format, addDays, parseISO } from 'date-fns'
import { db } from '@/lib/firebase'
import { saveJourney, getJourney } from '@/lib/journey'
import { interpolateAtLactate, stepsFromPhysiologySummary, type LactateStep } from '@/lib/physiology'
import type { WorkoutType, JourneyDoc, JourneyStage, Workout } from '@/lib/types'
import type { PlanAthleteContext, BlockStageInfo, SkeletonRequest, SkeletonOut } from '@/lib/ai-coach-brain/plan-schema'
import type { BlockWorkoutOut, DayKey, RecurringActivityInput } from '@/lib/ai-coach-brain/backstops'
import {
  normalizeInvalidTypes,
  enforceWeekSchedule,
  enforceAmPmOrder,
  enforceSameDaySessionTags,
  enforceRecurringActivities,
  enforceSpecialEvents,
  enforceDayTypeTemplate,
  enforceNoBackToBackBigDays,
  enforceLongRunDay,
  normalizeWeeklyVolume,
  applyCutbackWeekAdjustments,
} from '@/lib/ai-coach-brain/backstops'
import { aiCoachFetch } from '@/lib/ai-coach/client'
import { logAiUsage } from '@/lib/ai-coach/usage-log'

export const AI_SOURCE = 'bakken' as const
export const AI_JOURNEY_ID = 'bakken_season'

const BLOCK_DAYS = 14
const MAX_BLOCKS = 10 // safety cap: 20 weeks of upfront generation per run

export type StageTargetType = 'base' | 'build' | 'peak' | 'taper' | 'race_week'
export type GenerationTarget = 'current_stage' | 'whole_season' | StageTargetType
export const GENERATION_TARGET_STAGES: StageTargetType[] = ['base', 'build', 'peak', 'taper', 'race_week']

type DayType = 'workout' | 'rest' | 'off'
export const DAY_ORDER: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

interface BlockPlanOut {
  blockSummary: string
  workouts: BlockWorkoutOut[]
}

interface WeekAgg {
  totalPlanned: number
  totalActual: number
  completed: number
  skipped: number
  avgEffort: number | null
}

const STRINGS = {
  en: {
    profileNotFound: 'Athlete profile not found',
    clearingPrevious: 'Clearing the previous AI-generated season...',
    continuingSeason: (from: string) => `Continuing the existing season from ${from}...`,
    seasonAlreadyComplete: 'This season is already fully generated through the goal race — nothing left to add.',
    setGoalRaceFirst: 'This athlete has no goal race date yet. Set one (profile → Goal Race Date) before generating a season.',
    designingSkeleton: 'Designing the season skeleton...',
    skeletonFailed: (err: string) => `Skeleton generation failed: ${err}. Try again.`,
    blockFailed: (n: number, err: string, written: number) => `Block ${n} failed: ${err}. ${written} workouts from earlier blocks are already saved.`,
    generatingBlock: (from: string, to: string, i: number, total: number) => `Generating ${from} → ${to} (block ${i}/${total})...`,
    stageAlreadyPassed: 'That stage is already fully in the past — pick a later stage or the whole season.',
    summary: (stages: number, race: string, blocks: number, written: number) =>
      `${stages} phases through ${race}, ${blocks} blocks, ${written} workouts written. The athlete sees the first 2 weeks; the rest reveals automatically each Saturday.`,
  },
  he: {
    profileNotFound: 'פרופיל הספורטאי לא נמצא',
    clearingPrevious: 'מנקה את העונה הקודמת שנוצרה ב-AI...',
    continuingSeason: (from: string) => `ממשיך את העונה הקיימת מ-${from}...`,
    seasonAlreadyComplete: 'העונה הזו כבר נוצרה במלואה עד מירוץ היעד — אין מה להוסיף.',
    setGoalRaceFirst: 'לספורטאי אין עדיין תאריך מירוץ יעד. קבע/י אותו (פרופיל ← תאריך מירוץ יעד) לפני יצירת עונה.',
    designingSkeleton: 'מתכנן שלד עונה...',
    skeletonFailed: (err: string) => `יצירת השלד נכשלה: ${err}. נסה/י שוב.`,
    blockFailed: (n: number, err: string, written: number) => `בלוק ${n} נכשל: ${err}. ${written} אימונים מבלוקים קודמים כבר נשמרו.`,
    generatingBlock: (from: string, to: string, i: number, total: number) => `יוצר ${from} → ${to} (בלוק ${i}/${total})...`,
    stageAlreadyPassed: 'השלב הזה כבר עבר לגמרי — בחר/י שלב מאוחר יותר או את כל העונה.',
    summary: (stages: number, race: string, blocks: number, written: number) =>
      `${stages} שלבים עד ${race}, ${blocks} בלוקים, ${written} אימונים נכתבו. הספורטאי רואה את השבועיים הראשונים; השאר נחשף אוטומטית כל שבת.`,
  },
} as const

// The athlete's view reads the LEGACY STRING fields on sets/intervals
// (set.distance, set.duration, iv.distance...) to render "5× 1000m" lines —
// formatted here (not by the model) so unit words are always in the
// athlete's language.
const formatMetersStr = (m: number, lang: 'en' | 'he') => (lang === 'he' ? `${m} מ׳` : `${m}m`)
const formatSecondsStr = (sec: number, lang: 'en' | 'he') => {
  if (sec >= 60 && sec % 60 === 0) {
    const min = sec / 60
    return lang === 'he' ? `${min} דק׳` : `${min} min`
  }
  return lang === 'he' ? `${sec} שנ׳` : `${sec}s`
}

const addDaysStr = (dateStr: string, n: number) => format(addDays(parseISO(dateStr), n), 'yyyy-MM-dd')
const dateMin = (a: string, b: string) => (a < b ? a : b)
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart
const localId = (prefix: string) =>
  `${prefix}_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random()}`

/** Most recent real step test for this athlete — same query as hooks/useLatestStepTest. */
export async function fetchLatestStepTest(athleteId: string): Promise<LactateStep[] | null> {
  const snap = await getDocs(query(collection(db, 'lactateTests'), where('athleteId', '==', athleteId)))
  const stepTests = snap.docs
    .map((d) => d.data() as any)
    .filter((t) => t.kind !== 'spot' && Array.isArray(t.steps) && t.steps.length > 0)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
  return stepTests[0]?.steps ?? null
}

/** Lab steps to derive personal pace/HR targets from: a real step test wins,
 *  otherwise the coach's manual T1/T2/T3 estimate on the profile. */
export function effectiveLabSteps(labSteps: LactateStep[] | null, physiology: any): LactateStep[] | null {
  if (labSteps && labSteps.length >= 2) return labSteps
  const manual = stepsFromPhysiologySummary(physiology)
  return manual && manual.length >= 2 ? manual : null
}

export type TargetOverride = { paceMinSec: number; paceMaxSec: number; hrMin?: number; hrMax?: number }

/** Personal pace/HR target for a lactate range, interpolated from the lab curve. */
export function targetOverrideFor(
  labSteps: LactateStep[] | null,
  lactateMin: number | null | undefined,
  lactateMax: number | null | undefined,
): TargetOverride | undefined {
  if (!labSteps || labSteps.length < 2 || lactateMin == null || lactateMax == null) return undefined
  const atMin = interpolateAtLactate(labSteps, lactateMin)
  const atMax = interpolateAtLactate(labSteps, lactateMax)
  if (!atMin || !atMax) return undefined
  const paceSecs = [atMin.paceSecPerKm, atMax.paceSecPerKm].sort((a, b) => a - b)
  return {
    paceMinSec: paceSecs[0],
    paceMaxSec: paceSecs[1],
    ...(atMin.hr != null && atMax.hr != null
      ? { hrMin: Math.min(atMin.hr, atMax.hr), hrMax: Math.max(atMin.hr, atMax.hr) }
      : {}),
  }
}

/** Model-format sets → the stored shape (with the legacy display strings the athlete view reads). */
export function formatSets(sets: BlockWorkoutOut['sets'], lang: 'en' | 'he') {
  return (sets || []).map((s, i) => ({
    id: `s${i}`,
    reps: s.reps,
    distanceMeters: s.distanceMeters ?? null,
    durationSec: s.durationSec ?? null,
    distance: s.distanceMeters != null ? formatMetersStr(s.distanceMeters, lang) : null,
    duration: s.durationSec != null ? formatSecondsStr(s.durationSec, lang) : null,
    restBetweenReps: s.restBetweenReps ?? null,
    restAfterSet: s.restAfterSet ?? null,
    notes: s.notes ?? null,
    intervals: (s.intervals || []).map((iv, j) => ({
      id: `s${i}-iv${j}`,
      distanceMeters: iv.distanceMeters ?? null,
      durationSec: iv.durationSec ?? null,
      distance: iv.distanceMeters != null ? formatMetersStr(iv.distanceMeters, lang) : null,
      duration: iv.durationSec != null ? formatSecondsStr(iv.durationSec, lang) : null,
      // The interval row shows "@ {pace}" as the effort label.
      pace: iv.notes || null,
    })),
  }))
}

/**
 * Writes one AI-generated workout as a library entry + an assignment on
 * its date. Shared by the season pipeline and the agent's create_workouts
 * tool so both produce identical documents.
 */
export async function writeAiWorkout(opts: {
  athleteId: string
  coachId: string
  workout: BlockWorkoutOut
  lang: 'en' | 'he'
  labSteps: LactateStep[] | null
}): Promise<{ workoutId: string; assignedWorkoutId: string }> {
  const { athleteId, coachId, workout: w, lang, labSteps } = opts
  const targetOverride = targetOverrideFor(labSteps, w.bakkenLactateMin, w.bakkenLactateMax)

  const workoutDoc = {
    title: w.title,
    type: w.type as WorkoutType,
    description: w.description || '',
    duration: w.duration ?? null,
    distance: w.distance ?? null,
    warmup: w.warmup ?? null,
    cooldown: w.cooldown ?? null,
    notes: w.notes ?? null,
    targetThresholdLevel: w.targetThresholdLevel ?? null,
    comparisonGroup: w.comparisonGroup ?? null,
    thresholdDistance: w.thresholdDistance ?? null,
    sets: formatSets(w.sets, lang),
    createdBy: coachId,
    source: AI_SOURCE,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
  const wRef = await addDoc(collection(db, 'workouts'), workoutDoc)

  const aRef = await addDoc(collection(db, 'assignedWorkouts'), {
    workoutId: wRef.id,
    workout: { id: wRef.id, ...workoutDoc, createdAt: new Date(), updatedAt: new Date() },
    athleteId,
    assignedBy: coachId,
    scheduledDate: w.date,
    status: 'scheduled',
    session: w.session || 'other',
    source: AI_SOURCE,
    ...(targetOverride ? { targetOverride } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { workoutId: wRef.id, assignedWorkoutId: aRef.id }
}

const buildWeekSummary = (recentAssigned: any[], logs: any[], today: Date, weekOffset: number): WeekAgg | null => {
  const from = format(addDays(today, -7 * (weekOffset + 1)), 'yyyy-MM-dd')
  const to = format(addDays(today, -7 * weekOffset), 'yyyy-MM-dd')
  const slice = recentAssigned.filter((w) => w.scheduledDate >= from && w.scheduledDate < to)
  if (slice.length === 0) return null
  const totalPlanned = slice.reduce((s, w) => s + (w.workout?.distance || 0), 0)
  let totalActual = 0
  let completed = 0
  let skipped = 0
  let effortSum = 0
  let effortCount = 0
  for (const w of slice) {
    const log = logs.find((l: any) => l.assignedWorkoutId === w.id)
    if (w.status === 'completed') completed++
    if (w.status === 'skipped') skipped++
    if (log?.actualDistance) totalActual += log.actualDistance
    if (log?.effort != null) {
      effortSum += log.effort
      effortCount++
    }
  }
  return {
    totalPlanned,
    totalActual,
    completed,
    skipped,
    avgEffort: effortCount ? Math.round((effortSum / effortCount) * 10) / 10 : null,
  }
}

const ageFrom = (dob?: string): number | undefined => {
  if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) return undefined
  const years = (Date.now() - new Date(dob).getTime()) / (365.25 * 86400000)
  return years > 5 && years < 100 ? Math.floor(years) : undefined
}

/**
 * Builds the athlete_context the brain sees for plan generation, from the
 * profile plus the last 3 weeks of real training.
 */
export async function buildPlanAthleteContext(
  athleteId: string,
  profile: any,
  libraryWorkouts: Workout[],
  labSteps: LactateStep[] | null,
): Promise<{ context: PlanAthleteContext; assigned: any[]; actualAvgWeeklyKm: number | null }> {
  const today = new Date()
  const [assignedSnap, logsSnap] = await Promise.all([
    getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId))),
    getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId))),
  ])
  const assigned = assignedSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
  const logs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
  const cutoff = format(addDays(today, -21), 'yyyy-MM-dd')
  const recentAssigned = assigned
    .filter((w) => w.scheduledDate >= cutoff)
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
  const recentWorkouts = recentAssigned.map((w) => {
    const log =
      logs.find((l: any) => l.assignedWorkoutId === w.id) ||
      logs.find((l: any) => l.workoutId === w.workoutId && l.date === w.scheduledDate)
    return {
      date: w.scheduledDate,
      title: w.workout?.title || '',
      type: w.workout?.type || '',
      status: w.status,
      plannedKm: w.workout?.distance ?? undefined,
      actualKm: log?.actualDistance ?? undefined,
      effort: log?.effort ?? null,
      comment: log?.comment || undefined,
    }
  })

  const last3WeeksSummary = {
    week1: buildWeekSummary(recentAssigned, logs, today, 2),
    week2: buildWeekSummary(recentAssigned, logs, today, 1),
    week3: buildWeekSummary(recentAssigned, logs, today, 0),
  }
  const realWeeks = [last3WeeksSummary.week1, last3WeeksSummary.week2, last3WeeksSummary.week3]
    .filter((w): w is WeekAgg => w !== null && w.totalActual > 0)
  const actualAvgWeeklyKm = realWeeks.length
    ? Math.round(realWeeks.reduce((s, w) => s + w.totalActual, 0) / realWeeks.length)
    : null

  const context: PlanAthleteContext = {
    name: profile.name || 'Athlete',
    experienceLevel: profile.experienceLevel,
    daysPerWeek: profile.daysPerWeek,
    weekSchedule: profile.weekSchedule,
    weeklyMileage: profile.weeklyMileage,
    injuryHistory: profile.injuryHistory,
    currentShape: profile.currentShape,
    longRunMinutes: profile.longRunMinutes,
    longRunDay: profile.longRunDay,
    coachNotes: profile.coachPrivateNotes,
    goalRaceEvent: profile.goalRaceEvent || 'Goal Race',
    goalRaceDistance: profile.goalRaceDistance,
    goalRaceDate: profile.goalRaceDate,
    goalRaceTarget: profile.goalRaceTarget,
    testRaceEvent: profile.testRaceEvent,
    testRaceDistance: profile.testRaceDistance,
    testRaceDate: profile.testRaceDate,
    personalRecords: Array.isArray(profile.personalRecords)
      ? profile.personalRecords.slice(0, 5).map((p: any) => ({ event: p.event, time: p.time, date: p.date }))
      : [],
    // Extended onboarding (athlete-onboarding.tsx) — undefined when not answered.
    age: ageFrom(profile.dateOfBirth),
    weeklyTrainingHours: profile.weeklyTrainingHours ?? undefined,
    muscleFiberLeaning: profile.muscleFiberLeaning ?? undefined,
    occupationalPhysicalDemand: profile.occupationalPhysicalDemand ?? undefined,
    injuryHistoryDetail: Array.isArray(profile.injuryHistoryDetail) && profile.injuryHistoryDetail.length ? profile.injuryHistoryDetail : undefined,
    accessToLactateMeter: profile.accessToLactateMeter ?? undefined,
    thresholdTestingMethod: profile.thresholdTestingMethod ?? undefined,
    priorTrainingInterruptions: profile.priorTrainingInterruptions ?? undefined,
    labMarkersKnown: Array.isArray(profile.labMarkersKnown) && profile.labMarkersKnown.length ? profile.labMarkersKnown : undefined,
    menstrualCycleTracking: profile.menstrualCycleTracking ?? undefined,
    physiology: {
      hasLabTest: !!effectiveLabSteps(labSteps, profile.physiology),
      lt1PaceSec: profile.physiology?.lt1PaceSec ?? null,
      lt1Hr: profile.physiology?.lt1Hr ?? null,
      lt2PaceSec: profile.physiology?.lt2PaceSec ?? null,
      lt2Hr: profile.physiology?.lt2Hr ?? null,
      lt3PaceSec: profile.physiology?.lt3PaceSec ?? null,
      lt3Hr: profile.physiology?.lt3Hr ?? null,
      vo2maxEst: profile.physiology?.vo2maxEst ?? null,
      testDate: profile.physiology?.testDate,
    },
    last3WeeksSummary,
    recentWorkouts,
    recurringActivities: Array.isArray(profile.recurringActivities) && profile.recurringActivities.length > 0
      ? profile.recurringActivities.map((r: any) => {
          const linked = r.workoutId ? libraryWorkouts.find((w) => w.id === r.workoutId) : undefined
          return {
            dayOfWeek: r.dayOfWeek, frequency: r.frequency,
            type: linked?.type || r.type, title: linked?.title || r.title, notes: r.notes,
          }
        })
      : undefined,
    specialEvents: Array.isArray(profile.specialEvents) && profile.specialEvents.length > 0
      ? profile.specialEvents.map((e: any) => ({ date: e.date, label: e.label, notes: e.notes }))
      : undefined,
    language: (profile.preferredLanguage as 'en' | 'he') || 'he',
  }
  return { context, assigned, actualAvgWeeklyKm }
}

export interface SeasonPipelineOptions {
  athleteId: string
  coachId: string
  target: GenerationTarget
  /** Wipe every previous AI-generated workout and rebuild from next Sunday. */
  forceRestart: boolean
  libraryWorkouts: Workout[]
  /** Language for progress/error strings (not the plan itself — that follows the athlete's preferredLanguage). */
  uiLang: 'en' | 'he'
  onProgress?: (msg: string) => void
  /** Called with the journey as soon as it's known (new skeleton or the continued one). */
  onJourney?: (journey: JourneyDoc) => void
}

export type SeasonPipelineResult =
  | { ok: true; written: number; blocks: number; journey: JourneyDoc; firstBlockSummary: string | null; summary: string; warning?: string }
  | { ok: false; error: string; written: number; alreadyComplete?: boolean }

export async function runSeasonPipeline(opts: SeasonPipelineOptions): Promise<SeasonPipelineResult> {
  const { athleteId, coachId, target, forceRestart, libraryWorkouts, onProgress, onJourney } = opts
  const t = STRINGS[opts.uiLang]
  const progress = (m: string) => onProgress?.(m)

  const profileSnap = await getDoc(doc(db, 'users', athleteId))
  if (!profileSnap.exists()) return { ok: false, error: t.profileNotFound, written: 0 }
  const profile = profileSnap.data() as any
  if (!profile.goalRaceDate) return { ok: false, error: t.setGoalRaceFirst, written: 0 }

  const weekSchedule: Record<DayKey, DayType> = Object.fromEntries(
    DAY_ORDER.map((day) => {
      const v = profile.weekSchedule?.[day]
      return [day, v === 'off' ? 'off' : v === 'rest' ? 'rest' : 'workout']
    }),
  ) as Record<DayKey, DayType>
  const cutbackIntervalWeeks: number | undefined =
    typeof profile.cutbackIntervalWeeks === 'number' ? profile.cutbackIntervalWeeks : undefined
  const cutbackFewerDays = !!profile.cutbackFewerDays
  const cutbackDowngradeQuality = !!profile.cutbackDowngradeQuality

  const labSteps = effectiveLabSteps(await fetchLatestStepTest(athleteId), profile.physiology)
  const today = new Date()
  const { context: athleteContext, assigned, actualAvgWeeklyKm } =
    await buildPlanAthleteContext(athleteId, profile, libraryWorkouts, labSteps)

  // Continue an existing season for the same goal race instead of wiping it,
  // unless the caller explicitly asked for a fresh restart.
  const existingAi = assigned.filter((w: any) => w.source === AI_SOURCE)
  const lastGeneratedDate: string | null = existingAi.length
    ? existingAi.reduce((max: string, w: any) => (w.scheduledDate > max ? w.scheduledDate : max), existingAi[0].scheduledDate)
    : null
  const existingJourney = forceRestart ? null : await getJourney(athleteId, AI_JOURNEY_ID)
  const canContinue = !!(existingJourney && lastGeneratedDate && existingJourney.goalRaceDate === profile.goalRaceDate)

  if (canContinue && lastGeneratedDate! >= existingJourney!.goalRaceDate) {
    return { ok: false, error: t.seasonAlreadyComplete, written: 0, alreadyComplete: true }
  }

  let journeyDoc: JourneyDoc
  let resumeCursor: string
  let previousBlockTail: Array<{ date: string; type: string; title: string }> | undefined

  if (canContinue) {
    journeyDoc = existingJourney!
    resumeCursor = addDaysStr(lastGeneratedDate!, 1)
    previousBlockTail = existingAi
      .sort((a: any, b: any) => a.scheduledDate.localeCompare(b.scheduledDate))
      .slice(-10)
      .map((w: any) => ({ date: w.scheduledDate, type: w.workout?.type || '', title: w.workout?.title || '' }))
    progress(t.continuingSeason(resumeCursor))
    onJourney?.(journeyDoc)
  } else {
    // Full rebuild — only deletes assignments this feature created
    // (source:'bakken'), never anything the coach assigned by hand.
    progress(t.clearingPrevious)
    const priorSnap = await getDocs(
      query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId), where('source', '==', AI_SOURCE)),
    )
    if (!priorSnap.empty) await Promise.all(priorSnap.docs.map((d) => deleteDoc(d.ref)))

    // A brand-new season always starts on the upcoming Sunday so every week
    // (including the first) is a full Sun-Sat week.
    const seasonStartDate = today.getDay() === 0 ? today : addDays(today, 7 - today.getDay())
    const startDateStr = format(seasonStartDate, 'yyyy-MM-dd')
    const totalWeeksAvailable = Math.max(
      1,
      Math.ceil((new Date(profile.goalRaceDate).getTime() - seasonStartDate.getTime()) / (7 * 86400000)),
    )
    // A coach-entered weekly mileage always wins; real logged history is the fallback.
    const currentWeeklyKm = profile.weeklyMileage ?? actualAvgWeeklyKm ?? 30
    const skeletonReq: SkeletonRequest = {
      totalWeeksAvailable,
      currentWeeklyKm,
      peakWeeklyKmHint: profile.weeklyKmRange?.max,
    }
    progress(t.designingSkeleton)
    const skeletonData = await aiCoachFetch('/api/ai-coach/generate-skeleton', { athlete: athleteContext, skeleton: skeletonReq })
    if (skeletonData.usage) logAiUsage({ route: 'generate-skeleton', model: skeletonData.model, athleteId, coachId, usage: skeletonData.usage })
    if (skeletonData.error || !Array.isArray(skeletonData.skeleton?.stages) || skeletonData.skeleton.stages.length === 0) {
      return { ok: false, error: t.skeletonFailed(skeletonData.error || 'malformed response'), written: 0 }
    }
    const skeletonOut: SkeletonOut = skeletonData.skeleton

    // The model can be off by a week or two; the last stage absorbs the
    // remainder so the season lands exactly on goalRaceDate.
    const rawStages = skeletonOut.stages.filter((s) => s.weeks > 0)
    const weekSum = rawStages.reduce((s, st) => s + st.weeks, 0)
    if (weekSum !== totalWeeksAvailable && rawStages.length > 0) {
      const diff = totalWeeksAvailable - weekSum
      rawStages[rawStages.length - 1].weeks = Math.max(1, rawStages[rawStages.length - 1].weeks + diff)
    }

    let dateCursor = startDateStr
    const stages: JourneyStage[] = rawStages.map((s, i) => {
      const isLast = i === rawStages.length - 1
      const stageEnd = isLast ? profile.goalRaceDate : addDaysStr(dateCursor, s.weeks * 7 - 1)
      const stage: JourneyStage = {
        id: localId('stage'),
        name: s.name,
        type: s.type,
        startDate: dateCursor,
        endDate: stageEnd,
        focus: s.focus,
        weeklyVolumeKm: s.weeklyVolumeKm,
        keyWorkouts: s.keyWorkouts,
        milestones: s.milestones,
      }
      dateCursor = addDaysStr(stageEnd, 1)
      return stage
    })

    journeyDoc = {
      // Stable id — every rebuild overwrites the same journey doc.
      id: AI_JOURNEY_ID,
      title: skeletonOut.title,
      goalRaceEvent: profile.goalRaceEvent || 'Goal Race',
      goalRaceDate: profile.goalRaceDate,
      goalRaceTarget: profile.goalRaceTarget,
      startDate: startDateStr,
      stages,
      createdBy: coachId,
      createdAt: new Date(),
      updatedAt: new Date(),
    }
    await saveJourney(athleteId, journeyDoc)
    onJourney?.(journeyDoc)
    resumeCursor = journeyDoc.startDate
  }

  // How far this run generates.
  let targetEndDate: string
  if (target === 'whole_season') {
    targetEndDate = journeyDoc.goalRaceDate
  } else if (target === 'current_stage') {
    const stage = journeyDoc.stages.find((s) => resumeCursor >= s.startDate && resumeCursor <= s.endDate)
    targetEndDate = stage ? stage.endDate : journeyDoc.goalRaceDate
  } else {
    const matching = journeyDoc.stages.filter((s) => s.type === target && s.endDate >= resumeCursor)
    if (matching.length === 0) return { ok: false, error: t.stageAlreadyPassed, written: 0 }
    targetEndDate = matching[matching.length - 1].endDate
  }
  const seasonEndBound = dateMin(targetEndDate, journeyDoc.goalRaceDate)

  // ~14-day Sunday-aligned blocks, each clamped to its stage's end.
  const stageEndDateFor = (dateStr: string): string => {
    const stage = journeyDoc.stages.find((s) => dateStr >= s.startDate && dateStr <= s.endDate)
    return stage ? stage.endDate : seasonEndBound
  }
  const blocks: { startDate: string; endDate: string }[] = []
  let cursor = resumeCursor
  const firstDow = parseISO(cursor).getDay()
  if (firstDow !== 0 && cursor <= seasonEndBound) {
    const stubEnd = dateMin(addDaysStr(cursor, 6 - firstDow), dateMin(stageEndDateFor(cursor), seasonEndBound))
    blocks.push({ startDate: cursor, endDate: stubEnd })
    cursor = addDaysStr(stubEnd, 1)
  }
  while (cursor <= seasonEndBound && blocks.length < MAX_BLOCKS) {
    const end = dateMin(addDaysStr(cursor, BLOCK_DAYS - 1), dateMin(stageEndDateFor(cursor), seasonEndBound))
    blocks.push({ startDate: cursor, endDate: end })
    cursor = addDaysStr(end, 1)
  }

  // Recurring activities that reference a real library workout carry its content.
  const recurringActivitiesResolved: RecurringActivityInput[] | undefined = athleteContext.recurringActivities?.map((r, idx) => {
    const raw = profile.recurringActivities?.[idx]
    const linked = raw?.workoutId ? libraryWorkouts.find((w) => w.id === raw.workoutId) : undefined
    return {
      ...r,
      content: linked ? {
        description: linked.description, warmup: linked.warmup, cooldown: linked.cooldown,
        notes: linked.notes, duration: linked.duration, distance: linked.distance,
        sets: linked.sets as any, strengthBlocks: linked.strengthBlocks,
      } : undefined,
    }
  })

  let totalWritten = 0
  let firstBlockSummary: string | null = null
  let warning: string | undefined

  for (let i = 0; i < blocks.length; i++) {
    progress(t.generatingBlock(blocks[i].startDate, blocks[i].endDate, i + 1, blocks.length))

    const stagesForBlock: BlockStageInfo[] = journeyDoc.stages
      .filter((s) => overlaps(s.startDate, s.endDate, blocks[i].startDate, blocks[i].endDate))
      .map((s) => ({
        type: s.type,
        name: s.name,
        focus: s.focus,
        weeklyVolumeKm: s.weeklyVolumeKm,
        startDate: s.startDate,
        endDate: s.endDate,
        dayTypeTemplate: (profile.stageDayTypeTemplates as any)?.[s.type],
      }))

    const data = await aiCoachFetch('/api/ai-coach/generate-plan', {
      athlete: athleteContext,
      block: {
        blockIndex: i,
        totalBlocks: blocks.length,
        startDate: blocks[i].startDate,
        endDate: blocks[i].endDate,
        seasonStartDate: journeyDoc.startDate,
        stages: stagesForBlock,
        previousBlockTail,
      },
    })
    if (data.usage) logAiUsage({ route: 'generate-plan', model: data.model, athleteId, coachId, usage: data.usage })
    if (data.error || !Array.isArray(data.plan?.workouts)) {
      warning = t.blockFailed(i + 1, data.error || 'malformed response', totalWritten)
      break
    }
    const plan: BlockPlanOut = data.plan
    if (i === 0) firstBlockSummary = plan.blockSummary
    const lang = athleteContext.language
    normalizeInvalidTypes(plan.workouts, lang)
    enforceWeekSchedule(plan.workouts, weekSchedule, lang)
    enforceDayTypeTemplate(plan.workouts, stagesForBlock)
    enforceAmPmOrder(plan.workouts)
    enforceLongRunDay(plan.workouts, athleteContext.longRunDay, lang)
    enforceNoBackToBackBigDays(plan.workouts, previousBlockTail, athleteContext.longRunDay, lang)
    enforceRecurringActivities(plan.workouts, recurringActivitiesResolved, journeyDoc.startDate, lang)
    enforceSpecialEvents(plan.workouts, athleteContext.specialEvents, lang)
    // Last among the date/session-touching backstops (enforceLongRunDay can
    // create fresh same-day pairs).
    enforceSameDaySessionTags(plan.workouts)
    // Before normalizeWeeklyVolume — cutback changes the distance pool it reads.
    applyCutbackWeekAdjustments(
      plan.workouts, stagesForBlock, athleteContext.experienceLevel,
      { intervalOverride: cutbackIntervalWeeks, fewerDays: cutbackFewerDays, downgradeQuality: cutbackDowngradeQuality },
      lang,
    )
    normalizeWeeklyVolume(plan.workouts, stagesForBlock, journeyDoc.startDate, journeyDoc.goalRaceDate, athleteContext.longRunMinutes, athleteContext.experienceLevel, cutbackIntervalWeeks)

    for (const w of plan.workouts) {
      if (w.type === 'rest') continue
      await writeAiWorkout({ athleteId, coachId, workout: w, lang, labSteps })
      totalWritten++
    }

    previousBlockTail = plan.workouts
      .filter((w) => w.type !== 'rest')
      .slice(-10)
      .map((w) => ({ date: w.date, type: w.type, title: w.title }))
  }

  // The existing rolling-visibility window hides the rest of the season from the athlete.
  await updateDoc(doc(db, 'users', athleteId), {
    visibleWeeksAhead: 2,
    bakkenPlanGeneratedAt: serverTimestamp(),
  })

  if (totalWritten === 0 && warning) return { ok: false, error: warning, written: 0 }

  return {
    ok: true,
    written: totalWritten,
    blocks: blocks.length,
    journey: journeyDoc,
    firstBlockSummary,
    summary: t.summary(journeyDoc.stages.length, journeyDoc.goalRaceDate, blocks.length, totalWritten),
    warning,
  }
}
