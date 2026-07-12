'use client'

/**
 * Fetches an athlete's `logs` docs that carry at least one rep-level
 * lactate reading (`hasLactate: true`, set by
 * components/athlete/workout-log-form.tsx) and groups them by `workoutId`
 * — i.e. "every session of this same recurring workout." Shared by
 * components/coach/athlete-physiology.tsx (as a curve-source option
 * alongside real step tests) and components/coach/athlete-workout-progress.tsx
 * (the per-workout-type session table), so the query/grouping isn't
 * duplicated between them.
 */

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { paceToSec, secToPace } from '@/lib/physiology'

export interface WorkoutRepEntry {
  avgHr?: number
  lactate?: number
  pace?: string
  time?: string
}

export interface WorkoutLactateLog {
  id: string
  workoutId: string
  workoutTitle?: string
  date: string
  splitLogs?: WorkoutRepEntry[]
  comment?: string
}

export interface WorkoutLactateGroup {
  title: string
  logs: WorkoutLactateLog[]
}

/** Average lactate/HR/pace across one log's reps — shared by every view
 *  that turns a session's raw reps into one summary point. */
export function averageRepMetrics(reps: WorkoutRepEntry[]): { avgLactate: number | null; avgHr: number | null; avgPace: string | null } {
  const avg = (vals: number[]) => vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null
  const lacVals = reps.map(r => r.lactate).filter((v): v is number => v != null && v > 0)
  const hrVals = reps.map(r => r.avgHr).filter((v): v is number => v != null && v > 0)
  const paceSecVals = reps.map(r => paceToSec(r.pace)).filter((v): v is number => v != null)
  const avgPaceSec = paceSecVals.length ? Math.round(paceSecVals.reduce((s, v) => s + v, 0) / paceSecVals.length) : null
  return { avgLactate: avg(lacVals), avgHr: avg(hrVals), avgPace: avgPaceSec != null ? secToPace(avgPaceSec) : null }
}

export function useWorkoutLactateGroups(athleteId: string) {
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<WorkoutLactateLog[]>([])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const snap = await getDocs(query(
          collection(db, 'logs'),
          where('athleteId', '==', athleteId),
          where('hasLactate', '==', true),
        ))
        const docs = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<WorkoutLactateLog, 'id'>) }))
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        setLogs(docs)
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [athleteId])

  const grouped = useMemo(() => {
    const map = new Map<string, WorkoutLactateGroup>()
    for (const log of logs) {
      if (!map.has(log.workoutId)) map.set(log.workoutId, { title: log.workoutTitle || 'אימון', logs: [] })
      map.get(log.workoutId)!.logs.push(log)
    }
    return map
  }, [logs])

  const workoutOptions = useMemo(() =>
    Array.from(grouped.entries())
      .map(([id, g]) => ({ id, title: g.title, lastDate: g.logs[g.logs.length - 1]?.date || '' }))
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
    [grouped])

  return { loading, grouped, workoutOptions }
}
