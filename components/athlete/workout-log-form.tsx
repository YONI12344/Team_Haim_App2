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
import { CheckCircle2, Loader2, Activity, ChevronLeft } from 'lucide-react'
import { ManualLogCard } from '@/components/shared/manual-log-card'
import type { WorkoutLog, Workout, SplitLog } from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useLanguage } from '@/contexts/language-context'
import { useAuth } from '@/contexts/auth-context'
import { getCoachInfo } from '@/lib/coach'
import { PHASE_ICON, phaseLabel, type PhaseType } from '@/lib/workout-labels'
import { Progress } from '@/components/ui/progress'
import { computeThresholds, estimateVo2max, stepsFromThresholdReps } from '@/lib/physiology'

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
  const isThreshold = workout?.type === 'threshold'

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
        // First try to find a log by the assigned workout's workoutId
        const q = query(
          collection(db, 'logs'),
          where('workoutId', '==', workoutId),
          where('athleteId', '==', athleteId),
          limit(1)
        )
        let snapshot = await getDocs(q)

        // If no match by workoutId, fall back to a Strava log for the same date.
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
      const finalSplitLogs = isThreshold
        ? splitLogs
            .filter(s => s.durationActualMin || s.avgHr || s.avgPace || s.lactate || s.notes)
            .map(s => ({
              ...s,
              durationActualMin: s.durationActualMin ? Number(s.durationActualMin) : undefined,
              avgHr: s.avgHr ? Number(s.avgHr) : undefined,
              maxHr: s.maxHr ? Number(s.maxHr) : undefined,
              lactate: s.lactate ? Number(s.lactate) : undefined,
              lactateHr: s.lactateHr ? Number(s.lactateHr) : undefined,
            }))
        : splitLogs.filter(s => s.time || s.pace || s.notes)
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
      }
      let savedLogId: string
      if (isUpdate) {
        const updatePayload: any = { ...baseData, updatedAt: serverTimestamp() }
        if (stravaSource) updatePayload.feedbackStatus = 'completed'
        await updateDoc(doc(db, 'logs', existingLog!.id), updatePayload)
        savedLogId = existingLog!.id
        setExistingLog({ ...existingLog!, actualDistance: parsedDistance ?? undefined, actualPace: baseData.actualPace ?? undefined, effort, comment, splitLogs: baseData.splitLogs })
      } else {
        const docRef = await addDoc(collection(db, 'logs'), { ...baseData, createdAt: serverTimestamp() })
        savedLogId = docRef.id
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

      // Threshold workouts feed their rep-level lactate readings into the
      // same lactateTests/LactateStep[] pipeline formal step tests use, so
      // LT1/LT2 recompute automatically and the reading shows up in the Lab.
      if (isThreshold) {
        try {
          const steps = stepsFromThresholdReps(finalSplitLogs.filter(s => (s as any).phase === 'rep'))
          if (steps.length >= 2) {
            const { lt1, lt2 } = computeThresholds(steps)
            const testQuery = await getDocs(query(collection(db, 'lactateTests'), where('workoutLogId', '==', savedLogId)))
            const testDoc = {
              athleteId,
              kind: 'workout' as const,
              date: scheduledDate,
              workoutLogId: savedLogId,
              workoutTitle: workout?.title || '',
              steps,
              notes: comment.trim(),
              lt1PaceSec: lt1?.paceSecPerKm ?? null,
              lt1Hr: lt1?.hr ?? null,
              lt2PaceSec: lt2?.paceSecPerKm ?? null,
              lt2Hr: lt2?.hr ?? null,
            }
            if (!testQuery.empty) {
              await updateDoc(doc(db, 'lactateTests', testQuery.docs[0].id), { ...testDoc, updatedAt: serverTimestamp() })
            } else {
              await addDoc(collection(db, 'lactateTests'), { ...testDoc, createdAt: serverTimestamp() })
            }
            if (lt2) {
              await updateDoc(doc(db, 'users', athleteId), {
                physiology: {
                  lt1PaceSec: lt1?.paceSecPerKm ?? null,
                  lt1Hr: lt1?.hr ?? null,
                  lt2PaceSec: lt2.paceSecPerKm,
                  lt2Hr: lt2.hr,
                  vo2maxEst: estimateVo2max(lt2.paceSecPerKm),
                  source: 'test',
                  testDate: scheduledDate,
                  updatedAt: serverTimestamp(),
                },
              })
            }
          }
        } catch (e) { console.error('[workout-log-form] lactate curve upsert failed:', e) }
      }

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
          {stravaSource.splitLogs && stravaSource.splitLogs.length > 0 && (
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

      {/* Threshold workout execution — per-phase duration/HR/pace + rep-level lactate */}
      {isThreshold && !stravaSource && (() => {
        const phases = (workout?.sets || []) as any[]
        const findSplit = (si: number) => {
          const idx = splitLogs.findIndex(s => s.setIndex === si)
          return { idx, split: idx >= 0 ? splitLogs[idx] : undefined }
        }
        const isPhaseDone = (phase: any, split?: SplitLog) => {
          if (!split) return false
          if (phase.phase !== 'rep') return !!split.durationActualMin
          return !!(split.avgHr && split.avgPace)
        }
        const doneStates = phases.map((p, si) => isPhaseDone(p, findSplit(si).split))
        const completedCount = doneStates.filter(Boolean).length
        const currentIndex = doneStates.findIndex(d => !d)
        let repCounter = 0
        const repOrdinal: Record<number, number> = {}
        phases.forEach((p, si) => { if (p.phase === 'rep') repOrdinal[si] = ++repCounter })
        const lactateRows = phases
          .map((p, si) => ({ si, split: findSplit(si).split }))
          .filter(x => phases[x.si].phase === 'rep' && x.split?.lactate)

        return (
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.thresholdExecutionTitle}</p>
              {workout?.targetLactate != null && (
                <span className="text-[11px] font-semibold bg-navy/5 border border-navy/10 px-2 py-0.5 rounded-full whitespace-nowrap">
                  🎯 {workout.targetLactate} mmol/L
                </span>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>{t.phaseProgressLabel}</span>
                <span>{completedCount}/{phases.length}</span>
              </div>
              <Progress value={phases.length ? (completedCount / phases.length) * 100 : 0} className="h-2" />
            </div>

            <div className="space-y-3">
              {phases.map((phase, si) => {
                const { idx, split } = findSplit(si)
                const pt: PhaseType = phase.phase || 'warmup'
                const isRep = pt === 'rep'
                const isCurrent = si === currentIndex
                const set = (field: keyof SplitLog, value: string) => idx >= 0 && updateSplit(idx, field, value)
                return (
                  <div key={si} className={cn(
                    'rounded-2xl border overflow-hidden shadow-sm transition-colors',
                    isCurrent ? 'border-gold' : doneStates[si] ? 'border-emerald-200' : 'border-border',
                  )}>
                    <div className={cn('px-4 py-2.5 flex items-center justify-between gap-2 flex-wrap',
                      isCurrent ? 'bg-gold/10' : 'bg-navy/5')}>
                      <span className="text-sm font-bold text-navy flex items-center gap-2">
                        <span>{PHASE_ICON[pt]}</span>
                        {isRep && repOrdinal[si] ? `${phaseLabel(t, pt)} ${repOrdinal[si]}` : phaseLabel(t, pt)}
                        {phase.zone && <span className="text-[10px] font-semibold text-muted-foreground">Z{phase.zone}</span>}
                      </span>
                      {doneStates[si] && <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />}
                    </div>
                    <div className="p-4 space-y-3">
                      {(phase.duration || phase.pace || phase.notes) && (
                        <p className="text-[11px] text-muted-foreground">
                          {[phase.duration && `${phase.duration} min`, phase.pace, phase.notes].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {!isRep ? (
                        <div className="space-y-1.5">
                          <Label className="text-[11px] text-muted-foreground">{t.actualDurationLabel}</Label>
                          <Input type="number" step="0.5" min="0" className="h-10 rounded-xl"
                            value={split?.durationActualMin ?? ''}
                            onChange={e => set('durationActualMin', e.target.value)} />
                        </div>
                      ) : (
                        <>
                          <div className="grid grid-cols-3 gap-2">
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-muted-foreground">{t.avgHrLabel}</Label>
                              <Input type="number" className="h-10 rounded-xl text-center"
                                value={split?.avgHr ?? ''} onChange={e => set('avgHr', e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-muted-foreground">{t.maxHrLabel}</Label>
                              <Input type="number" className="h-10 rounded-xl text-center"
                                value={split?.maxHr ?? ''} onChange={e => set('maxHr', e.target.value)} />
                            </div>
                            <div className="space-y-1.5">
                              <Label className="text-[11px] text-muted-foreground">{t.avgPaceLabel}</Label>
                              <Input type="text" placeholder="4:30" dir="ltr" className="h-10 rounded-xl text-center"
                                value={split?.avgPace ?? ''} onChange={e => set('avgPace', e.target.value)} />
                            </div>
                          </div>

                          <div className="rounded-xl border border-dashed border-border p-3 space-y-2">
                            <Label className="text-[11px] font-semibold text-muted-foreground">🧪 {t.lactateTestSectionTitle}</Label>
                            <div className="grid grid-cols-3 gap-2">
                              <div className="space-y-1">
                                <Label className="text-[10px] text-muted-foreground">{t.lactateValueLabel}</Label>
                                <Input type="number" step="0.1" className="h-9 rounded-lg text-center"
                                  value={split?.lactate ?? ''} onChange={e => set('lactate', e.target.value)} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] text-muted-foreground">{t.hrAtTestLabel}</Label>
                                <Input type="number" placeholder={split?.avgHr ? String(split.avgHr) : ''} className="h-9 rounded-lg text-center"
                                  value={split?.lactateHr ?? ''} onChange={e => set('lactateHr', e.target.value)} />
                              </div>
                              <div className="space-y-1">
                                <Label className="text-[10px] text-muted-foreground">{t.paceAtTestLabel}</Label>
                                <Input type="text" dir="ltr" placeholder={split?.avgPace || ''} className="h-9 rounded-lg text-center"
                                  value={split?.lactatePace ?? ''} onChange={e => set('lactatePace', e.target.value)} />
                              </div>
                            </div>
                            {!!split?.lactate && !(split?.lactateHr && split?.lactatePace) && (
                              <p className="text-[10px] text-muted-foreground">{t.autoFilledHint}</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            {lactateRows.length > 0 && (
              <div className="rounded-2xl border border-border overflow-hidden">
                <div className="bg-navy/5 px-4 py-2">
                  <p className="text-xs font-bold text-navy">📈 {t.lactateHistoryTitle}</p>
                </div>
                <div className="divide-y divide-border/60">
                  <div className="grid grid-cols-4 gap-2 px-4 py-1.5 text-[10px] font-semibold text-muted-foreground text-center">
                    <span>{t.repNumberLabel}</span><span>{t.lactateValueLabel}</span><span>{t.hrAtTestLabel}</span><span>{t.paceAtTestLabel}</span>
                  </div>
                  {lactateRows.map(({ si, split }) => (
                    <div key={si} className="grid grid-cols-4 gap-2 px-4 py-1.5 text-xs text-center text-navy font-mono" dir="ltr">
                      <span>{repOrdinal[si]}</span>
                      <span className="font-bold">{split?.lactate}</span>
                      <span>{split?.lactateHr || split?.avgHr || '—'}</span>
                      <span>{split?.lactatePace || split?.avgPace || '—'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* Structured splits — only for non-Strava logs */}
      {hasSets && !stravaSource && !isThreshold && (
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.intervalLogTitle}</p>
          {workout!.sets!.map((set, si) => {
            const intervals = (set as any).intervals
            const hasIntervals = intervals && intervals.length > 0
            const reps = set.reps || 1
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
                          const split = splitLogs[globalIndex]
                          return (
                            <div key={ii} className="px-4 py-3 flex items-center gap-3">
                              <div className="flex items-center gap-2.5 w-28 flex-shrink-0">
                                <span className="w-6 h-6 rounded-full bg-navy text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0">{ii + 1}</span>
                                <span className="text-sm font-bold text-navy">{interval.distance || interval.duration || ''}</span>
                              </div>
                              <div className="flex-1">
                                <label className="text-[10px] text-muted-foreground block mb-1">{t.timeInputLabel}</label>
                                <Input type="text" placeholder={t.mmssPlaceholder} value={split?.time || ''}
                                  onChange={e => globalIndex >= 0 && updateSplit(globalIndex, 'time', e.target.value)}
                                  className="h-10 text-sm rounded-xl" />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ))
                  ) : (
                    Array.from({ length: reps }, (_, r) => {
                      const globalIndex = splitLogs.findIndex(s => s.setIndex === si && s.repIndex === r)
                      const split = splitLogs[globalIndex]
                      return (
                        <div key={r} className="px-4 py-3 flex items-center gap-3">
                          <div className="w-28 flex-shrink-0">
                            <span className="text-xs font-bold text-navy">
                              {reps > 1 ? `${t.repLabelPrefix} ${r + 1}` : (set.distance || set.duration || t.timeInputLabel)}
                            </span>
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground block mb-1">{t.timeInputLabel}</label>
                            <Input type="text" placeholder={t.mmssPlaceholder} value={split?.time || ''}
                              onChange={e => globalIndex >= 0 && updateSplit(globalIndex, 'time', e.target.value)}
                              className="h-10 text-sm rounded-xl" />
                          </div>
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
