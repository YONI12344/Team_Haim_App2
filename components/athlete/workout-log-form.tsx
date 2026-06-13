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
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  limit,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CheckCircle2, Loader2, Activity, ChevronLeft } from 'lucide-react'
import type { WorkoutLog, Workout, SplitLog } from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useLanguage } from '@/contexts/language-context'

interface WorkoutLogFormProps {
  workoutId: string
  assignedWorkoutId?: string
  athleteId: string
  scheduledDate: string
  workout?: Workout
}

export function WorkoutLogForm({ workoutId, assignedWorkoutId, athleteId, scheduledDate, workout }: WorkoutLogFormProps) {
  const { t } = useLanguage()
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
        toast.error('לא נמצאה פעילות Strava לתאריך זה. סנכרן Strava תחילה מהפרופיל שלך.')
        return
      }
      const activities = snap.docs.map(d => d.data())
      const best = activities.sort((a, b) => (b.actualDistance || 0) - (a.actualDistance || 0))[0]
      if (best.actualDistance) setActualDistance(String(best.actualDistance))
      if (best.actualPace) setActualPace(best.actualPace)
      setStravaFilled(true)
    } catch (err) {
      console.error('Strava fill error:', err)
      toast.error('שגיאה בטעינת נתוני Strava')
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
        const q = query(
          collection(db, 'logs'),
          where('workoutId', '==', workoutId),
          where('athleteId', '==', athleteId),
          limit(1)
        )
        const snapshot = await getDocs(q)
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
    setSplitLogs(prev => prev.map((s, i) => i === index ? { ...s, [field]: value } : s))
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
    try {
      const baseData = {
        athleteId,
        workoutId,
  assignedWorkoutId,
        date: scheduledDate,
        actualDistance: parsedDistance,
        actualPace: actualPace.trim() || null,
        effort,
        comment,
        splitLogs: splitLogs.filter(s => s.time || s.pace || s.notes),
      }
      if (existingLog?.id) {
        const updatePayload: any = { ...baseData, updatedAt: serverTimestamp() }
        if (stravaSource) updatePayload.feedbackStatus = 'completed'
        await updateDoc(doc(db, 'logs', existingLog.id), updatePayload)
        setExistingLog({ ...existingLog, actualDistance: parsedDistance ?? undefined, actualPace: baseData.actualPace ?? undefined, effort, comment, splitLogs: baseData.splitLogs })
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
        <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">נרשם</span>
            </div>
            <Button size="sm" variant="ghost" className="h-7 px-3 text-xs text-muted-foreground rounded-lg" onClick={() => setCollapsed(false)}>
              ערוך
            </Button>
          </div>
          <div className="px-4 py-3 flex items-center gap-4 flex-wrap">
            {effort != null && (
              <div className="flex items-center gap-1.5">
                <span className={cn(
                  'w-2.5 h-2.5 rounded-full flex-shrink-0',
                  effort <= 4 ? 'bg-emerald-400' :
                  effort <= 6 ? 'bg-amber-400' :
                  effort <= 7 ? 'bg-orange-400' : 'bg-red-400'
                )}/>
                <span className="text-sm font-semibold text-navy">מאמץ {effort}/10</span>
              </div>
            )}
            {actualDistance && (
              <span className="text-sm text-muted-foreground">{actualDistance} ק"מ</span>
            )}
            {actualPace && (
              <span className="text-sm text-muted-foreground">{actualPace}/ק"מ</span>
            )}
          </div>
          {comment && (
            <div className="px-4 pb-3">
              <p className="text-sm text-muted-foreground italic">"{comment}"</p>
            </div>
          )}
          {splitLogs && splitLogs.filter((s:any) => s.time && s.time.includes(':') && !String(s.distance||'').includes("ד'")).length > 0 && (
            <div className="px-4 pb-3 space-y-0.5 border-t border-border/40 pt-3">
              {Array.from(new Set(splitLogs
                .filter((s:any) => s.time && s.time.includes(':') && !String(s.distance||'').includes("ד'"))
                .map((s:any) => s.setIndex)
              )).map((si: any) => {
                const items = splitLogs.filter((s:any) => s.setIndex === si && s.time && s.time.includes(':') && !String(s.distance||'').includes("ד'"))
                if (!items.length) return null
                return (
                  <p key={si} className="text-xs text-muted-foreground">
                    <span className="font-semibold text-navy">סט {Number(si)+1}:</span>{' '}
                    {items.map((s:any) => s.distance ? `${s.distance} ${s.time}` : s.time).join(' · ')}
                  </p>
                )
              })}
            </div>
          )}
        </div>
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
          {stravaSource ? 'כיצד הרגשת?' : t.workoutLogHeading}
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
                {stravaSource.stravaName || 'אימון Strava'}
              </p>
              <p className="text-[11px] text-muted-foreground">סונכרן מ-Strava</p>
            </div>
          </div>
          <div className="px-4 py-3 flex flex-wrap gap-2">
            {actualDistance && (
              <span className="text-xs font-semibold bg-muted px-3 py-1.5 rounded-full">{actualDistance} ק"מ</span>
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

      {/* Structured splits — only for non-Strava logs */}
      {hasSets && !stravaSource && (
        <div className="space-y-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">תיעוד לפי אינטרוול</p>
          {workout!.sets!.map((set, si) => {
            const intervals = (set as any).intervals
            const hasIntervals = intervals && intervals.length > 0
            const reps = set.reps || 1
            return (
              <div key={set.id} className="rounded-2xl border border-border overflow-hidden shadow-sm">
                <div className="bg-navy/5 px-4 py-3 flex items-center justify-between">
                  <span className="text-xs font-bold text-navy">
                    סט {si + 1}
                    {hasIntervals ? ` · ${reps > 1 ? `${reps}× ` : ''}${intervals.length} אינטרוולים` : reps > 1 ? ` · ${reps} חזרות` : ''}
                  </span>
                  {set.rest && <span className="text-[11px] text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">מנוחה: {set.rest}</span>}
                </div>
                <div className="divide-y divide-border/60">
                  {hasIntervals ? (
                    Array.from({ length: reps }, (_, r) => (
                      <div key={r} className={reps > 1 ? 'border-b-2 border-navy/10' : ''}>
                        {reps > 1 && (
                          <div className="bg-muted/30 px-4 py-1.5">
                            <span className="text-[11px] font-semibold text-navy">חזרה {r + 1}</span>
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
                                <label className="text-[10px] text-muted-foreground block mb-1">זמן</label>
                                <Input type="text" placeholder="דק:שנ" value={split?.time || ''}
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
                              {reps > 1 ? `חזרה ${r + 1}` : (set.distance || set.duration || 'זמן')}
                            </span>
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground block mb-1">זמן</label>
                            <Input type="text" placeholder="דק:שנ" value={split?.time || ''}
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
              {stravaFilling ? 'מחפש פעילות...' : stravaFilled ? 'נתוני Strava מולאו' : 'מלא מ-Strava'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {stravaFilled ? 'מרחק וטמפו עודכנו' : 'מלא אוטומטית מהאימון האחרון'}
            </p>
          </div>
        </div>
        {!stravaFilling && !stravaFilled && <ChevronLeft className="h-4 w-4 text-muted-foreground flex-shrink-0" />}
      </button>}

      {/* Distance + pace — hidden when Strava data already shown in card */}
      {!stravaSource && (
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="actualDistance" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {hasSets ? 'סה"כ ק"מ' : t.actualDistanceKm}
            </Label>
            <Input id="actualDistance" type="number" step="0.1" min="0"
              placeholder={hasSets ? '10' : t.examplePlaceholder10}
              value={actualDistance} onChange={e => setActualDistance(e.target.value)}
              className="h-11 text-base rounded-xl text-center font-semibold" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="actualPace" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {hasSets ? 'טמפו ממוצע' : t.actualPaceKm}
            </Label>
            <Input id="actualPace" type="text"
              placeholder={hasSets ? '4:30' : t.examplePlaceholder530}
              value={actualPace} onChange={e => setActualPace(e.target.value)}
              className="h-11 text-base rounded-xl text-center font-semibold" />
          </div>
        </div>
      )}

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
              {effort == null ? 'בחר עצימות' :
               effort <= 2 ? 'קל מאוד' :
               effort <= 4 ? 'קל' :
               effort <= 6 ? 'בינוני' :
               effort <= 8 ? 'קשה' : 'מאוד קשה'}
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
        {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />שומר...</> : existingLog ? 'עדכן משוב' : 'שלח משוב למאמן'}
      </Button>
    </div>
  )
}
