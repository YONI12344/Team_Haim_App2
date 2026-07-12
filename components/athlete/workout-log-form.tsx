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
import { getCoachInfo } from '@/lib/coach'
import { useLatestStepTest } from '@/hooks/useLatestStepTest'
import { useWorkoutLactateGroups, latestSessionSteps } from '@/hooks/useWorkoutLactateGroups'
import { personalTargetRangeForLevel, formatTargetRange } from '@/lib/physiology'

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
        let snapshot = assignedWorkoutId
          ? await getDocs(query(
              collection(db, 'logs'),
              where('assignedWorkoutId', '==', assignedWorkoutId),
              where('athleteId', '==', athleteId),
              limit(1)
            ))
          : null

        // Fall back to workoutId+athleteId+date (legacy logs saved before
        // assignedWorkoutId was tracked, or call sites without it) — scoped
        // to this exact date so it can't pick up a different occurrence of
        // the same recurring template.
        if (!snapshot || snapshot.empty) {
          snapshot = await getDocs(query(
            collection(db, 'logs'),
            where('workoutId', '==', workoutId),
            where('athleteId', '==', athleteId),
            where('date', '==', scheduledDate),
            limit(1)
          ))
        }

        // If still nothing, fall back to a Strava log for the same date.
        // This prevents workout-log-form from creating a second document alongside
        // an existing Strava log (which has workoutId 'strava_<id>', not the template id).
        if (snapshot.empty && scheduledDate) {
          const stravaQ = query(
            collection(db, 'logs'),
            where('athleteId', '==', athleteId),
            where('date', '==', scheduledDate),
            where('source', '==', 'strava'),
            limit(1)
          )
          snapshot = await getDocs(stravaQ)
        }

        if (!snapshot.empty) {
          const logData = snapshot.docs[0].data()
          const effortNum = legacyEffortToNumber(logData.effort)
          const log: WorkoutLog = {
            id: snapshot.docs[0].id,
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

  // Pre-fill (still editable) pace/HR per rep from matched Strava laps, by
  // order — lap N is assumed to correspond to rep N (the athlete lapping
  // their watch each rep). Not distance/time-verified, just a default the
  // athlete can correct. Uses the functional setSplitLogs form so it's safe
  // regardless of whether this runs before or after the sets-seeding effect.
  useEffect(() => {
    if (!stravaSource?.splitLogs?.length) return
    setSplitLogs(prev => prev.map((s, i) => {
      const lap = stravaSource.splitLogs[i]
      if (!lap) return s
      return {
        ...s,
        pace: s.pace || lap.pace || '',
        avgHr: s.avgHr || lap.heartRate || undefined,
      }
    }))
  }, [stravaSource])

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

      const finalSplitLogs = splitLogsWithLactate
        .filter(s => s.time || s.pace || s.notes || s.avgHr || s.lactate)
        .map(s => ({
          ...s,
          avgHr: s.avgHr ? Number(s.avgHr) : undefined,
          lactate: s.lactate ? Number(s.lactate) : undefined,
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
        hasLactate,
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

      // Notify coach (fire-and-forget) — uses getCoachInfo() since this is a
      // single-coach app; there is no coachId field on athlete user docs
      ;(async () => {
        try {
          const coachInfo = await getCoachInfo()
          if (!coachInfo?.uid) {
            console.error('[workout-log-form] getCoachInfo returned no uid — notification skipped')
            return
          }
          const athleteSnap = await getDoc(doc(db, 'users', athleteId))
          if (athleteSnap.data()?.mutedByCoach === true) return
          const athleteName = user?.name || 'ספורטאי'
          const parts: string[] = []
          if (parsedDistance) parts.push(`${parsedDistance} ק"מ`)
          if (effort != null) parts.push(`מאמץ ${effort}/10`)
          if (comment.trim()) parts.push(comment.trim().slice(0, 80))
          const body = parts.join(' · ') || workout?.title || 'אימון'
          fetch('/api/send-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: coachInfo.uid,
              title: `${athleteName} עדכן אימון`,
              body,
              data: { type: 'workout_update' },
              url: `/coach/athletes/${athleteId}/planner`,
            }),
          }).then(async res => {
            // A non-2xx (e.g. 404 "no FCM token for user") was previously
            // indistinguishable from success — this send is fire-and-forget
            // by design (shouldn't block the athlete's save), but failures
            // should at least be visible in logs instead of silent.
            if (!res.ok) {
              console.error('[workout-log-form] Coach notification failed:', res.status, await res.text().catch(() => ''))
            }
          }).catch(err => console.error('[workout-log-form] Failed to send coach notification:', err))
        } catch (err) {
          console.error('[workout-log-form] Notification IIFE error:', err)
        }
      })()
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
                ? personalTargetRangeForLevel(latestSessionSteps(workoutGroups.get(workoutId), existingLog?.id), workout.targetThresholdLevel)
                : null
              const source: 'override' | 'recent' | 'lab' = targetOverride ? 'override' : recentRange ? 'recent' : 'lab'
              const range = targetOverride
                ? { paceRangeSec: [targetOverride.paceMinSec, targetOverride.paceMaxSec] as [number, number],
                    hrRange: targetOverride.hrMin != null && targetOverride.hrMax != null ? [targetOverride.hrMin, targetOverride.hrMax] as [number, number] : null }
                : recentRange || personalTargetRangeForLevel(latestSteps, workout.targetThresholdLevel)
              if (!range) {
                return (
                  <span className="text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full whitespace-nowrap">
                    🎯 {workout.targetThresholdLevel} — אין עדיין נתוני מעבדה
                  </span>
                )
              }
              const lactateMid = source === 'lab' || source === 'recent' ? (range as any).lactateMid : undefined
              const sourceTag = source === 'recent' ? ' · מהאימון הקודם' : source === 'lab' ? ' · מבדיקת מעבדה' : ' · ✏️'
              return (
                <span className="text-[11px] font-semibold bg-navy/5 border border-navy/10 px-2 py-0.5 rounded-full whitespace-nowrap" dir="ltr">
                  🎯 {workout.targetThresholdLevel} · {formatTargetRange(range, metrics, lactateMid)}{sourceTag}
                </span>
              )
            })()}
          </div>
          {workout!.sets!.map((set, si) => {
            const intervals = (set as any).intervals
            const hasIntervals = intervals && intervals.length > 0
            const reps = set.reps || 1
            const renderRepInputs = (globalIndex: number) => {
              const split = splitLogs[globalIndex]
              return (
                <div className="flex-1 grid grid-cols-3 gap-2">
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

          {/* Threshold workouts only — asked once for the whole session, not
              a box on every rep (which gets noisy for a 20-rep workout).
              "Yes" reveals a small add-a-reading list keyed by rep number. */}
          {workout?.type === 'threshold' && (
          <div className="rounded-2xl border border-border p-4 space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <p className="text-sm font-semibold text-navy">🧪 {t.testedLactateQuestion}</p>
              <div className="flex gap-1 bg-muted rounded-xl p-0.5">
                <button type="button" onClick={() => setTestedLactate(false)}
                  className={cn('text-xs px-3 py-1 rounded-lg font-semibold transition-all',
                    !testedLactate ? 'bg-white text-navy shadow-sm' : 'text-muted-foreground')}>
                  {t.no}
                </button>
                <button type="button" onClick={() => {
                    setTestedLactate(true)
                    if (lactateReadings.length === 0) setLactateReadings([{ repNumber: '', value: '' }])
                  }}
                  className={cn('text-xs px-3 py-1 rounded-lg font-semibold transition-all',
                    testedLactate ? 'bg-white text-navy shadow-sm' : 'text-muted-foreground')}>
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
                        className="h-9 text-sm text-center" />
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">{t.lactateValueLabel}</label>
                      <Input type="number" step="0.1" placeholder="3.5" value={r.value}
                        onChange={e => setLactateReadings(prev => prev.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x))}
                        className="h-9 text-sm text-center" />
                    </div>
                    <button type="button" onClick={() => setLactateReadings(prev => prev.filter((_, xi) => xi !== i))}
                      className="h-9 flex items-center justify-center text-gray-300 hover:text-red-400">
                      <XIcon className="h-4 w-4" />
                    </button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" className="h-8 text-xs"
                  onClick={() => setLactateReadings(prev => [...prev, { repNumber: '', value: '' }])}>
                  <Plus className="h-3.5 w-3.5 mr-1" />{t.addReadingBtn}
                </Button>
              </div>
            )}
          </div>
          )}
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
        <p className="text-xs text-muted-foreground -mb-3">{t.fixStravaDataHint}</p>
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
