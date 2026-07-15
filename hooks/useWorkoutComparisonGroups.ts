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
import { collection, getDocs, query, where } from 'firebase/firestore'
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
  splitLogs?: { avgHr?: number; pace?: string }[]
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
        const docs = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as any) }))
          .filter(d => !!d.comparisonGroup)
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
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
