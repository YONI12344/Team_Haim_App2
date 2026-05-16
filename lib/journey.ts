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
import type { JourneyDoc, JourneyStage, JourneyStageType } from '@/lib/types'

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
      stages: journey.stages,
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

/** Percent of a single stage elapsed by `today`. */
export function computeStageProgress(stage: JourneyStage, today: Date = new Date()): number {
  const a = new Date(stage.startDate).getTime()
  const b = new Date(stage.endDate).getTime()
  const t = today.getTime()
  if (t <= a) return 0
  if (t >= b) return 100
  return Math.round(((t - a) / (b - a)) * 100)
}
