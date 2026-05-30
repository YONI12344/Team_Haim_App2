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
      <div className="mt-3 pt-3 border-t border-border">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
              {effort != null && <span className="font-bold text-navy">מאמץ {effort}/10</span>}
              {actualDistance && <span className="text-muted-foreground">· {actualDistance} ק"מ</span>}
              {actualPace && <span className="text-muted-foreground">· {actualPace}/ק"מ</span>}
            </div>
            {comment && <p className="text-xs text-muted-foreground italic line-clamp-1">"{comment}"</p>}
            {splitLogs && splitLogs.length > 0 && (
              <p className="text-xs text-muted-foreground">
                {splitLogs.filter((s:any) => s.time).map((s:any, i:number) => `${s.distance||i+1}: ${s.time}`).join(' · ')}
              </p>
            )}
          </div>
          <Button size="sm" variant="ghost" className="h-6 w-6 p-0 flex-shrink-0" onClick={() => setCollapsed(false)}>
            <span className="text-xs">✏️</span>
          </Button>
        </div>
      </div>
    )
  }

  if (loading) {
    return <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
  }

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-5">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-navy">{t.workoutLogHeading}</h4>
        {saved && (
          <div className="flex items-center gap-1 text-emerald-600 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4" />
            <span>{t.loggedBadge}</span>
          </div>
        )}
      </div>

      {/* Structured splits — shown when workout has sets */}
      {hasSets && (
        <div className="space-y-4">
          <p className="text-sm font-bold text-navy border-b pb-1">תיעוד לפי אינטרוול</p>
          {workout!.sets!.map((set, si) => {
            const intervals = (set as any).intervals
            const hasIntervals = intervals && intervals.length > 0
            const reps = set.reps || 1
            return (
              <div key={set.id} className="rounded-lg border border-border overflow-hidden">
                <div className="bg-navy/5 px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-navy">
                    סט {si + 1}
                    {hasIntervals ? ` · ${reps > 1 ? `${reps}× ` : ''}${intervals.length} אינטרוולים` : reps > 1 ? ` · ${reps} חזרות` : ''}
                  </span>
                  {set.rest && <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">מנוחה: {set.rest}</span>}
                </div>
                <div className="divide-y divide-border">
                  {hasIntervals ? (
                    Array.from({ length: reps }, (_, r) => (
                      <div key={r} className={reps > 1 ? "border-b-2 border-navy/10" : ""}>
                        {reps > 1 && (
                          <div className="bg-muted/30 px-3 py-1">
                            <span className="text-[11px] font-semibold text-navy">חזרה {r + 1}</span>
                          </div>
                        )}
                        {intervals.map((interval: any, ii: number) => {
                          const globalIndex = splitLogs.findIndex(s => s.setIndex === si && s.repIndex === r * 1000 + ii)
                          const split = splitLogs[globalIndex]
                          return (
                            <div key={ii} className="px-3 py-2 flex items-center gap-3">
                              <div className="flex items-center gap-2 w-24 flex-shrink-0">
                                <span className="w-5 h-5 rounded-full bg-navy text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0">{ii + 1}</span>
                                <span className="text-sm font-bold text-navy">{interval.distance || interval.duration || ''}</span>
                              </div>
                              <div className="flex-1">
                                <label className="text-[10px] text-muted-foreground block mb-1">זמן</label>
                                <Input
                                  type="text"
                                  placeholder="דק:שנ"
                                  value={split?.time || ''}
                                  onChange={e => globalIndex >= 0 && updateSplit(globalIndex, 'time', e.target.value)}
                                  className="h-8 text-sm"
                                />
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
                        <div key={r} className="px-3 py-2 flex items-center gap-3">
                          <div className="w-24 flex-shrink-0">
                            <span className="text-xs font-bold text-navy">
                              {reps > 1 ? `חזרה ${r + 1}` : (set.distance || set.duration || 'זמן')}
                            </span>
                          </div>
                          <div className="flex-1">
                            <label className="text-[10px] text-muted-foreground block mb-1">זמן</label>
                            <Input
                              type="text"
                              placeholder="דק:שנ"
                              value={split?.time || ''}
                              onChange={e => globalIndex >= 0 && updateSplit(globalIndex, 'time', e.target.value)}
                              className="h-8 text-sm"
                            />
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

      {/* Overall distance + pace — shown for non-structured workouts */}
      {!hasSets && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="actualDistance" className="text-sm">{t.actualDistanceKm}</Label>
            <Input id="actualDistance" type="number" step="0.1" min="0" placeholder={t.examplePlaceholder10} value={actualDistance} onChange={e => setActualDistance(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="actualPace" className="text-sm">{t.actualPaceKm}</Label>
            <Input id="actualPace" type="text" placeholder={t.examplePlaceholder530} value={actualPace} onChange={e => setActualPace(e.target.value)} className="h-9" />
          </div>
        </div>
      )}

      {/* Overall distance for structured workouts too */}
      {hasSets && (
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <Label htmlFor="actualDistance" className="text-sm">סה"כ ק"מ</Label>
            <Input id="actualDistance" type="number" step="0.1" min="0" placeholder="e.g. 10" value={actualDistance} onChange={e => setActualDistance(e.target.value)} className="h-9" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="actualPace" className="text-sm">טמפו ממוצע</Label>
            <Input id="actualPace" type="text" placeholder="e.g. 4:30" value={actualPace} onChange={e => setActualPace(e.target.value)} className="h-9" />
          </div>
        </div>
      )}

      {/* Effort */}
      <div className="space-y-1">
        <div className="flex items-baseline justify-between">
          <Label className="text-sm">{t.effortRange}</Label>
          {effort != null && <span className="text-sm font-semibold text-navy">{effort}/10</span>}
        </div>
        <div role="radiogroup" aria-label="Perceived effort from 1 to 10" className="grid grid-cols-10 gap-1">
          {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => {
            const active = effort === n
            const tone = n <= 3 ? 'bg-emerald-100 text-emerald-700 border-emerald-300' : n <= 6 ? 'bg-amber-100 text-amber-700 border-amber-300' : n <= 8 ? 'bg-orange-100 text-orange-700 border-orange-300' : 'bg-red-100 text-red-700 border-red-300'
            return (
              <button key={n} type="button" role="radio" aria-checked={active} onClick={() => setEffort(n)}
                className={cn('h-9 rounded-md border text-sm font-semibold transition-colors', active ? tone : 'border-border bg-background text-muted-foreground hover:bg-muted/50')}>
                {n}
              </button>
            )
          })}
        </div>
        <p className="text-xs text-muted-foreground pt-0.5">{t.effortHelper}</p>
      </div>

      {/* Comment */}
      <div className="space-y-1">
        <Label htmlFor="comment" className="text-sm">{t.commentOptional}</Label>
        <Textarea id="comment" placeholder={t.commentPlaceholder} value={comment} onChange={e => setComment(e.target.value)} className="resize-none h-20" />
      </div>

      <Button onClick={handleSave} disabled={saving || effort == null} className="w-full bg-gold hover:bg-gold/90 text-navy">
        {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />{t.savingDots}</> : existingLog ? t.updateLog : t.saveLog}
      </Button>
    </div>
  )
}
