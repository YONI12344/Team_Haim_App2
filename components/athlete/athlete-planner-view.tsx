'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Loader2, MapPin, Clock, ChevronDown, ChevronUp, RefreshCw, CheckCircle2, Plus, CalendarClock } from 'lucide-react'
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
import { useWorkoutTypeLabels } from '@/lib/workout-labels'
import { toast } from 'sonner'
import { WorkoutLogForm } from '@/components/athlete/workout-log-form'
import { ManualLogCard } from '@/components/shared/manual-log-card'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AddActivityDialog } from '@/components/athlete/add-activity-dialog'
import { MoveWorkoutDialog } from '@/components/athlete/move-workout-dialog'
import {
  getActivityInfo, getActivityKind, isRunningKind, isGymKind,
  formatDurationMin, activityLabel,
  STRAVA_RUNNING_TYPES, STRAVA_GYM_TYPES,
} from '@/lib/activity-types'

const WEEKDAY_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const

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
  strength: 'bg-rose-100 text-rose-700 border-rose-200',
  cross_training: 'bg-teal-100 text-teal-700 border-teal-200',
  swim: 'bg-sky-100 text-sky-700 border-sky-200',
  bike: 'bg-indigo-100 text-indigo-700 border-indigo-200',
  time_trial: 'bg-indigo-100 text-indigo-700 border-indigo-200',
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  skipped: 'bg-red-100 text-red-600 border-red-200',
  scheduled: 'bg-amber-100 text-amber-700 border-amber-200',
}

const TYPE_BORDER_COLORS: Record<string, string> = {
  easy: 'border-l-emerald-500',
  long_run: 'border-l-orange-500',
  tempo: 'border-l-purple-500',
  intervals: 'border-l-blue-500',
  hill_repeats: 'border-l-amber-500',
  fartlek: 'border-l-cyan-500',
  recovery: 'border-l-gray-400',
  rest: 'border-l-gray-300',
  race: 'border-l-red-500',
  time_trial: 'border-l-indigo-500',
  strength: 'border-l-rose-500',
  cross_training: 'border-l-teal-500',
  swim: 'border-l-sky-500',
  bike: 'border-l-indigo-400',
}

const TYPE_DOT_COLORS: Record<string, string> = {
  easy: 'bg-emerald-500',
  long_run: 'bg-orange-500',
  tempo: 'bg-purple-500',
  intervals: 'bg-blue-500',
  hill_repeats: 'bg-amber-500',
  fartlek: 'bg-cyan-500',
  recovery: 'bg-gray-400',
  rest: 'bg-gray-300',
  race: 'bg-red-500',
  time_trial: 'bg-indigo-500',
  strength: 'bg-rose-500',
  cross_training: 'bg-teal-500',
  swim: 'bg-sky-500',
  bike: 'bg-indigo-400',
}

interface JourneySummary {
  stageName: string; weekInStage: number; totalWeeksInStage: number
  isOffWeek: boolean; goalRaceDate: string; goalRaceEvent: string
}

interface WeekLog {
  id: string
  actualDistance?: number
  actualPace?: string
  effort?: number
  comment?: string
  workoutId?: string
  assignedWorkoutId?: string
  source?: string
  splitLogs?: any[]
  date: string
  stravaActivityId?: string
  stravaName?: string
  averageHeartRate?: number
  elevationGain?: number
  feedbackStatus?: string
  stravaType?: string
  activityType?: string
  durationMin?: number
}

function mapLogDoc(d: { id: string; data: () => any }): WeekLog {
  const v = d.data()
  return {
    id: d.id,
    actualDistance: v.actualDistance,
    actualPace: v.actualPace,
    effort: v.effort,
    comment: v.comment,
    workoutId: v.workoutId,
    assignedWorkoutId: v.assignedWorkoutId,
    source: v.source,
    splitLogs: v.splitLogs || [],
    date: v.date || '',
    stravaActivityId: v.stravaActivityId,
    stravaName: v.stravaName,
    averageHeartRate: v.averageHeartRate,
    elevationGain: v.elevationGain,
    feedbackStatus: v.feedbackStatus,
    stravaType: v.stravaType,
    activityType: v.activityType,
    durationMin: v.durationMin,
  }
}

/** Logs that render as standalone activity cards (Strava sync or manual upload) */
const isActivityLog = (l: WeekLog) => l.source === 'strava' || l.source === 'manual'

export function AthletePlannerView({ overrideAthleteId }: { overrideAthleteId?: string } = {}) {
  const { user } = useAuth()
  const { t, isRTL } = useLanguage()
  const typeLabels = useWorkoutTypeLabels()
  const dayShort = [t.sun, t.mon, t.tue, t.wed, t.thu, t.fri, t.sat]
  const dayLabels = [t.sun, t.mon, t.tue, t.wed, t.thu, t.fri, t.sat]
  const dayEN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const formatHeDateLong = (d: Date) => d.toLocaleDateString(isRTL ? 'he-IL' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const athleteId = overrideAthleteId || user?.id || ''
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  const [journey, setJourney] = useState<JourneySummary | null>(null)
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [weekLogs, setWeekLogs] = useState<WeekLog[]>([])
  const [addActivityOpen, setAddActivityOpen] = useState(false)
  const [addActivityDate, setAddActivityDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'))
  const [moveWorkoutTarget, setMoveWorkoutTarget] = useState<AssignedWorkout | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(() => {
    // If ?date=YYYY-MM-DD is in the URL, jump straight to that date
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('date')
      if (p) { const d = new Date(p); if (!isNaN(d.getTime())) return d }
    }
    return new Date()
  })
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('day')
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null)
  const [openLogForms, setOpenLogForms] = useState<Set<string>>(new Set())
  const [expandedToday, setExpandedToday] = useState(false)
  const [stravaSyncing, setStravaSyncing] = useState(false)
  const [coachMessages, setCoachMessages] = useState<any[]>([])
  const [selectedWeekDay, setSelectedWeekDay] = useState<Date>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('date')
      if (p) { const d = new Date(p); if (!isNaN(d.getTime())) return d }
    }
    return new Date()
  })

  // When ?date= is in the URL (e.g. from dashboard pending-feedback link), jump to that date
  useEffect(() => {
    if (typeof window === 'undefined') return
    const p = new URLSearchParams(window.location.search).get('date')
    if (!p) return
    const d = new Date(p)
    if (!isNaN(d.getTime())) {
      setCurrentDate(d)
      setSelectedWeekDay(d)
    }
  }, [])

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
            weekStartDay: d.weekStartDay === 1 ? 1 : 0,
            kmWeekStartDay: d.kmWeekStartDay === 0 ? 0 : 1,
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

  // Per-athlete week settings (calendar display + weekly-km counting)
  const calWeekStartsOn: 0 | 1 = athlete?.weekStartDay === 1 ? 1 : 0
  const kmWeekStartsOn: 0 | 1 = athlete?.kmWeekStartDay === 0 ? 0 : 1
  // Day labels rotated to match the athlete's week start
  const rotateDays = <T,>(a: T[]): T[] => [...a.slice(calWeekStartsOn), ...a.slice(0, calWeekStartsOn)]
  const dayShortRot = rotateDays(dayShort)
  const dayLabelsRot = rotateDays(isRTL ? dayLabels : dayEN)

  useEffect(() => {
    if (viewMode !== 'week') return
    const ws = startOfWeek(currentDate, { weekStartsOn: calWeekStartsOn })
    const we = endOfWeek(currentDate, { weekStartsOn: calWeekStartsOn })
    if (selectedWeekDay < ws || selectedWeekDay > we) {
      const today = new Date()
      setSelectedWeekDay(today >= ws && today <= we ? today : ws)
    }
  }, [currentDate, viewMode])

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
        setWeekLogs(logsSnap.docs.map(mapLogDoc))
      })
      .catch(err => console.error(err))
  }, [athleteId])

  const getLogForWorkout = (workoutId: string, date: string) => {
    return weekLogs.find(l => l.workoutId === workoutId || l.date === date)
  }

  const weekStart = startOfWeek(currentDate, { weekStartsOn: calWeekStartsOn })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: calWeekStartsOn })
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [currentDate])

  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const monthWeeks = useMemo(() => eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: calWeekStartsOn }), [currentDate, calWeekStartsOn])

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
      !!l.actualDistance && !isActivityLog(l)
    )
    if (hasLog) return 'completed'
    if (w.status === 'skipped') return 'skipped'
    return 'scheduled'
  }, [weekLogs])

  const todayWorkouts = useMemo(() => getWorkoutsForDay(new Date()), [getWorkoutsForDay])

  const weekStartStr = format(startOfWeek(new Date(), {weekStartsOn: kmWeekStartsOn}), 'yyyy-MM-dd')
  const weekEndStr = format(endOfWeek(new Date(), {weekStartsOn: kmWeekStartsOn}), 'yyyy-MM-dd')
  const thisWeekKmActual = Math.round(weekLogs.filter(l => l.date >= weekStartStr && l.date <= weekEndStr).reduce((s, l) => s + (l.actualDistance || 0), 0))
  const thisWeekKmPlanned = useMemo(() => {
    const from = format(startOfWeek(new Date(),{weekStartsOn:kmWeekStartsOn}), 'yyyy-MM-dd')
    const to = format(endOfWeek(new Date(),{weekStartsOn:kmWeekStartsOn}), 'yyyy-MM-dd')
    return assignedWorkouts.filter(w => w.scheduledDate>=from && w.scheduledDate<=to)
      .reduce((s,w) => s+(w.workout?.distance??0), 0)
  }, [assignedWorkouts, kmWeekStartsOn])

  const selectedWorkout = useMemo(() =>
    assignedWorkouts.find(w => w.id === selectedWorkoutId) || null
  , [assignedWorkouts, selectedWorkoutId])

  const computeStravaMatch = useCallback((w: AssignedWorkout, dateStr: string) => {
    try {
      const activityLogs = weekLogs.filter(l => l.date === dateStr && isActivityLog(l))
      if (activityLogs.length === 0) return null
      const workoutType = w.workout?.type || ''
      const isStrengthW = ['strength', 'cross_training'].includes(workoutType)
      if (isStrengthW) {
        const gymLog = activityLogs.find(l => isGymKind(getActivityKind(l)))
        if (!gymLog) return null
        return { status: 'completed' as const, actual: gymLog.actualDistance || 0, planned: 0 }
      }
      if (workoutType === 'swim' || workoutType === 'bike') {
        const match = activityLogs.find(l => {
          const k = getActivityKind(l)
          return workoutType === 'swim' ? k === 'swim' : k === 'ride'
        })
        if (!match) return null
        return { status: 'completed' as const, actual: match.actualDistance || 0, planned: 0 }
      }
      const runLogs = activityLogs.filter(l => isRunningKind(getActivityKind(l)))
      if (runLogs.length === 0) return null
      const totalActual = Math.round(runLogs.reduce((s, l) => s + (l.actualDistance || 0), 0) * 100) / 100
      const planned = w.workout?.distance ?? 0
      if (planned === 0) return { status: 'completed' as const, actual: totalActual, planned: 0 }
      const ratio = totalActual / planned
      if (ratio >= 0.7) return { status: 'completed' as const, actual: totalActual, planned }
      if (ratio >= 0.5) return { status: 'partial' as const, actual: totalActual, planned }
      return { status: 'none' as const, actual: totalActual, planned }
    } catch { return null }
  }, [weekLogs])

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )

  const renderWorkoutDetail = (w: AssignedWorkout) => (
    <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white">
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
            {/* Rest between sets separator — use PREVIOUS set's rest */}
            {si > 0 && (
              <div className="flex items-center gap-3 px-4" style={{height:'28px'}}>
                <div className="flex-1 h-px bg-border"/>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {(w.workout.sets as any[])[si - 1]?.rest
                    ? `${t.restBetweenSets}: ${(w.workout.sets as any[])[si - 1].rest}`
                    : t.continueToNext}
                </span>
                <div className="flex-1 h-px bg-border"/>
              </div>
            )}
            {/* Set header */}
            <div className="px-4 py-3 border-t border-border">
              <p className="text-sm font-bold text-navy text-right">
                {t.setLabelPrefix} {si+1}
                {set.reps > 1 && !hasIntervals
                  ? <span className="font-normal"> · {set.reps}× {set.distance||set.duration||''}{set.pace ? ` @ ${set.pace}` : ''}</span>
                  : <>
                    {!hasIntervals && (set.distance||set.duration) && <span className="font-normal"> · {set.distance||set.duration}</span>}
                    {!hasIntervals && set.pace && <span className="font-normal text-muted-foreground"> @ {set.pace}</span>}
                  </>
                }
                {hasIntervals && set.reps > 1 && <span className="font-normal text-muted-foreground"> · {set.reps}×</span>}
              </p>
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
                    <p className="text-xs text-muted-foreground text-right">{t.restPrefix} {iv.rest}</p>
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
      {/* עדכן אימון / Strava / log form */}
      <div className="border-t border-border">
        {(() => {
          const stravaForDate = weekLogs.find(l => l.date === w.scheduledDate && l.source === 'strava')
          const hasManualLog = weekLogs.find(l =>
            (l.assignedWorkoutId === w.id || (!l.assignedWorkoutId && l.date === w.scheduledDate))
            && !!l.actualDistance && !isActivityLog(l)
          )
          const formOpen = openLogForms.has(w.id)
          const stravaAwaitingFeedback = stravaForDate?.feedbackStatus === 'pending'
          if (formOpen || (w.status === 'completed' && !hasManualLog) || stravaAwaitingFeedback) return (
            <div className="px-4 py-4">
              <WorkoutLogForm
                workoutId={w.workoutId}
                assignedWorkoutId={w.id}
                athleteId={athleteId}
                scheduledDate={w.scheduledDate}
                workout={w.workout}
              />
            </div>
          )
          if (hasManualLog) return (
            <div className="p-4">
              <ManualLogCard
                distance={hasManualLog.actualDistance}
                pace={hasManualLog.actualPace}
                effort={hasManualLog.effort}
                comment={hasManualLog.comment}
                splitLogs={hasManualLog.splitLogs}
                onEdit={() => setOpenLogForms(prev => new Set([...prev, w.id]))}
              />
            </div>
          )
          return (
            <div className="p-4" dir={isRTL ? 'rtl' : 'ltr'}>
              <button
                onClick={() => setOpenLogForms(prev => new Set([...prev, w.id]))}
                className="w-full h-11 rounded-xl bg-[#0a1628] text-white text-sm font-bold active:scale-[0.98] transition-all">
                {stravaForDate ? t.addNoteToWorkoutBtn : t.updateWorkoutBtn}
              </button>
            </div>
          )
        })()}
      </div>
    </div>
  )


  const handleStravaSync = async () => {
    if (!athleteId) return
    setStravaSyncing(true)
    try {
      const { doc, getDoc, collection, addDoc, serverTimestamp, query, where, getDocs, updateDoc } = await import('firebase/firestore')
      const { db } = await import('@/lib/firebase')
      // Get athlete's own stravaId from their user profile
      const userSnap = await getDoc(doc(db, 'users', athleteId))
      const stravaId = userSnap.data()?.stravaId
      if (!stravaId) { toast.error(t.stravaConnectBtn + ' — ' + t.stravaNotFoundError); return }
      const snap = await getDoc(doc(db, 'strava_connections', `strava_${stravaId}`))
      if (!snap.exists()) { toast.error(t.stravaConnectBtn); return }
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
            durationMin: activity.durationMin || null,
            effort: null,
            comment: '',
            splitLogs: activity.splitLogs || [],
            averageHeartRate: activity.averageHeartRate || null,
            elevationGain: activity.elevationGain || null,
            stravaType: activity.stravaType || '',
            source: 'strava',
            feedbackStatus: 'pending',
            createdAt: serverTimestamp(),
          })
          saved++
          // Notify coach of Strava workout completion (fire-and-forget)
          ;(async () => {
            try {
              const coachId = userSnap.data()?.coachId
              const athleteName = userSnap.data()?.name || 'ספורטאי'
              if (coachId && !userSnap.data()?.mutedByCoach) {
                fetch('/api/send-notification', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    userId: coachId,
                    title: `${athleteName} השלים אימון`,
                    body: `${activity.stravaName || 'פעילות Strava'} · ${activity.distanceKm} ק"מ`,
                    data: { type: 'workout_complete' },
                    url: `/coach/athletes/${athleteId}/planner`,
                  }),
                }).catch(() => {})
              }
            } catch {}
          })()
          // Smart auto-complete: aggregate running distance for the day, then match
          try {
            const isRunAct = STRAVA_RUNNING_TYPES.includes(activity.stravaType || 'Run')
            const isGymAct = STRAVA_GYM_TYPES.includes(activity.stravaType || '')
            const awSnap = await getDocs(query(
              collection(db, 'assignedWorkouts'),
              where('athleteId', '==', athleteId),
              where('scheduledDate', '==', activity.date)
            ))
            if (!awSnap.empty) {
              const dateLogsSnap = await getDocs(query(
                collection(db, 'logs'),
                where('athleteId', '==', athleteId),
                where('date', '==', activity.date),
                where('source', '==', 'strava')
              ))
              const totalRunKm = dateLogsSnap.docs
                .filter(d => { const t = d.data().stravaType; return !t || STRAVA_RUNNING_TYPES.includes(t) })
                .reduce((s, d) => s + (d.data().actualDistance || 0), 0)
              for (const aw of awSnap.docs) {
                if (aw.data().status === 'completed') continue
                const wType = aw.data().workout?.type || ''
                const isStrengthW = ['strength', 'cross_training'].includes(wType)
                const plannedDist = aw.data().workout?.distance ?? 0
                let shouldComplete = false
                if (isStrengthW) { shouldComplete = isGymAct }
                else if (wType === 'swim') { shouldComplete = activity.stravaType === 'Swim' }
                else if (wType === 'bike') { shouldComplete = ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide'].includes(activity.stravaType || '') }
                else if (isRunAct) { shouldComplete = plannedDist === 0 || totalRunKm >= plannedDist * 0.7 }
                if (shouldComplete) {
                  await updateDoc(doc(db, 'assignedWorkouts', aw.id), { status: 'completed', completedAt: serverTimestamp() })
                  setAssignedWorkouts(prev => prev.map(w => w.id === aw.id ? { ...w, status: 'completed' } : w))
                }
              }
            }
          } catch (e) { console.error('Smart auto-complete failed:', e) }
        }
        toast.success(`${t.syncedFromStrava}: ${saved}`)
        // Reload logs
        const logsSnap = await getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId)))
        setWeekLogs(logsSnap.docs.map(mapLogDoc))
      }
    } catch (err) { console.error(err); toast.error(t.stravaSyncTitle) }
    finally { setStravaSyncing(false) }
  }


  const StravaCard = ({ log }: { log: WeekLog }) => {
    const kindInfo = getActivityInfo(log)
    const isManual = log.source === 'manual'
    const displayName = log.stravaName || activityLabel(kindInfo.kind, isRTL)
    const durationDisplay = formatDurationMin(log.durationMin, isRTL)
    const [pendingEffort, setPendingEffort] = useState<number|null>(log.effort ?? null)
    const [pendingComment, setPendingComment] = useState(log.comment || '')
    const [editDistance, setEditDistance] = useState(log.actualDistance != null && log.actualDistance !== 0 ? String(log.actualDistance) : '')
    const [editPace, setEditPace] = useState(log.actualPace || '')
    const [editDuration, setEditDuration] = useState(log.durationMin ? String(log.durationMin) : '')
    const [submitting, setSubmitting] = useState(false)
    const [showDetails, setShowDetails] = useState(false)
    const isPending = log.feedbackStatus === 'pending'
    const [showForm, setShowForm] = useState(isPending)
    const [showSplits, setShowSplits] = useState(false)

    const handleSubmit = async () => {
      if (!pendingEffort) { toast.error(t.selectEffortError); return }
      const parsedDistance = editDistance.trim() ? parseFloat(editDistance) : null
      if (editDistance.trim() && (!Number.isFinite(parsedDistance!) || parsedDistance! < 0)) {
        toast.error(t.toastDistanceInvalid); return
      }
      const parsedDuration = editDuration.trim() ? parseInt(editDuration, 10) : null
      setSubmitting(true)
      try {
        const { doc, updateDoc, serverTimestamp, getDoc } = await import('firebase/firestore')
        const { db } = await import('@/lib/firebase')
        const changes = {
          effort: pendingEffort,
          comment: pendingComment,
          actualDistance: kindInfo.hasDistance ? parsedDistance : log.actualDistance ?? null,
          actualPace: kindInfo.hasDistance ? (editPace.trim() || null) : log.actualPace ?? null,
          durationMin: parsedDuration ?? log.durationMin ?? null,
          feedbackStatus: 'done',
        }
        await updateDoc(doc(db, 'logs', log.id), { ...changes, updatedAt: serverTimestamp() })
        setWeekLogs(prev => prev.map(l => l.id === log.id ? {
          ...l, effort: pendingEffort, comment: pendingComment, feedbackStatus: 'done',
          actualDistance: changes.actualDistance ?? undefined,
          actualPace: changes.actualPace ?? undefined,
          durationMin: changes.durationMin ?? undefined,
        } : l))
        setShowForm(false)
        toast.success(t.workoutSaved)
        // Notify coach of Strava feedback (fire-and-forget)
        ;(async () => {
          try {
            const athleteSnap = await getDoc(doc(db, 'users', athleteId))
            const coachId = athleteSnap.data()?.coachId
            const athleteName = athleteSnap.data()?.name || 'ספורטאי'
            if (!coachId || athleteSnap.data()?.mutedByCoach === true) return
            const preview = pendingComment.trim() ? pendingComment.trim().slice(0, 100) : `מאמץ ${pendingEffort}/10`
            fetch('/api/send-notification', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                userId: coachId,
                title: `${athleteName} הוסיף הערה לאימון`,
                body: preview,
                data: { type: 'workout_comment' },
                url: `/coach/athletes/${athleteId}/planner`,
              }),
            }).catch(() => {})
          } catch {}
        })()
      } catch(e) { console.error(e); toast.error(t.savingError) }
      finally { setSubmitting(false) }
    }

    const handleDelete = async () => {
      if (!confirm(t.deleteWorkoutConfirm)) return
      try {
        const { doc, deleteDoc } = await import('firebase/firestore')
        const { db } = await import('@/lib/firebase')
        await deleteDoc(doc(db, 'logs', log.id))
        setWeekLogs(prev => prev.filter(l => l.id !== log.id))
        toast.success(t.workoutDeleted)
      } catch(e) { console.error(e); toast.error(t.errorDeleting) }
    }

    const DetailsModal = () => (
      <Dialog open={showDetails} onOpenChange={setShowDetails}>
        <DialogContent className="max-w-md w-full" dir="rtl">
          <div className="max-h-[75vh] overflow-y-auto pr-1">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-right flex-wrap">
              {isManual ? (
                <span className="text-sm bg-gray-600 text-white px-2 py-0.5 rounded font-bold">{t.manualActivityTag}</span>
              ) : (
                <span className="text-sm bg-orange-500 text-white px-2 py-0.5 rounded font-bold">Strava</span>
              )}
              <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full border', kindInfo.badgeClass)}>
                {kindInfo.emoji} {activityLabel(kindInfo.kind, isRTL)}
              </span>
              <span>{displayName}</span>
            </DialogTitle>
            <DialogDescription className="sr-only">{t.stravaDialogDesc}</DialogDescription>
          </DialogHeader>
          {/* Key stats */}
          <div className="grid grid-cols-2 gap-3 py-2">
            {durationDisplay && (
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-navy">{durationDisplay}</p>
                <p className="text-xs text-muted-foreground">{t.durationMinLabel}</p>
              </div>
            )}
            {log.actualDistance && (
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-navy">{log.actualDistance}</p>
                <p className="text-xs text-muted-foreground">km</p>
              </div>
            )}
            {log.actualPace && (
              <div className="bg-muted/40 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-navy" dir="ltr">{log.actualPace.replace('/km','')}</p>
                <p className="text-xs text-muted-foreground">{t.tempoPerKmLabel}</p>
              </div>
            )}
            {log.averageHeartRate && (
              <div className="bg-red-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-red-600">{log.averageHeartRate}</p>
                <p className="text-xs text-muted-foreground">{t.avgHRBpmLabel}</p>
              </div>
            )}
            {log.elevationGain && (
              <div className="bg-emerald-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-emerald-700">{log.elevationGain}m</p>
                <p className="text-xs text-muted-foreground">{t.elevationGainLabel}</p>
              </div>
            )}
            {log.effort && (
              <div className="bg-amber-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-amber-700">{log.effort}/10</p>
                <p className="text-xs text-muted-foreground">{t.effortValueLabel}</p>
              </div>
            )}
          </div>
          {/* Comment */}
          {log.comment && !log.comment.startsWith('Synced from Strava:') && (
            <div className="bg-muted/30 rounded-lg p-3">
              <p className="text-xs text-muted-foreground mb-1">{t.noteLabel}</p>
              <p className="text-sm text-navy italic">"{log.comment}"</p>
            </div>
          )}
          {/* Splits */}
          {log.splitLogs && log.splitLogs.length > 0 && (
            <div>
              <p className="text-sm font-bold text-navy mb-2">{t.kmSplitsLabel}</p>
              <div className="rounded-lg border border-border overflow-hidden">
                <table className="w-full table-fixed text-[10px]" dir="ltr">
                  <colgroup>
                    <col style={{ width: '12%' }} />
                    <col style={{ width: '22%' }} />
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '24%' }} />
                    <col style={{ width: '18%' }} />
                  </colgroup>
                  <thead>
                    <tr className="bg-navy/5">
                      <th className="py-1.5 text-center font-bold text-navy whitespace-nowrap">km</th>
                      <th className="py-1.5 text-center font-bold text-navy whitespace-nowrap">{t.timeInputLabel}</th>
                      <th className="py-1.5 text-center font-bold text-navy whitespace-nowrap">{t.tempoLabel}</th>
                      <th className="py-1.5 text-center font-bold text-navy whitespace-nowrap">{t.heartRateLabel}</th>
                      <th className="py-1.5 text-center font-bold text-navy whitespace-nowrap">Zone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {log.splitLogs.map((s: any, i: number) => {
                      const pace = s.pace?.replace('/km', '') || '—'
                      const zone = s.paceZone || s.notes?.replace('Zone ', '') || '—'
                      const hr = s.heartRate || '—'
                      const isfast = s.pace && parseFloat(s.pace) < parseFloat(log.actualPace || '99')
                      return (
                        <tr
                          key={i}
                          className={cn(
                            'border-t border-border/40',
                            i % 2 === 0 ? 'bg-white' : 'bg-muted/20'
                          )}
                        >
                          <td className="py-2 text-center font-bold text-navy">{i + 1}</td>
                          <td className="py-2 text-center font-mono">{s.time}</td>
                          <td className={cn('py-2 text-center font-mono font-semibold', isfast ? 'text-emerald-600' : 'text-navy')}>{pace}</td>
                          <td className={cn('py-2 text-center font-mono', hr !== '—' && hr > 160 ? 'text-red-500' : hr !== '—' && hr > 140 ? 'text-orange-500' : 'text-navy')}>{hr}</td>
                          <td className={cn('py-2 text-center font-bold', zone === '5' || zone === '4' ? 'text-red-500' : zone === '3' ? 'text-orange-500' : zone === '2' ? 'text-amber-500' : 'text-emerald-600')}>
                            {zone === '—' ? '—' : `Z${zone}`}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-muted-foreground mt-1 text-center">{t.paceColorHint}</p>
            </div>
          )}
          </div>
        </DialogContent>
      </Dialog>
    )

    // ── STATE 1: Pending feedback (or editing) — compact collapsible ───
    if (isPending || showForm) return (
      <>
        <DetailsModal />
        <div className="rounded-2xl border border-amber-200/60 bg-white shadow-sm overflow-hidden" dir="rtl">
          {/* Compact header row */}
          <div className="px-3.5 py-2.5 flex items-center gap-2">
            <div className={cn('h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0',
              isManual ? 'bg-[#0a1628]' : 'bg-[#FC4C02]')}>
              <span className="text-[11px]">{isManual ? kindInfo.emoji : <span className="text-[9px] font-black text-white">S</span>}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0', kindInfo.badgeClass)}>
                  {kindInfo.emoji} {activityLabel(kindInfo.kind, isRTL)}
                </span>
                <span className="text-sm font-bold text-navy truncate">{displayName}</span>
                {kindInfo.hasDistance && !!log.actualDistance && <span className="text-xs text-gray-500">· {log.actualDistance} km</span>}
                {kindInfo.hasDistance && log.actualPace && <span className="text-xs text-gray-400" dir="ltr">· {log.actualPace}</span>}
                {!kindInfo.hasDistance && durationDisplay && <span className="text-xs text-gray-500">· {durationDisplay}</span>}
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              <button
                onClick={() => setShowForm(prev => !prev)}
                className={cn('text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap active:scale-95 transition-all border',
                  showForm ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-[#c9a84c]/20 text-[#c9a84c] border-[#c9a84c]/40')}>
                {showForm ? t.closeCta : 'ממתין למשוב שלך'}
              </button>
              <button onClick={handleDelete} className="h-6 w-6 rounded-full hover:bg-red-50 flex items-center justify-center text-muted-foreground/50 hover:text-red-400 transition-colors text-sm">✕</button>
            </div>
          </div>

          {/* Expandable effort form */}
          {showForm && (
            <div className="border-t border-border/50">
              <div className="px-4 py-4 space-y-4">
                <div>
                  <p className="text-sm font-semibold text-navy mb-3">{t.howHardWasIt}</p>
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
                        {pendingEffort == null ? t.chooseIntensity :
                         pendingEffort <= 3 ? t.effortVeryEasy :
                         pendingEffort <= 5 ? t.effortEasyLabel :
                         pendingEffort <= 7 ? t.effortModerate :
                         pendingEffort <= 9 ? t.effortHard : t.effortVeryHard}
                      </span>
                    </div>
                    <button
                      onClick={() => setPendingEffort(prev => prev != null ? Math.min(10, prev + 1) : 5)}
                      className="w-12 h-12 rounded-full border-2 border-border bg-white hover:bg-muted/40 transition-all flex items-center justify-center text-xl font-bold text-navy shadow-sm select-none">
                      +
                    </button>
                  </div>
                </div>
                {/* Fix / complete missing data */}
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">{t.fixStravaDataHint}</p>
                  <div className="grid grid-cols-3 gap-2">
                    {kindInfo.hasDistance && (
                      <div>
                        <label className="text-[10px] text-muted-foreground block mb-1">{t.km}</label>
                        <input type="number" step="0.1" min="0" value={editDistance}
                          onChange={e => setEditDistance(e.target.value)}
                          className="w-full h-10 rounded-xl border border-border/60 bg-muted/20 text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-navy/20" />
                      </div>
                    )}
                    {kindInfo.hasDistance && (
                      <div>
                        <label className="text-[10px] text-muted-foreground block mb-1">{t.tempoLabel}</label>
                        <input type="text" placeholder="5:30" value={editPace}
                          onChange={e => setEditPace(e.target.value)} dir="ltr"
                          className="w-full h-10 rounded-xl border border-border/60 bg-muted/20 text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-navy/20" />
                      </div>
                    )}
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">{t.durationMinLabel}</label>
                      <input type="number" min="0" value={editDuration}
                        onChange={e => setEditDuration(e.target.value)}
                        className="w-full h-10 rounded-xl border border-border/60 bg-muted/20 text-center text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-navy/20" />
                    </div>
                  </div>
                </div>
                <textarea
                  placeholder={t.optionalCommentPh}
                  value={pendingComment}
                  onChange={e => setPendingComment(e.target.value)}
                  dir="rtl"
                  className="w-full rounded-xl border border-border/60 bg-muted/20 px-3 py-2.5 text-sm resize-none h-20 focus:outline-none focus:ring-2 focus:ring-navy/20 focus:border-navy/40 transition-all placeholder:text-muted-foreground/60"
                />
                <button
                  onClick={handleSubmit}
                  disabled={submitting || !pendingEffort}
                  className="w-full h-12 rounded-2xl bg-navy hover:bg-navy/90 disabled:opacity-40 text-white text-base font-bold transition-all">
                  {submitting ? t.savingDots : t.sendFeedbackToCoach}
                </button>
              </div>
            </div>
          )}
        </div>
      </>
    )

    // ── STATE 2: Completed Strava — expanded stats card ────────────────
    return (
      <>
        <DetailsModal />
        <div className="bg-white rounded-2xl border border-[#FC4C02]/15 shadow-sm overflow-hidden" dir="rtl">
          {/* Header row */}
          <div className="px-3.5 py-2.5 flex items-center gap-2">
            <div className={cn('h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0',
              isManual ? 'bg-[#0a1628]' : 'bg-[#FC4C02]')}>
              <span className="text-[11px]">{isManual ? kindInfo.emoji : <span className="text-[9px] font-black text-white">S</span>}</span>
            </div>
            <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0', kindInfo.badgeClass)}>
              {kindInfo.emoji} {activityLabel(kindInfo.kind, isRTL)}
            </span>
            <span className="flex-1 text-sm font-bold text-[#0a1628] truncate">{displayName}</span>
            <span className="text-[10px] font-bold text-emerald-600 flex-shrink-0">✓</span>
            <button onClick={() => setShowForm(true)} className="text-[10px] text-[#0a1628]/50 hover:text-[#0a1628] flex-shrink-0 font-medium border border-gray-200 rounded-full px-2 py-0.5 transition-colors">{t.editActivityBtn}</button>
            <button onClick={() => setShowDetails(true)} className="text-[10px] text-[#0a1628]/50 hover:text-[#0a1628] flex-shrink-0 font-medium border border-gray-200 rounded-full px-2 py-0.5 transition-colors">{t.detailsBtn}</button>
            <button onClick={handleDelete} className="h-6 w-6 rounded-full flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0 text-sm">✕</button>
          </div>
          {/* Stats grid */}
          {(log.actualDistance || log.actualPace || log.averageHeartRate || log.elevationGain || durationDisplay) && (
            <div className="px-3.5 pb-3 grid grid-cols-3 gap-1.5">
              {durationDisplay && !kindInfo.hasDistance && (
                <div className="bg-gray-50 rounded-xl p-2 text-center">
                  <p className="text-base font-black text-[#0a1628]">{durationDisplay}</p>
                  <p className="text-[9px] text-gray-400">{t.durationMinLabel}</p>
                </div>
              )}
              {log.actualDistance && (
                <div className="bg-gray-50 rounded-xl p-2 text-center">
                  <p className="text-base font-black text-[#0a1628]">{log.actualDistance}</p>
                  <p className="text-[9px] text-gray-400">ק&quot;מ</p>
                </div>
              )}
              {log.actualPace && (
                <div className="bg-gray-50 rounded-xl p-2 text-center">
                  <p className="text-base font-black text-[#0a1628]" dir="ltr">{log.actualPace.replace('/km','')}</p>
                  <p className="text-[9px] text-gray-400">{t.tempoLabel}</p>
                </div>
              )}
              {log.averageHeartRate && (
                <div className="bg-red-50 rounded-xl p-2 text-center">
                  <p className="text-base font-black text-red-600">{log.averageHeartRate}</p>
                  <p className="text-[9px] text-gray-400">{t.heartRateLabel}</p>
                </div>
              )}
              {log.elevationGain && (
                <div className="bg-emerald-50 rounded-xl p-2 text-center">
                  <p className="text-base font-black text-emerald-700">{log.elevationGain}m</p>
                  <p className="text-[9px] text-gray-400">{t.elevationShort}</p>
                </div>
              )}
              {log.effort && (
                <div className="bg-amber-50 rounded-xl p-2 text-center">
                  <p className="text-base font-black text-amber-700">{log.effort}/10</p>
                  <p className="text-[9px] text-gray-400">{t.effortValueLabel}</p>
                </div>
              )}
            </div>
          )}
          {/* Expandable splits */}
          {log.splitLogs && log.splitLogs.length > 0 && (
            <div className="border-t border-gray-100">
              <button
                onClick={() => setShowSplits(prev => !prev)}
                className="w-full px-3.5 py-2 flex items-center justify-between text-xs font-bold text-[#0a1628]/60 hover:bg-gray-50 transition-colors">
                <span>{t.splitsLabelShort} ({log.splitLogs.length})</span>
                {showSplits ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </button>
              {showSplits && (
                <div className="px-3.5 pb-3">
                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full table-fixed text-[10px]" dir="ltr">
                      <colgroup>
                        <col style={{ width: '12%' }} />
                        <col style={{ width: '22%' }} />
                        <col style={{ width: '24%' }} />
                        <col style={{ width: '24%' }} />
                        <col style={{ width: '18%' }} />
                      </colgroup>
                      <thead>
                        <tr className="bg-[#0a1628]/5">
                          <th className="py-1.5 text-center font-bold text-[#0a1628] whitespace-nowrap">km</th>
                          <th className="py-1.5 text-center font-bold text-[#0a1628] whitespace-nowrap">{t.timeInputLabel}</th>
                          <th className="py-1.5 text-center font-bold text-[#0a1628] whitespace-nowrap">{t.tempoLabel}</th>
                          <th className="py-1.5 text-center font-bold text-[#0a1628] whitespace-nowrap">{t.heartRateLabel}</th>
                          <th className="py-1.5 text-center font-bold text-[#0a1628] whitespace-nowrap">Zone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {log.splitLogs.map((s: any, i: number) => {
                          const pace = s.pace?.replace('/km', '') || '—'
                          const zone = s.paceZone || s.notes?.replace('Zone ', '') || '—'
                          const hr = s.heartRate || '—'
                          const isfast = s.pace && parseFloat(s.pace) < parseFloat(log.actualPace || '99')
                          return (
                            <tr key={i} className={cn('border-t border-border/40', i % 2 === 0 ? 'bg-white' : 'bg-muted/20')}>
                              <td className="py-2 text-center font-bold text-[#0a1628]">{i + 1}</td>
                              <td className="py-2 text-center font-mono">{s.time}</td>
                              <td className={cn('py-2 text-center font-mono font-semibold', isfast ? 'text-emerald-600' : 'text-[#0a1628]')}>{pace}</td>
                              <td className={cn('py-2 text-center font-mono', hr !== '—' && hr > 160 ? 'text-red-500' : hr !== '—' && hr > 140 ? 'text-orange-500' : 'text-[#0a1628]')}>{hr}</td>
                              <td className={cn('py-2 text-center font-bold', zone === '5' || zone === '4' ? 'text-red-500' : zone === '3' ? 'text-orange-500' : zone === '2' ? 'text-amber-500' : 'text-emerald-600')}>
                                {zone === '—' ? '—' : `Z${zone}`}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </>
    )
  }


  // ── Shared premium workout card renderer ────────────────────────────────────
  const renderWorkoutCard = (w: AssignedWorkout, cardIndex?: number) => {
    const effStatus = getEffectiveStatus(w)
    const msg = coachMessages.find(m => m.assignedWorkoutId === w.id)
    const isSelected = selectedWorkoutId === w.id
    const log = weekLogs.find(l => l.assignedWorkoutId === w.id && !!l.actualDistance && !isActivityLog(l))
      || weekLogs.find(l => !l.assignedWorkoutId && l.date === w.scheduledDate && !!l.actualDistance && !isActivityLog(l))
    return (
      <div key={w.id} className="space-y-2">
        {/* Compact premium Nike-style tile */}
        <div className={cn(
          'bg-white rounded-2xl shadow-sm border-l-4 overflow-hidden transition-all',
          effStatus === 'completed'
            ? 'border border-emerald-100 border-l-emerald-500'
            : effStatus === 'skipped'
            ? 'border border-red-100 border-l-red-400'
            : `border border-gray-100 ${TYPE_BORDER_COLORS[w.workout?.type] || 'border-l-[#0a1628]'}`
        )}>
          {/* Multi-workout index label */}
          {cardIndex != null && cardIndex > 1 && (
            <div className="px-4 pt-2.5 pb-0">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t.workoutCardPrefix} {cardIndex}</span>
            </div>
          )}

          {/* Main tap row — min 44px touch target */}
          <button
            onClick={() => setSelectedWorkoutId(prev => prev === w.id ? null : w.id)}
            className="w-full px-4 py-3.5 text-right active:bg-gray-50 transition-colors min-h-[56px]">
            <div className="flex items-center justify-between gap-3" dir="rtl">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={cn('text-[10px] font-bold px-2.5 py-0.5 rounded-full border', TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy)}>
                    {typeLabels[w.workout?.type] || w.workout?.type}
                  </span>
                  {effStatus === 'completed' && (
                    <span className="text-[10px] font-bold text-emerald-600 flex items-center gap-1">
                      <span className="w-3.5 h-3.5 rounded-full bg-emerald-100 inline-flex items-center justify-center text-[8px]">✓</span>
                      {log?.actualDistance ? `${log.actualDistance} km` : t.stravaCompletedLabel}
                    </span>
                  )}
                  {effStatus === 'skipped' && (
                    <span className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-100 px-2 py-0.5 rounded-full">{t.stravaNotDoneLabel}</span>
                  )}
                </div>
                <p className={cn('font-bold text-[15px] leading-snug',
                  effStatus === 'completed' ? 'text-gray-500' : 'text-[#0a1628]')}>
                  {w.workout.title}
                </p>
                {(w.workout.distance || w.workout.duration) && (
                  <p className="text-xs text-gray-400 mt-0.5">
                    {w.workout.distance && `${w.workout.distance} km`}
                    {w.workout.distance && w.workout.duration && ' · '}
                    {w.workout.duration && `${w.workout.duration} min`}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <span className="text-[10px] text-gray-400 font-medium hidden sm:block">{t.detailsBtn}</span>
                <ChevronDown className={cn('h-4 w-4 text-gray-400 transition-transform duration-200', isSelected ? 'rotate-180' : '')} />
              </div>
            </div>
          </button>

          {/* Expanded detail */}
          {isSelected && (
            <div className="border-t border-gray-100 px-4 pb-4 pt-3">
              {renderWorkoutDetail(w)}
            </div>
          )}
        </div>

        {/* Coach message */}
        {msg && (
          <div className={cn('bg-white rounded-2xl border p-4 shadow-sm', !msg.read ? 'border-l-4 border-l-[#c9a84c] border-gray-100' : 'border-gray-100')} dir="rtl">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#c9a84c]">{t.messageFromCoach}</p>
              {msg.createdAt?.seconds && <p className="text-[9px] text-gray-400">{format(new Date(msg.createdAt.seconds * 1000), 'd/M/yyyy')}</p>}
            </div>
            <p className="text-sm text-[#0a1628] leading-relaxed">{msg.message}</p>
            {!msg.read && (
              <button onClick={async () => { try { await updateDoc(doc(db, 'coachMessages', msg.id), { read: true }); setCoachMessages(prev => prev.map(m => m.id === msg.id ? { ...m, read: true } : m)) } catch {} }}
                className="mt-2 text-[10px] text-gray-400 hover:text-gray-600 underline underline-offset-2">{t.markAsRead}</button>
            )}
          </div>
        )}

        {/* Manual log result */}
        {log && (
          <ManualLogCard
            distance={log.actualDistance}
            pace={log.actualPace}
            effort={log.effort}
            comment={log.comment}
            splitLogs={log.splitLogs}
            onDelete={async () => {
              if (!confirm(t.confirmDeleteLog)) return
              try {
                const { doc, deleteDoc, updateDoc } = await import('firebase/firestore')
                const { db } = await import('@/lib/firebase')
                if (log.id) await deleteDoc(doc(db, 'logs', log.id))
                await updateDoc(doc(db, 'assignedWorkouts', w.id), { status: 'scheduled', completedAt: null })
                setWeekLogs(prev => prev.filter(l => l.id !== log.id))
                toast.success(t.logDeleted)
              } catch(e) { console.error(e); toast.error(t.errorDeleting) }
            }}
          />
        )}
      </div>
    )
  }

  const renderNavyWorkoutBlock = (w: AssignedWorkout, isMulti: boolean, idx: number, dateStr: string) => {
    const wEff = getEffectiveStatus(w)
    const wSelected = selectedWorkoutId === w.id
    const wLog = weekLogs.find(l => l.assignedWorkoutId === w.id && !!l.actualDistance && !isActivityLog(l))
      || weekLogs.find(l => !l.assignedWorkoutId && l.date === dateStr && !!l.actualDistance && !isActivityLog(l))
    const wMsg = coachMessages.find(m => m.assignedWorkoutId === w.id)
    const stravaThisDay = weekLogs.find(l => l.date === dateStr && l.source === 'strava')
    const stravaMatch = computeStravaMatch(w, dateStr)
    const isEffectivelyDone = wEff === 'completed' || stravaMatch?.status === 'completed'
    return (
      <div key={w.id} className="space-y-2">
        {isMulti && (
          <p className="text-[10px] font-bold text-[#c9a84c] uppercase tracking-widest px-1">{t.workoutCardPrefix} {idx + 1}</p>
        )}
        <div className={cn('rounded-3xl transition-all',
          isEffectivelyDone ? 'bg-gradient-to-br from-emerald-700 to-emerald-800' : 'bg-gradient-to-br from-[#0a1628] to-[#0a1628]/85')}>
          <div className="p-5">
            <div className="flex items-center justify-between mb-2.5" dir="rtl">
              <span className="bg-white/15 text-white/90 text-[11px] font-bold px-3 py-1 rounded-full">
                {typeLabels[w.workout?.type] || w.workout?.type || 'ריצה'}
              </span>
              <div className="flex items-center gap-1.5">
                {stravaThisDay?.feedbackStatus === 'pending' && (
                  <span className="text-[10px] font-bold bg-[#c9a84c]/25 text-[#c9a84c] border border-[#c9a84c]/40 px-2 py-0.5 rounded-full">ממתין למשוב</span>
                )}
                {stravaThisDay && stravaThisDay.feedbackStatus !== 'pending' && (
                  <span className="text-[10px] font-bold text-[#FC4C02] bg-[#FC4C02]/20 px-2 py-0.5 rounded-full">Strava ✓</span>
                )}
                {isEffectivelyDone && !stravaThisDay && <span className="text-[11px] font-bold text-emerald-200">{t.stravaCompletedLabel}</span>}
                {wEff === 'skipped' && <span className="text-[11px] font-bold text-red-300">{t.stravaNotDoneLabel}</span>}
                {isToday(parseISO(w.scheduledDate)) && wEff === 'scheduled' && idx === 0 && !stravaThisDay && (
                  <span className="text-[#c9a84c] text-[11px] font-black">{t.today}</span>
                )}
              </div>
            </div>
            <p className={cn('font-black text-white leading-tight mb-3', isMulti ? 'text-xl' : 'text-[26px]')}>
              {w.workout.title}
            </p>
            <div className="flex items-center gap-2 mb-4 flex-wrap" dir="rtl">
              {w.workout.distance && (
                <span className={cn('text-sm font-bold px-3 py-1.5 rounded-full',
                  isEffectivelyDone ? 'bg-white/20 text-white' : 'bg-[#c9a84c] text-[#0a1628]')}>
                  {wLog?.actualDistance ?? w.workout.distance} km
                </span>
              )}
              {w.workout.duration && !wLog && (
                <span className="text-sm bg-white/15 text-white px-3 py-1.5 rounded-full">{w.workout.duration} min</span>
              )}
              {wLog?.actualPace && <span className="text-sm bg-white/15 text-white px-3 py-1.5 rounded-full" dir="ltr">{wLog.actualPace}</span>}
              {wLog?.effort != null && <span className="text-sm bg-white/15 text-white px-3 py-1.5 rounded-full">{t.effortValueLabel} {wLog.effort}/10</span>}
            </div>
            {stravaMatch && !wLog && (
              <div className="flex items-center gap-1.5 mb-3" dir="rtl">
                <span className="text-[9px] font-black text-[#FC4C02] bg-[#FC4C02]/25 w-4 h-4 rounded flex items-center justify-center flex-shrink-0">S</span>
                {stravaMatch.planned > 0 ? (
                  <span className={cn('text-[11px] font-bold',
                    stravaMatch.status === 'completed' ? 'text-emerald-300' :
                    stravaMatch.status === 'partial' ? 'text-amber-300' : 'text-red-300')}>
                    {stravaMatch.actual} / {stravaMatch.planned} km
                    {stravaMatch.status === 'completed' ? ` ${t.stravaCompletedLabel}` : stravaMatch.status === 'partial' ? ` ${t.stravaPartialLabel}` : ` ${t.stravaNotDoneLabel}`}
                  </span>
                ) : (
                  <span className="text-[11px] font-bold text-emerald-300">{stravaMatch.actual} km ✓</span>
                )}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedWorkoutId(prev => prev === w.id ? null : w.id)}
                className={cn('flex-1 h-11 rounded-2xl font-bold text-sm active:scale-95 transition-all',
                  wSelected ? 'bg-white/20 text-white' : 'bg-white/15 text-white hover:bg-white/20')}>
                {wSelected ? t.closeCta : t.workoutDetailsCta}
              </button>
              {wEff === 'scheduled' && !isEffectivelyDone && (
                <button
                  onClick={() => setMoveWorkoutTarget(w)}
                  title={t.moveWorkoutBtn}
                  className="h-11 w-11 rounded-2xl bg-white/10 hover:bg-white/20 text-white/70 hover:text-white flex items-center justify-center active:scale-95 transition-all flex-shrink-0">
                  <CalendarClock className="h-5 w-5" />
                </button>
              )}
            </div>
            {(w as any).movedByAthlete && (
              <p className="text-[10px] text-white/40 mt-2 text-center" dir="rtl">{t.movedByAthleteTag}</p>
            )}
          </div>
        </div>
        {wSelected && (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
            {renderWorkoutDetail(w)}
          </div>
        )}
        {wMsg && (
          <div className={cn('bg-white rounded-2xl border p-4 shadow-sm',
            !wMsg.read ? 'border-l-4 border-l-[#c9a84c] border-gray-100' : 'border-gray-100')} dir="rtl">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-[#c9a84c]">{t.messageFromCoach}</p>
              {wMsg.read && wMsg.readAt ? (
                <span className="flex items-center gap-1 text-[9px] text-emerald-500 font-medium">
                  <CheckCircle2 className="h-3 w-3" />
                  {t.seenLabel} {format(new Date(wMsg.readAt), 'HH:mm')}
                </span>
              ) : wMsg.createdAt?.seconds && (
                <p className="text-[9px] text-gray-400">{format(new Date(wMsg.createdAt.seconds * 1000), 'd/M/yyyy')}</p>
              )}
            </div>
            <p className="text-sm text-[#0a1628] leading-relaxed">{wMsg.message}</p>
            {!wMsg.read && (
              <div className="flex justify-end mt-3">
                <button
                  onClick={() => {
                    const readAt = Date.now()
                    setCoachMessages(prev => prev.map(m => m.id === wMsg.id ? { ...m, read: true, readAt } : m)) // instant
                    updateDoc(doc(db, 'coachMessages', wMsg.id), { read: true, readAt }).catch(() => {})
                  }}
                  className="flex items-center gap-1.5 bg-[#c9a84c] hover:bg-[#b8962e] text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors active:scale-95"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t.markedAsReadBtn}
                </button>
              </div>
            )}
          </div>
        )}
        {wLog && (
          <ManualLogCard
            distance={wLog.actualDistance}
            pace={wLog.actualPace}
            effort={wLog.effort}
            comment={wLog.comment}
            splitLogs={wLog.splitLogs}
            onDelete={async () => {
              if (!confirm(t.confirmDeleteLog)) return
              try {
                const { doc, deleteDoc, updateDoc } = await import('firebase/firestore')
                const { db } = await import('@/lib/firebase')
                if (wLog.id) await deleteDoc(doc(db, 'logs', wLog.id))
                await updateDoc(doc(db, 'assignedWorkouts', w.id), { status: 'scheduled', completedAt: null })
                setWeekLogs(prev => prev.filter(l => l.id !== wLog.id))
                toast.success(t.logDeleted)
              } catch(e) { console.error(e); toast.error(t.errorDeleting) }
            }}
          />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3 pb-24" dir={isRTL ? 'rtl' : 'ltr'}>

      {/* ── Navigation ─────────────────────────────────────────────────────── */}
      <div className="space-y-2">
        {/* Row 1: Date navigation — big touch targets */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentDate(d => viewMode==='day' ? new Date(d.getTime()-86400000) : viewMode==='week' ? subWeeks(d,1) : subMonths(d,1))}
            className="w-11 h-11 rounded-2xl bg-gray-100 flex items-center justify-center active:scale-95 transition-all flex-shrink-0">
            <ChevronRight className="h-5 w-5 text-[#0a1628]" />
          </button>

          <p className="flex-1 text-center text-base font-bold text-[#0a1628]">
            {viewMode==='day'
              ? formatHeDateLong(currentDate)
              : viewMode==='week'
              ? `${format(weekStart,'d')}–${format(weekEnd,'d MMM')}`
              : format(currentDate,'MMMM yyyy')}
          </p>

          <button
            onClick={() => setCurrentDate(d => viewMode==='day' ? new Date(d.getTime()+86400000) : viewMode==='week' ? addWeeks(d,1) : addMonths(d,1))}
            className="w-11 h-11 rounded-2xl bg-gray-100 flex items-center justify-center active:scale-95 transition-all flex-shrink-0">
            <ChevronLeft className="h-5 w-5 text-[#0a1628]" />
          </button>
        </div>

        {/* Row 2: View tabs (gold active) + Strava sync button */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-gray-100 rounded-2xl p-1 flex-1">
            {(['day','week','month'] as const).map(mode => (
              <button key={mode} onClick={() => setViewMode(mode)}
                className={cn('flex-1 h-10 rounded-xl text-sm font-bold transition-all active:scale-95',
                  viewMode === mode ? 'bg-[#c9a84c] text-[#0a1628] shadow-sm' : 'text-gray-400 hover:text-gray-600')}>
                {mode==='day' ? t.dayView : mode==='week' ? t.weekView : t.monthView}
              </button>
            ))}
          </div>
          <button onClick={handleStravaSync} disabled={stravaSyncing}
            className="h-10 px-3 rounded-2xl bg-[#FC4C02]/10 flex items-center gap-1.5 active:scale-95 transition-all flex-shrink-0 disabled:opacity-50"
            title="סנכרן Strava">
            {stravaSyncing ? (
              <Loader2 className="h-4 w-4 animate-spin text-[#FC4C02]" />
            ) : (
              <RefreshCw className="h-4 w-4 text-[#FC4C02]" />
            )}
            <span className="text-xs font-bold text-[#FC4C02]">Strava</span>
          </button>
        </div>
      </div>

      {/* ── Day View ──────────────────────────────────────────────────────── */}
      {viewMode === 'day' && (() => {
        const dayWs = getWorkoutsForDay(currentDate)
        const dateStr = format(currentDate, 'yyyy-MM-dd')
        const activitiesToday = weekLogs.filter(l => l.date === dateStr && isActivityLog(l))
        const mainW = dayWs[0] || null

        const addActivityButton = (
          <button
            onClick={() => { setAddActivityDate(dateStr); setAddActivityOpen(true) }}
            className="w-full h-12 rounded-2xl border-2 border-dashed border-gray-200 hover:border-[#c9a84c]/50 text-gray-400 hover:text-[#c9a84c] text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] bg-white/50">
            <Plus className="h-4 w-4" />
            {t.addActivityBtn}
          </button>
        )

        // ── Rest day hero ──
        if (!mainW && activitiesToday.length === 0) return (
          <div className="space-y-3">
            <div className="bg-gradient-to-br from-[#0a1628] to-[#0a1628]/85 rounded-3xl p-8 text-center">
              <div className="text-5xl mb-4">🌿</div>
              <p className="text-2xl font-bold text-white mb-2">{t.restDayLabel}</p>
              <p className="text-sm text-white/40">{t.restDaySubtitle}</p>
            </div>
            {addActivityButton}
          </div>
        )

        return (
          <div className="space-y-3">
            {dayWs.map((w, idx) => renderNavyWorkoutBlock(w, dayWs.length > 1, idx, dateStr))}
            {activitiesToday.length > 0 && (
              <div className="space-y-1.5">
                {activitiesToday.map(log => <StravaCard key={log.id} log={log} />)}
              </div>
            )}
            {addActivityButton}
          </div>
        )
      })()}

      {/* ── Week View ─────────────────────────────────────────────────────── */}
      {viewMode === 'week' && (
        <div className="space-y-3">
          {/* 7-day pill strip — horizontal scroll on mobile */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
            <div className="flex gap-1 overflow-x-auto pb-1" style={{scrollbarWidth:'none'}} dir="rtl">
              {weekDays.map((day, di) => {
                const dayWs = getWorkoutsForDay(day)
                const hasCompleted = dayWs.some(w => getEffectiveStatus(w) === 'completed')
                const hasPending = dayWs.some(w => getEffectiveStatus(w) === 'scheduled')
                const isSelDay = isSameDay(day, selectedWeekDay)
                const todayFlag = isToday(day)
                return (
                  <button key={di}
                    onClick={() => { setSelectedWeekDay(day); setSelectedWorkoutId(null) }}
                    className={cn('flex flex-col items-center py-2.5 px-3 rounded-2xl transition-all active:scale-95 flex-shrink-0 min-w-[44px]',
                      isSelDay ? 'bg-[#0a1628]' : todayFlag ? 'bg-[#0a1628]/5' : 'hover:bg-gray-50')}>
                    <span className={cn('text-[10px] font-semibold mb-0.5', isSelDay ? 'text-white/50' : todayFlag ? 'text-[#c9a84c]' : 'text-gray-400')}>
                      {dayShortRot[di]}
                    </span>
                    <span className={cn('text-sm font-black', isSelDay ? 'text-white' : todayFlag ? 'text-[#0a1628]' : 'text-[#0a1628]/60')}>
                      {format(day,'d/M')}
                    </span>
                    <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5',
                      dayWs.length === 0 ? 'opacity-0' :
                      hasCompleted ? 'bg-emerald-500' :
                      hasPending ? (isSelDay ? 'bg-[#c9a84c]' : 'bg-[#c9a84c]/70') : 'bg-gray-200'
                    )} />
                  </button>
                )
              })}
            </div>

            {/* Week km progress bar in gold */}
            {(() => {
              const weekPlanned = getWeekKm(weekDays)
              const weekActual = Math.round(weekDays.reduce((s, d) => {
                const dStr = format(d, 'yyyy-MM-dd')
                return s + weekLogs.filter(l => l.date === dStr).reduce((a, l) => a + (l.actualDistance || 0), 0)
              }, 0))
              if (weekPlanned === 0) return null
              return (
                <div className="mt-3 pt-3 border-t border-gray-50">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-bold text-[#0a1628]">{weekActual} {t.weekKmDoneLabel}</span>
                    <span className="text-xs text-gray-400">{t.ofPlannedLabel} {weekPlanned} km</span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-1.5">
                    <div className={cn('h-1.5 rounded-full transition-all', weekActual >= weekPlanned ? 'bg-emerald-500' : 'bg-[#c9a84c]')}
                      style={{width:`${Math.min(100,(weekActual/weekPlanned)*100)}%`}} />
                  </div>
                </div>
              )
            })()}
          </div>

          {/* Selected day's workouts */}
          {(() => {
            const dayWs = getWorkoutsForDay(selectedWeekDay)
            const dayStr = format(selectedWeekDay, 'yyyy-MM-dd')
            const activitiesDay = weekLogs.filter(l => l.date === dayStr && isActivityLog(l))
            const addActivityButton = (
              <button
                onClick={() => { setAddActivityDate(dayStr); setAddActivityOpen(true) }}
                className="w-full h-12 rounded-2xl border-2 border-dashed border-gray-200 hover:border-[#c9a84c]/50 text-gray-400 hover:text-[#c9a84c] text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] bg-white/50">
                <Plus className="h-4 w-4" />
                {t.addActivityBtn}
              </button>
            )
            if (dayWs.length === 0 && activitiesDay.length === 0) return (
              <div className="space-y-3">
                <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 text-center">
                  <p className="font-semibold text-[#0a1628] mb-1">{t.restDayLabel}</p>
                  <p className="text-sm text-gray-400">{format(selectedWeekDay,'EEEE, d MMMM')}</p>
                </div>
                {addActivityButton}
              </div>
            )
            return (
              <div className="space-y-3">
                {dayWs.map((w, i) => renderNavyWorkoutBlock(w, dayWs.length > 1, i, dayStr))}
                {activitiesDay.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 border-t border-gray-100" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{t.workouts}</span>
                      <div className="flex-1 border-t border-gray-100" />
                    </div>
                    {activitiesDay.map(log => <StravaCard key={log.id} log={log} />)}
                  </div>
                )}
                {addActivityButton}
              </div>
            )
          })()}
        </div>
      )}

      {/* ── Month View ────────────────────────────────────────────────────── */}
      {viewMode === 'month' && (
        <div className="space-y-3">
          {/* Month stats — total km + completions */}
          {(() => {
            const mStart = format(monthStart, 'yyyy-MM-dd')
            const mEnd = format(monthEnd, 'yyyy-MM-dd')
            const monthWs = assignedWorkouts.filter(w => w.scheduledDate >= mStart && w.scheduledDate <= mEnd)
            const mCompleted = monthWs.filter(w => getEffectiveStatus(w) === 'completed').length
            const mTotal = monthWs.length
            const mKm = Math.round(weekLogs.filter(l => l.date >= mStart && l.date <= mEnd).reduce((s, l) => s + (l.actualDistance || 0), 0))
            return (
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[#0a1628] rounded-2xl p-3 text-center">
                  <p className="text-xl font-black text-white">{mKm}</p>
                  <p className="text-[10px] text-white/50 mt-0.5">{t.weekKmDoneLabel}</p>
                </div>
                <div className="bg-emerald-600 rounded-2xl p-3 text-center">
                  <p className="text-xl font-black text-white">{mCompleted}</p>
                  <p className="text-[10px] text-white/70 mt-0.5">{t.doneBadge}</p>
                </div>
                <div className="bg-white rounded-2xl border border-gray-100 p-3 text-center shadow-sm">
                  <p className="text-xl font-black text-[#0a1628]">{mTotal}</p>
                  <p className="text-[10px] text-gray-400 mt-0.5">{t.workouts}</p>
                </div>
              </div>
            )
          })()}

          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-4">
            {/* Day headers */}
            <div className="grid grid-cols-8 gap-1 mb-2">
              {dayLabelsRot.map((d,i) => (
                <div key={i} className="text-center text-[9px] font-bold text-gray-400 py-1 uppercase tracking-wider">{d}</div>
              ))}
              <div className="text-center text-[9px] font-bold text-gray-400 py-1 uppercase tracking-wider">km</div>
            </div>

            <div className="space-y-1">
              {monthWeeks.map((weekStartDay, wi) => {
                const days = eachDayOfInterval({ start: weekStartDay, end: endOfWeek(weekStartDay,{weekStartsOn:calWeekStartsOn}) })
                const wKm = getWeekKm(days)
                const wDone = Math.round(days.reduce((s,d) => {
                  const dStr = format(d,'yyyy-MM-dd')
                  return s + weekLogs.filter(l=>l.date===dStr).reduce((a,l)=>a+(l.actualDistance||0),0)
                },0))
                return (
                  <div key={wi} className="grid grid-cols-8 gap-1">
                    {days.map((day, di) => {
                      const inMonth = isSameMonth(day, currentDate)
                      const dayWs = getWorkoutsForDay(day)
                      const dStr = format(day, 'yyyy-MM-dd')
                      // Done activities (Strava / manual) — shown even on days with no planned workout
                      const dayActivities = weekLogs.filter(l => l.date === dStr && isActivityLog(l))
                      const todayFlag = isToday(day)
                      const selectedInDay = dayWs.some(w => w.id === selectedWorkoutId)
                      const hasUnreadMsg = dayWs.some(w => coachMessages.some(m => m.assignedWorkoutId === w.id && !m.read))
                      const clickable = inMonth && (dayWs.length > 0 || dayActivities.length > 0)
                      return (
                        <div key={di}
                          onClick={() => {
                            if (!clickable) return
                            if (dayWs.length > 0) {
                              const first = dayWs[0]
                              setSelectedWorkoutId(prev => prev === first.id ? null : first.id)
                            } else {
                              // Activity-only day → jump to its day view
                              setCurrentDate(day)
                              setViewMode('day')
                            }
                          }}
                          className={cn(
                            'min-h-[52px] rounded-xl p-1.5 flex flex-col items-center gap-1 transition-all',
                            !inMonth ? 'opacity-15 pointer-events-none' : '',
                            todayFlag ? 'bg-[#0a1628]/5' : '',
                            selectedInDay ? 'bg-[#c9a84c]/10 ring-1 ring-[#c9a84c]/30' : '',
                            clickable ? 'cursor-pointer hover:bg-gray-50' : ''
                          )}>
                          {todayFlag ? (
                            <span className="w-5 h-5 rounded-full bg-[#c9a84c] flex items-center justify-center text-[9px] font-black text-[#0a1628]">{format(day,'d')}</span>
                          ) : (
                            <span className={cn('text-[11px] font-semibold', inMonth ? 'text-[#0a1628]/70' : 'text-gray-300')}>{format(day,'d')}</span>
                          )}
                          {(dayWs.length > 0 || dayActivities.length > 0) && (
                            <div className="flex gap-0.5 flex-wrap justify-center items-center">
                              {dayWs.slice(0,3).map((w,i) => (
                                <span key={i} className={cn('w-1.5 h-1.5 rounded-full',
                                  getEffectiveStatus(w) === 'completed' ? 'bg-emerald-500' : TYPE_DOT_COLORS[w.workout?.type] || 'bg-[#0a1628]'
                                )} />
                              ))}
                              {/* Extra done activities beyond the plan */}
                              {dayWs.length === 0 && dayActivities.slice(0,3).map((l, i) => (
                                <span key={`a${i}`} className="text-[8px] leading-none">
                                  {getActivityInfo(l).emoji}
                                </span>
                              ))}
                            </div>
                          )}
                          {hasUnreadMsg && <span className="w-1 h-1 rounded-full bg-[#c9a84c]" />}
                        </div>
                      )
                    })}
                    {/* Week KM cell */}
                    <div className="flex flex-col items-center justify-center rounded-xl p-1 gap-0.5">
                      {wKm > 0 ? <p className="text-[10px] font-bold text-[#0a1628]/50">{wKm}</p> : <p className="text-[10px] text-gray-200">—</p>}
                      {wDone > 0 && <p className="text-[10px] font-bold text-emerald-600">{wDone}</p>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Selected workout — date label + full premium card */}
          {selectedWorkout && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-[#c9a84c] uppercase tracking-widest px-1" dir="rtl">
                {format(parseISO(selectedWorkout.scheduledDate),'EEEE · d MMMM')}
              </p>
              {renderNavyWorkoutBlock(selectedWorkout, false, 0, selectedWorkout.scheduledDate)}
            </div>
          )}
        </div>
      )}

      {/* ── Bottom Info Cards ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* שלב העונה */}
        {journey && (
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">{t.seasonStageTitle}</p>
            <div className="space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold bg-[#0a1628]/10 text-[#0a1628] px-3 py-1 rounded-full">{journey.stageName}</span>
                <span className="text-sm font-semibold text-[#0a1628]">{t.weekWord} {journey.weekInStage}/{journey.totalWeeksInStage}</span>
                <span className={cn('text-xs font-bold px-3 py-1 rounded-full', journey.isOffWeek ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700')}>
                  {journey.isOffWeek ? t.offWeekLabel : t.trainingWeekLabel}
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
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-3">{t.weeklyKmTitle}</p>
          {athlete?.weeklyKmRange ? (
            <div className="space-y-3">
              <div className="flex items-end gap-2 flex-wrap">
                <span className="text-3xl font-black text-[#0a1628]">{thisWeekKmActual}</span>
                <span className="text-sm text-gray-400 mb-1">/ {athlete.weeklyKmRange.min}–{athlete.weeklyKmRange.max} km</span>
              </div>
              <div className="w-full bg-gray-100 rounded-full h-2">
                <div className={cn('h-2 rounded-full transition-all', thisWeekKmActual >= athlete.weeklyKmRange.min ? 'bg-emerald-500' : 'bg-[#c9a84c]')}
                  style={{width:`${Math.min(100,(thisWeekKmActual/athlete.weeklyKmRange.max)*100)}%`}}/>
              </div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>{thisWeekKmActual >= athlete.weeklyKmRange.min ? t.weekGoalAchieved : `${t.kmRemainingLabel} ${Math.max(0,athlete.weeklyKmRange.min-thisWeekKmActual)} km`}</span>
                <span>{t.plannedLabel}: {thisWeekKmPlanned} km</span>
              </div>
            </div>
          ) : <p className="text-sm text-gray-500">{t.goalKmNotSet}</p>}
        </div>
      </div>

      {/* ── Dialogs ───────────────────────────────────────────────────────── */}
      <AddActivityDialog
        open={addActivityOpen}
        onOpenChange={setAddActivityOpen}
        athleteId={athleteId}
        athleteName={athlete?.name}
        date={addActivityDate}
        onSaved={async (log) => {
          setWeekLogs(prev => [...prev, log])
          // Refresh assigned workouts — auto-complete may have marked one done
          try {
            const snap = await getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId)))
            setAssignedWorkouts(snap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id })))
          } catch {}
        }}
      />
      {moveWorkoutTarget && (
        <MoveWorkoutDialog
          open={!!moveWorkoutTarget}
          onOpenChange={(o) => { if (!o) setMoveWorkoutTarget(null) }}
          workout={moveWorkoutTarget}
          athleteId={athleteId}
          athleteName={athlete?.name}
          busyDates={assignedWorkouts.map(w => w.scheduledDate)}
          onMoved={(workoutId, newDate) => {
            setAssignedWorkouts(prev => prev.map(w =>
              w.id === workoutId
                ? { ...w, scheduledDate: newDate, movedByAthlete: true, movedFromDate: moveWorkoutTarget.scheduledDate } as any
                : w
            ))
            setMoveWorkoutTarget(null)
          }}
        />
      )}
    </div>
  )
}
