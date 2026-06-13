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
import { CheckCircle2, Loader2 } from 'lucide-react'
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
          if (log.splitLogs && log.splitLogs.length > 0) {
            setSplitLogs(log.splitLogs)
          }
          setSaved(true)
          setCollapsed(true)
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
        await updateDoc(doc(db, 'logs', existingLog.id), { ...baseData, updatedAt: serverTimestamp() })
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
        <div className="bg-emerald-50 rounded-2xl border border-emerald-200 shadow-sm p-4 flex items-start justify-between gap-3">
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-700">הושלם</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              {effort != null && (
                <span className={cn(
                  'px-2.5 py-1 rounded-full text-xs font-bold',
                  effort <= 4 ? 'bg-emerald-100 text-emerald-700' :
                  effort <= 6 ? 'bg-amber-100 text-amber-700' :
                  effort <= 7 ? 'bg-orange-100 text-orange-700' :
                  'bg-red-100 text-red-700'
                )}>מאמץ {effort}/10</span>
              )}
              {actualDistance && <span className="text-sm font-semibold text-navy">{actualDistance} ק"מ</span>}
              {actualPace && <span className="text-sm text-muted-foreground">{actualPace}/ק"מ</span>}
            </div>
            {comment && <p className="text-sm text-navy italic leading-relaxed">"{comment}"</p>}
            {splitLogs && splitLogs.filter((s:any) => s.time && s.time.includes(':') && !String(s.distance||'').includes("ד'")).length > 0 && (
              <div className="space-y-0.5 pt-1 border-t border-emerald-200/60">
                {Array.from(new Set(splitLogs
                  .filter((s:any) => s.time && s.time.includes(':') && !String(s.distance||'').includes("ד'"))
                  .map((s:any) => s.setIndex)
                )).map((si: any) => {
                  const items = splitLogs.filter((s:any) => s.setIndex === si && s.time && s.time.includes(':') && !String(s.distance||'').includes("ד'"))
                  if (!items.length) return null
                  return (
                    <p key={si} className="text-sm text-muted-foreground">
                      <span className="font-semibold text-navy">סט {Number(si)+1}:</span>{' '}
                      {items.map((s:any) => s.distance ? `${s.distance} ${s.time}` : s.time).join(' · ')}
                    </p>
                  )
                })}
              </div>
            )}
          </div>
          <Button size="sm" variant="outline" className="h-8 px-3 bg-white flex-shrink-0 text-sm rounded-xl border-emerald-200" onClick={() => setCollapsed(false)}>
            ערוך
          </Button>
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
        <h4 className="font-bold text-navy text-base">{t.workoutLogHeading}</h4>
        {saved && (
          <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-semibold">
            <CheckCircle2 className="h-4 w-4" />
            <span>{t.loggedBadge}</span>
          </div>
        )}
      </div>

      {/* Structured splits */}
      {hasSets && (
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

      {/* Strava auto-fill */}
      <div className="flex justify-end">
        <button type="button" onClick={handleFillFromStrava} disabled={stravaFilling}
          className="text-xs px-4 py-2 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors disabled:opacity-50">
          {stravaFilling ? 'Loading...' : stravaFilled ? 'Strava Filled!' : 'Fill from Strava'}
        </button>
      </div>

      {/* Distance + pace */}
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

      {/* Effort */}
      <div className="space-y-3">
        <div className="flex items-baseline justify-between">
          <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.effortRange}</Label>
          {effort != null && (
            <span className={cn(
              'text-lg font-bold px-2.5 py-0.5 rounded-full',
              effort <= 4 ? 'bg-emerald-100 text-emerald-700' :
              effort <= 6 ? 'bg-amber-100 text-amber-700' :
              effort <= 7 ? 'bg-orange-100 text-orange-700' :
              'bg-red-100 text-red-700'
            )}>{effort}/10</span>
          )}
        </div>
        <div role="radiogroup" aria-label="Perceived effort from 1 to 10" className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const active = effort === n
            const activeTone = n <= 4 ? 'bg-emerald-100 text-emerald-700 border-emerald-300 shadow-sm' :
              n <= 6 ? 'bg-amber-100 text-amber-700 border-amber-300 shadow-sm' :
              n <= 7 ? 'bg-orange-100 text-orange-700 border-orange-300 shadow-sm' :
              'bg-red-100 text-red-700 border-red-300 shadow-sm'
            return (
              <button key={n} type="button" role="radio" aria-checked={active} onClick={() => setEffort(n)}
                className={cn('h-11 rounded-xl border text-sm font-bold transition-all', active ? activeTone : 'border-border bg-background text-muted-foreground hover:bg-muted/50')}>
                {n}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground">{t.effortHelper}</p>
      </div>

      {/* Comment */}
      <div className="space-y-1.5">
        <Label htmlFor="comment" className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.commentOptional}</Label>
        <Textarea id="comment" placeholder={t.commentPlaceholder} value={comment}
          onChange={e => setComment(e.target.value)} className="resize-none h-24 rounded-2xl text-sm" />
      </div>

      <Button onClick={handleSave} disabled={saving || effort == null}
        className="w-full h-12 bg-navy hover:bg-navy/90 text-white font-semibold rounded-2xl text-base">
        {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t.savingDots}</> : existingLog ? t.updateLog : t.saveLog}
      </Button>
    </div>
  )
}
