'use client'

/**
 * Fetches an athlete's `logs` docs tagged with a `comparisonGroup` (set by
 * the coach on a workout template in workout-builder.tsx, then denormalized
 * onto the log at save time — see workout-log-form.tsx and the Strava
 * auto-match path in athlete-planner-view.tsx) and groups them by that
 * label — "every session of this same repeatable workout, any type."
 *
 * Unlike useWorkoutLactateGroups, this has no `hasLactate` filter: a
 * fartlek or easy run has no lactate readings at all, but still has
 * pace/HR/distance/effort worth comparing session-over-session. That's the
 * whole point of this hook — pace & HR over calendar time, not lactate.
 */

import { useEffect, useMemo, useState } from 'react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { paceToSec, secToPace } from '@/lib/physiology'
import { resolveSessionRepRows, STRUCTURED_WORKOUT_TYPES, mainSetSummary } from '@/lib/strava-lap-matching'

export interface ComparisonLogEntry {
  id: string
  date: string
  workoutTitle?: string
  actualDistance?: number
  actualPace?: string
  averageHeartRate?: number
  effort?: number | null
  durationMin?: number
  assignedWorkoutId?: string
  workoutId?: string
  splitLogs?: { avgHr?: number; pace?: string; rest?: string; setIndex?: number; repIndex?: number; distanceKm?: number; time?: string; heartRate?: number }[]
  /** The workout template's own `type` (intervals/fartlek/long_run/…) —
   *  looked up once per distinct workoutId (same batched-getDoc pattern as
   *  useWorkoutLactateGroups) so the gallery can bucket groups into one
   *  folder per type and pick a type-appropriate session summary. */
  workoutType?: string
  /** The resolved workout's own `.sets` structure — needed to tell
   *  resolveSessionRepRows what each rep's planned distance is, so an
   *  interval session's splitLogs get the SAME raw-vs-rep-shaped
   *  detection and regrouping the Strava box already applies, instead of
   *  averaging raw un-regrouped per-lap Strava data directly. */
  workoutSets?: any[]
  /** Prescribed rest for this session, e.g. "90 שנ'" — from the workout
   *  snapshot that was actually assigned that day (assignedWorkouts.workout),
   *  falling back to the current template if that's unavailable. Only set
   *  when the workout actually has structured rest between reps (an
   *  interval-type session) — a continuous session (fartlek etc.) has none. */
  restLabel?: string | null
}

export interface WorkoutComparisonGroup {
  name: string
  logs: ComparisonLogEntry[]
  /** The group's workout `type` — first one found among its logs' workout
   *  templates. Drives the gallery's folder-by-type grouping and which
   *  summary fields (interval vs fartlek vs long-run vs generic) apply. */
  type?: string
}

/** Which per-type summary shape a comparison group gets. */
export type ComparisonSummaryKind = 'intervals' | 'fartlek' | 'long_run' | 'generic'

/**
 * Which summary shape this group gets. Primary signal is the workout's own
 * `type` — reusing STRUCTURED_WORKOUT_TYPES from lib/strava-lap-matching.ts
 * (the same set that decides whether SplitsTable shows rep-grouped splits
 * at all) so the two can never disagree about what counts as an interval
 * workout. When the template is gone/untyped, fall back to the rest
 * signal — restLabelFromWorkout only ever sets restLabel for a session
 * with reps>1 AND a real rest value, which is exactly what "interval-type"
 * means here.
 */
export function summaryKindForGroup(group: WorkoutComparisonGroup): ComparisonSummaryKind {
  if (group.type && STRUCTURED_WORKOUT_TYPES.has(group.type)) return 'intervals'
  if (group.type === 'fartlek') return 'fartlek'
  if (group.type === 'long_run') return 'long_run'
  if (!group.type && group.logs.some(l => l.restLabel)) return 'intervals'
  return 'generic'
}

/** One session's headline pace/HR/distance — for a Strava activity that
 *  records the ENTIRE session (warmup jog + the real fartlek/tempo effort +
 *  cooldown) as one recording, the coach-reported "an athlete puts the
 *  whole session in one Strava" case: prefers the detected MAIN SET only
 *  (mainSetSummary — the contiguous block of short work/recovery laps,
 *  excluding the much-longer warmup/cooldown laps around it), so the Lab's
 *  session-over-session comparison isn't diluted by slow warmup/cooldown
 *  minutes. Falls back to the logged overall actualPace/averageHeartRate,
 *  then to averaging rep-level splitLogs, exactly as before, whenever no
 *  trim-worthy main set is found (e.g. a plain easy/long run with no
 *  distinguishable structure — nothing to trim, use the whole thing). */
export function sessionSummary(log: ComparisonLogEntry): { paceSec: number | null; hr: number | null; distance: number | null; mainSetDurationMin: number | null } {
  const isRawLaps = !!log.splitLogs?.length && log.splitLogs[0].distanceKm != null
  if (isRawLaps) {
    const main = mainSetSummary(log.splitLogs!)
    if (main && main.distanceKm > 0) {
      return {
        paceSec: Math.round(main.durationSec / main.distanceKm),
        hr: main.avgHr,
        distance: Math.round(main.distanceKm * 100) / 100,
        // The full activity's own log.durationMin (Strava's whole-recording
        // time) would otherwise override this trimmed pace's own duration
        // downstream — this is the trimmed block's real duration instead.
        mainSetDurationMin: Math.round(main.durationSec / 60),
      }
    }
  }

  let paceSec = paceToSec(log.actualPace)
  let hr = log.averageHeartRate ?? null

  if ((paceSec == null || hr == null) && log.splitLogs?.length) {
    const paceVals = log.splitLogs.map(s => paceToSec(s.pace)).filter((v): v is number => v != null)
    const hrVals = log.splitLogs.map(s => s.avgHr).filter((v): v is number => v != null && v > 0)
    if (paceSec == null && paceVals.length) paceSec = Math.round(paceVals.reduce((a, b) => a + b, 0) / paceVals.length)
    if (hr == null && hrVals.length) hr = Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length)
  }
  return { paceSec, hr, distance: log.actualDistance ?? null, mainSetDurationMin: null }
}

export interface ComparisonPoint {
  logId: string
  date: string
  label: string
  paceSec: number | null
  pace: string | null
  hr: number | null
  distance?: number
  effort?: number | null
  /** Minutes, from the log if recorded (Strava), else estimated from
   *  distance × pace when both are present. */
  durationMin?: number | null
  restLabel?: string | null
  /** Mean of this session's rep paces (splitLogs[].pace), sec/km — the
   *  interval-type headline number, distinct from the overall actualPace
   *  which includes warmup/rest for a Strava-sourced log. */
  avgRepPaceSec?: number | null
  avgRepPace?: string | null
  /** Distinct reps logged this session — by (setIndex, repIndex) when the
   *  rows carry them, else simply splitLogs.length. */
  repCount?: number | null
  /** Mean of splitLogs[].avgHr — HR during the reps themselves. */
  avgRepHr?: number | null
  /** Mean ACTUAL logged rest between reps (splitLogs[].rest, from Strava
   *  rest laps or manual entry), in seconds — preferred over the prescribed
   *  restLabel when present. */
  avgRestSec?: number | null
}

/** A logged rest string → seconds: "1:30" (the secToPace format Strava
 *  matching and manual entry both use) or a bare "90". */
function restStrToSec(s?: string | null): number | null {
  if (!s) return null
  const trimmed = String(s).trim()
  const asMinSec = paceToSec(trimmed)
  if (asMinSec != null) return asMinSec
  const bare = trimmed.match(/^\d+$/)
  if (bare) {
    const v = parseInt(trimmed, 10)
    return v > 0 ? v : null
  }
  return null
}

/** distance(km) × pace(sec/km) → whole minutes, for a session with no
 *  directly-logged duration (e.g. a manually-entered fartlek). */
function estimateDurationMin(distanceKm?: number, paceSec?: number | null): number | null {
  if (!distanceKm || !paceSec) return null
  return Math.round((distanceKm * paceSec) / 60)
}

/** The workout's own prescribed rest, only when it's actually an
 *  interval-type session (more than one rep, with a real rest value set) —
 *  a continuous session (fartlek, easy run, tempo) has no such field filled
 *  in at all, which is exactly how it's told apart from an interval one. */
function restLabelFromWorkout(workout: any): string | null {
  if (!workout?.sets?.length) return null
  for (const s of workout.sets) {
    const reps = s?.reps || 1
    const rest = (s?.restBetweenReps || s?.restAfterSet || '').toString().trim()
    if (reps > 1 && rest) return rest
  }
  return null
}

/** One data point per session, oldest to newest — the shape the trend chart
 *  and table both read from. */
export function buildComparisonPoints(group: WorkoutComparisonGroup): ComparisonPoint[] {
  return group.logs.map(log => {
    const { paceSec, hr, distance, mainSetDurationMin } = sessionSummary(log)
    // Rep-level aggregates for the interval-type summary — resolved
    // through the SAME raw-vs-rep-shaped detection + regrouping the
    // Strava box uses (resolveSessionRepRows), not a direct average of
    // log.splitLogs: an interval-type (non-threshold) workout's splitLogs
    // never go through the Lab backfill and stay as raw, un-regrouped
    // per-lap Strava data forever, so averaging them directly reproduced
    // the exact wrong-pace bug already fixed for the Strava box.
    const reps = resolveSessionRepRows(log.splitLogs || [], { sets: log.workoutSets, type: log.workoutType })
    const avgOf = (vals: number[]) => vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : null
    // Distance-weighted, not a plain mean of the rep paces: a threshold
    // session's reps aren't always equal length (e.g. 2000m then 1000m at
    // different paces) — weighting by each rep's own distance gives the
    // true overall pace (total distance ÷ total time), where an unweighted
    // mean would let the shorter rep skew the result just as much as the
    // longer one. Falls back to an unweighted mean when reps carry no
    // numeric distance at all (e.g. a duration-based interval like "3 min").
    const repPaces = reps.map(r => ({ paceSec: paceToSec(r.pace), meters: r.meters })).filter((r): r is { paceSec: number; meters: number | null } => r.paceSec != null)
    const weighted = repPaces.filter(r => r.meters != null && r.meters > 0)
    const avgRepPaceSec = weighted.length === repPaces.length && weighted.length > 0
      ? Math.round(weighted.reduce((sum, r) => sum + r.paceSec * (r.meters as number), 0) / weighted.reduce((sum, r) => sum + (r.meters as number), 0))
      : avgOf(repPaces.map(r => r.paceSec))
    const avgRepHr = avgOf(reps.map(r => r.heartRate).filter((v): v is number => v != null && v > 0))
    const avgRestSec = avgOf(reps.map(r => restStrToSec(r.rest)).filter((v): v is number => v != null))
    const repCount = reps.length || null
    return {
      logId: log.id,
      date: log.date,
      label: log.date,
      paceSec,
      pace: paceSec != null ? secToPace(paceSec) : null,
      hr,
      distance: distance ?? undefined,
      effort: log.effort,
      durationMin: mainSetDurationMin ?? log.durationMin ?? estimateDurationMin(distance ?? undefined, paceSec),
      restLabel: log.restLabel ?? null,
      avgRepPaceSec,
      avgRepPace: avgRepPaceSec != null ? secToPace(avgRepPaceSec) : null,
      repCount,
      avgRepHr,
      avgRestSec,
    }
  })
}

export function useWorkoutComparisonGroups(athleteId: string) {
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<(ComparisonLogEntry & { comparisonGroup: string })[]>([])

  useEffect(() => {
    if (!athleteId) return
    const load = async () => {
      setLoading(true)
      try {
        const snap = await getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId)))
        const raw = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(d => !!d.comparisonGroup)
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''))

        // The prescribed rest for each session comes from the workout
        // snapshot actually assigned that day (assignedWorkouts.workout),
        // not the current template, in case the coach has since edited it —
        // falling back to the current template only when there's no
        // assignedWorkoutId to look up (e.g. an old or Strava-matched log).
        const awIds = Array.from(new Set(raw.filter(d => d.assignedWorkoutId).map(d => d.assignedWorkoutId as string)))
        // ALL distinct workoutIds — not just the assignedWorkoutId-less ones
        // — because every log needs its template's `type` for the gallery's
        // folder-by-type grouping (same batched-getDoc pattern as
        // useWorkoutLactateGroups), even when its rest comes from the
        // assigned-workout snapshot instead.
        const templateIds = Array.from(new Set(raw.filter(d => d.workoutId).map(d => d.workoutId as string)))
        const [awDocs, templateDocs] = await Promise.all([
          Promise.all(awIds.map(id => getDoc(doc(db, 'assignedWorkouts', id)).catch(() => null))),
          Promise.all(templateIds.map(id => getDoc(doc(db, 'workouts', id)).catch(() => null))),
        ])
        const awWorkoutMap = new Map<string, any>()
        awDocs.forEach((s, i) => { if (s?.exists()) awWorkoutMap.set(awIds[i], s.data()?.workout) })
        const templateMap = new Map<string, any>()
        templateDocs.forEach((s, i) => { if (s?.exists()) templateMap.set(templateIds[i], s.data()) })

        const docs = raw.map(d => {
          const workout = d.assignedWorkoutId ? awWorkoutMap.get(d.assignedWorkoutId) : templateMap.get(d.workoutId)
          // Type from the current template first (the coach's source of
          // truth for categorization), falling back to the day's assigned
          // snapshot for a log whose template has since been deleted.
          const workoutType = templateMap.get(d.workoutId)?.type ?? workout?.type
          return { ...d, restLabel: restLabelFromWorkout(workout), workoutType, workoutSets: workout?.sets }
        })
        setLogs(docs)
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [athleteId])

  const grouped = useMemo(() => {
    const map = new Map<string, WorkoutComparisonGroup>()
    for (const log of logs) {
      const key = log.comparisonGroup
      if (!map.has(key)) map.set(key, { name: key, logs: [] })
      const g = map.get(key)!
      g.logs.push(log)
      if (!g.type && log.workoutType) g.type = log.workoutType
    }
    return map
  }, [logs])

  const groupOptions = useMemo(() =>
    Array.from(grouped.entries())
      .map(([id, g]) => ({ id, name: g.name, type: g.type, count: g.logs.length, lastDate: g.logs[g.logs.length - 1]?.date || '' }))
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
    [grouped])

  return { loading, grouped, groupOptions }
}
