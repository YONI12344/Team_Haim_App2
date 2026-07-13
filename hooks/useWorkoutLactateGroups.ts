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
import { format } from 'date-fns'
import { paceToSec, secToPace, personalTargetRangeForLevel, type LactateStep, type PersonalTargetRange } from '@/lib/physiology'
import type { CurveInput } from '@/components/coach/lactate-multi-curve-chart'

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
  /** Rep distance this session was built around (e.g. 400 for "20×400") —
   *  when set, this log pools with every other threshold log at the same
   *  distance instead of only ones sharing the exact same workoutId. */
  thresholdDistance?: number
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

const SESSION_COLORS = ['#e8826b', '#c9a84c', '#6b8fb5', '#8a6bb5', '#4caf8a', '#d4708a', '#c97a4c', '#5c9ab5']

/** The same grouping key `useWorkoutLactateGroups` uses internally — a
 *  threshold workout with a tagged rep distance pools by that distance,
 *  everything else keys by its own workoutId. Callers looking up "this
 *  workout's group" (to find its target/last session) must use this same
 *  key instead of the raw workoutId, or they'll miss a pooled group. */
export function groupKeyFor(workout: { thresholdDistance?: number } | null | undefined, workoutId: string): string {
  return workout?.thresholdDistance ? `dist-${workout.thresholdDistance}` : workoutId
}

/** One curve per session/log in a workout group — rep-level points (never
 *  session-averaged), so pace/HR/lactate always come from the same
 *  measurement instead of being paired across different reps. Shared by
 *  the workout gallery, the Lab overview chart, and the per-workout
 *  deep-dive so all three build curves identically. */
export function buildSessionCurves(group: WorkoutLactateGroup): CurveInput[] {
  return group.logs
    .map((log, i) => ({
      id: log.id,
      label: format(new Date(log.date), 'd/M/yy'),
      color: SESSION_COLORS[i % SESSION_COLORS.length],
      sourceType: 'workout' as const,
      points: (log.splitLogs || [])
        .filter(r => r.lactate || r.avgHr || r.pace)
        .map(r => ({ pace: r.pace ?? null, hr: r.avgHr ?? null, lactate: r.lactate ?? 0, label: format(new Date(log.date), 'd/M') })),
    }))
    .filter(c => c.points.length > 0)
}

/**
 * The athlete's most recent *past* session of this same workout, as raw
 * {pace, hr, lactate} steps — so a workout's target can be recomputed from
 * "how did I do last time on this exact workout" instead of only a lab
 * test. `excludeLogId` drops the session currently being edited (so it
 * never references itself as "the previous one"). Returns [] when there's
 * no qualifying prior session.
 */
export function latestSessionSteps(group: WorkoutLactateGroup | undefined, excludeLogId?: string): LactateStep[] {
  if (!group) return []
  const candidates = group.logs.filter(l => l.id !== excludeLogId)
  const last = candidates[candidates.length - 1]
  if (!last) return []
  return (last.splitLogs || []).map(r => ({ pace: r.pace ?? '', hr: r.avgHr ?? null, lactate: r.lactate ?? 0 }))
}

/**
 * The athlete's *current* T1/T2/T3 for this specific workout — i.e. the
 * same "last session" data that now drives the dynamic workout target (see
 * workout-log-form.tsx / athlete-planner-view.tsx), surfaced here so the
 * Lab can show it as a headline per workout instead of only implicitly, by
 * reading the most-recent row of the per-session table. Each level is
 * null when the athlete's last session didn't span that mmol range.
 */
export function currentWorkoutThresholds(group: WorkoutLactateGroup | undefined): Record<'T1' | 'T2' | 'T3', PersonalTargetRange | null> {
  const steps = latestSessionSteps(group)
  return {
    T1: personalTargetRangeForLevel(steps, 'T1'),
    T2: personalTargetRangeForLevel(steps, 'T2'),
    T3: personalTargetRangeForLevel(steps, 'T3'),
  }
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

  // Threshold logs group by rep distance when tagged (so "20×400" and
  // "12×400" pool into one "אימוני סף 400 מ׳" group instead of staying
  // separate) — everything else still groups by the exact workoutId.
  const grouped = useMemo(() => {
    const map = new Map<string, WorkoutLactateGroup>()
    for (const log of logs) {
      const key = log.thresholdDistance ? `dist-${log.thresholdDistance}` : log.workoutId
      const title = log.thresholdDistance ? `אימוני סף ${log.thresholdDistance} מ׳` : (log.workoutTitle || 'אימון')
      if (!map.has(key)) map.set(key, { title, logs: [] })
      map.get(key)!.logs.push(log)
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
