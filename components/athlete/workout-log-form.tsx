'use client'

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  limit,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CheckCircle2, Loader2, Activity, ChevronLeft, Plus, X as XIcon } from 'lucide-react'
import { ManualLogCard } from '@/components/shared/manual-log-card'
import type { WorkoutLog, Workout, SplitLog } from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useLanguage } from '@/contexts/language-context'
import { useAuth } from '@/contexts/auth-context'
import { isCoachEmail } from '@/lib/constants'
import { useLatestStepTest } from '@/hooks/useLatestStepTest'
import { useWorkoutLactateGroups, latestSessionSteps, groupKeyFor, inferThresholdDistance } from '@/hooks/useWorkoutLactateGroups'
import { personalTargetRangeForLevel, personalTargetRangeWithBaseline, formatTargetRange, paceToSec, secToPace } from '@/lib/physiology'
import { parseRepMeters, buildRepDisplayRows, expectedRepMetersForWorkout, scoreActivityFitForReps } from '@/lib/strava-lap-matching'

interface WorkoutLogFormProps {
  workoutId: string
  assignedWorkoutId?: string
  athleteId: string
  scheduledDate: string
  workout?: Workout
}

export function WorkoutLogForm({ workoutId, assignedWorkoutId, athleteId, scheduledDate, workout }: WorkoutLogFormProps) {
  const { t } = useLanguage()
  const { user } = useAuth()
  // The coach can also open this form while reviewing an athlete's page — a
  // Cloud Function trigger (functions/src/index.ts) notifies the coach on
  // every athlete-side save, so a coach's OWN save must be tagged to skip
  // that notification instead of pinging them about their own action.
  const isCoachViewer = isCoachEmail(user?.email)
  const { steps: latestSteps } = useLatestStepTest(workout?.targetThresholdLevel ? athleteId : undefined)
  const { grouped: workoutGroups } = useWorkoutLactateGroups(workout?.targetThresholdLevel ? athleteId : '')
  const [targetOverride, setTargetOverride] = useState<{ paceMinSec: number; paceMaxSec: number; hrMin?: number; hrMax?: number } | null>(null)
  const [existingLog, setExistingLog] = useState<WorkoutLog | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const [actualDistance, setActualDistance] = useState('')
  const [actualPace, setActualPace] = useState('')
  const [effort, setEffort] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [splitLogs, setSplitLogs] = useState<SplitLog[]>([])
  // Lactate is asked about once for the whole session (not a box on every
  // single rep, which gets noisy for a 20-rep workout) — "yes" reveals a
  // small add-a-reading list keyed by rep number, so the athlete only fills
  // in the reps they actually tested.
  const [testedLactate, setTestedLactate] = useState(false)
  const [lactateReadings, setLactateReadings] = useState<{ repNumber: string; value: string }[]>([])
  const [stravaFilling, setStravaFilling] = useState(false)
  const [stravaFilled, setStravaFilled] = useState(false)
  const [stravaSource, setStravaSource] = useState<null | {
    stravaName: string
    averageHeartRate: number | null
    elevationGain: number | null
    splitLogs: any[]
  }>(null)

  const handleFillFromStrava = async () => {
    setStravaFilling(true)
    try {
      const { collection, query, where, getDocs } = await import('firebase/firestore')
      const { db } = await import('@/lib/firebase')
      const q = query(
        collection(db, 'logs'),
        where('athleteId', '==', athleteId),
        where('date', '==', scheduledDate),
        where('source', '==', 'strava')
      )
      const snap = await getDocs(q)
      if (snap.empty) {
        toast.error(t.stravaNotFoundError)
        return
      }
      const activities = snap.docs.map(d => d.data())
      const best = activities.sort((a, b) => (b.actualDistance || 0) - (a.actualDistance || 0))[0]
      if (best.actualDistance) setActualDistance(String(best.actualDistance))
      if (best.actualPace) setActualPace(best.actualPace)
      setStravaFilled(true)
    } catch (err) {
      console.error('Strava fill error:', err)
      toast.error(t.stravaLoadError)
    } finally {
      setStravaFilling(false)
    }
  }

  const hasSets = workout?.sets && workout.sets.length > 0

  // Build initial split logs from workout sets
  useEffect(() => {
    if (!hasSets || splitLogs.length > 0) return
    const initial: SplitLog[] = []
    workout!.sets!.forEach((set, si) => {
      const intervals = (set as any).intervals
      const reps = set.reps || 1
      if (intervals && intervals.length > 0) {
        // For each rep, create one entry per interval
        for (let r = 0; r < reps; r++) {
          intervals.forEach((interval: any, ii: number) => {
            initial.push({ setIndex: si, repIndex: r * 1000 + ii, distance: interval.distance || interval.duration || '', time: '', pace: '', notes: '' })
          })
        }
      } else {
        for (let r = 0; r < reps; r++) {
          initial.push({ setIndex: si, repIndex: r, distance: set.distance || set.duration || '', time: '', pace: '', notes: '' })
        }
      }
    })
    setSplitLogs(initial)
  }, [workout])

  useEffect(() => {
    const loadLog = async () => {
      try {
        // Prefer matching by assignedWorkoutId — unique per assignment, so
        // reassigning the same recurring workout template to a new date
        // doesn't collide with a previous occurrence's log (workoutId alone
        // is reused across dates for recurring sessions, e.g. "20x400").
        let matchedDoc: any = undefined
        if (assignedWorkoutId) {
          // A warmup/main-event/cooldown recorded as SEPARATE Strava
          // activities can all legitimately share this same
          // assignedWorkoutId (that's the whole point of the same-session
          // clustering in athlete-planner-view.tsx) — picking an arbitrary
          // one here (the old `limit(1)`) could just as easily grab the
          // warmup's laps as the real effort's. The longest-distance one
          // is the main event; that's the one whose laps should fill this
          // workout's rep splits.
          const snap = await getDocs(query(
            collection(db, 'logs'),
            where('assignedWorkoutId', '==', assignedWorkoutId),
            where('athleteId', '==', athleteId),
          ))
          matchedDoc = snap.docs.reduce((best: any, d: any) =>
            (!best || (d.data().actualDistance || 0) > (best.data().actualDistance || 0)) ? d : best, undefined)
        }

        // Fall back to workoutId+athleteId+date (legacy logs saved before
        // assignedWorkoutId was tracked, or call sites without it) — scoped
        // to this exact date so it can't pick up a different occurrence of
        // the same recurring template.
        if (!matchedDoc) {
          const snap = await getDocs(query(
            collection(db, 'logs'),
            where('workoutId', '==', workoutId),
            where('athleteId', '==', athleteId),
            where('date', '==', scheduledDate),
            limit(1)
          ))
          matchedDoc = snap.docs[0]
        }

        // If still nothing, fall back to a Strava log for the same date —
        // this prevents workout-log-form from creating a second document
        // alongside an existing Strava log (which has workoutId
        // 'strava_<id>', not the template id). When the athlete had TWO+
        // sessions that day (e.g. easy AM run + evening threshold workout,
        // or a separately-recorded warmup/cooldown either side of the
        // actual interval session) and the auto-match in
        // athlete-planner-view.tsx didn't manage to tag the right one with
        // this assignedWorkoutId, there can be more than one Strava log for
        // the same date — picking an arbitrary one here would fill a
        // threshold workout's rep splits from the wrong activity entirely.
        //
        // For a structured workout (has its own reps), prefer whichever
        // candidate's OWN laps actually fit that rep pattern (scored via
        // scoreActivityFitForReps) — a continuous warmup/cooldown jog won't
        // have laps clustering near any rep distance/pace, so it scores
        // near zero and loses to the real interval activity even if it
        // happens to be numerically closer on total distance alone. Ties
        // (or a continuous workout with no rep structure to score against)
        // fall back to whichever total distance is closest to planned.
        if (!matchedDoc && scheduledDate) {
          const stravaSnap = await getDocs(query(
            collection(db, 'logs'),
            where('athleteId', '==', athleteId),
            where('date', '==', scheduledDate),
            where('source', '==', 'strava'),
          ))
          if (stravaSnap.docs.length <= 1) {
            matchedDoc = stravaSnap.docs[0]
          } else {
            const expectedMeters = expectedRepMetersForWorkout(workout)
            const plannedDist = workout?.distance
            let bestScore = -1
            let bestDiff = Infinity
            for (const d of stravaSnap.docs) {
              const data = d.data()
              const repScore = expectedMeters.length ? scoreActivityFitForReps(data.splitLogs || [], expectedMeters) : 0
              const diff = plannedDist != null ? Math.abs((data.actualDistance || 0) - plannedDist) : Infinity
              if (repScore > bestScore || (repScore === bestScore && diff < bestDiff)) {
                bestScore = repScore
                bestDiff = diff
                matchedDoc = d
              }
            }
          }
        }

        if (matchedDoc) {
          const logData = matchedDoc.data()
          const effortNum = legacyEffortToNumber(logData.effort)
          const log: WorkoutLog = {
            id: matchedDoc.id,
            athleteId: logData.athleteId || athleteId,
            workoutId: logData.workoutId || workoutId,
            date: logData.date || scheduledDate,
            actualDistance: logData.actualDistance ?? undefined,
            actualPace: logData.actualPace ?? undefined,
            effort: effortNum,
            comment: logData.comment || '',
            splitLogs: logData.splitLogs || [],
            createdAt: logData.createdAt?.toDate?.() || new Date(),
          }
          setExistingLog(log)
          setActualDistance(log.actualDistance?.toString() || '')
          setActualPace(log.actualPace || '')
          setEffort(log.effort)
          setComment(log.comment)
          if (logData.source === 'strava') {
            setStravaSource({
              stravaName: logData.stravaName || '',
              averageHeartRate: logData.averageHeartRate || null,
              elevationGain: logData.elevationGain || null,
              splitLogs: Array.isArray(logData.splitLogs) ? logData.splitLogs : [],
            })
            // Only collapse if athlete already added effort feedback
            if (log.effort) {
              setSaved(true)
              setCollapsed(true)
            }
          } else {
            if (log.splitLogs && log.splitLogs.length > 0) {
              setSplitLogs(log.splitLogs)
              const readings = log.splitLogs
                .map((s, i) => ({ repNumber: String(i + 1), value: s.lactate ? String(s.lactate) : '' }))
                .filter(r => r.value !== '')
              if (readings.length > 0) {
                setTestedLactate(true)
                setLactateReadings(readings)
              }
            }
            setSaved(true)
            setCollapsed(true)
          }
        }
      } catch (error) {
        console.error('Error loading workout log:', error)
      } finally {
        setLoading(false)
      }
    }
    loadLog()
  }, [workoutId, athleteId, scheduledDate])

  // Coach's manual override of this specific assignment's target, if any —
  // takes precedence over the auto-computed range (see the target badge below).
  useEffect(() => {
    if (!assignedWorkoutId || !workout?.targetThresholdLevel) { setTargetOverride(null); return }
    getDoc(doc(db, 'assignedWorkouts', assignedWorkoutId))
      .then(snap => setTargetOverride(snap.data()?.targetOverride ?? null))
      .catch(err => { console.error(err); setTargetOverride(null) })
  }, [assignedWorkoutId, workout?.targetThresholdLevel])

  // Pre-fill (still editable) pace/HR/rest per rep from matched Strava laps —
  // buildRepDisplayRows combines consecutive auto-laps by distance+time (e.g.
  // a 1.6km rep recorded as two 1km auto-laps) into one rep row, and keeps
  // every rest/recovery lap as its own row in between instead of dropping
  // it — a rep's pace comes from its own combined data instead of whichever
  // lap happened to land at that index, and the recovery AFTER a rep is
  // carried onto that same rep's `rest` field. Rest length is part of a
  // threshold session's real shape (too little/too much recovery changes
  // the lactate/pace response), so it's captured here rather than shown
  // once in the Strava view and lost. Not further verified beyond that;
  // just a default the athlete can correct. Uses the functional
  // setSplitLogs form so it's safe regardless of whether this runs before
  // or after the sets-seeding effect.
  //
  // Time/pace/HR prefill runs for every workout with a rep structure — a
  // fartlek/tempo/easy run legitimately wants its real recorded pace/time/
  // HR filled in per rep too, same as a genuine interval session. REST is
  // the one field gated, and not by type (a type-wide gate turned out too
  // broad: it also blocked a genuinely-structured intervals workout whose
  // stored `type` string didn't happen to match STRUCTURED_WORKOUT_TYPES
  // exactly, silently breaking prefill for it entirely — reported directly
  // as "worse now, not even finding warmup/cooldown anymore"). Instead,
  // gate rest on the workout's OWN definition: only inject a computed rest
  // value when at least one of its sets actually configures
  // restBetweenReps/restAfterSet — "you will know from the workout's own
  // detail" whether rest is part of the plan at all, exactly as reported.
  // A fartlek with no rest defined anywhere in its structure never gets
  // one fabricated from a misread slow GPS lap; a real interval session
  // that DOES define rest still gets its real recorded rest filled in.
  useEffect(() => {
    if (!stravaSource?.splitLogs?.length) return
    const definesRest = (workout?.sets || []).some((s: any) => s.restBetweenReps || s.restAfterSet)
    setSplitLogs(prev => {
      const expectedMeters = prev.map(s => parseRepMeters(s.distance))
      const rows = buildRepDisplayRows(stravaSource.splitLogs, expectedMeters)
      const matched = new Map<number, Extract<typeof rows[number], { kind: 'rep' }>>()
      const restAfter = new Map<number, string>()
      let lastRepIndex: number | null = null
      for (const row of rows) {
        if (row.kind === 'rep') { matched.set(row.repIndex, row); lastRepIndex = row.repIndex }
        else if (lastRepIndex != null && !restAfter.has(lastRepIndex)) restAfter.set(lastRepIndex, row.time)
      }
      return prev.map((s, i) => {
        const lap = matched.get(i)
        const rest = definesRest ? restAfter.get(i) : undefined
        if (!lap && !rest) return s
        return {
          ...s,
          // elapsedSec was already being computed (it's exactly what
          // SplitsTable shows as this rep's "time" in the Strava view) but
          // was never actually copied into the form's own time field, so
          // it always showed blank here even when the Strava box next to
          // it displayed a real value.
          time: s.time || (lap ? secToPace(lap.elapsedSec) : '') || '',
          pace: s.pace || lap?.pace || '',
          avgHr: s.avgHr || lap?.heartRate || undefined,
          rest: s.rest || rest || '',
        }
      })
    })
  }, [stravaSource, workout?.sets])

  const updateSplit = useCallback((index: number, field: keyof SplitLog, value: string) => {
    // Numeric SplitLog fields (avgHr, lactate, ...) are edited as plain text
    // in the inputs below and only parsed to Number() at save time — the
    // cast keeps the draft state loose without a second parallel shape.
    setSplitLogs(prev => prev.map((s, i) => i === index ? ({ ...s, [field]: value } as SplitLog) : s))
  }, [])

  const handleSave = async () => {
    if (!effort || effort < 1 || effort > 10) {
      toast.error(t.toastEffortRequired)
      return
    }
    let parsedDistance: number | null = null
    if (actualDistance.trim() !== '') {
      const n = parseFloat(actualDistance)
      if (!Number.isFinite(n) || n < 0) {
        toast.error(t.toastDistanceInvalid)
        return
      }
      parsedDistance = n
    }
    setSaving(true)
    const isUpdate = !!existingLog?.id
    try {
      // The `workout` prop is a snapshot embedded in the assignedWorkouts
      // doc at assignment time — if the coach tags a comparisonGroup onto
      // the template AFTER a session was already assigned, that snapshot
      // won't have it. Re-fetch the live template so the group tag always
      // applies retroactively instead of only to newly-assigned sessions.
      let liveComparisonGroup = workout?.comparisonGroup || null
      try {
        const wSnap = await getDoc(doc(db, 'workouts', workoutId))
        if (wSnap.exists()) liveComparisonGroup = (wSnap.data() as Workout).comparisonGroup || null
      } catch (e) { console.error('Error fetching live workout for comparisonGroup:', e) }

      // Apply the "which reps did you test" answers onto the matching
      // splitLogs entries (1-based rep number → array index) instead of a
      // lactate box sitting on every single rep.
      const lactateByRep = new Map<number, number>()
      if (testedLactate) {
        for (const r of lactateReadings) {
          const repNum = parseInt(r.repNumber, 10)
          const value = parseFloat(r.value)
          if (repNum >= 1 && repNum <= splitLogs.length && Number.isFinite(value) && value > 0) {
            lactateByRep.set(repNum, value)
          }
        }
      }
      const splitLogsWithLactate = splitLogs.map((s, i) => ({ ...s, lactate: lactateByRep.get(i + 1) }))

      // s.distance is seeded from the workout template for EVERY real rep
      // (see the initial-splitLogs effect above) regardless of whether
      // Strava's prefill ever ran — dropping it from this check meant a
      // rep with no manually-entered field yet (pace/time hadn't been
      // prefilled, no lactate typed in for THIS rep) looked "empty" and
      // got discarded entirely, even though it's a real rep of the
      // workout. That's what turned "typed lactate into 2 of 5 reps" into
      // "only 2 splits survive save, with no pace" — the other 3 real
      // reps (and their own already-prefilled pace) were silently
      // dropped, not just left without a lactate value.
      const finalSplitLogs = splitLogsWithLactate
        .filter(s => s.time || s.pace || s.notes || s.avgHr || s.lactate || s.rest || s.distance)
        .map(s => ({
          ...s,
          // Firestore's updateDoc/addDoc reject a literal `undefined` field
          // anywhere, including nested inside an array — must be `null`
          // (or the key omitted) for a rep with no HR/lactate reading.
          avgHr: s.avgHr ? Number(s.avgHr) : null,
          lactate: s.lactate ? Number(s.lactate) : null,
        }))
      // Denormalized so the Lab's per-workout progress view
      // (components/coach/athlete-workout-progress.tsx) can group/label
      // logs and query cheaply without extra reads or fetching every log.
      const hasLactate = finalSplitLogs.some(s => s.lactate)
      const baseData = {
        athleteId,
        workoutId,
  assignedWorkoutId,
        date: scheduledDate,
        actualDistance: parsedDistance,
        actualPace: actualPace.trim() || null,
        effort,
        comment,
        splitLogs: finalSplitLogs,
        workoutTitle: workout?.title || null,
        thresholdDistance: inferThresholdDistance(workout) ?? null,
        comparisonGroup: liveComparisonGroup,
        hasLactate,
        // Cloud Function notifyCoachOnLogChange (functions/src/index.ts)
        // skips a write tagged 'coach' so the coach never gets notified
        // about their own save when reviewing this form on an athlete's
        // behalf — everything else notifies as an athlete update.
        lastEditedByRole: isCoachViewer ? 'coach' : 'athlete',
      }
      if (isUpdate) {
        const updatePayload: any = { ...baseData, updatedAt: serverTimestamp() }
        if (stravaSource) updatePayload.feedbackStatus = 'completed'
        await updateDoc(doc(db, 'logs', existingLog!.id), updatePayload)
        setExistingLog({ ...existingLog!, actualDistance: parsedDistance ?? undefined, actualPace: baseData.actualPace ?? undefined, effort, comment, splitLogs: baseData.splitLogs })
      } else {
        const docRef = await addDoc(collection(db, 'logs'), { ...baseData, createdAt: serverTimestamp() })
        setExistingLog({ id: docRef.id, athleteId, workoutId, date: scheduledDate, actualDistance: parsedDistance ?? undefined, actualPace: baseData.actualPace ?? undefined, effort, comment, splitLogs: baseData.splitLogs, createdAt: new Date() })
      }
      try {
        if (assignedWorkoutId) {
          await updateDoc(doc(db, 'assignedWorkouts', assignedWorkoutId), { status: 'completed', completedAt: serverTimestamp() })
        } else {
          const awQuery = await getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId), where('workoutId', '==', workoutId), where('scheduledDate', '==', scheduledDate)))
          if (!awQuery.empty) {
            await updateDoc(doc(db, 'assignedWorkouts', awQuery.docs[0].id), { status: 'completed', completedAt: serverTimestamp() })
          }
        }
      } catch (e) { console.error(e) }

      setSaved(true)
      setCollapsed(true)
      toast.success(t.toastWorkoutLogged)

      // Coach notification is handled server-side now (Cloud Function
      // notifyCoachOnLogChange, functions/src/index.ts) — it fires on
      // every logs write regardless of which UI path made it or whether
      // this tab stays open long enough for a client-side fetch to land,
      // instead of each save site sending its own fire-and-forget push.
    } catch (error) {
      console.error('Error saving workout log:', error)
      toast.error(t.toastSaveLogFailed)
    } finally {
      setSaving(false)
    }
  }

  if (collapsed) {
    return (
      <div className="mt-4 pt-4 border-t border-border/40">
        <ManualLogCard
          distance={actualDistance ? parseFloat(actualDistance) : null}
          pace={actualPace || null}
          effort={effort}
          comment={comment}
          splitLogs={splitLogs}
          onEdit={() => setCollapsed(false)}
        />
      </div>
    )
  }

  if (loading) {
    return <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="mt-5 pt-5 border-t border-border/40 space-y-6">
      <div className="flex items-center justify-between">
        <h4 className="font-bold text-navy text-base">
          {stravaSource ? t.howDidYouFeelStrava : t.workoutLogHeading}
        </h4>
        {saved && (
          <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            <span>{t.loggedBadge}</span>
          </div>
        )}
      </div>

      {/* Strava activity card — shown when log came from Strava */}
      {stravaSource && (
        <div className="rounded-2xl border border-border overflow-hidden shadow-sm" dir="rtl">
          <div className="px-4 py-3 flex items-center gap-3 bg-[#FC4C02]/5 border-b border-border/50">
            <div className="h-9 w-9 rounded-xl bg-[#FC4C02] flex items-center justify-center flex-shrink-0">
              <Activity className="h-4 w-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-navy truncate">
                {stravaSource.stravaName || t.stravaWorkoutName}
              </p>
              <p className="text-[11px] text-muted-foreground">{t.syncedFromStrava}</p>
            </div>
          </div>
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {actualDistance && (
              <span className="text-xs font-semibold bg-muted px-3 py-1.5 rounded-full">{actualDistance} km</span>
            )}
            {actualPace && (
              <span className="text-xs font-semibold bg-muted px-3 py-1.5 rounded-full">{actualPace}</span>
            )}
            {stravaSource.averageHeartRate && (
              <span className="text-xs font-semibold bg-red-50 text-red-600 border border-red-100 px-3 py-1.5 rounded-full">{stravaSource.averageHeartRate} bpm</span>
            )}
            {stravaSource.elevationGain != null && stravaSource.elevationGain > 0 && (
              <span className="text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 px-3 py-1.5 rounded-full">+{stravaSource.elevationGain}m</span>
            )}
          </div>
          {/* Raw lap scroller — only when there's no coach-planned structure
              to show the same data against (see the structured splits
              section below, which reuses this same lap data per rep). */}
          {!hasSets && stravaSource.splitLogs && stravaSource.splitLogs.length > 0 && (
            <div className="px-4 pb-3 overflow-x-auto" dir="ltr">
              <div className="flex gap-2 w-max">
                {stravaSource.splitLogs.slice(0, 20).map((split: any, i: number) => (
                  <div key={i} className="flex-shrink-0 rounded-xl border border-border bg-muted/30 px-3 py-2 text-center min-w-[64px]">
                    <p className="text-[10px] font-semibold text-muted-foreground mb-0.5">
                      {split.lapIndex ? `Lap ${split.lapIndex}` : `km ${i + 1}`}
                    </p>
                    <p className="text-xs font-bold text-navy">{split.pace || split.time}</p>
                    {split.heartRate && (
                      <p className="text-[10px] text-red-500">{split.heartRate} bpm</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Structured splits — one row per rep, with time + pace/HR (pre-filled,
          editable, from a matched Strava lap when available) + an optional
          lactate reading. Shown whenever the workout has planned reps,
          Strava-sourced or not. */}
      {hasSets && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.intervalLogTitle}</p>
            {workout?.targetThresholdLevel && (() => {
              const metrics: ('pace' | 'hr' | 'lactate')[] = workout.targetMetrics?.length ? workout.targetMetrics : ['pace', 'hr', 'lactate']
              // Prefer the athlete's own last completed session of this exact
              // workout over the (possibly months-old) lab test — the target
              // should self-adapt session to session.
              const recentRange = !targetOverride
                ? personalTargetRangeWithBaseline(latestSessionSteps(workoutGroups.get(groupKeyFor(workout, workoutId)), existingLog?.id, latestSteps), latestSteps, workout.targetThresholdLevel)
                : null
              const source: 'override' | 'recent' | 'lab' = targetOverride ? 'override' : recentRange ? 'recent' : 'lab'
              const range = targetOverride
                ? { paceRangeSec: [targetOverride.paceMinSec, targetOverride.paceMaxSec] as [number, number],
                    hrRange: targetOverride.hrMin != null && targetOverride.hrMax != null ? [targetOverride.hrMin, targetOverride.hrMax] as [number, number] : null }
                : recentRange || personalTargetRangeForLevel(latestSteps, workout.targetThresholdLevel)
              if (!range) {
                return (
                  <span className="text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                    {workout.targetThresholdLevel} — אין עדיין נתוני מעבדה
                  </span>
                )
              }
              const lactateMid = source === 'lab' || source === 'recent' ? (range as any).lactateMid : undefined
              const sourceTag = source === 'recent'
                ? ((range as any).extrapolated ? ' · מוערך משיפוע הבדיקה' : ' · מהאימון הקודם')
                : source === 'lab' ? ' · מבדיקת מעבדה' : ' · ✏️'
              return (
                <span className="text-[11px] font-semibold bg-navy/5 border border-navy/10 px-2 py-0.5 rounded-full whitespace-nowrap" dir="ltr">
                  {workout.targetThresholdLevel} · {formatTargetRange(range, metrics, lactateMid)}{sourceTag}
                </span>
              )
            })()}
          </div>

          {/* Threshold workouts only — moved to the TOP of this section
              instead of buried after a long list of rep rows, and given a
              gold accent so it's not missed: asked once for the whole
              session, not a box on every rep (which gets noisy for a
              20-rep workout). "Yes" reveals a small add-a-reading list
              keyed by rep number. */}
          {workout?.type === 'threshold' && (
          <div className="rounded-2xl border-2 border-gold/40 bg-gold/5 p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-bold text-navy">🧪 {t.testedLactateQuestion}</p>
              <div className="flex gap-1 bg-white rounded-xl p-0.5 border border-gold/30">
                <button type="button" onClick={() => setTestedLactate(false)}
                  className={cn('text-xs px-3 py-1 rounded-lg font-semibold transition-all',
                    !testedLactate ? 'bg-gold text-navy shadow-sm' : 'text-muted-foreground')}>
                  {t.no}
                </button>
                <button type="button" onClick={() => {
                    setTestedLactate(true)
                    if (lactateReadings.length === 0) setLactateReadings([{ repNumber: '', value: '' }])
                  }}
                  className={cn('text-xs px-3 py-1 rounded-lg font-semibold transition-all',
                    testedLactate ? 'bg-gold text-navy shadow-sm' : 'text-muted-foreground')}>
                  {t.yes}
                </button>
              </div>
            </div>
            {testedLactate && (
              <div className="space-y-2">
                <p className="text-[10px] text-muted-foreground">{t.repNumberHint} (1–{splitLogs.length})</p>
                {lactateReadings.map((r, i) => (
                  <div key={i} className="grid grid-cols-[1fr_1fr_2rem] gap-2 items-end">
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">{t.repNumberLabel}</label>
                      <Input type="number" min="1" max={splitLogs.length} placeholder="1" value={r.repNumber}
                        onChange={e => setLactateReadings(prev => prev.map((x, xi) => xi === i ? { ...x, repNumber: e.target.value } : x))}
                        className="h-9 text-sm text-center bg-white" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">{t.lactateValueLabel}</label>
                      <Input type="number" step="0.1" placeholder="3.5" value={r.value}
                        onChange={e => setLactateReadings(prev => prev.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x))}
                        className="h-9 text-sm text-center bg-white" />
                    </div>
                    <button type="button" onClick={() => setLactateReadings(prev => prev.filter((_, xi) => xi !== i))}
                      className="h-9 flex items-center justify-center text-gray-300 hover:text-red-400">
                      <XIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs bg-white"
                  onClick={() => setLactateReadings(prev => [...prev, { repNumber: '', value: '' }])}>
                  <Plus className="h-3.5 w-3.5 mr-1" />{t.addReadingBtn}
                </Button>
              </div>
            )}
          </div>
          )}

          {workout!.sets!.map((set, si) => {
            const intervals = (set as any).intervals
            const hasIntervals = intervals && intervals.length > 0
            const reps = set.reps || 1
            const renderRepInputs = (globalIndex: number) => {
              const split = splitLogs[globalIndex]
              return (
                // 2×2 instead of 4-in-a-row — this sits next to a fixed-width
                // rep-number label, so on a real phone 4 columns left each
                // input only ~50-60px wide: barely enough room for the
                // rounded-xl corners to read as circles clipping the value
                // down to 1-2 characters. Two columns per row gives each
                // input roughly double the width.
                <div className="flex-1 grid grid-cols-2 gap-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">{t.timeInputLabel}</label>
                    <Input type="text" placeholder={t.mmssPlaceholder} value={split?.time || ''}
                      onChange={e => globalIndex >= 0 && updateSplit(globalIndex, 'time', e.target.value)}
                      className="h-9 text-sm rounded-xl" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">{t.avgPaceLabel}</label>
                    <Input type="text" dir="ltr" placeholder="4:30" value={split?.pace || ''}
                      onChange={e => globalIndex >= 0 && updateSplit(globalIndex, 'pace', e.target.value)}
                      className="h-9 text-sm rounded-xl" />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-1">{t.avgHrLabel}</label>
                    <Input type="number" value={split?.avgHr ?? ''}
                      onChange={e => globalIndex >= 0 && updateSplit(globalIndex, 'avgHr', e.target.value)}
                      className="h-9 text-sm rounded-xl text-center" />
                  </div>
                  <div>
                    {/* Recovery AFTER this rep — pre-filled (editable) from the
                        matched Strava rest lap when available. Rest length is
                        part of a threshold session's real shape (too little/
                        too much recovery changes the lactate/pace response),
                        so it's captured here instead of only shown once in
                        the Strava view and lost. */}
                    <label className="text-[10px] text-muted-foreground block mb-1">{t.restLapLabel}</label>
                    <Input type="text" dir="ltr" placeholder="1:30" value={split?.rest || ''}
                      onChange={e => globalIndex >= 0 && updateSplit(globalIndex, 'rest', e.target.value)}
                      className="h-9 text-sm rounded-xl" />
                  </div>
                </div>
              )
            }
            return (
              <div key={set.id} className="rounded-2xl border border-border overflow-hidden shadow-sm">
                <div className="bg-navy/5 px-4 py-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-navy">
                    {t.setLabelPrefix} {si + 1}
                    {hasIntervals ? ` · ${reps > 1 ? `${reps}× ` : ''}${intervals.length}` : reps > 1 ? ` · ${reps} ${t.repLabelPrefix}` : ''}
                  </span>
                </div>
                <div className="divide-y divide-border/60">
                  {hasIntervals ? (
                    Array.from({ length: reps }, (_, r) => (
                      <div key={r} className={reps > 1 ? 'border-b-2 border-navy/10' : ''}>
                        {reps > 1 && (
                          <div className="bg-muted/30 px-4 py-1.5">
                            <span className="text-[11px] font-semibold text-navy">{t.repLabelPrefix} {r + 1}</span>
                          </div>
                        )}
                        {intervals.map((interval: any, ii: number) => {
                          const globalIndex = splitLogs.findIndex(s => s.setIndex === si && s.repIndex === r * 1000 + ii)
                          return (
                            <div key={ii} className="px-4 py-3 flex items-start gap-3">
                              <div className="flex items-center gap-2.5 w-8 flex-shrink-0 pt-6">
                                <span className="w-6 h-6 rounded-full bg-navy text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0">{ii + 1}</span>
                              </div>
                              {renderRepInputs(globalIndex)}
                            </div>
                          )
                        })}
                      </div>
                    ))
                  ) : (
                    Array.from({ length: reps }, (_, r) => {
                      const globalIndex = splitLogs.findIndex(s => s.setIndex === si && s.repIndex === r)
                      return (
                        <div key={r} className="px-4 py-3 flex items-start gap-3">
                          <div className="w-20 flex-shrink-0 pt-6">
                            <span className="text-xs font-bold text-navy">
                              {reps > 1 ? `${t.repLabelPrefix} ${r + 1}` : (set.distance || set.duration || '')}
                            </span>
                          </div>
                          {renderRepInputs(globalIndex)}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Strava auto-fill — hidden when already a Strava log */}
      {!stravaSource && <button type="button" onClick={handleFillFromStrava} disabled={stravaFilling || stravaFilled}
        className="w-full flex items-center justify-between gap-3 px-4 py-3.5 rounded-2xl border border-border bg-white hover:bg-muted/30 transition-all disabled:opacity-60 shadow-sm">
        <div className="flex items-center gap-3">
          <div className={cn(
            'h-9 w-9 rounded-xl flex items-center justify-center flex-shrink-0',
            stravaFilled ? 'bg-emerald-500' : 'bg-[#FC4C02]'
          )}>
            {stravaFilling
              ? <Loader2 className="h-4 w-4 text-white animate-spin" />
              : stravaFilled
              ? <CheckCircle2 className="h-4 w-4 text-white" />
              : <Activity className="h-4 w-4 text-white" />
            }
          </div>
          <div dir="rtl">
            <p className="text-sm font-semibold text-navy">
              {stravaFilling ? t.stravaSearching : stravaFilled ? t.stravaDataFilled : t.fillFromStrava}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {stravaFilled ? t.stravaDataUpdated : t.stravaAutoFill}
            </p>
          </div>
        </div>
        {!stravaFilling && !stravaFilled && <ChevronLeft className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      </button>}

      {/* Distance + pace — editable even for Strava logs so the athlete can
          fix or add data Strava missed */}
      {stravaSource && (
        <p className="text-xs text-muted-foreground">{t.fixStravaDataHint}</p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="actualDistance" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {hasSets ? t.totalKmLabel : t.actualDistanceKm}
          </Label>
          <Input id="actualDistance" type="number" step="0.1" min="0"
            placeholder={hasSets ? '10' : t.examplePlaceholder10}
            value={actualDistance} onChange={e => setActualDistance(e.target.value)}
            className="h-11 text-base rounded-xl text-center font-semibold" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="actualPace" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {hasSets ? t.avgTempoLabel : t.actualPaceKm}
          </Label>
          <Input id="actualPace" type="text"
            placeholder={hasSets ? '4:30' : t.examplePlaceholder530}
            value={actualPace} onChange={e => setActualPace(e.target.value)}
            className="h-11 text-base rounded-xl text-center font-semibold" />
        </div>
      </div>

      {/* Effort */}
      <div className="space-y-3">
        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.effortRange}</Label>
        <div className="flex items-center justify-center gap-6 py-2" dir="rtl">
          <button type="button"
            onClick={() => setEffort(prev => prev != null ? Math.max(1, prev - 1) : 5)}
            className="w-14 h-14 rounded-full border-2 border-border bg-white hover:bg-muted/40 transition-all flex items-center justify-center shadow-sm text-2xl font-bold text-navy select-none">
            −
          </button>
          <div className="flex flex-col items-center gap-1 min-w-[72px]">
            <span className={cn(
              'text-6xl font-black leading-none transition-colors',
              effort == null ? 'text-muted-foreground/30' :
              effort <= 2 ? 'text-emerald-500' :
              effort <= 4 ? 'text-emerald-400' :
              effort <= 6 ? 'text-amber-500' :
              effort <= 8 ? 'text-orange-500' : 'text-red-500'
            )}>
              {effort ?? '—'}
            </span>
            <span className={cn(
              'text-sm font-semibold transition-colors',
              effort == null ? 'text-muted-foreground' :
              effort <= 2 ? 'text-emerald-500' :
              effort <= 4 ? 'text-emerald-400' :
              effort <= 6 ? 'text-amber-500' :
              effort <= 8 ? 'text-orange-500' : 'text-red-500'
            )}>
              {effort == null ? t.chooseIntensity :
               effort <= 2 ? t.effortVeryEasy :
               effort <= 4 ? t.effortEasyLabel :
               effort <= 6 ? t.effortModerate :
               effort <= 8 ? t.effortHard : t.effortVeryHard}
            </span>
          </div>
          <button type="button"
            onClick={() => setEffort(prev => prev != null ? Math.min(10, prev + 1) : 5)}
            className="w-14 h-14 rounded-full border-2 border-border bg-white hover:bg-muted/40 transition-all flex items-center justify-center shadow-sm text-2xl font-bold text-navy select-none">
            +
          </button>
        </div>
      </div>

      {/* Comment */}
      <div className="space-y-1.5">
        <Label htmlFor="comment" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.commentOptional}</Label>
        <Textarea id="comment" placeholder={t.commentPlaceholder} value={comment}
          onChange={e => setComment(e.target.value)} className="resize-none h-24 rounded-2xl text-sm" />
      </div>

      <Button onClick={handleSave} disabled={saving || effort == null}
        className="w-full h-12 bg-navy hover:bg-navy/90 text-white font-semibold rounded-2xl text-base">
        {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t.savingDots}</> : existingLog ? t.updateFeedback : t.sendFeedbackToCoach}
      </Button>
    </div>
  )
}
