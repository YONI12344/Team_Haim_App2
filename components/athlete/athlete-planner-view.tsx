'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Loader2, MapPin, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, eachDayOfInterval, isSameMonth,
  isSameDay, isToday, parseISO, eachWeekOfInterval,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase'
import { collection, doc, getDoc, getDocs, query, where, updateDoc } from 'firebase/firestore'
import type { AthleteProfile, AssignedWorkout, TrainingDayType } from '@/lib/types'
import { listJourneys, computeJourneyProgress } from '@/lib/journey'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { toast } from 'sonner'
import { WorkoutLogForm } from '@/components/athlete/workout-log-form'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const WEEKDAY_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const
const DAY_HE = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת']
const DAY_HE_SHORT = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']
const DAY_EN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const DAY_HE_LABELS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']

const TYPE_COLORS: Record<string, string> = {
  easy: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  long_run: 'bg-orange-100 text-orange-800 border-orange-200',
  tempo: 'bg-purple-100 text-purple-800 border-purple-200',
  intervals: 'bg-blue-100 text-blue-800 border-blue-200',
  hill_repeats: 'bg-amber-100 text-amber-800 border-amber-200',
  fartlek: 'bg-cyan-100 text-cyan-800 border-cyan-200',
  recovery: 'bg-gray-100 text-gray-600 border-gray-200',
  rest: 'bg-muted text-muted-foreground',
  race: 'bg-red-100 text-red-700 border-red-200',
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  skipped: 'bg-red-100 text-red-600 border-red-200',
  scheduled: 'bg-amber-100 text-amber-700 border-amber-200',
}

interface JourneySummary {
  stageName: string; weekInStage: number; totalWeeksInStage: number
  isOffWeek: boolean; goalRaceDate: string; goalRaceEvent: string
}

export function AthletePlannerView({ overrideAthleteId }: { overrideAthleteId?: string } = {}) {
  const { user } = useAuth()
  const { language, t } = useLanguage()
  const athleteId = overrideAthleteId || user?.id || ''
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  const [journey, setJourney] = useState<JourneySummary | null>(null)
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [weekLogs, setWeekLogs] = useState<{id: string, actualDistance?: number, actualPace?: string, effort?: number, comment?: string, workoutId?: string, assignedWorkoutId?: string, source?: string, splitLogs?: any[], date: string, stravaActivityId?: string, stravaName?: string, averageHeartRate?: number, elevationGain?: number, feedbackStatus?: string}[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day')
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null)
  const [openLogForms, setOpenLogForms] = useState<Set<string>>(new Set())
  const [expandedToday, setExpandedToday] = useState(false)
  const [stravaSyncing, setStravaSyncing] = useState(false)
  const [coachMessages, setCoachMessages] = useState<any[]>([])

  useEffect(() => {
    if (!athleteId) return
    const load = async () => {
      setLoading(true)
      try {
        const profileSnap = await getDoc(doc(db, 'users', athleteId))
        if (profileSnap.exists()) {
          const d = profileSnap.data()
          setAthlete({
            id: profileSnap.id, userId: d.userId || profileSnap.id,
            name: d.name || 'Athlete', email: d.email || '', photoURL: d.photoURL,
            events: Array.isArray(d.events) ? d.events : [],
            personalRecords: [], seasonBests: [], trainingPaces: [], goals: [],
            weekSchedule: d.weekSchedule, weeklyKmRange: d.weeklyKmRange,
            offWeekInterval: d.offWeekInterval,
            createdAt: d.createdAt?.toDate?.() || new Date(),
            updatedAt: d.updatedAt?.toDate?.() || new Date(),
          })
          const today = new Date()
          const journeys = await listJourneys(athleteId)
          const active = journeys.find(j =>
            new Date(j.startDate) <= today && new Date(j.goalRaceDate) >= today
          ) || journeys[journeys.length - 1]
          if (active) {
            const progress = computeJourneyProgress(active, today)
            const stage = progress.activeStage
            if (stage) {
              const s = new Date(stage.startDate), e = new Date(stage.endDate)
              const total = Math.max(1, Math.ceil((e.getTime()-s.getTime())/(7*86400000)))
              const cur = Math.max(1, Math.ceil((today.getTime()-s.getTime())/(7*86400000)))
              setJourney({
                stageName: stage.name, weekInStage: cur, totalWeeksInStage: total,
                isOffWeek: cur % (d.offWeekInterval ?? 4) === 0,
                goalRaceDate: active.goalRaceDate, goalRaceEvent: active.goalRaceEvent,
              })
            }
          }
        }
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [athleteId])

  useEffect(() => {
    if (!athleteId) return
    getDocs(query(collection(db, 'coachMessages'), where('athleteId', '==', athleteId)))
      .then(snap => {
        setCoachMessages(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      })
      .catch(() => {})
  }, [athleteId])

  useEffect(() => {
    if (!athleteId) return
    getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId)))
      .then(async snap => {
        setAssignedWorkouts(snap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id })))
        const { getDocs: gd, query: q, collection: col, where: wh } = await import('firebase/firestore')
        const from = format(startOfWeek(new Date(),{weekStartsOn:1}), 'yyyy-MM-dd')
        const to = format(endOfWeek(new Date(),{weekStartsOn:1}), 'yyyy-MM-dd')
        const logsSnap = await gd(q(col(db, 'logs'), wh('athleteId', '==', athleteId)))
        setWeekLogs(logsSnap.docs.map(d => ({ id: d.id, actualDistance: d.data().actualDistance, actualPace: d.data().actualPace, effort: d.data().effort, comment: d.data().comment, workoutId: d.data().workoutId, assignedWorkoutId: d.data().assignedWorkoutId, source: d.data().source, splitLogs: d.data().splitLogs || [], date: d.data().date || '', stravaActivityId: d.data().stravaActivityId, stravaName: d.data().stravaName, averageHeartRate: d.data().averageHeartRate, elevationGain: d.data().elevationGain, feedbackStatus: d.data().feedbackStatus })))
      })
      .catch(err => console.error(err))
  }, [athleteId])

  const getLogForWorkout = (workoutId: string, date: string) => {
    return weekLogs.find(l => l.workoutId === workoutId || l.date === date)
  }

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 })
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [currentDate])

  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const monthWeeks = useMemo(() => eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 0 }), [currentDate])

  const getWorkoutsForDate = useCallback((dateStr: string) =>
    assignedWorkouts.filter(w => w.scheduledDate === dateStr)
  , [assignedWorkouts])

  const getWorkoutsForDay = useCallback((date: Date) =>
    getWorkoutsForDate(format(date, 'yyyy-MM-dd'))
  , [getWorkoutsForDate])

  const getWeekKm = useCallback((days: Date[]) =>
    days.reduce((sum, day) => sum + getWorkoutsForDay(day).reduce((s,w) => s+(w.workout?.distance??0),0), 0)
  , [getWorkoutsForDay])

  // BUG FIX: derive completion status from logs array, not just Firestore status field.
  // When athlete logs a workout the local assignedWorkouts status may lag behind.
  const getEffectiveStatus = useCallback((w: AssignedWorkout): string => {
    if (w.status === 'completed') return 'completed'
    const hasLog = weekLogs.some(l =>
      (l.assignedWorkoutId === w.id || (!l.assignedWorkoutId && l.date === w.scheduledDate)) &&
      !!l.actualDistance && l.source !== 'strava'
    )
    if (hasLog) return 'completed'
    if (w.status === 'skipped') return 'skipped'
    return 'scheduled'
  }, [weekLogs])

  const todayWorkouts = useMemo(() => getWorkoutsForDay(new Date()), [getWorkoutsForDay])

  const weekStartStr = format(startOfWeek(new Date(), {weekStartsOn: 1}), 'yyyy-MM-dd')
  const weekEndStr = format(endOfWeek(new Date(), {weekStartsOn: 1}), 'yyyy-MM-dd')
  const thisWeekKmActual = Math.round(weekLogs.filter(l => l.date >= weekStartStr && l.date <= weekEndStr).reduce((s, l) => s + (l.actualDistance || 0), 0))
  const thisWeekKmPlanned = useMemo(() => {
    const from = format(startOfWeek(new Date(),{weekStartsOn:1}), 'yyyy-MM-dd')
    const to = format(endOfWeek(new Date(),{weekStartsOn:1}), 'yyyy-MM-dd')
    return assignedWorkouts.filter(w => w.scheduledDate>=from && w.scheduledDate<=to)
      .reduce((s,w) => s+(w.workout?.distance??0), 0)
  }, [assignedWorkouts])

  const selectedWorkout = useMemo(() =>
    assignedWorkouts.find(w => w.id === selectedWorkoutId) || null
  , [assignedWorkouts, selectedWorkoutId])

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )

  const renderWorkoutDetail = (w: AssignedWorkout) => (
    <div className="border border-border rounded-xl overflow-hidden bg-white">
      {/* Warmup */}
      {w.workout.warmup && (
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm text-muted-foreground text-right">{t.warmupLabel}: {w.workout.warmup}</p>
        </div>
      )}
      {/* Sets */}
      {w.workout.sets && w.workout.sets.length > 0 && w.workout.sets.map((set: any, si: number) => {
        const hasIntervals = set.intervals && set.intervals.length > 0
        return (
          <div key={set.id||si}>
            {/* Rest between sets separator */}
            {si > 0 && (
              <div className="flex items-center gap-3 px-4" style={{height:'28px'}}>
                <div className="flex-1 h-px bg-border"/>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {set.rest ? `${t.restBetweenSets}: ${set.rest}` : t.continueToNext}
                </span>
                <div className="flex-1 h-px bg-border"/>
              </div>
            )}
            {/* Set header */}
            <div className="px-4 py-3 border-t border-border">
              <p className="text-sm font-bold text-navy text-right">
                סט {si+1}
                {set.reps > 1 && !hasIntervals
                  ? <span className="font-normal"> · {set.reps}× {set.distance||set.duration||''}{set.pace ? ` @ ${set.pace}` : ''}</span>
                  : <>
                    {!hasIntervals && (set.distance||set.duration) && <span className="font-normal"> · {set.distance||set.duration}</span>}
                    {!hasIntervals && set.pace && <span className="font-normal text-muted-foreground"> @ {set.pace}</span>}
                  </>
                }
                {hasIntervals && set.reps > 1 && <span className="font-normal text-muted-foreground"> · {set.reps}×</span>}
              </p>
              {!hasIntervals && set.rest && (
                <p className="text-xs text-muted-foreground text-right mt-1">מנוחה: {set.rest}</p>
              )}
            </div>
            {/* Intervals */}
            {hasIntervals && set.intervals.map((iv: any, ii: number) => (
              <div key={iv.id||ii}>
                <div className="px-4 py-3 border-t border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-navy text-white font-bold flex items-center justify-center text-xs flex-shrink-0">{ii+1}</span>
                    <span className="text-base font-bold text-navy">{iv.distance}</span>
                  </div>
                  {iv.pace && <span className="text-sm text-muted-foreground">@ {iv.pace}</span>}
                </div>
                {iv.rest && (
                  <div className="px-4 py-1.5 border-t border-border/30">
                    <p className="text-xs text-muted-foreground text-right">מנוחה: {iv.rest}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })}
      {/* Cooldown */}
      {w.workout.cooldown && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-sm text-muted-foreground text-right">{t.cooldownLabel}: {w.workout.cooldown}</p>
        </div>
      )}
      {/* Coach notes */}
      {w.workout.notes && (
        <div className="px-4 py-3 border-t border-border">
          <p className="text-sm text-navy text-right">{t.coachNotesLabel}: {w.workout.notes}</p>
        </div>
      )}
      {/* Log form */}
      <div className="border-t border-border">
        {(w.status === 'completed' || openLogForms.has(w.id)) ? (
          <div className="px-4 py-4">
            <WorkoutLogForm
              workoutId={w.workoutId}
              assignedWorkoutId={w.id}
              athleteId={athleteId}
              scheduledDate={w.scheduledDate}
              workout={w.workout}
            />
          </div>
        ) : (
          <button
            onClick={() => setOpenLogForms(prev => new Set([...prev, w.id]))}
            className="w-full px-4 py-3 text-sm font-medium text-navy hover:bg-muted/30 transition-colors text-right">
            + תעד אימון
          </button>
        )}
      </div>
    </div>
  )


  const handleStravaSync = async () => {
    if (!athleteId) return
    setStravaSyncing(true)
    try {
      const { doc, getDoc, collection, addDoc, serverTimestamp, query, where, getDocs } = await import('firebase/firestore')
      const { db } = await import('@/lib/firebase')
      // Get athlete's own stravaId from their user profile
      const userSnap = await getDoc(doc(db, 'users', athleteId))
      const stravaId = userSnap.data()?.stravaId
      if (!stravaId) { toast.error('Strava לא מחובר - חבר Strava מהפרופיל'); return }
      const snap = await getDoc(doc(db, 'strava_connections', `strava_${stravaId}`))
      if (!snap.exists()) { toast.error('Strava לא מחובר'); return }
      const stravaData = snap.data()
      const res = await fetch('/api/strava/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: athleteId, accessToken: stravaData.accessToken, refreshToken: stravaData.refreshToken, expiresAt: stravaData.expiresAt }),
      })
      const data = await res.json()
      if (data.success) {
        let saved = 0
        for (const activity of data.activities) {
          const existing = await getDocs(query(collection(db, 'logs'), where('stravaActivityId', '==', activity.stravaActivityId), where('athleteId', '==', athleteId)))
          if (!existing.empty) continue
          await addDoc(collection(db, 'logs'), {
            athleteId,
            workoutId: `strava_${activity.stravaActivityId}`,
            stravaActivityId: activity.stravaActivityId,
            startTime: activity.startTime || null,
            stravaName: activity.stravaName || '',
            date: activity.date,
            actualDistance: activity.distanceKm,
            actualPace: activity.avgPace,
            effort: null,
            comment: '',
            splitLogs: activity.splitLogs || [],
            averageHeartRate: activity.averageHeartRate || null,
            elevationGain: activity.elevationGain || null,
            source: 'strava',
            feedbackStatus: 'pending',
            createdAt: serverTimestamp(),
          })
          saved++
        }
        toast.success(`סונכרנו ${saved} אימונים חדשים מ-Strava!`)
        // Reload logs
        const logsSnap = await getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId)))
        setWeekLogs(logsSnap.docs.map(d => ({ id: d.id, actualDistance: d.data().actualDistance, actualPace: d.data().actualPace, effort: d.data().effort, comment: d.data().comment, workoutId: d.data().workoutId, assignedWorkoutId: d.data().assignedWorkoutId, source: d.data().source, splitLogs: d.data().splitLogs || [], date: d.data().date || '', stravaActivityId: d.data().stravaActivityId, stravaName: d.data().stravaName, averageHeartRate: d.data().averageHeartRate, elevationGain: d.data().elevationGain, feedbackStatus: d.data().feedbackStatus })))
      }
    } catch (err) { console.error(err); toast.error('סנכרון נכשל') }
    finally { setStravaSyncing(false) }
  }


  const StravaCard = ({ log }: { log: typeof weekLogs[0] }) => {
    const [pendingEffort, setPendingEffort] = useState<number|null>(null)
    const [pendingComment, setPendingComment] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [showDetails, setShowDetails] = useState(false)
    const isPending = log.feedbackStatus === 'pending'

    const handleSubmit = async () => {
      if (!pendingEffort) { toast.error('יש לבחור מאמץ 1-10'); return }
      setSubmitting(true)
      try {
        const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore')
        const { db } = await import('@/lib/firebase')
        await updateDoc(doc(db, 'logs', log.id), { effort: pendingEffort, comment: pendingComment, feedbackStatus: 'done', updatedAt: serverTimestamp() })
        setWeekLogs(prev => prev.map(l => l.id === log.id ? { ...l, effort: pendingEffort, comment: pendingComment, feedbackStatus: 'done' } : l))
        toast.success('תודה! האימון נשמר ✓')
      } catch(e) { console.error(e); toast.error('שגיאה בשמירה') }
      finally { setSubmitting(false) }
    }

    const handleDelete = async () => {
      if (!confirm('למחוק אימון זה?')) return
      try {
        const { doc, deleteDoc } = await import('firebase/firestore')
        const { db } = await import('@/lib/firebase')
        await deleteDoc(doc(db, 'logs', log.id))
        setWeekLogs(prev => prev.filter(l => l.id !== log.id))
        toast.success('אימון נמחק')
      } catch(e) { console.error(e); toast.error('שגיאה במחיקה') }
    }

    const DetailsModal = () => (
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md w-full" dir="rtl">
          <div className="max-h-[75vh] overflow-y-auto pr-1">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right">
              <span className="text-sm bg-orange-500 text-white px-2 py-0.5 rounded font-bold">Strava</span>
              <span>{log.stravaName || 'אימון Strava'}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">פרטי אימון Strava</DialogDescription>
          </DialogHeader>
          {/* Key stats */}
          <div className="grid grid-cols-2 gap-3 py-2">
            {log.actualDistance && (
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-navy">{log.actualDistance}</p>
                <p className="text-xs text-muted-foreground">ק"מ</p>
              </div>
            )}
            {log.actualPace && (
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-navy" dir="ltr">{log.actualPace.replace('/km','')}</p>
                <p className="text-xs text-muted-foreground">טמפו /ק"מ</p>
              </div>
            )}
            {log.averageHeartRate && (
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-600">{log.averageHeartRate}</p>
                <p className="text-xs text-muted-foreground">דופק ממוצע bpm</p>
              </div>
            )}
            {log.elevationGain && (
              <div className="bg-emerald-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-emerald-700">{log.elevationGain}m</p>
                <p className="text-xs text-muted-foreground">עלייה מצטברת</p>
              </div>
            )}
            {log.effort && (
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{log.effort}/10</p>
                <p className="text-xs text-muted-foreground">מאמץ</p>
              </div>
            )}
          </div>
          {/* Comment */}
          {log.comment && !log.comment.startsWith('Synced from Strava:') && (
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">הערה</p>
              <p className="text-sm text-navy italic">"{log.comment}"</p>
            </div>
          )}
          {/* Splits */}
          {log.splitLogs && log.splitLogs.length > 0 && (
            <div>
              <p className="text-sm font-bold text-navy mb-2">פיצולים לק"מ</p>
              <div className="rounded-lg border border-border overflow-hidden">
                <div className="grid grid-cols-5 bg-navy/5 px-2 py-1.5 text-[10px] font-bold text-navy text-center">
                  <span>ק"מ</span>
                  <span>זמן</span>
                  <span>טמפו</span>
                  <span>דופק</span>
                  <span>זון</span>
                </div>
                {log.splitLogs.map((s: any, i: number) => {
                  const pace = s.pace?.replace('/km','') || '—'
                  const zone = s.paceZone || s.notes?.replace('Zone ','') || '—'
                  const hr = s.heartRate || '—'
                  const isfast = s.pace && parseFloat(s.pace) < parseFloat(log.actualPace || '99')
                  return (
                    <div key={i} className={`grid grid-cols-5 px-2 py-2 text-[11px] text-center border-t border-border/40 ${i % 2 === 0 ? 'bg-white' : 'bg-muted/20'}`} dir="ltr">
                      <span className="font-bold text-navy">{i+1}</span>
                      <span className="font-mono">{s.time}</span>
                      <span className={`font-mono font-semibold ${isfast ? 'text-emerald-600' : 'text-navy'}`}>{pace}</span>
                      <span className={`font-mono ${hr !== '—' && hr > 160 ? 'text-red-500' : hr !== '—' && hr > 140 ? 'text-orange-500' : 'text-navy'}`}>{hr}</span>
                      <span className={`font-bold ${zone==='5'||zone==='4' ? 'text-red-500' : zone==='3' ? 'text-orange-500' : zone==='2' ? 'text-amber-500' : 'text-emerald-600'}`}>Z{zone}</span>
                    </div>
                  )
                })}
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 text-center">טמפו ירוק = מהיר מהממוצע · דופק אדום = מעל 160</p>
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>
    )

    // ── STATE 1: Pending feedback ──────────────────────────────────────
    if (isPending) return (
      <>
        <DetailsModal />
        <div className="rounded-2xl border border-border bg-white shadow-sm overflow-hidden" dir="rtl">
          {/* Header */}
          <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-7 w-7 rounded-lg bg-[#FC4C02] flex items-center justify-center flex-shrink-0">
                <span className="text-[10px] font-black text-white">S</span>
              </div>
              <span className="text-sm font-bold text-navy truncate">{log.stravaName || 'אימון Strava'}</span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[11px] bg-amber-50 text-amber-700 border border-amber-200 font-semibold px-2.5 py-1 rounded-full whitespace-nowrap">ממתין למשוב</span>
              <button onClick={handleDelete} className="h-6 w-6 rounded-full hover:bg-red-50 flex items-center justify-center text-muted-foreground/50 hover:text-red-400 transition-colors text-sm">✕</button>
            </div>
          </div>

          {/* Stats pills */}
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {log.actualDistance && <span className="text-xs font-medium bg-muted/60 px-3 py-1.5 rounded-full">{log.actualDistance} ק"מ</span>}
            {log.actualPace && <span className="text-xs font-medium bg-muted/60 px-3 py-1.5 rounded-full" dir="ltr">{log.actualPace}</span>}
            {log.averageHeartRate && <span className="text-xs font-medium bg-red-50 text-red-600 border border-red-100 px-3 py-1.5 rounded-full">{log.averageHeartRate} bpm</span>}
            {log.elevationGain != null && log.elevationGain > 0 && <span className="text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-100 px-3 py-1.5 rounded-full">↑{log.elevationGain}m</span>}
          </div>

          {/* Divider */}
          <div className="border-t border-border/50 mx-4" />

          {/* Effort + comment + submit */}
          <div className="px-4 py-4 space-y-4">
            <div>
              <p className="text-sm font-semibold text-navy mb-3">כמה היה קשה?</p>
              <div className="flex items-center justify-center gap-6">
                <button
                  onClick={() => setPendingEffort(prev => prev != null ? Math.max(1, prev - 1) : 5)}
                  className="w-12 h-12 rounded-full border-2 border-border bg-white hover:bg-muted/40 transition-all flex items-center justify-center text-xl font-bold text-navy shadow-sm select-none">
                  −
                </button>
                <div className="flex flex-col items-center gap-1 min-w-[72px]">
                  <span className={cn('text-5xl font-black leading-none transition-colors',
                    pendingEffort == null ? 'text-muted-foreground/25' :
                    pendingEffort <= 3 ? 'text-emerald-500' :
                    pendingEffort <= 5 ? 'text-green-600' :
                    pendingEffort <= 7 ? 'text-amber-500' :
                    pendingEffort <= 9 ? 'text-orange-500' : 'text-red-500'
                  )}>
                    {pendingEffort ?? '—'}
                  </span>
                  <span className={cn('text-xs font-semibold transition-colors',
                    pendingEffort == null ? 'text-muted-foreground' :
                    pendingEffort <= 3 ? 'text-emerald-500' :
                    pendingEffort <= 5 ? 'text-green-600' :
                    pendingEffort <= 7 ? 'text-amber-500' :
                    pendingEffort <= 9 ? 'text-orange-500' : 'text-red-500'
                  )}>
                    {pendingEffort == null ? 'בחר עצימות' :
                     pendingEffort <= 3 ? 'קל מאוד' :
                     pendingEffort <= 5 ? 'קל' :
                     pendingEffort <= 7 ? 'בינוני' :
                     pendingEffort <= 9 ? 'קשה' : 'מאוד קשה'}
                  </span>
                </div>
                <button
                  onClick={() => setPendingEffort(prev => prev != null ? Math.min(10, prev + 1) : 5)}
                  className="w-12 h-12 rounded-full border-2 border-border bg-white hover:bg-muted/40 transition-all flex items-center justify-center text-xl font-bold text-navy shadow-sm select-none">
                  +
                </button>
              </div>
            </div>

            <textarea
              placeholder="הערה אופציונלית..."
              value={pendingComment}
              onChange={e => setPendingComment(e.target.value)}
              dir="rtl"
              className="w-full rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy/40 transition-all placeholder:text-muted-foreground/60"
            />

            <button
              onClick={handleSubmit}
              disabled={submitting || !pendingEffort}
              className="w-full h-12 rounded-2xl bg-navy hover:bg-navy/90 disabled:opacity-40 text-white text-base font-bold transition-all">
              {submitting ? 'שומר...' : 'שלח משוב למאמן ✓'}
            </button>
          </div>
        </div>
      </>
    )

    // ── STATE 2: Completed Strava activity ─────────────────────────────
    return (
      <>
        <DetailsModal />
        <div className="rounded-2xl border border-emerald-200 border-l-4 border-l-emerald-500 bg-emerald-50/30 overflow-hidden shadow-sm" dir="rtl">
          {/* Header */}
          <div className="px-4 pt-4 pb-3 flex items-center justify-between gap-2">
            <span className="text-sm font-bold text-navy truncate min-w-0">{log.stravaName || 'אימון Strava'}</span>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <span className="text-[11px] bg-emerald-100 text-emerald-700 font-bold px-2.5 py-1 rounded-full">✓ הושלם</span>
              <span className="text-[11px] bg-[#FC4C02]/10 text-[#FC4C02] font-bold px-2 py-1 rounded-full">Strava</span>
              <button onClick={handleDelete} className="h-6 w-6 rounded-full hover:bg-red-50 flex items-center justify-center text-muted-foreground/50 hover:text-red-400 transition-colors text-sm">✕</button>
            </div>
          </div>

          {/* Stats pills */}
          <div className="px-4 pb-3 flex flex-wrap gap-2">
            {log.actualDistance && <span className="text-xs font-medium bg-white border border-border/40 px-3 py-1.5 rounded-full">{log.actualDistance} ק"מ</span>}
            {log.actualPace && <span className="text-xs font-medium bg-white border border-border/40 px-3 py-1.5 rounded-full" dir="ltr">{log.actualPace}</span>}
            {log.averageHeartRate && <span className="text-xs font-medium bg-red-50 text-red-600 border border-red-100 px-3 py-1.5 rounded-full">{log.averageHeartRate} bpm</span>}
            {log.effort != null && (
              <span className={cn('text-xs font-medium px-3 py-1.5 rounded-full border',
                log.effort <= 3 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                log.effort <= 5 ? 'bg-green-100 text-green-700 border-green-200' :
                log.effort <= 7 ? 'bg-amber-100 text-amber-700 border-amber-200' :
                log.effort <= 9 ? 'bg-orange-100 text-orange-700 border-orange-200' :
                'bg-red-100 text-red-700 border-red-200'
              )}>מאמץ {log.effort}/10</span>
            )}
          </div>

          {/* Lap split chips */}
          {log.splitLogs && log.splitLogs.length > 0 && (
            <div className="px-4 pb-3">
              <p className="text-[10px] font-semibold text-muted-foreground mb-2" dir="rtl">פיצולים</p>
              <div className="flex overflow-x-auto gap-2 pb-1" dir="ltr" style={{scrollbarWidth:'none'}}>
                {log.splitLogs.map((s: any, i: number) => (
                  <div key={i} className="flex-shrink-0 rounded-xl bg-white border border-border/50 shadow-sm px-3 py-2 text-center min-w-[68px]">
                    <p className="text-[10px] text-muted-foreground mb-0.5">
                      {s.lapIndex ? `Lap ${s.lapIndex}` : `km ${i + 1}`}
                    </p>
                    <p className="text-xs font-bold text-navy">{s.pace?.replace('/km','') || s.time}</p>
                    {s.heartRate && <p className="text-[10px] text-red-500 mt-0.5">{s.heartRate}</p>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer: comment + details button */}
          <div className="px-4 pb-4 flex items-center justify-between gap-3">
            {log.comment && !log.comment.startsWith('Synced from Strava:') ? (
              <p className="text-xs text-muted-foreground italic line-clamp-1 flex-1">"{log.comment}"</p>
            ) : <div className="flex-1" />}
            <button
              onClick={() => setShowDetails(true)}
              className="flex-shrink-0 text-xs font-medium text-navy border border-navy/25 rounded-full px-3 py-1.5 hover:bg-navy/5 transition-colors">
              פרטים מלאים
            </button>
          </div>
        </div>
      </>
    )
  }


  return (
    <div className="space-y-4 pb-24" dir="rtl">

      {/* Calendar */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
          {/* Nav + Toggle */}
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='day' ? new Date(d.getTime()-86400000) : viewMode==='week' ? subWeeks(d,1) : subMonths(d,1))}>
              <ChevronRight className="h-4 w-4"/>
            </Button>
            <div className="flex flex-col items-center gap-1.5">
              <p className="font-semibold text-navy text-base">
                {viewMode==='day'
                  ? format(currentDate,'EEEE, d MMM yyyy')
                  : viewMode==='week'
                  ? `${format(weekStart,'d MMM')} – ${format(weekEnd,'d MMM yyyy')}`
                  : format(currentDate,'MMMM yyyy')}
              </p>
              <div className="flex gap-1 bg-muted rounded-full p-0.5">
                <button onClick={() => setViewMode('day')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='day' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>{t.dayView}</button>
                <button onClick={() => setViewMode('week')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='week' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>{t.weekView}</button>
                <button onClick={() => setViewMode('month')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='month' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>{t.monthView}</button>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='day' ? new Date(d.getTime()+86400000) : viewMode==='week' ? addWeeks(d,1) : addMonths(d,1))}>
              <ChevronLeft className="h-4 w-4"/>
            </Button>
          </div>

          {/* Strava Sync Button */}
          <div className="flex justify-end mb-2">
            <button
              onClick={handleStravaSync}
              disabled={stravaSyncing}
              className="text-xs px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white font-medium transition-colors flex items-center gap-1.5"
            >
              {stravaSyncing ? '⏳ מסנכרן...' : '🚴 סנכרן Strava'}
            </button>
          </div>

          {/* Day View - same as week view single column */}
          {viewMode === 'day' && (
            <div className="space-y-3">
              <div className={cn('rounded-xl border-2 min-h-[100px] p-3',
                isToday(currentDate) ? 'border-gold bg-gold/5' : 'border-border'
              )}>
                <p className={cn('text-xs font-bold mb-2 text-right', isToday(currentDate) ? 'text-gold' : 'text-muted-foreground')}>
                  {format(currentDate,'EEEE, d MMMM')}
                </p>
                {(() => {
                  const dayWorkouts = getWorkoutsForDay(currentDate)
                  const dateStrCheck = format(currentDate, 'yyyy-MM-dd')
                  const stravaLogsCheck = weekLogs.filter(l => l.date === dateStrCheck && l.source === 'strava')
                  if (dayWorkouts.length === 0 && stravaLogsCheck.length === 0) return (
                    <p className="text-sm text-muted-foreground text-center py-4">אין אימון מתוכנן</p>
                  )
                  return (
                    <div className="space-y-1.5">
                      {/* All assigned workouts */}
                      {dayWorkouts.map(w => {
                        const msg = coachMessages.find(m => m.assignedWorkoutId === w.id)
                        return (
                          <div key={w.id} className="space-y-1">
                            <button
                              onClick={() => setSelectedWorkoutId(prev => prev === w.id ? null : w.id)}
                              className={cn('w-full rounded-lg px-2.5 py-2 border transition-all hover:opacity-80',
                                TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                selectedWorkoutId === w.id ? 'ring-2 ring-navy' : ''
                              )}>
                              <div className="flex items-center justify-between gap-1 w-full" dir="rtl">
                                <p className="font-semibold text-sm leading-snug">{w.workout.title}</p>
                                <p className="text-xs opacity-70">
                                  {w.workout.distance && `${w.workout.distance}k`}
                                  {w.workout.duration && ` · ${w.workout.duration}'`}
                                </p>
                              </div>
                            </button>
                            {msg && (
                              <div className={cn(
                                'rounded-xl border bg-white px-3 py-2.5 space-y-1',
                                !msg.read ? 'border-t-2 border-t-[#c9a84c] border-gray-100' : 'border-gray-100'
                              )} dir="rtl">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-[10px] font-semibold text-[#c9a84c] uppercase tracking-wide">הערת מאמן</p>
                                  {msg.createdAt?.seconds && (
                                    <p className="text-[9px] text-gray-400">{format(new Date(msg.createdAt.seconds * 1000), 'd/M/yyyy')}</p>
                                  )}
                                </div>
                                <p className="text-sm text-[#0a1628] leading-relaxed">{msg.message}</p>
                                {!msg.read && (
                                  <button
                                    onClick={async () => {
                                      try {
                                        await updateDoc(doc(db, 'coachMessages', msg.id), { read: true })
                                        setCoachMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true } : m))
                                      } catch {}
                                    }}
                                    className="text-[10px] text-gray-400 hover:text-gray-600 underline underline-offset-2 transition-colors"
                                  >
                                    סמן כנקרא
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })}

                      {/* Divider — only if any logs exist */}
                      {dayWorkouts.some(w => weekLogs.find(l => (l.assignedWorkoutId === w.id || (!l.assignedWorkoutId && l.date === w.scheduledDate)) && l.actualDistance && l.source !== 'strava')) && (
                        <div className="flex items-center gap-2 my-1">
                          <div className="flex-1 border-t border-emerald-200" />
                          <span className="text-xs text-emerald-600 font-medium">ביצוע</span>
                          <div className="flex-1 border-t border-emerald-200" />
                        </div>
                      )}

                      {/* All completed logs */}
                      {dayWorkouts.map(w => {
                        const log = weekLogs.find(l => l.assignedWorkoutId === w.id && !!l.actualDistance && l.source !== 'strava') || weekLogs.find(l => !l.assignedWorkoutId && l.date === w.scheduledDate && !!l.actualDistance && l.source !== 'strava')
                        if (!log) return null
                        return (
                          <div key={w.id} className="rounded-2xl border border-emerald-200 border-l-4 border-l-emerald-500 bg-emerald-50/30 overflow-hidden shadow-sm" dir="rtl">
                            <div className="px-4 pt-3.5 pb-2 flex items-center justify-between gap-2">
                              <span className="text-sm font-bold text-navy truncate min-w-0">{w.workout.title}</span>
                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                <span className="text-[11px] bg-emerald-100 text-emerald-700 font-bold px-2.5 py-1 rounded-full">✓ הושלם</span>
                                <button
                                  onClick={async () => {
                                    if (!confirm('למחוק את תיעוד האימון?')) return
                                    try {
                                      const { doc, deleteDoc, updateDoc } = await import('firebase/firestore')
                                      const { db } = await import('@/lib/firebase')
                                      if (log.id) await deleteDoc(doc(db, 'logs', log.id))
                                      await updateDoc(doc(db, 'assignedWorkouts', w.id), { status: 'scheduled', completedAt: null })
                                      setWeekLogs(prev => prev.filter(l => l.id !== log.id))
                                      toast.success('תיעוד נמחק')
                                    } catch(e) { console.error(e); toast.error('שגיאה במחיקה') }
                                  }}
                                  className="h-6 w-6 rounded-full hover:bg-red-50 flex items-center justify-center text-muted-foreground/50 hover:text-red-400 transition-colors text-sm">✕</button>
                              </div>
                            </div>
                            <div className="px-4 pb-3 flex flex-wrap gap-2">
                              {log.actualDistance && <span className="text-xs font-medium bg-white border border-border/40 px-3 py-1.5 rounded-full">{log.actualDistance} ק"מ</span>}
                              {log.actualPace && <span className="text-xs font-medium bg-white border border-border/40 px-3 py-1.5 rounded-full" dir="ltr">{log.actualPace}</span>}
                              {log.effort != null && (
                                <span className={cn('text-xs font-medium px-3 py-1.5 rounded-full border',
                                  log.effort <= 3 ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                                  log.effort <= 5 ? 'bg-green-100 text-green-700 border-green-200' :
                                  log.effort <= 7 ? 'bg-amber-100 text-amber-700 border-amber-200' :
                                  log.effort <= 9 ? 'bg-orange-100 text-orange-700 border-orange-200' :
                                  'bg-red-100 text-red-700 border-red-200'
                                )}>מאמץ {log.effort}/10</span>
                              )}
                            </div>
                            {log.comment && <p className="px-4 pb-3.5 text-xs text-muted-foreground italic line-clamp-1">"{log.comment}"</p>}
                          </div>
                        )
                      })}
                      {/* Strava standalone logs for this day - shown after sync */}
                      {(() => {
                        const dateStr = format(currentDate, 'yyyy-MM-dd')
                        const stravaLogs = weekLogs.filter(l =>
                          l.date === dateStr &&
                          l.source === 'strava'
                        )
                        if (!stravaLogs.length) return null
                        return (
                          <div className="space-y-1.5 mt-1">
                            <div className="flex items-center gap-2 my-1">
                              <div className="flex-1 border-t border-orange-200" />
                              <span className="text-xs text-orange-600 font-medium">Strava</span>
                              <div className="flex-1 border-t border-orange-200" />
                            </div>
                            {stravaLogs.map(log => <StravaCard key={log.id} log={log} />)}
                          </div>
                        )
                      })()}
                    </div>
                  )
                })()}
              </div>
              {selectedWorkoutId && (() => {
                const w = getWorkoutsForDay(currentDate).find(x => x.id === selectedWorkoutId)
                if (!w) return null
                return (
                  <div>
                    <p className="font-bold text-navy text-base px-1 mb-1 text-right">{w.workout.title}</p>
                    <div className="flex gap-3 text-sm text-muted-foreground px-1 mb-2 justify-end">
                      {w.workout.distance && <span>{w.workout.distance} ק"מ</span>}
                      {w.workout.duration && <span>{w.workout.duration} דק'</span>}
                    </div>
                    {renderWorkoutDetail(w)}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Week View */}
          {viewMode === 'week' && (
            <div>
              {/* Week grid - always horizontal, scrollable on mobile */}
              <div className="overflow-x-auto pb-2">
                <div style={{minWidth:'600px'}}>
                  <div className="grid grid-cols-8 gap-1.5 mb-1.5">
                    {weekDays.map((_,i) => (
                      <div key={i} className="text-center text-xs font-bold text-navy py-1">
                        {language === 'he' ? DAY_HE_LABELS[i] : DAY_EN[i]}
                      </div>
                    ))}
                    <div className="text-center text-xs font-bold text-navy py-1">ק"מ</div>
                  </div>
                  <div className="grid grid-cols-8 gap-1.5">
                    {weekDays.map((day, di) => {
                      const dayWorkouts = getWorkoutsForDay(day)
                      const todayFlag = isToday(day)
                      const hasCompleted = dayWorkouts.some(w => getEffectiveStatus(w) === 'completed')
                      return (
                        <div key={di} className={cn('min-h-[150px] rounded-xl border transition-all',
                          todayFlag ? 'border-gold bg-gold/5' : 'border-border',
                        )}>
                          <div className="p-1.5 border-b border-border/40 text-center">
                            <p className={cn('text-xs font-bold', todayFlag ? 'text-gold' : 'text-navy/70')}>{format(day,'d')}</p>
                            {hasCompleted && <span className="text-[9px] text-emerald-500">✓</span>}
                          </div>
                          <div className="p-1.5 space-y-1">
                            {dayWorkouts.map(w => {
                              const effStatus = getEffectiveStatus(w)
                              const hasMsg = coachMessages.some(m => m.assignedWorkoutId === w.id && !m.read)
                              return (
                                <button key={w.id}
                                  onClick={() => setSelectedWorkoutId(prev => prev === w.id ? null : w.id)}
                                  className={cn('w-full text-left text-[11px] rounded-lg px-2 py-2 border leading-snug transition-all hover:opacity-80',
                                    TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                    effStatus === 'completed' ? 'opacity-60' : '',
                                    selectedWorkoutId === w.id ? 'ring-2 ring-navy' : ''
                                  )}>
                                  <p className="font-semibold leading-snug text-xs break-words">{w.workout?.title}</p>
                                  {w.workout?.distance && <p className="opacity-70 text-[10px] mt-0.5">{w.workout.distance}k</p>}
                                  {w.workout?.duration && !w.workout?.distance && <p className="opacity-70">{w.workout.duration}'</p>}
                                  {effStatus === 'completed' && <p className="text-emerald-700 text-[9px] font-bold mt-0.5">הושלם</p>}
                                  {hasMsg && <span className="inline-block w-1.5 h-1.5 bg-[#c9a84c] rounded-full mt-0.5"/>}
                                </button>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                    {/* KM column */}
                    <div className="flex flex-col items-center justify-center rounded-xl bg-muted/30 border border-border/30 min-h-[130px] gap-1">
                      <div className="text-center">
                        <p className="text-lg font-bold text-navy">{getWeekKm(weekDays)}</p>
                        <p className="text-[10px] text-muted-foreground">מתוכנן</p>
                      </div>
                      {thisWeekKmActual > 0 && <>
                        <div className="w-8 h-px bg-border"/>
                        <div className="text-center">
                          <p className="text-base font-bold text-emerald-600">{thisWeekKmActual}</p>
                          <p className="text-[10px] text-emerald-600">בוצע</p>
                        </div>
                      </>}
                    </div>
                  </div>
                </div>
              </div>

              {/* Selected workout detail */}
              {selectedWorkout && (
                <div className="mt-4 rounded-xl border border-gold/30 bg-gold/5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-navy text-base">{selectedWorkout.workout.title}</p>
                      <p className="text-xs text-muted-foreground">{format(parseISO(selectedWorkout.scheduledDate),'EEEE, d MMMM')}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {(() => {
                        const s = getEffectiveStatus(selectedWorkout)
                        return <>
                          <span className={cn('w-2.5 h-2.5 rounded-full', s==='completed' ? 'bg-emerald-500' : s==='skipped' ? 'bg-red-400' : 'bg-amber-400')}/>
                          <span className="text-xs text-muted-foreground">{s==='completed'?t.completedBadge:s==='skipped'?t.skippedBadge:t.scheduledBadge}</span>
                        </>
                      })()}
                    </div>
                  </div>
                  {renderWorkoutDetail(selectedWorkout)}
                </div>
              )}
            </div>
          )}

          {/* Month View */}
          {viewMode === 'month' && (
            <div>
              <div className="overflow-x-auto pb-2">
                <div style={{minWidth:'360px'}}>
                  <div className="grid grid-cols-8 gap-1 mb-1">
                    {(language === 'he' ? DAY_HE_LABELS : DAY_EN).map((d,i) => (
                      <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
                    ))}
                    <div className="text-center text-[10px] font-medium text-muted-foreground py-1">ק"מ</div>
                  </div>
                  <div className="space-y-1">
                    {monthWeeks.map((weekStartDay, wi) => {
                      const days = eachDayOfInterval({ start: weekStartDay, end: endOfWeek(weekStartDay,{weekStartsOn:0}) })
                      const wKm = getWeekKm(days)
                      return (
                        <div key={wi} className="grid grid-cols-8 gap-1">
                          {days.map((day, di) => {
                            const inMonth = isSameMonth(day, currentDate)
                            const dayWorkouts = getWorkoutsForDay(day)
                            const todayFlag = isToday(day)
                            const hasCompleted = dayWorkouts.some(w => getEffectiveStatus(w) === 'completed')
                            const selectedInDay = dayWorkouts.some(w => w.id === selectedWorkoutId)
                            const hasUnreadMsg = dayWorkouts.some(w => coachMessages.some(m => m.assignedWorkoutId === w.id && !m.read))
                            return (
                              <div key={di}
                                className={cn('min-h-[80px] rounded-lg p-1 text-left border transition-all',
                                  !inMonth ? 'opacity-20 border-transparent pointer-events-none' : 'border-border',
                                  todayFlag ? 'border-gold/60 bg-gold/5' : '',
                                  selectedInDay ? 'ring-2 ring-gold border-gold' : '',
                                )}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className={cn('text-[10px] font-semibold', todayFlag ? 'text-gold' : 'text-navy')}>{format(day,'d')}</span>
                                  <div className="flex items-center gap-0.5">
                                    {hasCompleted && <span className="text-emerald-500 text-[9px]">✓</span>}
                                    {hasUnreadMsg && <span className="w-1.5 h-1.5 bg-[#c9a84c] rounded-full inline-block"/>}
                                  </div>
                                </div>
                                <div className="space-y-0.5">
                                  {dayWorkouts.slice(0,2).map(w => (
                                    <button key={w.id}
                                      onClick={() => inMonth && setSelectedWorkoutId(prev => prev === w.id ? null : w.id)}
                                      className={cn('w-full text-left text-[8px] rounded px-0.5 py-1 truncate border transition-all hover:opacity-75',
                                        TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                        getEffectiveStatus(w) === 'completed' ? 'opacity-60' : '',
                                        selectedWorkoutId === w.id ? 'ring-1 ring-navy font-bold' : ''
                                      )}>
                                      {getEffectiveStatus(w) === 'completed' ? '✓ ' : ''}{w.workout?.title}
                                    </button>
                                  ))}
                                  {dayWorkouts.length > 2 && <p className="text-[8px] text-muted-foreground">+{dayWorkouts.length-2}</p>}
                                </div>
                              </div>
                            )
                          })}
                          {(() => {
                            const wDone = Math.round(days.reduce((s,d) => {
                              const dStr = format(d,'yyyy-MM-dd')
                              return s + weekLogs.filter(l=>l.date===dStr).reduce((a,l)=>a+(l.actualDistance||0),0)
                            },0))
                            return (
                              <div className="flex flex-col items-center justify-center rounded-lg bg-muted/30 p-1 gap-0.5">
                                {wKm > 0 ? (
                                  <div className="text-center">
                                    <p className="text-[10px] font-bold text-navy">{wKm}</p>
                                    <p className="text-[8px] text-muted-foreground">plan</p>
                                  </div>
                                ) : <p className="text-[9px] text-muted-foreground">—</p>}
                                {wDone > 0 && (
                                  <div className="text-center border-t border-border/40 pt-0.5 w-full">
                                    <p className="text-[10px] font-bold text-emerald-600">{wDone}</p>
                                    <p className="text-[8px] text-emerald-600">done</p>
                                  </div>
                                )}
                              </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Selected workout detail */}
              {selectedWorkout && (
                <div className="mt-4 rounded-xl border border-gold/30 bg-gold/5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-navy text-base">{selectedWorkout.workout.title}</p>
                      <p className="text-xs text-muted-foreground">{format(parseISO(selectedWorkout.scheduledDate),'EEEE, d MMMM')}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {(() => {
                        const s = getEffectiveStatus(selectedWorkout)
                        return <>
                          <span className={cn('w-2.5 h-2.5 rounded-full', s==='completed' ? 'bg-emerald-500' : s==='skipped' ? 'bg-red-400' : 'bg-amber-400')}/>
                          <span className="text-xs text-muted-foreground">{s==='completed'?t.completedBadge:s==='skipped'?t.skippedBadge:t.scheduledBadge}</span>
                        </>
                      })()}
                    </div>
                  </div>
                  {renderWorkoutDetail(selectedWorkout)}
                </div>
              )}
            </div>
          )}
      </div>

      {/* Bottom Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* שלב העונה */}
        {journey && (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">שלב העונה</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold bg-[#0a1628]/10 text-[#0a1628] px-3 py-1 rounded-full">{journey.stageName}</span>
                <span className="text-sm font-semibold text-[#0a1628]">שבוע {journey.weekInStage}/{journey.totalWeeksInStage}</span>
                <span className={cn('text-xs font-bold px-3 py-1 rounded-full', journey.isOffWeek ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                  {journey.isOffWeek ? 'שבוע מנוחה' : 'שבוע אימון'}
                </span>
              </div>
              {journey.goalRaceEvent && (
                <p className="text-xs text-gray-500">{journey.goalRaceEvent} · {format(parseISO(journey.goalRaceDate),'MMM d, yyyy')}</p>
              )}
            </div>
          </div>
        )}

        {/* ק"מ השבוע */}
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">ק"מ השבוע</p>
          {athlete?.weeklyKmRange ? (
            <div className="space-y-3">
              <div className="flex items-end gap-2 flex-wrap">
                <span className="text-3xl font-black text-[#0a1628]">{thisWeekKmActual}</span>
                <span className="text-sm text-gray-400 mb-1">/ {athlete.weeklyKmRange.min}–{athlete.weeklyKmRange.max} ק"מ</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className={cn('h-2 rounded-full transition-all', thisWeekKmActual >= athlete.weeklyKmRange.min ? 'bg-emerald-500' : 'bg-[#c9a84c]')}
                  style={{width:`${Math.min(100,(thisWeekKmActual/athlete.weeklyKmRange.max)*100)}%`}}/>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{thisWeekKmActual >= athlete.weeklyKmRange.min ? 'יעד השבוע הושג!' : `נותרו ${Math.max(0,athlete.weeklyKmRange.min-thisWeekKmActual)} ק"מ`}</span>
                <span>מתוכנן: {thisWeekKmPlanned} ק"מ</span>
              </div>
            </div>
          ) : <p className="text-sm text-gray-500">לא הוגדר יעד ק"מ</p>}
        </div>
      </div>
    </div>
  )
}
