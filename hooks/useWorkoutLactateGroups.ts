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
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { format } from 'date-fns'
import { paceToSec, secToPace, personalTargetRangeForLevel, personalTargetRangeWithBaseline, estimateLactateFromHr, estimateLactateAtPace, type LactateStep, type PersonalTargetRange } from '@/lib/physiology'
import { parseRepMeters, buildRepDisplayRows, expectedRepMetersForWorkout, scoreActivityFitForReps, STRUCTURED_WORKOUT_TYPES } from '@/lib/strava-lap-matching'
import type { CurveInput } from '@/components/coach/lactate-multi-curve-chart'

export interface WorkoutRepEntry {
  avgHr?: number
  /** Raw, never-reviewed Strava splits store HR under this key instead of
   *  `avgHr` (see app/api/strava/sync/route.ts) — a threshold session that
   *  auto-matched to a workout but was never opened/saved in
   *  workout-log-form.tsx (which is the only place `heartRate` becomes
   *  `avgHr`) still lands in this hook's query, so both keys have to be
   *  read here or its HR silently disappears. */
  heartRate?: number | null
  /** Present only on raw, never-reviewed Strava splits (never on a reviewed/
   *  manually-entered rep) — the same shape signal resolveSessionRepRows
   *  uses elsewhere; this hook checks it to decide whether a log still
   *  needs rep/rest separation (see resolveRawSplits below). */
  distanceKm?: number
  lactate?: number
  pace?: string
  time?: string
  /** Recovery duration after this rep (e.g. "1:30") — rest length affects
   *  a threshold session's lactate/pace response, so it travels with the
   *  rest of the rep's data instead of being dropped after entry. */
  rest?: string
}

/** A rep's heart rate regardless of which of the two split-log shapes it
 *  came from — see the `heartRate` field comment above. */
function repHr(r: WorkoutRepEntry): number | null {
  return r.avgHr ?? r.heartRate ?? null
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
  /** The specific day's assigned-workout slot this log was matched to, when
   *  known — a more precise "same physical session" key than workoutId
   *  alone (which identifies the recurring TEMPLATE, not a specific day's
   *  execution of it). Falls back to workoutId when absent (older logs). */
  assignedWorkoutId?: string
  splitLogs?: WorkoutRepEntry[]
  /** Rest/recovery laps separated out of a raw Strava session's splits
   *  (see resolveRawSplits) — kept alongside the reps, instead of silently
   *  discarded, so the Lab can show what the recovery looked like too. */
  restLogs?: { time: string; heartRate: number | null; distanceMeters: number | null }[]
  comment?: string
  /** True when any rep of this session has a lactate reading. A threshold
   *  workout logged without testing still belongs in this group (so it's
   *  comparable session-over-session) but has this false. */
  hasLactate?: boolean
}

export interface WorkoutLactateGroup {
  title: string
  logs: WorkoutLactateLog[]
  /** The workout's own `type` (easy/tempo/threshold/interval/repetition/race) —
   *  used to bucket the gallery into one folder per workout type. A
   *  distance-pooled group (e.g. "אימוני סף 1000 מ׳") is always 'threshold'
   *  by construction (see groupKeyFor/inferThresholdDistance); anything else
   *  is looked up from its own workout template. */
  type?: string
}

/** Average lactate/HR/pace across one log's reps — shared by every view
 *  that turns a session's raw reps into one summary point. */
export function averageRepMetrics(reps: WorkoutRepEntry[]): { avgLactate: number | null; avgHr: number | null; avgPace: string | null } {
  const avg = (vals: number[]) => vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null
  const lacVals = reps.map(r => r.lactate).filter((v): v is number => v != null && v > 0)
  const hrVals = reps.map(repHr).filter((v): v is number => v != null && v > 0)
  const paceSecVals = reps.map(r => paceToSec(r.pace)).filter((v): v is number => v != null)
  const avgPaceSec = paceSecVals.length ? Math.round(paceSecVals.reduce((s, v) => s + v, 0) / paceSecVals.length) : null
  return { avgLactate: avg(lacVals), avgHr: avg(hrVals), avgPace: avgPaceSec != null ? secToPace(avgPaceSec) : null }
}

const SESSION_COLORS = ['#e8826b', '#c9a84c', '#6b8fb5', '#8a6bb5', '#4caf8a', '#d4708a', '#c97a4c', '#5c9ab5']

/** A log is still in raw, never-reviewed Strava shape (vs. reviewed/
 *  manually-entered) exactly when its first split carries `distanceKm` —
 *  the same signal resolveSessionRepRows uses. */
function isRawShaped(splitLogs: WorkoutRepEntry[] | undefined): boolean {
  return !!splitLogs?.length && splitLogs[0].distanceKm != null
}

/**
 * When an athlete's watch pauses/restarts mid-session — or logs an
 * unrelated short walk the same day — Strava splits ONE physical workout
 * into several separate `logs` docs, all auto-matched to the same workout
 * slot by athlete-planner-view.tsx's same-day clustering, even though only
 * ONE of them actually contains the real structured session. Concatenating
 * every same-day fragment together was tried and made things WORSE:
 * confirmed directly against production data, a "2000m×3" session's 3 real
 * reps live entirely inside ONE 8.5km fragment, self-contained — a
 * separate same-day 2.4km fragment and an unrelated 601m walk 52 minutes
 * later are NOT part of that session at all, and folding their laps in
 * shifted where the real reps' boundaries landed, corrupting paces that
 * were already correct in each fragment on its own.
 *
 * Instead, pick whichever same-day fragment's OWN laps best fit the
 * workout's rep pattern — scoreActivityFitForReps, the SAME scoring
 * athlete-planner-view.tsx already uses to choose a match in the first
 * place — and use only that one; the other same-day fragments are simply
 * not part of this workout's session data (not merged in as "extra rest"
 * either). Already-reviewed (rep-shaped) logs are never subject to this at
 * all — they're already correct, one document per session. */
export function pickMainSessionFragment(
  logs: WorkoutLactateLog[],
  expectedMetersFor: (workoutId: string) => (number | null)[],
): WorkoutLactateLog[] {
  const passthrough: WorkoutLactateLog[] = []
  const fragmentGroups = new Map<string, WorkoutLactateLog[]>()
  for (const log of logs) {
    if (!isRawShaped(log.splitLogs)) { passthrough.push(log); continue }
    const key = `${log.date}::${log.assignedWorkoutId || log.workoutId}`
    if (!fragmentGroups.has(key)) fragmentGroups.set(key, [])
    fragmentGroups.get(key)!.push(log)
  }
  const picked: WorkoutLactateLog[] = []
  for (const frags of fragmentGroups.values()) {
    if (frags.length === 1) { picked.push(frags[0]); continue }
    const expectedMeters = expectedMetersFor(frags[0].workoutId)
    if (expectedMeters.length === 0) {
      // No rep structure to score fit against — fall back to the longest
      // recording, the same "main fragment" heuristic already used
      // elsewhere (athlete-planner-view.tsx's isMainFragment).
      picked.push(frags.reduce((best, f) => (f.splitLogs?.length ?? 0) > (best.splitLogs?.length ?? 0) ? f : best))
      continue
    }
    let best = frags[0], bestScore = -1
    for (const f of frags) {
      const score = scoreActivityFitForReps(
        (f.splitLogs || []).map(s => ({ distanceKm: s.distanceKm, time: s.time, heartRate: s.heartRate ?? null })),
        expectedMeters,
      )
      if (score > bestScore) { bestScore = score; best = f }
    }
    picked.push(best)
  }
  return [...passthrough, ...picked]
}

/** Separates a raw Strava session's real work reps from the rest/recovery
 *  jogs sitting between them in the same flat splitLogs array (e.g. a GPS
 *  auto-lapping a 2000m rep into 1000m+1000m, with a short, slow recovery
 *  lap before the next one) — mirrors resolveSessionRepRows/
 *  buildRepDisplayRows, which the comparison gallery already uses
 *  (hooks/useWorkoutComparisonGroups.ts) but this hook never did, so a
 *  rest jog's low pace/HR was silently averaged in as if it were its own
 *  real rep. A no-op for already-reviewed (rep-shaped) logs or a workout
 *  with no known rep structure to match against — those pass through
 *  exactly as stored. */
export function resolveRawSplits(log: WorkoutLactateLog, expectedMeters: (number | null)[]): WorkoutLactateLog {
  if (!isRawShaped(log.splitLogs) || expectedMeters.length === 0) return log
  const rows = buildRepDisplayRows(
    (log.splitLogs || []).map(s => ({ distanceKm: s.distanceKm, time: s.time, heartRate: s.heartRate ?? null })),
    expectedMeters,
  )
  const reps: WorkoutRepEntry[] = []
  const restLogs: NonNullable<WorkoutLactateLog['restLogs']> = []
  for (const row of rows) {
    if (row.kind === 'rep') reps.push({ pace: row.pace, heartRate: row.heartRate })
    else restLogs.push({ time: row.time, heartRate: row.heartRate, distanceMeters: row.distanceMeters })
  }
  return { ...log, splitLogs: reps, restLogs }
}

/** Average HR + the most recent interval's own duration across the latest
 *  session's rest/recovery rows — shown next to T1/T2/T3 so a coach can see
 *  what the recovery looked like too, instead of it only being implicitly
 *  discarded. Null for a reviewed/manually-entered session, which never
 *  carries restLogs (see resolveRawSplits — only raw Strava data does). */
export function latestSessionRest(group: WorkoutLactateGroup | undefined): { time: string; hr: number | null } | null {
  const rows = group?.logs[group.logs.length - 1]?.restLogs
  if (!rows?.length) return null
  const secs = rows.map(r => paceToSec(r.time)).filter((v): v is number => v != null)
  const hrs = rows.map(r => r.heartRate).filter((v): v is number => v != null && v > 0)
  return {
    time: secs.length ? secToPace(Math.round(secs.reduce((a, b) => a + b, 0) / secs.length)) : rows[rows.length - 1].time,
    hr: hrs.length ? Math.round(hrs.reduce((a, b) => a + b, 0) / hrs.length) : null,
  }
}

type DistanceSource = { type?: string; thresholdDistance?: number; sets?: { distance?: string }[] }

/** A threshold workout's rep distance — the coach's explicit tag if set,
 *  otherwise parsed from the workout's own rep structure (e.g. "1000m" on
 *  its first set → 1000) so a workout like "8×1000" pools with every other
 *  1000m threshold session without the coach having to remember to tag it.
 *  Uses the SAME parseRepMeters as lib/strava-lap-matching.ts (an
 *  independent inline parser here used to strip all non-digit characters
 *  from the raw string, which silently turned "2 ק״מ" (2km) into "2" —
 *  parsed as 2 METERS instead of 2000, so a genuine "3×2km" threshold
 *  workout got misfiled into a nonsensical "2m" group instead of pooling
 *  with real 2000m sessions, or vanished from the Lab's threshold view
 *  entirely depending on what else keyed off this value) instead of a
 *  second, differently-buggy parser. */
export function inferThresholdDistance(workout: DistanceSource | null | undefined): number | undefined {
  if (!workout) return undefined
  if (workout.thresholdDistance) return workout.thresholdDistance
  if (workout.type !== 'threshold') return undefined
  const meters = parseRepMeters(workout.sets?.[0]?.distance)
  return meters ?? undefined
}

/** The same grouping key `useWorkoutLactateGroups` uses internally — a
 *  threshold workout with a (tagged or inferred) rep distance pools by that
 *  distance, everything else keys by its own workoutId. Callers looking up
 *  "this workout's group" (to find its target/last session) must use this
 *  same key instead of the raw workoutId, or they'll miss a pooled group. */
export function groupKeyFor(workout: DistanceSource | null | undefined, workoutId: string): string {
  const dist = inferThresholdDistance(workout)
  return dist ? `dist-${dist}` : workoutId
}

/** One curve per session/log in a workout group — rep-level points (never
 *  session-averaged), so pace/HR/lactate always come from the same
 *  measurement instead of being paired across different reps. Shared by
 *  the workout gallery, the Lab overview chart, and the per-workout
 *  deep-dive so all three build curves identically. */
export function buildSessionCurves(group: WorkoutLactateGroup, baselineSteps?: LactateStep[] | null): CurveInput[] {
  const canEstimate = !!baselineSteps && baselineSteps.length >= 2
  return group.logs
    .map((log, i) => {
      let anyEstimated = false
      // THIS session's own directly-measured reps — an athlete's
      // pace/HR→lactate relationship on the day can sit noticeably off
      // from an older lab test (fitness/heat/fatigue/hydration all shift
      // it), so a rep tested at 2.4 mmol next to an untested rep at a
      // similar pace/HR is a far better reference for THAT rep than a lab
      // test from a different day: reported directly — two reps tested at
      // 2.1-2.4 mmol, but the lab-test-based estimate put the other
      // (untested, similar-effort) reps at ~1.4-1.7, visibly too low.
      const ownMeasured: LactateStep[] = (log.splitLogs || [])
        .filter(r => r.lactate)
        .map(r => ({ pace: r.pace ?? '', hr: repHr(r), lactate: r.lactate! }))
      const canEstimateFromSession = ownMeasured.length >= 2
      const points = (log.splitLogs || [])
        .map(r => {
          if (r.lactate) return { pace: r.pace ?? null, hr: repHr(r), lactate: r.lactate, label: format(new Date(log.date), 'd/M') }
          // No direct reading for this rep. Preference order:
          // 1. Pace-based, anchored on this session's own nearest real rep
          //    and shaped by the baseline test's per-zone slopes
          //    (estimateLactateAtPace) — pace is the more direct, reliable
          //    correlate ("faster rep ⇒ higher lactate") than HR, which
          //    lags and drifts with fatigue; this is what makes a faster
          //    untested rep come out higher and a slower one lower,
          //    instead of a flat clamp to the nearest tested value.
          // 2. HR-interpolated between this session's own 2+ real
          //    readings, when there's no baseline test to shape a pace
          //    projection from.
          // 3. HR-interpolated against the baseline test directly, when
          //    this session has no real readings of its own at all.
          const paceSec = paceToSec(r.pace)
          const hr = repHr(r)
          const est = (ownMeasured.length >= 1 && canEstimate && paceSec != null)
            ? estimateLactateAtPace(paceSec, ownMeasured, baselineSteps)
            : canEstimateFromSession && hr != null
              ? estimateLactateFromHr(ownMeasured, hr)
              : (canEstimate && hr != null ? estimateLactateFromHr(baselineSteps!, hr) : null)
          if (est != null) {
            anyEstimated = true
            return { pace: r.pace ?? null, hr, lactate: est, label: format(new Date(log.date), 'd/M') }
          }
          return null
        })
        .filter((p): p is NonNullable<typeof p> => p != null)
      return {
        id: log.id,
        label: format(new Date(log.date), 'd/M/yy'),
        color: SESSION_COLORS[i % SESSION_COLORS.length],
        sourceType: 'workout' as const,
        points,
        lactateEstimated: anyEstimated,
      }
    })
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
export function latestSessionSteps(
  group: WorkoutLactateGroup | undefined,
  excludeLogId?: string,
  baselineSteps?: LactateStep[] | null,
): LactateStep[] {
  if (!group) return []
  const candidates = group.logs.filter(l => l.id !== excludeLogId)
  const canEstimate = !!baselineSteps && baselineSteps.length >= 2
  // Prefer the most recent session with a real lactate reading; next, one
  // that at least has HR (so estimateLactateFromHr below has something to
  // work with) if a baseline test is available to estimate against;
  // otherwise the true latest session, whatever it has. Now that untested
  // sessions of the same workout are also in this group (see hasLactate
  // above), the truly latest log might have neither, which would silently
  // lose a still-relevant prior tested/HR session as the reference.
  const withLactate = candidates.filter(l => (l.splitLogs || []).some(r => r.lactate))
  const withHr = canEstimate ? candidates.filter(l => (l.splitLogs || []).some(r => repHr(r) != null)) : []
  const last = withLactate[withLactate.length - 1] ?? withHr[withHr.length - 1] ?? candidates[candidates.length - 1]
  if (!last) return []
  return (last.splitLogs || []).map(r => {
    const hr = repHr(r)
    if (r.lactate) return { pace: r.pace ?? '', hr, lactate: r.lactate }
    if (canEstimate && hr != null) {
      const est = estimateLactateFromHr(baselineSteps!, hr)
      if (est != null) return { pace: r.pace ?? '', hr, lactate: est }
    }
    return { pace: r.pace ?? '', hr, lactate: 0 }
  })
}

/**
 * The athlete's *current* T1/T2/T3 for this specific workout — i.e. the
 * same "last session" data that now drives the dynamic workout target (see
 * workout-log-form.tsx / athlete-planner-view.tsx), surfaced here so the
 * Lab can show it as a headline per workout instead of only implicitly, by
 * reading the most-recent row of the per-session table.
 *
 * A constant-pace workout (e.g. 3×3000 @ T1) only ever samples one narrow
 * lactate band, so it directly hits at most one level — when
 * `baselineSteps` (the athlete's real step test) is passed, the other
 * levels are projected from that test's local slope anchored through this
 * session's actual measurement instead of staying blank. See
 * personalTargetRangeWithBaseline for how that projection works.
 */
export function currentWorkoutThresholds(
  group: WorkoutLactateGroup | undefined,
  baselineSteps?: LactateStep[] | null,
): Record<'T1' | 'T2' | 'T3', PersonalTargetRange | null> {
  const steps = latestSessionSteps(group, undefined, baselineSteps)
  if (baselineSteps && baselineSteps.length >= 2) {
    return {
      T1: personalTargetRangeWithBaseline(steps, baselineSteps, 'T1'),
      T2: personalTargetRangeWithBaseline(steps, baselineSteps, 'T2'),
      T3: personalTargetRangeWithBaseline(steps, baselineSteps, 'T3'),
    }
  }
  return {
    T1: personalTargetRangeForLevel(steps, 'T1'),
    T2: personalTargetRangeForLevel(steps, 'T2'),
    T3: personalTargetRangeForLevel(steps, 'T3'),
  }
}

export function useWorkoutLactateGroups(athleteId: string) {
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<WorkoutLactateLog[]>([])
  const [inferredDistance, setInferredDistance] = useState<Map<string, number>>(new Map())
  const [workoutTypeById, setWorkoutTypeById] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        // No hasLactate filter — a threshold workout logged WITHOUT testing
        // (pace/HR only) still belongs in this gallery so it's comparable
        // session-over-session; it just has nothing to plot on the
        // pace/HR-vs-lactate axis (see buildSessionCurves), and shows a
        // pace/HR-over-time trend instead (see lactate-workout-gallery.tsx).
        const snap = await getDocs(query(
          collection(db, 'logs'),
          where('athleteId', '==', athleteId),
        ))
        const raw = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<WorkoutLactateLog, 'id'>) }))

        // Fetch every distinct workout template ONCE — needed to (a) infer
        // thresholdDistance for an old log that predates that field, (b)
        // confirm a distance-less log's workout is actually type
        // 'threshold' (decides whether it belongs in this gallery at all),
        // and (c) learn the workout's own `type` for the gallery's
        // folder-by-type grouping below — a log can already have
        // thresholdDistance denormalized onto it (skipping (a)/(b)) but
        // still need (c), so this fetches ALL distinct workoutIds, not just
        // the ones missing thresholdDistance.
        const allWorkoutIds = Array.from(new Set(raw.map(d => d.workoutId)))
        const inferredMap = new Map<string, number>()
        const thresholdTypeIds = new Set<string>()
        const typeMap = new Map<string, string>()
        // Each workout's own rep structure — needed to separate a raw
        // Strava session's real reps from its rest/recovery laps (see
        // resolveRawSplits) before anything else reads its splitLogs.
        const setsMap = new Map<string, { distance?: string }[]>()
        if (allWorkoutIds.length > 0) {
          const fetched = await Promise.all(
            allWorkoutIds.map(id => getDoc(doc(db, 'workouts', id)).catch(() => null))
          )
          fetched.forEach((wSnap, i) => {
            if (!wSnap?.exists()) return
            const data = wSnap.data() as DistanceSource
            const dist = inferThresholdDistance(data)
            if (dist) inferredMap.set(allWorkoutIds[i], dist)
            if (data.type === 'threshold') thresholdTypeIds.add(allWorkoutIds[i])
            if (data.type) typeMap.set(allWorkoutIds[i], data.type)
            if (data.sets?.length) setsMap.set(allWorkoutIds[i], data.sets)
          })
          setInferredDistance(inferredMap)
          setWorkoutTypeById(typeMap)
        }

        const filtered = raw
          .filter(d => d.hasLactate || d.thresholdDistance || inferredMap.has(d.workoutId) || thresholdTypeIds.has(d.workoutId))

        const expectedMetersFor = (workoutId: string): (number | null)[] => {
          const sets = setsMap.get(workoutId)
          return sets?.length ? expectedRepMetersForWorkout({ sets }) : []
        }

        // Pick each same-day workout slot's one real fragment (see
        // pickMainSessionFragment above), THEN separate that session's real
        // reps from its rest/recovery laps — see resolveRawSplits. Must
        // happen here, before grouping/sorting, so buildSessionCurves etc.
        // only ever see genuine reps, never a rest jog or an unrelated
        // same-day fragment mixed in as if it were part of the workout.
        const picked = pickMainSessionFragment(filtered, expectedMetersFor)
        const docs = picked
          .map(log => {
            // A distance-pooled log (thresholdDistance tagged or inferred)
            // is always a real threshold workout by construction; anything
            // else needs its own template's type to know whether it has a
            // rep structure worth resolving against at all.
            const type = (log.thresholdDistance || inferredMap.has(log.workoutId)) ? 'threshold' : typeMap.get(log.workoutId)
            if (!type || !STRUCTURED_WORKOUT_TYPES.has(type)) return log
            return resolveRawSplits(log, expectedMetersFor(log.workoutId))
          })
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        setLogs(docs)
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [athleteId])

  // Threshold logs group by rep distance (tagged, or inferred from an old
  // log's workout template) so "20×400" and "12×400" pool into one
  // "אימוני סף 400 מ׳" group instead of staying separate — everything else
  // still groups by the exact workoutId.
  const grouped = useMemo(() => {
    const map = new Map<string, WorkoutLactateGroup>()
    for (const log of logs) {
      const dist = log.thresholdDistance || inferredDistance.get(log.workoutId)
      const key = dist ? `dist-${dist}` : log.workoutId
      const title = dist ? `אימוני סף ${dist} מ׳` : (log.workoutTitle || 'אימון')
      // A distance-pooled group is always a real threshold workout by
      // construction (groupKeyFor/inferThresholdDistance only pool by
      // distance for type 'threshold', or an explicit thresholdDistance
      // tag) — no template lookup needed for those.
      const type = dist ? 'threshold' : workoutTypeById.get(log.workoutId)
      if (!map.has(key)) map.set(key, { title, logs: [], type })
      map.get(key)!.logs.push(log)
    }
    return map
  }, [logs, inferredDistance, workoutTypeById])

  const workoutOptions = useMemo(() =>
    Array.from(grouped.entries())
      .map(([id, g]) => ({ id, title: g.title, type: g.type, lastDate: g.logs[g.logs.length - 1]?.date || '' }))
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
    [grouped])

  return { loading, grouped, workoutOptions }
}
