/**
 * lib/journey.ts
 *
 * Firestore CRUD + templates for the per-athlete "Season Journey".
 * Each journey is stored at users/{athleteId}/journey/{journeyId}.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  deleteDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { JourneyDoc, JourneyStage, JourneyStageType, WorkoutType } from '@/lib/types'

function genId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

interface RawStage {
  id?: string
  name?: string
  type?: JourneyStageType
  startDate?: string
  endDate?: string
  focus?: string
  weeklyVolumeKm?: number
  keyWorkouts?: string[]
  milestones?: string[]
  notes?: string
}

function mapStage(raw: RawStage): JourneyStage {
  return {
    id: raw.id || genId('stage'),
    name: raw.name || 'Stage',
    type: (raw.type as JourneyStageType) || 'custom',
    startDate: raw.startDate || '',
    endDate: raw.endDate || '',
    focus: raw.focus || '',
    weeklyVolumeKm: raw.weeklyVolumeKm,
    keyWorkouts: Array.isArray(raw.keyWorkouts) ? raw.keyWorkouts : [],
    milestones: Array.isArray(raw.milestones) ? raw.milestones : [],
    notes: raw.notes,
  }
}

interface RawJourneyDoc {
  title?: string
  goalRaceEvent?: string
  goalRaceDate?: string
  goalRaceTarget?: string
  startDate?: string
  stages?: RawStage[]
  createdBy?: string
  createdAt?: { toDate?: () => Date }
  updatedAt?: { toDate?: () => Date }
}

function mapJourney(id: string, data: RawJourneyDoc): JourneyDoc {
  return {
    id,
    title: data.title || 'Season Journey',
    goalRaceEvent: data.goalRaceEvent || '',
    goalRaceDate: data.goalRaceDate || '',
    goalRaceTarget: data.goalRaceTarget,
    startDate: data.startDate || '',
    stages: Array.isArray(data.stages) ? data.stages.map(mapStage) : [],
    createdBy: data.createdBy || '',
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  }
}

export async function listJourneys(athleteId: string): Promise<JourneyDoc[]> {
  const col = collection(db, 'users', athleteId, 'journey')
  const snap = await getDocs(query(col, orderBy('goalRaceDate', 'asc')))
  return snap.docs.map((d) => mapJourney(d.id, d.data() as RawJourneyDoc))
}

export async function getJourney(
  athleteId: string,
  journeyId: string,
): Promise<JourneyDoc | null> {
  const snap = await getDoc(doc(db, 'users', athleteId, 'journey', journeyId))
  if (!snap.exists()) return null
  return mapJourney(snap.id, snap.data() as RawJourneyDoc)
}

export async function saveJourney(
  athleteId: string,
  journey: JourneyDoc,
): Promise<void> {
  const ref = doc(db, 'users', athleteId, 'journey', journey.id)
  const existing = await getDoc(ref)
  await setDoc(
    ref,
    {
      title: journey.title,
      goalRaceEvent: journey.goalRaceEvent,
      goalRaceDate: journey.goalRaceDate,
      goalRaceTarget: journey.goalRaceTarget ?? null,
      startDate: journey.startDate,
      stages: JSON.parse(JSON.stringify(journey.stages)),
      createdBy: journey.createdBy,
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function deleteJourney(athleteId: string, journeyId: string): Promise<void> {
  await deleteDoc(doc(db, 'users', athleteId, 'journey', journeyId))
}

// -------------------- templates --------------------

function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function newStage(
  s: Omit<JourneyStage, 'id'> & { id?: string },
): JourneyStage {
  return {
    id: s.id || genId('stage'),
    name: s.name,
    type: s.type,
    startDate: s.startDate,
    endDate: s.endDate,
    focus: s.focus,
    weeklyVolumeKm: s.weeklyVolumeKm,
    keyWorkouts: s.keyWorkouts ?? [],
    milestones: s.milestones ?? [],
    notes: s.notes,
  }
}

interface TemplateInput {
  startDate: string
  goalRaceDate: string
  createdBy: string
  goalRaceTarget?: string
}

export interface JourneyTemplate {
  key: string
  label: string
  goalRaceEvent: string
  /** Approximate length in weeks; used to suggest a startDate from the race date. */
  weeks: number
  build(input: TemplateInput): JourneyDoc
}

function makeFiveStage(
  input: TemplateInput,
  cfg: {
    title: string
    goalRaceEvent: string
    weeks: number
    splits: number[] // proportions summing to weeks; e.g. [6,4,3,2,1]
    focuses: string[]
    workouts: string[][]
    volumes: number[]
  },
): JourneyDoc {
  const stageTypes: JourneyStageType[] = ['base', 'build', 'peak', 'taper', 'race_week']
  const stageNames = ['Base', 'Build', 'Peak', 'Taper', 'Race Week']

  const stages: JourneyStage[] = []
  let cursor = input.startDate
  cfg.splits.forEach((w, i) => {
    const end = addDaysISO(cursor, w * 7 - 1)
    stages.push(
      newStage({
        name: stageNames[i],
        type: stageTypes[i],
        startDate: cursor,
        endDate: i === cfg.splits.length - 1 ? input.goalRaceDate : end,
        focus: cfg.focuses[i],
        weeklyVolumeKm: cfg.volumes[i],
        keyWorkouts: cfg.workouts[i],
        milestones: i === cfg.splits.length - 1 ? ['Goal race'] : [],
      }),
    )
    cursor = addDaysISO(end, 1)
  })

  return {
    id: genId('journey'),
    title: cfg.title,
    goalRaceEvent: cfg.goalRaceEvent,
    goalRaceDate: input.goalRaceDate,
    goalRaceTarget: input.goalRaceTarget,
    startDate: input.startDate,
    stages,
    createdBy: input.createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export const journeyTemplates: JourneyTemplate[] = [
  {
    key: 'marathon-16',
    label: '16-week Marathon',
    goalRaceEvent: 'Marathon',
    weeks: 16,
    build: (input) =>
      makeFiveStage(input, {
        title: 'Road to Marathon',
        goalRaceEvent: 'Marathon',
        weeks: 16,
        splits: [6, 5, 3, 1, 1],
        focuses: [
          'Aerobic base, easy mileage, strides',
          'Marathon-specific endurance, long tempo work',
          'Race-pace specificity, simulation long runs',
          'Sharpen, reduce volume by ~40%',
          'Race week: rest, openers, fuel',
        ],
        workouts: [
          ['Long run 90–120 min easy', 'Strides 6x20s', 'Steady 60 min'],
          ['Long run 2–2.5 h', 'Tempo 6–8 km @ T', 'MP segments 3x5 km'],
          ['Long run with MP 3x6 km', 'Simulation 3x5 km @ HMP', 'VO2 5x1000m'],
          ['Easy 75 min + strides', '3 km tempo', 'Short MP 4 km'],
          ['Easy 30–40 min', 'Openers: 2 km easy + 4x100m strides', 'Goal race'],
        ],
        volumes: [70, 90, 100, 60, 30],
      }),
  },
  {
    key: '10k-12',
    label: '12-week 10K',
    goalRaceEvent: '10K',
    weeks: 12,
    build: (input) =>
      makeFiveStage(input, {
        title: 'Road to 10K',
        goalRaceEvent: '10K',
        weeks: 12,
        splits: [4, 4, 2, 1, 1],
        focuses: [
          'Aerobic base, easy mileage',
          'Threshold + VO2max introduction',
          'Race-pace work, faster intervals',
          'Taper, keep intensity, drop volume',
          'Race week: light + race',
        ],
        workouts: [
          ['Long run 70–90 min', 'Strides 6x20s', 'Steady 50 min'],
          ['Tempo 5–6 km @ T', '5x1000m @ I', 'Long run 90 min'],
          ['8x800m @ I', '3x2 km @ T', 'Race-pace 4x1500m'],
          ['Easy 40 min + 4x200m', '2 km tempo', 'Long run 60 min easy'],
          ['Easy 30 min', 'Openers: 4x100m', 'Goal race'],
        ],
        volumes: [50, 60, 65, 45, 25],
      }),
  },
  {
    key: '5k-8',
    label: '8-week 5K',
    goalRaceEvent: '5K',
    weeks: 8,
    build: (input) =>
      makeFiveStage(input, {
        title: 'Road to 5K',
        goalRaceEvent: '5K',
        weeks: 8,
        // Integer week splits summing to 8: Base / Build / Peak / Taper / Race week.
        splits: [3, 2, 1, 1, 1],
        focuses: [
          'Aerobic base + strides',
          'Threshold + 5K-specific intervals',
          'Sharpening, race-pace reps',
          'Mini-taper, keep speed',
          'Race week',
        ],
        workouts: [
          ['Long run 60–75 min', '6x20s strides', 'Easy 45 min'],
          ['Tempo 4 km @ T', '6x800m @ I', '12x400m @ R'],
          ['3x1 mile @ 5K pace', '5x1000m @ I'],
          ['2 km tempo', '4x200m @ R'],
          ['Openers: 4x100m', 'Goal race'],
        ],
        volumes: [40, 50, 55, 40, 20],
      }),
  },
]

export function buildTemplate(
  key: string,
  input: TemplateInput,
): JourneyDoc | null {
  const t = journeyTemplates.find((x) => x.key === key)
  if (!t) return null
  return t.build(input)
}

// -------------------- custom wizard (athlete-data driven) --------------------

/** Hebrew labels for workout types — used only to generate readable
 *  keyWorkouts text on stages; this file has no access to language context. */
const TYPE_HE: Record<WorkoutType, string> = {
  easy: 'ריצה קלה', long_run: 'ריצה ארוכה', tempo: 'טמפו/סף', intervals: 'אינטרוולים',
  hill_repeats: 'עליות', fartlek: 'פרטלק', recovery: 'התאוששות', strength: 'חיזוק',
  cross_training: 'אימון משולב', swim: 'שחייה', bike: 'אופניים', rest: 'מנוחה',
  race: 'תחרות', time_trial: 'מבחן זמן', threshold: 'אימון סף',
}

/**
 * Which of the coach's chosen workout types make sense in each phase, in
 * priority order — this encodes the actual progression Yoni coaches with:
 * base = easy/hills/fartlek/long run (aerobic, no hard intensity yet);
 * build = threshold/tempo work introduced while fartlek and hills continue;
 * peak = sharpen into specific intervals + goal-pace work.
 * The order here (not the order the coach clicked the chips) decides which
 * types surface first in each stage's keyWorkouts.
 */
const PHASE_TYPES: Record<JourneyStageType, WorkoutType[]> = {
  base: ['easy', 'long_run', 'hill_repeats', 'fartlek', 'strength', 'cross_training', 'swim', 'bike', 'recovery'],
  build: ['tempo', 'fartlek', 'hill_repeats', 'long_run', 'intervals', 'cross_training'],
  peak: ['intervals', 'tempo', 'time_trial', 'hill_repeats', 'race'],
  taper: ['easy', 'tempo', 'recovery', 'strength'],
  race_week: ['easy', 'recovery'],
  recovery: ['easy', 'recovery'],
  custom: ['easy'],
}

const PHASE_FALLBACK_HE: Record<JourneyStageType, string[]> = {
  base: ['ריצה קלה', 'ריצה ארוכה', 'עליות', 'פרטלק'],
  build: ['טמפו/סף', 'פרטלק', 'עליות', 'ריצה ארוכה'],
  peak: ['אינטרוולים ספציפיים', 'קצב מטרה (Goal Pace)', 'טמפו/סף'],
  taper: ['קל + פתיחות', 'הפחתת נפח'],
  race_week: ['קל בלבד', 'פתיחות לפני המרוץ'],
  recovery: ['קל בלבד'],
  custom: ['ריצה קלה'],
}

function keyWorkoutsForPhase(phase: JourneyStageType, chosen: WorkoutType[]): string[] {
  const order = PHASE_TYPES[phase] || []
  let relevant = order.filter((w) => chosen.includes(w)).map((w) => TYPE_HE[w] || w)
  if (relevant.length === 0) relevant = PHASE_FALLBACK_HE[phase]
  // Peak is where training gets race-specific — always call out goal-pace
  // work here regardless of which type chips the coach picked.
  if (phase === 'peak' && !relevant.includes('קצב מטרה (Goal Pace)')) {
    relevant = [...relevant, 'קצב מטרה (Goal Pace)']
  }
  return relevant.slice(0, 5)
}

/** Split total available weeks into [base, build, peak, taper, race_week]. */
function splitWeeksForCustomJourney(totalWeeks: number): number[] {
  const weeks = Math.max(4, totalWeeks)
  const raceWeek = 1
  const taper = weeks >= 10 ? 2 : 1
  const remaining = Math.max(2, weeks - raceWeek - taper)
  const peak = Math.max(1, Math.round(remaining * 0.25))
  const build = Math.max(1, Math.round(remaining * 0.40))
  const base = Math.max(1, remaining - peak - build)
  return [base, build, peak, taper, raceWeek]
}

export interface InterimRace {
  event: string
  date: string
  type?: 'race' | 'time_trial'
  notes?: string
}

export interface CustomJourneyInput {
  startDate: string
  goalRaceEvent: string
  goalRaceDate: string
  goalRaceTarget?: string
  createdBy: string
  /** Athlete's current weekly km (baseline, before the plan ramps up). */
  currentWeeklyKm: number
  /** Target weekly km at the peak of training. */
  peakWeeklyKm: number
  /** Workout types the coach wants emphasized — filtered into each stage. */
  workoutTypes: WorkoutType[]
  /** Tune-up / time-trial races along the way — added as stage milestones. */
  interimRaces?: InterimRace[]
  /** Explicit km target per stage [base, build, peak, taper, race_week] —
   *  overrides the auto-ramp from currentWeeklyKm/peakWeeklyKm when given. */
  phaseVolumesKm?: number[]
}

/** Auto-ramp default km target for each of the 5 stages, from current to peak. */
export function defaultPhaseVolumes(currentWeeklyKm: number, peakWeeklyKm: number): number[] {
  const current = Math.max(0, currentWeeklyKm || 0)
  const peak = Math.max(current, peakWeeklyKm || current)
  return [
    Math.round(current + (peak - current) * 0.3),
    Math.round(current + (peak - current) * 0.7),
    peak,
    Math.round(peak * 0.6),
    Math.round(peak * 0.3),
  ]
}

/**
 * Builds a full 5-stage journey (בסיס/בנייה/שיא/חידוד/שבוע תחרות) sized to
 * the athlete's actual data: stage lengths scale with however many weeks
 * are available until the goal race, weekly volume ramps from the
 * athlete's current km to their peak target (or uses the coach's explicit
 * per-phase km when provided), and each stage's key workouts are drawn
 * from the types the coach actually wants to use with them — instead of
 * the fixed generic templates.
 */
export function buildCustomJourney(input: CustomJourneyInput): JourneyDoc {
  const totalWeeks = Math.round(
    (new Date(input.goalRaceDate).getTime() - new Date(input.startDate).getTime()) / (7 * 86400000),
  )
  const splits = splitWeeksForCustomJourney(totalWeeks)
  const stageTypes: JourneyStageType[] = ['base', 'build', 'peak', 'taper', 'race_week']
  const stageNamesHe = ['בסיס', 'בנייה', 'שיא', 'חידוד', 'שבוע תחרות']

  const volumes = input.phaseVolumesKm && input.phaseVolumesKm.length === 5
    ? input.phaseVolumesKm
    : defaultPhaseVolumes(input.currentWeeklyKm, input.peakWeeklyKm)

  const stages: JourneyStage[] = []
  let cursor = input.startDate
  splits.forEach((w, i) => {
    const end = addDaysISO(cursor, w * 7 - 1)
    const isLast = i === splits.length - 1
    const stageEnd = isLast ? input.goalRaceDate : end
    stages.push(
      newStage({
        name: stageNamesHe[i],
        type: stageTypes[i],
        startDate: cursor,
        endDate: stageEnd,
        focus: keyWorkoutsForPhase(stageTypes[i], input.workoutTypes).join(' · '),
        weeklyVolumeKm: volumes[i],
        keyWorkouts: keyWorkoutsForPhase(stageTypes[i], input.workoutTypes),
        milestones: isLast ? [`${input.goalRaceEvent} — יעד העונה`] : [],
      }),
    )
    cursor = addDaysISO(stageEnd, 1)
  })

  // Interim races: attach as a milestone on whichever stage contains the date
  for (const race of input.interimRaces || []) {
    const stage = stages.find((s) => race.date >= s.startDate && race.date <= s.endDate)
    if (stage) {
      stage.milestones = [...(stage.milestones || []), `${race.date} — ${race.event}`]
    }
  }

  return {
    id: genId('journey'),
    title: input.goalRaceEvent ? `בדרך ל־${input.goalRaceEvent}` : 'מסע העונה',
    goalRaceEvent: input.goalRaceEvent,
    goalRaceDate: input.goalRaceDate,
    goalRaceTarget: input.goalRaceTarget,
    startDate: input.startDate,
    stages,
    createdBy: input.createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function newEmptyJourney(input: TemplateInput, title = 'Season Journey'): JourneyDoc {
  return {
    id: genId('journey'),
    title,
    goalRaceEvent: '',
    goalRaceDate: input.goalRaceDate,
    goalRaceTarget: input.goalRaceTarget,
    startDate: input.startDate,
    stages: [],
    createdBy: input.createdBy,
    createdAt: new Date(),
    updatedAt: new Date(),
  }
}

export function newEmptyStage(after?: JourneyStage): JourneyStage {
  const start = after?.endDate ? addDaysISO(after.endDate, 1) : new Date().toISOString().slice(0, 10)
  return {
    id: genId('stage'),
    name: 'New Stage',
    type: 'custom',
    startDate: start,
    endDate: addDaysISO(start, 13),
    focus: '',
    weeklyVolumeKm: undefined,
    keyWorkouts: [],
    milestones: [],
  }
}

/**
 * Today's progress through the journey: percentage of total length elapsed,
 * the active stage (if any), and the next milestone date.
 */
export interface JourneyProgress {
  totalDays: number
  elapsedDays: number
  percent: number
  activeStage: JourneyStage | null
  nextStage: JourneyStage | null
  daysToRace: number
}

export function computeJourneyProgress(
  journey: JourneyDoc,
  today: Date = new Date(),
): JourneyProgress {
  const start = new Date(journey.startDate)
  const end = new Date(journey.goalRaceDate)
  const t = today.getTime()
  const totalDays = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000))
  const elapsedDays = Math.max(0, Math.min(totalDays, Math.round((t - start.getTime()) / 86400000)))
  const percent = Math.round((elapsedDays / totalDays) * 100)
  const activeStage =
    journey.stages.find((s) => {
      const a = new Date(s.startDate).getTime()
      const b = new Date(s.endDate).getTime()
      return t >= a && t <= b
    }) || null
  const future = journey.stages
    .filter((s) => new Date(s.startDate).getTime() > t)
    .sort((a, b) => a.startDate.localeCompare(b.startDate))
  const nextStage = future[0] || null
  const daysToRace = Math.max(0, Math.round((end.getTime() - t) / 86400000))
  return { totalDays, elapsedDays, percent, activeStage, nextStage, daysToRace }
}

/**
 * Whether the week containing `mid` (a mid-week reference date, e.g.
 * Thursday of the week being checked — avoids DST/boundary edge cases
 * versus comparing raw week-start dates) is a recovery/rest week, per the
 * athlete's every-`offN`-weeks cadence.
 *
 * When the coach has explicitly set `anchorDate` (see "set this week as
 * the rest week" in athlete-planner.tsx / athlete-planner-view.tsx — moves
 * the cadence when the athlete goes on vacation, gets sick, needs an extra
 * recovery week, etc.), that week itself becomes a rest week and every
 * `offN`-th week before/after it re-aligns from there — the recurring
 * pattern shifts to fit, not just this one week.
 *
 * Falls back to the ORIGINAL fixed cadence (counted from the journey
 * stage's own start date, 1-indexed) when no anchor has ever been set, so
 * nothing changes for an athlete who's never had it moved.
 */
export function isRestWeek(mid: Date, offN: number, anchorDate: string | undefined, stageStartDate: string): boolean {
  if (offN <= 0) return false
  if (anchorDate) {
    const anchor = new Date(anchorDate)
    const weeksSinceAnchor = Math.round((mid.getTime() - anchor.getTime()) / (7 * 86400000))
    return ((weeksSinceAnchor % offN) + offN) % offN === 0
  }
  const stageStart = new Date(stageStartDate)
  const weekInStage = Math.max(1, Math.ceil((mid.getTime() - stageStart.getTime()) / (7 * 86400000)))
  return weekInStage % offN === 0
}

/** Percent of a single stage elapsed by `today`. */
export function computeStageProgress(stage: JourneyStage, today: Date = new Date()): number {
  const a = new Date(stage.startDate).getTime()
  const b = new Date(stage.endDate).getTime()
  const t = today.getTime()
  if (t <= a) return 0
  if (t >= b) return 100
  return Math.round(((t - a) / (b - a)) * 100)
}

// ── Display helpers ──────────────────────────────────────────────────────────

const STAGE_NAME_HE: Record<string, string> = {
  base: 'בסיס', build: 'בנייה', peak: 'שיא', taper: 'חידוד',
  race_week: 'שבוע תחרות', 'race week': 'שבוע תחרות', recovery: 'התאוששות',
}

/**
 * Stage name for display — journey templates ship with English stage names
 * ("Build", "Base"...), which look broken inside the Hebrew UI. Translate
 * known names/types; keep custom names the coach typed.
 */
export function stageDisplayName(stage: { name?: string; type?: string }, hebrew = true): string {
  const name = (stage.name || '').trim()
  if (!hebrew) return name || stage.type || ''
  const key = name.toLowerCase()
  if (STAGE_NAME_HE[key]) return STAGE_NAME_HE[key]
  if (!name && stage.type) return STAGE_NAME_HE[stage.type] || stage.type
  return name || STAGE_NAME_HE[stage.type || ''] || ''
}

/** Journey title for display — replaces generic/mixed-language titles. */
export function journeyDisplayTitle(
  j: { title?: string; goalRaceEvent?: string },
  hebrew = true,
): string {
  const raw = (j.title || '').trim()
  const generic =
    /^(season journey|road to .*|untitled|build|base|peak|taper|my season)$/i.test(raw) ||
    /^המסע\s+[A-Za-z]/.test(raw)
  if (raw && !generic) return raw
  if (j.goalRaceEvent) return hebrew ? `בדרך ל־${j.goalRaceEvent}` : `Road to ${j.goalRaceEvent}`
  return hebrew ? 'מסע העונה' : 'Season Journey'
}
