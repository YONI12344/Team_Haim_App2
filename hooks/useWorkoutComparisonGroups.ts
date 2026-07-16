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
  splitLogs?: { avgHr?: number; pace?: string }[]
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
}

/** One session's headline pace/HR — prefers the logged overall actualPace /
 *  averageHeartRate, falling back to averaging rep-level splitLogs (the
 *  same reps threshold workouts already record) when the overall fields
 *  weren't filled in. */
export function sessionSummary(log: ComparisonLogEntry): { paceSec: number | null; hr: number | null } {
  let paceSec = paceToSec(log.actualPace)
  let hr = log.averageHeartRate ?? null

  if ((paceSec == null || hr == null) && log.splitLogs?.length) {
    const paceVals = log.splitLogs.map(s => paceToSec(s.pace)).filter((v): v is number => v != null)
    const hrVals = log.splitLogs.map(s => s.avgHr).filter((v): v is number => v != null && v > 0)
    if (paceSec == null && paceVals.length) paceSec = Math.round(paceVals.reduce((a, b) => a + b, 0) / paceVals.length)
    if (hr == null && hrVals.length) hr = Math.round(hrVals.reduce((a, b) => a + b, 0) / hrVals.length)
  }
  return { paceSec, hr }
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
    const { paceSec, hr } = sessionSummary(log)
    return {
      logId: log.id,
      date: log.date,
      label: log.date,
      paceSec,
      pace: paceSec != null ? secToPace(paceSec) : null,
      hr,
      distance: log.actualDistance,
      effort: log.effort,
      durationMin: log.durationMin ?? estimateDurationMin(log.actualDistance, paceSec),
      restLabel: log.restLabel ?? null,
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
        const templateIds = Array.from(new Set(raw.filter(d => !d.assignedWorkoutId && d.workoutId).map(d => d.workoutId as string)))
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
          return { ...d, restLabel: restLabelFromWorkout(workout) }
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
      map.get(key)!.logs.push(log)
    }
    return map
  }, [logs])

  const groupOptions = useMemo(() =>
    Array.from(grouped.entries())
      .map(([id, g]) => ({ id, name: g.name, count: g.logs.length, lastDate: g.logs[g.logs.length - 1]?.date || '' }))
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
    [grouped])

  return { loading, grouped, groupOptions }
}
