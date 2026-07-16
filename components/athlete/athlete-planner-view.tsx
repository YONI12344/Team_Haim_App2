'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Loader2, MapPin, Clock, ChevronDown, ChevronUp, RefreshCw, CheckCircle2, Plus, CalendarClock, FlaskConical, Pencil, X as XIcon } from 'lucide-react'
import { Input } from '@/components/ui/input'
import Link from 'next/link'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, eachDayOfInterval, isSameMonth,
  isSameDay, isToday, parseISO, eachWeekOfInterval,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase'
import { collection, doc, getDoc, getDocs, query, where, updateDoc } from 'firebase/firestore'
import type { AthleteProfile, AssignedWorkout, TrainingDayType } from '@/lib/types'
import { sortBySession, setRestAfter, setRestBetweenReps } from '@/lib/types'
import { listJourneys, computeJourneyProgress, stageDisplayName, isRestWeek } from '@/lib/journey'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { useWorkoutTypeLabels } from '@/lib/workout-labels'
import { toast } from 'sonner'
import { WorkoutLogForm } from '@/components/athlete/workout-log-form'
import { personalTargetRangeForLevel, personalTargetRangeWithBaseline, formatTargetRange, paceToSec, secToPace } from '@/lib/physiology'
import { useLatestStepTest } from '@/hooks/useLatestStepTest'
import { useWorkoutLactateGroups, latestSessionSteps, groupKeyFor, inferThresholdDistance } from '@/hooks/useWorkoutLactateGroups'
import { expectedRepMetersForWorkout, scoreActivityFitForReps, buildRepDisplayRows } from '@/lib/strava-lap-matching'
import { SplitsTable } from '@/components/shared/splits-table'
import { isCoachEmail } from '@/lib/constants'
import { ManualLogCard } from '@/components/shared/manual-log-card'
import { useDaysOff } from '@/hooks/useDaysOff'
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

// Session labels for days with more than one workout (e.g. easy run AM, gym PM)
const SESSION_BADGE: Record<string, { emoji: string; label: string }> = {
  am: { emoji: '🌅', label: 'בוקר' },
  pm: { emoji: '🌇', label: 'ערב' },
  other: { emoji: '🕐', label: 'נוסף' },
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
  startTime?: string
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
    startTime: v.startTime,
  }
}

/** Logs that render as standalone activity cards (Strava sync or manual upload) */
const isActivityLog = (l: WeekLog) => l.source === 'strava' || l.source === 'manual'

interface AthletePlannerViewProps {
  overrideAthleteId?: string
  /** yyyy-MM-dd — when set (e.g. embedded in the coach planner), seeds and
   *  keeps syncing the displayed date so it always matches the date the
   *  coach is looking at, instead of defaulting to today. */
  initialDate?: string
}

export function AthletePlannerView({ overrideAthleteId, initialDate }: AthletePlannerViewProps = {}) {
  const { user } = useAuth()
  const { t, isRTL } = useLanguage()
  const typeLabels = useWorkoutTypeLabels()
  const dayShort = [t.sun, t.mon, t.tue, t.wed, t.thu, t.fri, t.sat]
  const dayLabels = [t.sun, t.mon, t.tue, t.wed, t.thu, t.fri, t.sat]
  const dayEN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  const formatHeDateLong = (d: Date) => d.toLocaleDateString(isRTL ? 'he-IL' : 'en-US', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
  const athleteId = overrideAthleteId || user?.id || ''
  const isCoachViewer = isCoachEmail(user?.email)
  const { steps: latestSteps } = useLatestStepTest(athleteId)
  const { grouped: workoutGroups } = useWorkoutLactateGroups(athleteId)
  // Read-only here — only the coach can mark/undo a day off (athlete-planner.tsx)
  const { dayOffFor } = useDaysOff(athleteId)
  const [editingTargetId, setEditingTargetId] = useState<string | null>(null)
  const [targetEditFields, setTargetEditFields] = useState({ paceMin: '', paceMax: '', hrMin: '', hrMax: '' })
  const [savingTargetOverride, setSavingTargetOverride] = useState(false)
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  const [journey, setJourney] = useState<JourneySummary | null>(null)
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [weekLogs, setWeekLogs] = useState<WeekLog[]>([])
  const [addActivityOpen, setAddActivityOpen] = useState(false)
  const [addActivityDate, setAddActivityDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'))
  const [moveWorkoutTarget, setMoveWorkoutTarget] = useState<AssignedWorkout | null>(null)
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(() => {
    if (initialDate) { const d = new Date(initialDate); if (!isNaN(d.getTime())) return d }
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
    if (initialDate) { const d = new Date(initialDate); if (!isNaN(d.getTime())) return d }
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

  // Embedded mode (coach planner): keep the displayed date in sync with the
  // initialDate prop whenever the coach taps a different date on the calendar
  useEffect(() => {
    if (!initialDate) return
    const d = new Date(initialDate)
    if (isNaN(d.getTime())) return
    setCurrentDate(d)
    setSelectedWeekDay(d)
    setViewMode('day')
  }, [initialDate])

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
            offWeekAnchorDate: d.offWeekAnchorDate,
            weekStartDay: d.weekStartDay === 1 ? 1 : 0,
            kmWeekStartDay: d.kmWeekStartDay === 0 ? 0 : 1,
            labVisibleToAthlete: d.labVisibleToAthlete === true,
            physiology: d.physiology || undefined,
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
                stageName: stageDisplayName(stage), weekInStage: cur, totalWeeksInStage: total,
                isOffWeek: isRestWeek(today, d.offWeekInterval ?? 4, d.offWeekAnchorDate, stage.startDate),
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
        // Rolling visibility window: athlete sees only N weeks ahead
        // (rolls every Saturday; coach sets N per athlete, 0 = unlimited)
        let visibleWeeks = 2
        try {
          const uSnap = await getDoc(doc(db, 'users', athleteId))
          const v = uSnap.data()?.visibleWeeksAhead
          if (typeof v === 'number') visibleWeeks = v
        } catch {}
        const cutoffStr = visibleWeeks > 0
          ? format(addWeeks(startOfWeek(new Date(), { weekStartsOn: 6 }), visibleWeeks), 'yyyy-MM-dd')
          : null
        // Race/time-trial workouts and coach-flagged ones bypass the window —
        // the calendar date itself is always navigable, only the regular
        // workout content beyond the window is hidden.
        const bypassesWindow = (w: AssignedWorkout) =>
          w.showAheadOverride || w.workout?.type === 'race' || w.workout?.type === 'time_trial'
        setAssignedWorkouts(
          snap.docs
            .map(d => ({ ...(d.data() as AssignedWorkout), id: d.id }))
            .filter(w => !cutoffStr || w.scheduledDate < cutoffStr || bypassesWindow(w))
        )
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
    sortBySession(assignedWorkouts.filter(w => w.scheduledDate === dateStr))
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

  /** A heuristic fallback for when there's no precise assignedWorkoutId
   *  match (wLog) yet — sums ALL of the date's activity logs of the same
   *  discipline and compares the total against THIS card's own target.
   *  That's only sound on a day with exactly one workout: on a
   *  multi-workout day it double-counts the same activities against every
   *  card independently (e.g. today's total running distance clearing 70%
   *  of BOTH a 9km and a 7km target at once), which is exactly what caused
   *  both cards to show "done" with the same total distance even after
   *  the real per-workout Strava matching was already correct. Multi-
   *  workout days must rely solely on the precise wLog match instead —
   *  nothing shown here beats guessing wrong.
   */
  const computeStravaMatch = useCallback((w: AssignedWorkout, dateStr: string, isMulti: boolean) => {
    if (isMulti) return null
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

  const startEditingTarget = (w: AssignedWorkout, current: { paceRangeSec: [number, number]; hrRange: [number, number] | null } | null) => {
    setEditingTargetId(w.id)
    setTargetEditFields({
      paceMin: current ? secToPace(current.paceRangeSec[0]) : '',
      paceMax: current ? secToPace(current.paceRangeSec[1]) : '',
      hrMin: current?.hrRange ? String(current.hrRange[0]) : '',
      hrMax: current?.hrRange ? String(current.hrRange[1]) : '',
    })
  }

  const saveTargetOverride = async (w: AssignedWorkout) => {
    const paceMinSec = paceToSec(targetEditFields.paceMin)
    const paceMaxSec = paceToSec(targetEditFields.paceMax)
    if (!paceMinSec || !paceMaxSec) { toast.error('נדרש טווח קצב תקין (למשל 3:55 ו-4:15)'); return }
    const targetOverride = {
      paceMinSec: Math.min(paceMinSec, paceMaxSec),
      paceMaxSec: Math.max(paceMinSec, paceMaxSec),
      ...(targetEditFields.hrMin && targetEditFields.hrMax ? {
        hrMin: Math.min(Number(targetEditFields.hrMin), Number(targetEditFields.hrMax)),
        hrMax: Math.max(Number(targetEditFields.hrMin), Number(targetEditFields.hrMax)),
      } : {}),
    }
    setSavingTargetOverride(true)
    try {
      await updateDoc(doc(db, 'assignedWorkouts', w.id), { targetOverride })
      setAssignedWorkouts(prev => prev.map(aw => aw.id === w.id ? { ...aw, targetOverride } : aw))
      setEditingTargetId(null)
      toast.success('היעד עודכן')
    } catch (err) {
      console.error(err)
      toast.error('העדכון נכשל')
    } finally {
      setSavingTargetOverride(false)
    }
  }

  const clearTargetOverride = async (w: AssignedWorkout) => {
    try {
      await updateDoc(doc(db, 'assignedWorkouts', w.id), { targetOverride: null })
      setAssignedWorkouts(prev => prev.map(aw => aw.id === w.id ? { ...aw, targetOverride: undefined } : aw))
      toast.success('חזר לחישוב אוטומטי')
    } catch (err) { console.error(err); toast.error('העדכון נכשל') }
  }

  const renderWorkoutDetail = (w: AssignedWorkout) => {
    // Personalized threshold target — computed from THIS athlete's own
    // step-test data (a range, not one fixed point), so the same workout
    // template shows different numbers per athlete. The coach can manually
    // override it for this specific assignment. Computed once up here
    // (not only inside the badge below) so the concrete pace can also be
    // embedded directly in each set further down, not only in a badge
    // above the sets — that badge alone was unclear about which pace
    // applied to which set.
    const targetLevel = w.workout.targetThresholdLevel
    const metrics: ('pace' | 'hr' | 'lactate')[] = w.workout.targetMetrics?.length ? w.workout.targetMetrics : ['pace', 'hr', 'lactate']
    // Prefer the athlete's own last completed session of this exact
    // workout over the (possibly months-old) lab test — the target
    // self-adapts session to session.
    const recent = targetLevel && !w.targetOverride
      ? personalTargetRangeWithBaseline(latestSessionSteps(workoutGroups.get(groupKeyFor(w.workout, w.workoutId)), undefined, latestSteps), latestSteps, targetLevel)
      : null
    const source: 'override' | 'recent' | 'lab' = w.targetOverride ? 'override' : recent ? 'recent' : 'lab'
    const auto = targetLevel ? (recent || personalTargetRangeForLevel(latestSteps, targetLevel)) : null
    const range = targetLevel
      ? (w.targetOverride
          ? { paceRangeSec: [w.targetOverride.paceMinSec, w.targetOverride.paceMaxSec] as [number, number],
              hrRange: w.targetOverride.hrMin != null && w.targetOverride.hrMax != null ? [w.targetOverride.hrMin, w.targetOverride.hrMax] as [number, number] : null }
          : auto)
      : null
    const isEditing = editingTargetId === w.id
    // Full range for the badge above the sets (the "official" target);
    // just the midpoint for the set's own line — the range there was
    // clutter, the athlete just needs one number to aim for per set.
    const badgeText = targetLevel && range ? formatTargetRange(range, metrics, source === 'override' ? undefined : auto?.lactateMid) : null
    const inlinePaceText = targetLevel && range ? formatTargetRange(range, metrics, source === 'override' ? undefined : auto?.lactateMid, false) : null

    return (
    <div className="rounded-2xl overflow-hidden border border-gray-100 bg-white" dir={isRTL ? 'rtl' : 'ltr'}>
      {targetLevel && (isEditing ? (
            <div className="px-4 py-3 border-b border-border bg-navy/5 space-y-2" dir="rtl">
              <p className="text-xs font-semibold text-navy">התאמת יעד ({targetLevel}) לספורטאי זה</p>
              <div className="grid grid-cols-2 gap-2">
                <Input placeholder="קצב מינ' (4:15)" value={targetEditFields.paceMin} dir="ltr" className="h-9 text-sm"
                  onChange={e => setTargetEditFields(f => ({ ...f, paceMin: e.target.value }))} />
                <Input placeholder="קצב מקס' (3:55)" value={targetEditFields.paceMax} dir="ltr" className="h-9 text-sm"
                  onChange={e => setTargetEditFields(f => ({ ...f, paceMax: e.target.value }))} />
                <Input placeholder="דופק מינ'" type="number" value={targetEditFields.hrMin} className="h-9 text-sm"
                  onChange={e => setTargetEditFields(f => ({ ...f, hrMin: e.target.value }))} />
                <Input placeholder="דופק מקס'" type="number" value={targetEditFields.hrMax} className="h-9 text-sm"
                  onChange={e => setTargetEditFields(f => ({ ...f, hrMax: e.target.value }))} />
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" className="h-8 bg-navy text-white" disabled={savingTargetOverride}
                  onClick={() => saveTargetOverride(w)}>
                  {savingTargetOverride ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'שמור'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setEditingTargetId(null)}>ביטול</Button>
              </div>
            </div>
      ) : (
          <div className="px-4 py-2.5 border-b border-border bg-navy/5 flex items-center justify-end gap-1.5 flex-wrap">
            <span className={cn('text-xs font-semibold px-2.5 py-1 rounded-full whitespace-nowrap',
              range ? 'bg-white border border-navy/10 text-navy' : 'bg-amber-50 border border-amber-200 text-amber-700')} dir="ltr">
              {range
                ? `${targetLevel} · ${badgeText}${
                    source === 'override' ? ' · ✏️'
                    : source === 'recent' ? ((range as any).extrapolated ? ' · מוערך משיפוע הבדיקה' : ' · מהאימון הקודם')
                    : ' · מבדיקת מעבדה'
                  }`
                : `${targetLevel} — אין עדיין נתוני מעבדה`}
            </span>
            {isCoachViewer && (
              <button type="button" onClick={() => startEditingTarget(w, range)}
                className="text-muted-foreground hover:text-navy p-1" aria-label="ערוך יעד">
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            {isCoachViewer && w.targetOverride && (
              <button type="button" onClick={() => clearTargetOverride(w)}
                className="text-muted-foreground hover:text-red-500 p-1" aria-label="בטל התאמה">
                <XIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
      ))}
      {/* Warmup */}
      {w.workout.warmup && (
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm text-muted-foreground text-right">{t.warmupLabel}: {w.workout.warmup}</p>
        </div>
      )}
      {/* Sets — three distinct, never-ambiguous rest concepts:
          1. restBetweenReps: shown once under THIS set, only when reps > 1
             ("3× 2km" → "── מנוחה בין חזרות: X ──")
          2. restAfterSet: shown as the separator BEFORE the next set
             ("── מנוחה בין סטים: Y ──"), using THIS set's own field —
             no more "peek at the previous set" indirection
          3. interval.rest: already shown between each interval, unaffected */}
      {w.workout.sets && w.workout.sets.length > 0 && w.workout.sets.map((set: any, si: number) => {
        const hasIntervals = set.intervals && set.intervals.length > 0
        const restBetweenReps = setRestBetweenReps(set)
        const restAfterSet = setRestAfter(set)
        const isLastSet = si === (w.workout.sets as any[]).length - 1
        return (
          <div key={set.id||si}>
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
                {/* The set's own pace field is often just the T-level name
                    ("@ T1") rather than an actual pace — append the
                    athlete's concrete personalized number here too, not
                    only in the badge above the sets. */}
                {inlinePaceText && <span className="font-normal" dir="ltr"> · {inlinePaceText}</span>}
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
            {/* Rest between the reps of THIS set — e.g. "3× 2 ק"מ" always has
                a place to show its rest now, lone set or not. */}
            {(set.reps || 1) > 1 && restBetweenReps && (
              <div className="flex items-center gap-3 px-4" style={{height:'28px'}}>
                <div className="flex-1 h-px bg-border"/>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {t.restBetweenReps}: {restBetweenReps}
                </span>
                <div className="flex-1 h-px bg-border"/>
              </div>
            )}
            {/* Rest before the NEXT set — this set's own restAfterSet, shown
                only when there is a next set to transition into. */}
            {!isLastSet && (
              <div className="flex items-center gap-3 px-4" style={{height:'28px'}}>
                <div className="flex-1 h-px bg-border"/>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {restAfterSet ? `${t.restBetweenSets}: ${restAfterSet}` : t.continueToNext}
                </span>
                <div className="flex-1 h-px bg-border"/>
              </div>
            )}
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
          // The "no assignedWorkoutId" fallback only makes sense on a day
          // with exactly one workout (legacy logs saved before
          // assignedWorkoutId was tracked at all) — on a multi-workout day
          // (morning + evening, or run + gym) an orphaned log would
          // otherwise get attributed to EVERY workout that day via this
          // same fallback, showing the same completed distance under all
          // of them even though only one was actually done.
          const isSingleWorkoutDay = getWorkoutsForDay(new Date(w.scheduledDate)).length <= 1
          const hasManualLog = weekLogs.find(l =>
            (l.assignedWorkoutId === w.id || (isSingleWorkoutDay && !l.assignedWorkoutId && l.date === w.scheduledDate))
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
  }

  /** Debug utility (coach-only): wipes every log AND resets every assigned
   *  workout's status for the currently-viewed date, so repeated testing
   *  (manual "Fill from Strava" saves, partial deletes, several sync
   *  attempts) can't leave stale/duplicate data around to confuse the next
   *  test. Not meant for real day-to-day use — just for verifying the
   *  Strava-matching logic against a clean slate. */
  const handleResetDayDebug = async () => {
    if (!confirm(`מחיקת כל הנתונים של ${format(currentDate, 'd/M/yyyy')} — בטוח?`)) return
    try {
      const { doc, collection, deleteDoc, updateDoc, query, where, getDocs } = await import('firebase/firestore')
      const { db } = await import('@/lib/firebase')
      const dateStr = format(currentDate, 'yyyy-MM-dd')
      const logsSnap = await getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId), where('date', '==', dateStr)))
      await Promise.all(logsSnap.docs.map(d => deleteDoc(d.ref)))
      const awSnap = await getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId), where('scheduledDate', '==', dateStr)))
      await Promise.all(awSnap.docs.map(d => updateDoc(d.ref, { status: 'scheduled', completedAt: null })))
      setAssignedWorkouts(prev => prev.map(w => w.scheduledDate === dateStr ? { ...w, status: 'scheduled' } : w))
      setWeekLogs(prev => prev.filter(l => l.date !== dateStr))
      toast.success(`נמחק: ${logsSnap.docs.length} לוגים, אופסו ${awSnap.docs.length} אימונים`)
    } catch (e) {
      console.error(e)
      toast.error('איפוס נכשל')
    }
  }

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

        // First pass: save/find each activity's log doc. A log with a
        // LOW-confidence link (distance-only, rep-fit, or no candidate at
        // all) is still eligible to be re-matched below — only an explicit
        // SESSION TAG match (tier 3) is trusted as final. Rep-fit (tier 2)
        // isn't reliable enough to freeze forever: a short warmup can
        // coincidentally score a nonzero rep-fit against the WRONG
        // candidate, and once that happened before the session-inference
        // fix existed, it would otherwise never get another chance to
        // re-match now that a better signal (session) is available.
        //
        // That re-matching is only worth doing for RECENT activities,
        // though — an old one's data isn't going to suddenly improve, so
        // re-checking it on every single sync forever is pure waste (and
        // log noise). Anything older than this just keeps its existing
        // link, however low-confidence, permanently.
        const REPAIR_WINDOW_DAYS = 7
        const repairCutoffStr = new Date(Date.now() - REPAIR_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
        const toMatch: { activity: any; logRef: any; oldAssignedWorkoutId: string | null }[] = []
        for (const activity of data.activities) {
          const existing = await getDocs(query(collection(db, 'logs'), where('stravaActivityId', '==', activity.stravaActivityId), where('athleteId', '==', athleteId)))
          let logRef
          let oldAssignedWorkoutId: string | null = null
          if (!existing.empty) {
            const existingDoc = existing.docs[0]
            const alreadyConfident = (existingDoc.data().matchTier ?? 0) >= 3
            const tooOldToRepair = activity.date < repairCutoffStr
            if (existingDoc.data().assignedWorkoutId && (alreadyConfident || tooOldToRepair)) continue
            oldAssignedWorkoutId = existingDoc.data().assignedWorkoutId || null
            logRef = existingDoc.ref
          } else {
            logRef = await addDoc(collection(db, 'logs'), {
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
          }
          toMatch.push({ activity, logRef, oldAssignedWorkoutId })
        }

        // Smart auto-complete, grouped by date so same-day activities can
        // be reconciled together — a warmup/cooldown recorded as a
        // SEPARATE Strava activity from the main set has no rep structure
        // and a small distance of its own, so matched independently it can
        // land on a completely different scheduled workout later that day
        // just because that workout's plan happens to be a closer distance.
        const byDate = new Map<string, typeof toMatch>()
        for (const item of toMatch) {
          if (!byDate.has(item.activity.date)) byDate.set(item.activity.date, [])
          byDate.get(item.activity.date)!.push(item)
        }

        for (const [date, dayItems] of byDate) {
          try {
            const isRunAct = (a: any) => STRAVA_RUNNING_TYPES.includes(a.stravaType || 'Run')
            const isGymAct = (a: any) => STRAVA_GYM_TYPES.includes(a.stravaType || '')
            const isSwimAct = (a: any) => a.stravaType === 'Swim'
            const isBikeAct = (a: any) => ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide'].includes(a.stravaType || '')
            const awSnap = await getDocs(query(
              collection(db, 'assignedWorkouts'),
              where('athleteId', '==', athleteId),
              where('scheduledDate', '==', date)
            ))
            if (awSnap.empty) continue

            // Two real, separate workouts (e.g. AM run + PM run) need at
            // least this much of a gap to count as distinct sessions.
            const SAME_SESSION_GAP_HOURS = 4
            const buildTimeClusters = <T extends { activity: any }>(items: T[]): T[][] => {
              const sorted = [...items].sort((a, b) => (a.activity.startTime || '').localeCompare(b.activity.startTime || ''))
              const out: T[][] = []
              for (const t of sorted) {
                const startMs = t.activity.startTime ? new Date(t.activity.startTime).getTime() : null
                const last = out[out.length - 1]
                const lastT = last?.[last.length - 1]
                const lastEndMs = lastT?.activity.startTime
                  ? new Date(lastT.activity.startTime).getTime() + (lastT.activity.durationMin || 0) * 60000
                  : null
                if (last && startMs != null && lastEndMs != null && (startMs - lastEndMs) <= SAME_SESSION_GAP_HOURS * 3600 * 1000) {
                  last.push(t)
                } else {
                  out.push([t])
                }
              }
              return out
            }

            type Tentative = { activity: any; logRef: any; match: any; tier: number; oldAssignedWorkoutId: string | null }
            const tentative: Tentative[] = []

            // Pre-pass — pure chronological pairing. A real session's own
            // internal Strava auto-laps can coincidentally fit a DIFFERENT
            // workout's rep count better than the one it actually belongs
            // to, which rep-fit/distance scoring alone can't tell apart.
            // But when every activity today is a run, and the number of
            // distinct time-separated sessions (grouped purely by the
            // SAME_SESSION_GAP_HOURS rule, before any rep/distance
            // reasoning) exactly matches the number of scheduled,
            // not-yet-completed running workouts, there's a much more
            // reliable signal available: pair them up by time order alone
            // — the earliest session goes to whichever workout is
            // earliest in the day (by session tag), and so on.
            const runCandidates = awSnap.docs.filter(aw => {
              if (aw.data().status === 'completed') return false
              const wType = aw.data().workout?.type || ''
              return !['strength', 'cross_training'].includes(wType) && wType !== 'swim' && wType !== 'bike'
            })
            const allRunToday = dayItems.every(item => isRunAct(item.activity))
            const rawClusters = allRunToday ? buildTimeClusters(dayItems) : []
            let handledChronologically = false
            if (allRunToday && rawClusters.length > 1 && rawClusters.length === runCandidates.length) {
              const sessionOrder = (aw: typeof runCandidates[number]) =>
                aw.data().session === 'am' ? 0 : aw.data().session === 'pm' ? 1 : 2
              const sortedCandidates = [...runCandidates].sort((a, b) => sessionOrder(a) - sessionOrder(b))
              const sortedClusters = [...rawClusters].sort((a, b) => (a[0].activity.startTime || '').localeCompare(b[0].activity.startTime || ''))
              for (let i = 0; i < sortedClusters.length; i++) {
                const match = sortedCandidates[i]
                for (const { activity, logRef, oldAssignedWorkoutId } of sortedClusters[i]) {
                  console.log('[strava-match] chronological', {
                    activity: activity.stravaName, startTime: activity.startTime,
                    sessionIndex: i, matchedTo: match.data().workout?.title,
                  })
                  tentative.push({ activity, logRef, match, tier: 4, oldAssignedWorkoutId })
                }
              }
              handledChronologically = true
            }

            // Phase 1 (fallback path only) — each activity's OWN best
            // match, independent of its same-day siblings. tier:
            // 3=explicit session tag, 2=rep-fit, 1=distance closeness,
            // 0=only candidate / no signal at all.
            for (const { activity, logRef, oldAssignedWorkoutId } of (handledChronologically ? [] : dayItems)) {
              const candidates = awSnap.docs.filter(aw => {
                // A completed workout is normally excluded (don't steal it
                // from whatever legitimately finished it) — UNLESS it's
                // already this exact activity's own current link, in which
                // case it must stay eligible for re-matching. Otherwise,
                // re-evaluating a low-confidence link whose target happens
                // to already be complete (by this very activity, from an
                // earlier sync) would see only the OTHER workout left as a
                // candidate and wrongly reassign there by elimination.
                if (aw.data().status === 'completed' && aw.id !== oldAssignedWorkoutId) return false
                const wType = aw.data().workout?.type || ''
                const isStrengthW = ['strength', 'cross_training'].includes(wType)
                if (isStrengthW) return isGymAct(activity)
                if (wType === 'swim') return isSwimAct(activity)
                if (wType === 'bike') return isBikeAct(activity)
                return isRunAct(activity)
              })
              if (candidates.length === 0) continue

              let activitySession: 'am' | 'pm' | null = null
              if (activity.startTime) {
                const hourPart = String(activity.startTime).split('T')[1]
                const hour = hourPart ? parseInt(hourPart.split(':')[0], 10) : NaN
                if (!isNaN(hour)) activitySession = hour < 14 ? 'am' : 'pm'
              }
              // The coach's UI only prompts for a session tag when a SECOND
              // workout is added to an already-occupied day, so on a
              // two-workout day often only ONE of them ever gets tagged —
              // leaving the other with no session field at all, which then
              // never matches here even though there's no real ambiguity:
              // the untagged one must be the opposite session from the
              // tagged one.
              const effectiveSession = (aw: typeof candidates[number]): 'am' | 'pm' | 'other' | undefined => {
                const own = aw.data().session
                if (own) return own
                if (candidates.length === 2) {
                  const otherSession = candidates.find(c => c.id !== aw.id)?.data().session
                  if (otherSession === 'am') return 'pm'
                  if (otherSession === 'pm') return 'am'
                }
                return undefined
              }
              const bySession = activitySession ? candidates.find(aw => effectiveSession(aw) === activitySession) : undefined
              const byRepFit = !bySession && candidates.length > 1
                ? candidates.reduce<{ aw: typeof candidates[number]; score: number } | null>((best, aw) => {
                    const expectedMeters = expectedRepMetersForWorkout(aw.data().workout)
                    if (expectedMeters.length === 0) return best
                    const score = scoreActivityFitForReps(activity.splitLogs || [], expectedMeters)
                    if (score === 0) return best
                    return (!best || score > best.score) ? { aw, score } : best
                  }, null)?.aw
                : undefined
              const byDistance = !bySession && !byRepFit && candidates.length > 1
                ? candidates.reduce<{ aw: typeof candidates[number]; diff: number } | null>((best, aw) => {
                    const plannedKm = aw.data().workout?.distance
                    if (plannedKm == null) return best
                    const diff = Math.abs(plannedKm - activity.distanceKm)
                    return (!best || diff < best.diff) ? { aw, diff } : best
                  }, null)?.aw
                : undefined
              const match = bySession || byRepFit || byDistance || candidates[0]
              const tier = bySession ? 3 : byRepFit ? 2 : byDistance ? 1 : 0
              console.log('[strava-match] tentative', {
                activity: activity.stravaName, stravaActivityId: activity.stravaActivityId,
                startTime: activity.startTime, distanceKm: activity.distanceKm,
                candidates: candidates.map(c => ({ id: c.id, title: c.data().workout?.title, session: c.data().session, plannedKm: c.data().workout?.distance })),
                matchedTo: match.data().workout?.title, tier,
              })
              tentative.push({ activity, logRef, match, tier, oldAssignedWorkoutId })
            }

            // Phase 2 (fallback path only) — reconcile same-day activities
            // that started close together in time as ONE physical
            // training block: they must all agree on whichever match has
            // the strongest evidence in the group, instead of a
            // low-confidence fragment (a cooldown, say) drifting off to a
            // different scheduled workout on its own. Already handled by
            // the chronological pre-pass above when that applied cleanly.
            if (!handledChronologically) {
              const clusters = buildTimeClusters(tentative)
              for (const cluster of clusters) {
                if (cluster.length < 2) continue
                const winner = cluster.reduce((best, t) => (!best || t.tier > best.tier) ? t : best, null as Tentative | null)!
                console.log('[strava-match] cluster reconciled', {
                  members: cluster.map(t => t.activity.stravaName),
                  winnerActivity: winner.activity.stravaName,
                  winnerMatch: winner.match.data().workout?.title,
                  winnerTier: winner.tier,
                })
                for (const t of cluster) { t.match = winner.match; t.tier = winner.tier }
              }
            }

            // Phase 3 — write the final decision for each activity.
            for (const { activity, logRef, match, tier } of tentative) {
              const wType = match.data().workout?.type || ''
              const isStrengthW = ['strength', 'cross_training'].includes(wType)
              const plannedDist = match.data().workout?.distance ?? 0
              let shouldComplete = false
              if (isStrengthW || wType === 'swim' || wType === 'bike') {
                shouldComplete = true // discipline already confirmed via candidates filter
              } else {
                // Sum distance across every activity THIS sync matched to
                // the same workout (covers both "several workouts today"
                // and "one workout split into warmup + main" cases).
                const matchedKm = tentative.filter(t => t.match.id === match.id).reduce((s, t) => s + (t.activity.distanceKm || 0), 0)
                shouldComplete = plannedDist === 0 || matchedKm >= plannedDist * 0.7
              }
              console.log('[strava-match] final', {
                activity: activity.stravaName, matchedTo: match.data().workout?.title, tier, shouldComplete,
              })
              await updateDoc(logRef, { assignedWorkoutId: match.id, comparisonGroup: match.data().workout?.comparisonGroup || null, matchTier: tier })
              if (shouldComplete) {
                await updateDoc(doc(db, 'assignedWorkouts', match.id), { status: 'completed', completedAt: serverTimestamp() })
                setAssignedWorkouts(prev => prev.map(w => w.id === match.id ? { ...w, status: 'completed' } : w))
              }
            }

            // Lab backfill — a Strava-synced log's workoutId is only ever
            // the synthetic `strava_<activityId>` placeholder set at
            // creation (see the addDoc above), and it never gets
            // thresholdDistance/hasLactate — so useWorkoutLactateGroups
            // (the Lab) never sees an auto-synced threshold session at
            // all, no matter how good its rep data is.
            //
            // A previous attempt at this (reverted) guarded itself with
            // `expectedRepMetersForWorkout(workout).length > 0`, which is
            // true for ANY workout with a non-empty `sets` array — a gym
            // set of 12 squats or an easy run's duration-based warmup/
            // cooldown "sets" both qualify just as much as a real "5×1000m"
            // threshold session, since that function only checks whether
            // sets exist, not whether they carry a real distance. That let
            // the backfill misfire on workout types it was never meant to
            // touch, overwriting their splitLogs/workoutId and breaking the
            // athlete's own previously-correct Strava display for them.
            //
            // inferThresholdDistance is the SAME check the Lab itself uses
            // to decide "does this workout belong in the threshold view" —
            // reusing it here (instead of re-deriving a similar-looking
            // but different condition) guarantees this backfill only ever
            // fires for a workout the Lab would actually want, by
            // construction. The extra expectedMeters.some(...) check is a
            // second belt-and-braces guard that there's a real distance
            // target to build rep rows from at all.
            //
            // Only the MAIN event fragment of a multi-fragment session
            // (warmup+main+cooldown) gets this — the longest-distance
            // activity among everything matched to this workout this sync.
            // Warmup/cooldown fragments are left as plain Strava logs.
            for (const matchId of new Set(tentative.map(t => t.match.id))) {
              const group = tentative.filter(t => t.match.id === matchId)
              const match = group[0].match
              const workoutData = match.data().workout
              const thresholdDistance = inferThresholdDistance(workoutData)
              if (thresholdDistance == null) continue // not a real distance-based threshold workout
              const expectedMeters = expectedRepMetersForWorkout(workoutData)
              if (!expectedMeters.some(m => m != null)) continue // no real distance targets to build reps from
              const mainEntry = group.reduce((best, g) => (g.activity.distanceKm || 0) > (best.activity.distanceKm || 0) ? g : best)
              const rows = buildRepDisplayRows(
                (mainEntry.activity.splitLogs || []).map((s: any) => ({ distanceKm: s.distanceKm, time: s.time, heartRate: s.heartRate })),
                expectedMeters,
              )
              const newSplitLogs: any[] = []
              let lastRepEntry: any = null
              for (const row of rows) {
                if (row.kind === 'rep') {
                  lastRepEntry = {
                    setIndex: 0, repIndex: row.repIndex,
                    distance: row.targetMeters ? `${row.targetMeters}m` : '',
                    time: secToPace(row.elapsedSec),
                    pace: row.pace,
                    avgHr: row.heartRate ?? null,
                    lactate: null,
                    rest: '',
                  }
                  newSplitLogs.push(lastRepEntry)
                } else if (lastRepEntry && !lastRepEntry.rest) {
                  lastRepEntry.rest = row.time
                }
              }
              if (newSplitLogs.length === 0) continue
              await updateDoc(mainEntry.logRef, {
                workoutId: match.data().workoutId,
                workoutTitle: workoutData?.title || null,
                thresholdDistance,
                hasLactate: false,
                splitLogs: newSplitLogs,
              })
            }

            // A repaired log's match can move to a DIFFERENT workout than
            // before (e.g. a fragment that was wrongly completing the
            // evening workout now correctly points to morning instead) —
            // if nothing today still points to whatever it used to be
            // linked to, that workout's "completed" status is stale and
            // must be reverted, or it stays wrongly marked done forever.
            const oldIds = new Set(tentative.map(t => t.oldAssignedWorkoutId).filter((id): id is string => !!id))
            const newIds = new Set(tentative.map(t => t.match.id))
            for (const oldId of oldIds) {
              if (newIds.has(oldId)) continue
              const staleDoc = awSnap.docs.find(d => d.id === oldId)
              if (staleDoc && staleDoc.data().status === 'completed') {
                console.log('[strava-match] reverting stale completion', { workoutId: oldId, title: staleDoc.data().workout?.title })
                await updateDoc(doc(db, 'assignedWorkouts', oldId), { status: 'scheduled', completedAt: null })
                setAssignedWorkouts(prev => prev.map(w => w.id === oldId ? { ...w, status: 'scheduled' } : w))
              }
            }
          } catch (e) { console.error('Smart auto-complete failed:', e) }
        }
        toast.success(`${t.syncedFromStrava}: ${saved}`)
        // Reload logs
        const logsSnap = await getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId)))
        setWeekLogs(logsSnap.docs.map(mapLogDoc))
      } else {
        // Previously silent on failure — e.g. Strava's own rate limit
        // (100 requests/15min) kicking in after several syncs in a row
        // returns { error: '...Too Many Requests' } here, and nothing was
        // ever shown to the user for it.
        const isRateLimit = String(data.error || '').toLowerCase().includes('too many requests')
        toast.error(isRateLimit ? t.stravaRateLimitError : t.stravaSyncTitle)
      }
    } catch (err) { console.error(err); toast.error(t.stravaSyncTitle) }
    finally { setStravaSyncing(false) }
  }


  const StravaCard = ({ log, dayWorkouts = [] }: { log: WeekLog; dayWorkouts?: AssignedWorkout[] }) => {
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

    // Manual override — auto-matching (session tag / rep-fit / distance /
    // chronological order) is only ever a best-effort guess; this lets the
    // athlete or coach directly fix it in one tap instead of waiting on
    // another sync. Setting matchTier: 3 marks it as confidently final, so
    // a future sync's low-confidence repair pass never second-guesses it.
    const [reassigning, setReassigning] = useState(false)
    const handleReassign = async (newWorkoutId: string) => {
      const prevWorkoutId = log.assignedWorkoutId || null
      if (newWorkoutId === (prevWorkoutId || '')) return
      setReassigning(true)
      try {
        const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore')
        const { db } = await import('@/lib/firebase')
        const newWorkout = newWorkoutId ? dayWorkouts.find(w => w.id === newWorkoutId) : undefined
        await updateDoc(doc(db, 'logs', log.id), {
          assignedWorkoutId: newWorkoutId || null,
          comparisonGroup: newWorkout?.workout?.comparisonGroup || null,
          matchTier: 3,
        })
        if (newWorkoutId) {
          await updateDoc(doc(db, 'assignedWorkouts', newWorkoutId), { status: 'completed', completedAt: serverTimestamp() })
          setAssignedWorkouts(prev => prev.map(w => w.id === newWorkoutId ? { ...w, status: 'completed' } : w))
        }
        if (prevWorkoutId && prevWorkoutId !== newWorkoutId) {
          await updateDoc(doc(db, 'assignedWorkouts', prevWorkoutId), { status: 'scheduled', completedAt: null })
          setAssignedWorkouts(prev => prev.map(w => w.id === prevWorkoutId ? { ...w, status: 'scheduled' } : w))
        }
        setWeekLogs(prev => prev.map(l => l.id === log.id ? { ...l, assignedWorkoutId: newWorkoutId || undefined } : l))
        toast.success(t.reassignedToast)
      } catch (e) { console.error(e); toast.error(t.savingError) }
      finally { setReassigning(false) }
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
              <SplitsTable splitLogs={log.splitLogs} matchedWorkout={dayWorkouts.find(w => w.id === log.assignedWorkoutId)?.workout} referencePace={log.actualPace} />
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

          {/* Manual "assign to workout" override — auto-matching is only
              ever a best-effort guess; this fixes it in one tap. */}
          {dayWorkouts.length > 0 && (
            <div className="px-3.5 pb-2 flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground flex-shrink-0">{t.assignToWorkoutLabel}</span>
              <select
                value={log.assignedWorkoutId || ''}
                disabled={reassigning}
                onChange={e => handleReassign(e.target.value)}
                className="flex-1 min-w-0 text-[11px] font-semibold text-navy bg-gray-50 border border-gray-200 rounded-full px-2 py-1 disabled:opacity-50">
                <option value="">{t.noWorkoutOption}</option>
                {dayWorkouts.map(w => (
                  <option key={w.id} value={w.id}>{w.workout?.title || t.workouts}</option>
                ))}
              </select>
            </div>
          )}

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
          {/* Manual "assign to workout" override — auto-matching is only
              ever a best-effort guess; this fixes it in one tap. */}
          {dayWorkouts.length > 0 && (
            <div className="px-3.5 pb-2 flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground flex-shrink-0">{t.assignToWorkoutLabel}</span>
              <select
                value={log.assignedWorkoutId || ''}
                disabled={reassigning}
                onChange={e => handleReassign(e.target.value)}
                className="flex-1 min-w-0 text-[11px] font-semibold text-navy bg-gray-50 border border-gray-200 rounded-full px-2 py-1 disabled:opacity-50">
                <option value="">{t.noWorkoutOption}</option>
                {dayWorkouts.map(w => (
                  <option key={w.id} value={w.id}>{w.workout?.title || t.workouts}</option>
                ))}
              </select>
            </div>
          )}
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
                  <SplitsTable splitLogs={log.splitLogs} matchedWorkout={dayWorkouts.find(w => w.id === log.assignedWorkoutId)?.workout} referencePace={log.actualPace} />
                </div>
              )}
            </div>
          )}
        </div>
      </>
    )
  }

  // ── Consolidated multi-fragment session card ────────────────────────
  // A single training block (warmup + main set + cooldown) can land as
  // several separate Strava activities that all correctly share one
  // assignedWorkoutId (see the same-session clustering in
  // handleStravaSync) — the athlete should only see ONE box for it and
  // give feedback ONCE, not once per fragment. The longest-distance
  // fragment is the main event; its pace/HR/splits are what's shown.
  const ConsolidatedStravaCard = ({ logs, dayWorkouts = [] }: { logs: WeekLog[]; dayWorkouts?: AssignedWorkout[] }) => {
    const sortedByTime = [...logs].sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''))
    const mainLog = logs.reduce((best, l) => (l.actualDistance || 0) > (best.actualDistance || 0) ? l : best, logs[0])
    const kindInfo = getActivityInfo(mainLog)
    const isManual = mainLog.source === 'manual'
    const totalDistance = Math.round(logs.reduce((s, l) => s + (l.actualDistance || 0), 0) * 100) / 100
    const totalDurationMin = logs.reduce((s, l) => s + (l.durationMin || 0), 0)
    const durationDisplay = formatDurationMin(totalDurationMin, isRTL)
    const isPending = logs.some(l => l.feedbackStatus === 'pending')
    const [pendingEffort, setPendingEffort] = useState<number|null>(mainLog.effort ?? null)
    const [pendingComment, setPendingComment] = useState(mainLog.comment || '')
    const [submitting, setSubmitting] = useState(false)
    const [showForm, setShowForm] = useState(isPending)
    const [showDetails, setShowDetails] = useState(false)
    const [showSplits, setShowSplits] = useState(false)
    const [reassigning, setReassigning] = useState(false)

    const handleSubmit = async () => {
      if (!pendingEffort) { toast.error(t.selectEffortError); return }
      setSubmitting(true)
      try {
        const { serverTimestamp } = await import('firebase/firestore')
        await Promise.all(logs.map(l => updateDoc(doc(db, 'logs', l.id), {
          effort: pendingEffort, comment: pendingComment, feedbackStatus: 'done', updatedAt: serverTimestamp(),
        })))
        const ids = new Set(logs.map(l => l.id))
        setWeekLogs(prev => prev.map(l => ids.has(l.id) ? { ...l, effort: pendingEffort, comment: pendingComment, feedbackStatus: 'done' } : l))
        setShowForm(false)
        toast.success(t.workoutSaved)
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
      } catch (e) { console.error(e); toast.error(t.savingError) }
      finally { setSubmitting(false) }
    }

    const handleReassign = async (newWorkoutId: string) => {
      const prevWorkoutId = mainLog.assignedWorkoutId || null
      if (newWorkoutId === (prevWorkoutId || '')) return
      setReassigning(true)
      try {
        const { serverTimestamp } = await import('firebase/firestore')
        const newWorkout = newWorkoutId ? dayWorkouts.find(w => w.id === newWorkoutId) : undefined
        await Promise.all(logs.map(l => updateDoc(doc(db, 'logs', l.id), {
          assignedWorkoutId: newWorkoutId || null,
          comparisonGroup: newWorkout?.workout?.comparisonGroup || null,
          matchTier: 3,
        })))
        if (newWorkoutId) {
          await updateDoc(doc(db, 'assignedWorkouts', newWorkoutId), { status: 'completed', completedAt: serverTimestamp() })
          setAssignedWorkouts(prev => prev.map(w => w.id === newWorkoutId ? { ...w, status: 'completed' } : w))
        }
        if (prevWorkoutId && prevWorkoutId !== newWorkoutId) {
          await updateDoc(doc(db, 'assignedWorkouts', prevWorkoutId), { status: 'scheduled', completedAt: null })
          setAssignedWorkouts(prev => prev.map(w => w.id === prevWorkoutId ? { ...w, status: 'scheduled' } : w))
        }
        const ids = new Set(logs.map(l => l.id))
        setWeekLogs(prev => prev.map(l => ids.has(l.id) ? { ...l, assignedWorkoutId: newWorkoutId || undefined } : l))
        toast.success(t.reassignedToast)
      } catch (e) { console.error(e); toast.error(t.savingError) }
      finally { setReassigning(false) }
    }

    const handleDeleteAll = async () => {
      if (!confirm(t.deleteWorkoutConfirm)) return
      try {
        const { deleteDoc } = await import('firebase/firestore')
        await Promise.all(logs.map(l => deleteDoc(doc(db, 'logs', l.id))))
        const ids = new Set(logs.map(l => l.id))
        setWeekLogs(prev => prev.filter(l => !ids.has(l.id)))
        toast.success(t.workoutDeleted)
      } catch (e) { console.error(e); toast.error(t.errorDeleting) }
    }

    const assignSelect = dayWorkouts.length > 0 && (
      <div className="px-3.5 pb-2 flex items-center gap-1.5">
        <span className="text-[10px] text-muted-foreground flex-shrink-0">{t.assignToWorkoutLabel}</span>
        <select
          value={mainLog.assignedWorkoutId || ''}
          disabled={reassigning}
          onChange={e => handleReassign(e.target.value)}
          className="flex-1 min-w-0 text-[11px] font-semibold text-navy bg-gray-50 border border-gray-200 rounded-full px-2 py-1 disabled:opacity-50">
          <option value="">{t.noWorkoutOption}</option>
          {dayWorkouts.map(w => (
            <option key={w.id} value={w.id}>{w.workout?.title || t.workouts}</option>
          ))}
        </select>
      </div>
    )

    const segmentChips = (
      <div className="px-3.5 pb-2 flex items-center gap-1.5 flex-wrap">
        {sortedByTime.map(l => (
          // Falls back to the raw Strava/Garmin lap name when there's no
          // distance/duration to show (e.g. a structured-workout step like
          // "תיעוד לפני אינטרוול") — those can run long, so this always
          // truncates instead of stretching the chip past the phone's
          // width and breaking the row layout.
          <span key={l.id} className={cn('max-w-[45vw] truncate text-[10px] font-semibold px-2 py-0.5 rounded-full border',
            l.id === mainLog.id ? 'bg-[#c9a84c]/15 text-[#c9a84c] border-[#c9a84c]/30' : 'bg-gray-50 text-gray-500 border-gray-200')}>
            {l.id === mainLog.id && `${t.mainEventBadge} · `}
            {l.actualDistance ? `${l.actualDistance} km` : (formatDurationMin(l.durationMin, isRTL) || l.stravaName)}
          </span>
        ))}
      </div>
    )

    const splitsSection = (mainLog.splitLogs && mainLog.splitLogs.length > 0) && (
      <div>
        <button
          onClick={() => setShowSplits(prev => !prev)}
          className="w-full px-3.5 py-2 flex items-center justify-between text-xs font-bold text-[#0a1628]/60 hover:bg-gray-50 transition-colors">
          <span>{t.splitsLabelShort} ({mainLog.splitLogs.length})</span>
          {showSplits ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
        {showSplits && (
          <div className="px-3.5 pb-3">
            <SplitsTable splitLogs={mainLog.splitLogs} matchedWorkout={dayWorkouts.find(w => w.id === mainLog.assignedWorkoutId)?.workout} referencePace={mainLog.actualPace} />
          </div>
        )}
      </div>
    )

    // ── STATE 1: Pending feedback (or editing) — compact collapsible ───
    if (isPending || showForm) return (
      <div className="rounded-2xl border border-amber-200/60 bg-white shadow-sm overflow-hidden" dir="rtl">
        <div className="px-3.5 py-2.5 flex items-center gap-2">
          <div className={cn('h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0', isManual ? 'bg-[#0a1628]' : 'bg-[#FC4C02]')}>
            <span className="text-[11px]">{isManual ? kindInfo.emoji : <span className="text-[9px] font-black text-white">S</span>}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0', kindInfo.badgeClass)}>
                {kindInfo.emoji} {activityLabel(kindInfo.kind, isRTL)}
              </span>
              <span className="text-sm font-bold text-navy truncate">{totalDistance ? `${totalDistance} km` : durationDisplay}</span>
              <span className="text-xs text-gray-400">· {logs.length} {t.segmentsCountLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={() => setShowForm(prev => !prev)}
              className={cn('text-[11px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap active:scale-95 transition-all border',
                showForm ? 'bg-gray-100 text-gray-600 border-gray-200' : 'bg-[#c9a84c]/20 text-[#c9a84c] border-[#c9a84c]/40')}>
              {showForm ? t.closeCta : 'ממתין למשוב שלך'}
            </button>
            <button onClick={handleDeleteAll} className="h-6 w-6 rounded-full hover:bg-red-50 flex items-center justify-center text-muted-foreground/50 hover:text-red-400 transition-colors text-sm">✕</button>
          </div>
        </div>
        {segmentChips}
        {assignSelect}
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
    )

    // ── STATE 2: Completed — expanded stats card ────────────────────────
    return (
      <div className="bg-white rounded-2xl border border-[#FC4C02]/15 shadow-sm overflow-hidden" dir="rtl">
        <div className="px-3.5 py-2.5 flex items-center gap-2">
          <div className={cn('h-6 w-6 rounded-lg flex items-center justify-center flex-shrink-0', isManual ? 'bg-[#0a1628]' : 'bg-[#FC4C02]')}>
            <span className="text-[11px]">{isManual ? kindInfo.emoji : <span className="text-[9px] font-black text-white">S</span>}</span>
          </div>
          <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0', kindInfo.badgeClass)}>
            {kindInfo.emoji} {activityLabel(kindInfo.kind, isRTL)}
          </span>
          <span className="flex-1 text-sm font-bold text-[#0a1628] truncate">{mainLog.stravaName || activityLabel(kindInfo.kind, isRTL)}</span>
          <span className="text-[10px] font-bold text-emerald-600 flex-shrink-0">✓</span>
          <button onClick={() => setShowForm(true)} className="text-[10px] text-[#0a1628]/50 hover:text-[#0a1628] flex-shrink-0 font-medium border border-gray-200 rounded-full px-2 py-0.5 transition-colors">{t.editActivityBtn}</button>
          <button onClick={handleDeleteAll} className="h-6 w-6 rounded-full flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0 text-sm">✕</button>
        </div>
        {segmentChips}
        {assignSelect}
        <div className="px-3.5 pb-3 grid grid-cols-3 gap-1.5">
          {totalDistance > 0 && (
            <div className="bg-gray-50 rounded-xl p-2 text-center">
              <p className="text-base font-black text-[#0a1628]">{totalDistance}</p>
              <p className="text-[9px] text-gray-400">ק&quot;מ</p>
            </div>
          )}
          {durationDisplay && (
            <div className="bg-gray-50 rounded-xl p-2 text-center">
              <p className="text-base font-black text-[#0a1628]">{durationDisplay}</p>
              <p className="text-[9px] text-gray-400">{t.durationMinLabel}</p>
            </div>
          )}
          {mainLog.actualPace && (
            <div className="bg-gray-50 rounded-xl p-2 text-center">
              <p className="text-base font-black text-[#0a1628]" dir="ltr">{mainLog.actualPace.replace('/km','')}</p>
              <p className="text-[9px] text-gray-400">{t.tempoLabel}</p>
            </div>
          )}
          {mainLog.averageHeartRate && (
            <div className="bg-red-50 rounded-xl p-2 text-center">
              <p className="text-base font-black text-red-600">{mainLog.averageHeartRate}</p>
              <p className="text-[9px] text-gray-400">{t.heartRateLabel}</p>
            </div>
          )}
          {mainLog.effort != null && (
            <div className="bg-amber-50 rounded-xl p-2 text-center">
              <p className="text-base font-black text-amber-700">{mainLog.effort}/10</p>
              <p className="text-[9px] text-gray-400">{t.effortValueLabel}</p>
            </div>
          )}
        </div>
        {splitsSection}
      </div>
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
            <div className="px-4 pt-2.5 pb-0 flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{t.workoutCardPrefix} {cardIndex}</span>
              {w.session && SESSION_BADGE[w.session] && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 border border-gray-200">
                  {SESSION_BADGE[w.session].emoji} {SESSION_BADGE[w.session].label}
                </span>
              )}
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

  /** A date range the COACH marked as no-workout (sick/trip/other) — shown
   *  instead of the rest-day hero so it's clear this was intentional, not a
   *  missed workout. Read-only here: only the coach can mark/undo a day off
   *  (see athlete-planner.tsx) — the athlete just sees the result.
   *  Reminders are already suppressed server-side for this range (see
   *  app/api/send-morning-reminders, send-evening-reminders). */
  const renderDayOffCard = (dateStr: string) => {
    const dayOff = dayOffFor(dateStr)
    if (!dayOff) return null
    const title = dayOff.reason === 'sick' ? t.dayOffCardTitleSick
      : dayOff.reason === 'trip' ? t.dayOffCardTitleTrip
      : t.dayOffCardTitleOther
    return (
      <div className="bg-gradient-to-br from-[#0a1628] to-[#0a1628]/85 rounded-3xl p-6 text-center space-y-2">
        <p className="text-xl font-bold text-white">{title}</p>
        {dayOff.note && <p className="text-sm text-white/60" dir="auto">{dayOff.note}</p>}
      </div>
    )
  }

  const renderNavyWorkoutBlock = (w: AssignedWorkout, isMulti: boolean, idx: number, dateStr: string, matchedActivities: WeekLog[] = [], dayWorkouts: AssignedWorkout[] = []) => {
    const wEff = getEffectiveStatus(w)
    const wSelected = selectedWorkoutId === w.id
    // The "no assignedWorkoutId" fallback only applies on a single-workout
    // day (isMulti false) — on a multi-workout day an orphaned log would
    // otherwise get attributed to every workout that day via this same
    // fallback, showing the same completed distance under all of them.
    // When several Strava fragments (warmup/main/cooldown) share this
    // workout, the longest-distance one is the main event — that's the
    // one whose pace/effort should represent the workout up top, and the
    // top "km" pill should show the combined total, not just one fragment.
    const matchedWithDistance = matchedActivities.filter(l => !!l.actualDistance)
    const mainMatchedLog = matchedWithDistance.length > 0
      ? matchedWithDistance.reduce((best, l) => (l.actualDistance || 0) > (best.actualDistance || 0) ? l : best)
      : undefined
    const totalMatchedKm = matchedWithDistance.length > 0
      ? Math.round(matchedWithDistance.reduce((s, l) => s + (l.actualDistance || 0), 0) * 100) / 100
      : undefined
    const wLog = weekLogs.find(l => l.assignedWorkoutId === w.id && !!l.actualDistance && !isActivityLog(l))
      || weekLogs.find(l => !isMulti && !l.assignedWorkoutId && l.date === dateStr && !!l.actualDistance && !isActivityLog(l))
    // Used only for the top pill's pace/effort/duration display (never for
    // ManualLogCard below, which must stay scoped to plain non-Strava logs
    // or the matched Strava fragment(s) would render twice).
    const topLog = mainMatchedLog || wLog
    const wMsg = coachMessages.find(m => m.assignedWorkoutId === w.id)
    const stravaThisDay = weekLogs.find(l => l.date === dateStr && l.source === 'strava')
    const stravaMatch = computeStravaMatch(w, dateStr, isMulti)
    const isEffectivelyDone = wEff === 'completed' || stravaMatch?.status === 'completed'
    return (
      <div key={w.id} className="space-y-2">
        {isMulti && (
          <div className="flex items-center gap-1.5 px-1">
            <p className="text-[10px] font-bold text-[#c9a84c] uppercase tracking-widest">{t.workoutCardPrefix} {idx + 1}</p>
            {w.session && SESSION_BADGE[w.session] && (
              <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-[#c9a84c]/15 text-[#c9a84c]">
                {SESSION_BADGE[w.session].emoji} {SESSION_BADGE[w.session].label}
              </span>
            )}
          </div>
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
                  {totalMatchedKm ?? topLog?.actualDistance ?? w.workout.distance} km
                </span>
              )}
              {w.workout.duration && !topLog && (
                <span className="text-sm bg-white/15 text-white px-3 py-1.5 rounded-full">{w.workout.duration} min</span>
              )}
              {topLog?.actualPace && <span className="text-sm bg-white/15 text-white px-3 py-1.5 rounded-full" dir="ltr">{topLog.actualPace}</span>}
              {topLog?.effort != null && <span className="text-sm bg-white/15 text-white px-3 py-1.5 rounded-full">{t.effortValueLabel} {topLog.effort}/10</span>}
            </div>
            {stravaMatch && !topLog && (
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
        {/* Strava activity/activities matched to THIS specific workout
            (via assignedWorkoutId) — shown right here instead of in a
            generic list below every workout of the day, so the morning
            workout only ever shows the morning's own Strava data and the
            evening workout only its own. When warmup/main/cooldown were
            recorded as separate fragments they all land here together —
            show ONE consolidated card (one feedback prompt) instead of
            one box per fragment. */}
        {matchedActivities.length > 1
          ? <ConsolidatedStravaCard logs={matchedActivities} dayWorkouts={dayWorkouts} />
          : matchedActivities.map(log => <StravaCard key={log.id} log={log} dayWorkouts={dayWorkouts} />)}
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
          {isCoachViewer && viewMode === 'day' && (
            <button onClick={handleResetDayDebug}
              className="h-10 px-3 rounded-2xl bg-red-50 flex items-center gap-1.5 active:scale-95 transition-all flex-shrink-0"
              title="איפוס נתוני היום (דיבוג)">
              <span className="text-xs font-bold text-red-500">🧹 איפוס יום</span>
            </button>
          )}
          {!overrideAthleteId && athlete?.labVisibleToAthlete && (
            <Link href="/athlete/lab"
              className="h-10 px-3 rounded-2xl bg-[#0a1628]/5 flex items-center gap-1.5 active:scale-95 transition-all flex-shrink-0"
              title={t.labLabel}>
              <FlaskConical className="h-4 w-4 text-[#0a1628]" />
              <span className="text-xs font-bold text-[#0a1628]">{t.labLabel}</span>
            </Link>
          )}
        </div>
      </div>

      {/* ── Day View ──────────────────────────────────────────────────────── */}
      {viewMode === 'day' && (() => {
        const dayWs = getWorkoutsForDay(currentDate)
        const dateStr = format(currentDate, 'yyyy-MM-dd')
        const activitiesToday = weekLogs.filter(l => l.date === dateStr && isActivityLog(l))
        // Each workout only shows the Strava activity/activities actually
        // matched to IT (via assignedWorkoutId) — the morning workout
        // never shows the evening's data and vice versa. Anything left
        // over (not yet matched to any of today's workouts) still shows
        // as a generic list below everything, same as before.
        const matchedActivitiesFor = (w: AssignedWorkout) => activitiesToday.filter(l => l.assignedWorkoutId === w.id)
        const matchedIds = new Set(dayWs.flatMap(w => matchedActivitiesFor(w).map(l => l.id)))
        const unmatchedActivities = activitiesToday.filter(l => !matchedIds.has(l.id))
        const mainW = dayWs[0] || null

        const addActivityButton = (
          <button
            onClick={() => { setAddActivityDate(dateStr); setAddActivityOpen(true) }}
            className="w-full h-12 rounded-2xl border-2 border-dashed border-gray-200 hover:border-[#c9a84c]/50 text-gray-400 hover:text-[#c9a84c] text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] bg-white/50">
            <Plus className="h-4 w-4" />
            {t.addActivityBtn}
          </button>
        )
        const dayOffCard = renderDayOffCard(dateStr)

        // ── Day off (sick/trip/other) — coach-set, read-only here ──
        if (dayOffCard) return (
          <div className="space-y-3">
            {dayOffCard}
            {dayWs.map((w, idx) => renderNavyWorkoutBlock(w, dayWs.length > 1, idx, dateStr, matchedActivitiesFor(w), dayWs))}
            {unmatchedActivities.length > 0 && (
              <div className="space-y-1.5">
                {unmatchedActivities.map(log => <StravaCard key={log.id} log={log} dayWorkouts={dayWs} />)}
              </div>
            )}
          </div>
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
            {dayWs.map((w, idx) => renderNavyWorkoutBlock(w, dayWs.length > 1, idx, dateStr, matchedActivitiesFor(w), dayWs))}
            {unmatchedActivities.length > 0 && (
              <div className="space-y-1.5">
                {unmatchedActivities.map(log => <StravaCard key={log.id} log={log} dayWorkouts={dayWs} />)}
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
                const isOff = !!dayOffFor(format(day, 'yyyy-MM-dd'))
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
                    {isOff ? (
                      <span className="text-[10px] mt-1.5">🩹</span>
                    ) : (
                      <span className={cn('w-1.5 h-1.5 rounded-full mt-1.5',
                        dayWs.length === 0 ? 'opacity-0' :
                        hasCompleted ? 'bg-emerald-500' :
                        hasPending ? (isSelDay ? 'bg-[#c9a84c]' : 'bg-[#c9a84c]/70') : 'bg-gray-200'
                      )} />
                    )}
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
            const matchedActivitiesForDay = (w: AssignedWorkout) => activitiesDay.filter(l => l.assignedWorkoutId === w.id)
            const matchedDayIds = new Set(dayWs.flatMap(w => matchedActivitiesForDay(w).map(l => l.id)))
            const unmatchedActivitiesDay = activitiesDay.filter(l => !matchedDayIds.has(l.id))
            const addActivityButton = (
              <button
                onClick={() => { setAddActivityDate(dayStr); setAddActivityOpen(true) }}
                className="w-full h-12 rounded-2xl border-2 border-dashed border-gray-200 hover:border-[#c9a84c]/50 text-gray-400 hover:text-[#c9a84c] text-sm font-bold flex items-center justify-center gap-2 transition-all active:scale-[0.98] bg-white/50">
                <Plus className="h-4 w-4" />
                {t.addActivityBtn}
              </button>
            )
            const dayOffCard = renderDayOffCard(dayStr)
            if (dayOffCard) return (
              <div className="space-y-3">
                {dayOffCard}
                {dayWs.map((w, i) => renderNavyWorkoutBlock(w, dayWs.length > 1, i, dayStr, matchedActivitiesForDay(w), dayWs))}
                {unmatchedActivitiesDay.length > 0 && (
                  <div className="space-y-1.5">
                    {unmatchedActivitiesDay.map(log => <StravaCard key={log.id} log={log} dayWorkouts={dayWs} />)}
                  </div>
                )}
              </div>
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
                {dayWs.map((w, i) => renderNavyWorkoutBlock(w, dayWs.length > 1, i, dayStr, matchedActivitiesForDay(w), dayWs))}
                {unmatchedActivitiesDay.length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 border-t border-gray-100" />
                      <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">{t.workouts}</span>
                      <div className="flex-1 border-t border-gray-100" />
                    </div>
                    {unmatchedActivitiesDay.map(log => <StravaCard key={log.id} log={log} dayWorkouts={dayWs} />)}
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
                            if (dayWs.length === 1) {
                              const only = dayWs[0]
                              setSelectedWorkoutId(prev => prev === only.id ? null : only.id)
                            } else {
                              // Multiple workouts (or activity-only) — the
                              // month grid can only ever preview one workout
                              // below it, so jump to day view where all of
                              // them render in full.
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
