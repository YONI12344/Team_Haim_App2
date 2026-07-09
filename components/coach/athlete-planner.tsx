'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Plus, X,
  Loader2, MapPin, Clock, Check, Calendar, Search, Copy, Pencil, Trash2, ClipboardPaste,
  BarChart2, Sparkles, Send,
} from 'lucide-react'
import Link from 'next/link'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, addDays, eachDayOfInterval, eachWeekOfInterval, isSameMonth,
  isSameDay, isToday, parseISO,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { db, realtimeDb } from '@/lib/firebase'
import { ref, push } from 'firebase/database'
import {
  collection, doc, getDoc, getDocs, query,
  where, addDoc, serverTimestamp, deleteDoc, updateDoc,
} from 'firebase/firestore'
import type { AthleteProfile, Workout, AssignedWorkout, TrainingDayType, WorkoutLog, WorkoutType, JourneyDoc, JourneyStage } from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import { listJourneys, computeJourneyProgress, saveJourney, stageDisplayName } from '@/lib/journey'
import { useAuth } from '@/contexts/auth-context'
import { useWorkoutTypeLabels, autoWorkoutTitle } from '@/lib/workout-labels'
import { WorkoutBuilder } from '@/components/coach/workout-builder'
import { ActivityDetailView } from '@/components/shared/activity-detail-view'
import { AthletePlannerView } from '@/components/athlete/athlete-planner-view'
import { useLanguage } from '@/contexts/language-context'
import { toast } from 'sonner'

const WEEKDAY_KEYS = [
  'sunday','monday','tuesday','wednesday','thursday','friday','saturday',
] as const

const DAY_BG: Record<string, string> = {
  rest:     'bg-muted/30',
  off:      'bg-muted/10',
  easy:     'bg-emerald-50',
  workout:  'bg-blue-50',
  long_run: 'bg-orange-50',
}

const DAY_DOT: Record<string, string> = {
  rest: 'bg-gray-300', off: 'bg-gray-200',
  easy: 'bg-emerald-400', workout: 'bg-blue-400', long_run: 'bg-orange-400',
}

const DAY_BADGE: Record<string, string> = {
  rest: 'bg-muted text-muted-foreground',
  off:  'bg-muted/50 text-muted-foreground',
  easy: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  workout: 'bg-blue-100 text-blue-700 border-blue-200',
  long_run: 'bg-orange-100 text-orange-700 border-orange-200',
}


interface JourneySummary {
  stageName: string
  weekInStage: number
  totalWeeksInStage: number
  isOffWeek: boolean
  goalRaceDate: string
  goalRaceEvent: string
}

interface Props { athleteId: string }

export function AthletePlanner({ athleteId }: Props) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const workoutTypeLabels = useWorkoutTypeLabels()
  const router = useRouter()

  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  // Full active journey — powers season-aware planning in the month view
  const [activeJourney, setActiveJourney] = useState<JourneyDoc | null>(null)
  // All athletes — for the quick switcher in the header
  const [allAthletes, setAllAthletes] = useState<{ id: string; name: string }[]>([])

  useEffect(() => {
    getDocs(query(collection(db, 'users'), where('role', '==', 'athlete')))
      .then(snap => setAllAthletes(
        snap.docs
          .map(d => ({ id: d.id, name: d.data().name || d.data().email || '—' }))
          .sort((a, b) => a.name.localeCompare(b.name, 'he'))
      ))
      .catch(() => {})
  }, [])
  const [journey, setJourney] = useState<JourneySummary | null>(null)
  const [workoutLibrary, setWorkoutLibrary] = useState<Workout[]>([])
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [loading, setLoading] = useState(true)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [showCreateWorkout, setShowCreateWorkout] = useState(false)
  const [creatingWorkout, setCreatingWorkout] = useState(false)
  const [showBuilderDialog, setShowBuilderDialog] = useState(false)
  const [builderWorkoutId, setBuilderWorkoutId] = useState<string | undefined>(undefined)
  const [editingAssignedId, setEditingAssignedId] = useState<string | null>(null)
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null)
  const [editWO, setEditWO] = useState({ title: '', type: 'easy' as WorkoutType, distance: '', duration: '', description: '', notes: '' })
  const [savingEdit, setSavingEdit] = useState(false)
  const [newWO, setNewWO] = useState({ title: '', type: 'easy' as WorkoutType, distance: '', duration: '', description: '', notes: '' })
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<'week' | 'month'>('month')
  const [selectedAssignedId, setSelectedAssignedId] = useState<string | null>(null)
  const [copiedWorkout, setCopiedWorkout] = useState<AssignedWorkout | null>(null)
  // Copy-week paste mode: source week start while choosing a target week
  const [copiedWeekStart, setCopiedWeekStart] = useState<Date | null>(null)
  const [librarySearch, setLibrarySearch] = useState('')

  // AI coaching report — collapsed by default to keep the screen clean
  const [aiReport, setAiReport] = useState<any>(null)
  const [aiReportLoading, setAiReportLoading] = useState(false)
  const [showAiSection, setShowAiSection] = useState(false)

  // Quick-assign sheet — opens when the coach taps a day on the calendar
  const [quickAssignDate, setQuickAssignDate] = useState<Date | null>(null)
  const [qaType, setQaType] = useState<WorkoutType | null>(null)
  const [qaTitle, setQaTitle] = useState('')
  const [qaDistance, setQaDistance] = useState('')
  const [qaDuration, setQaDuration] = useState('')
  const [qaDesc, setQaDesc] = useState('')
  const [qaSaving, setQaSaving] = useState(false)
  const [qaSearch, setQaSearch] = useState('')
  const [qaShowCreate, setQaShowCreate] = useState(false)

  const resetQuickAssign = () => {
    setQaType(null); setQaTitle(''); setQaDistance(''); setQaDuration(''); setQaDesc(''); setQaSearch(''); setQaShowCreate(false)
  }
  // Coach messages
  const [coachMessageText, setCoachMessageText] = useState('')
  const [sendingCoachMessage, setSendingCoachMessage] = useState(false)
  // Message composer under the embedded "exactly as the athlete sees it" view
  const [dayMessageText, setDayMessageText] = useState('')
  const [sendingDayMessage, setSendingDayMessage] = useState(false)

  // Weekly summary
  const [showWeeklySummary, setShowWeeklySummary] = useState(false)
  const [weeklySummaryLoading, setWeeklySummaryLoading] = useState(false)
  const [weeklySummary, setWeeklySummary] = useState<any>(null)
  const [weeklyCoachNote, setWeeklyCoachNote] = useState('')
  const [savingWeeklySummary, setSavingWeeklySummary] = useState(false)

  // ── Load athlete + journey + workout library ──────────────────────────────
  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const profileSnap = await getDoc(doc(db, 'users', athleteId))
        if (profileSnap.exists()) {
          const d = profileSnap.data()
          setAthlete({
            id: profileSnap.id,
            userId: d.userId || profileSnap.id,
            name: d.name || 'Athlete',
            email: d.email || '',
            photoURL: d.photoURL,
            events: Array.isArray(d.events) ? d.events : [],
            personalRecords: Array.isArray(d.personalRecords) ? d.personalRecords : [],
            seasonBests: Array.isArray(d.seasonBests) ? d.seasonBests : [],
            trainingPaces: Array.isArray(d.trainingPaces) ? d.trainingPaces : [],
            goals: Array.isArray(d.goals) ? d.goals : [],
            weekSchedule: d.weekSchedule,
            weeklyKmRange: d.weeklyKmRange,
            offWeekInterval: d.offWeekInterval,
            targetPaceKm: d.targetPaceKm,
            visibleWeeksAhead: typeof d.visibleWeeksAhead === 'number' ? d.visibleWeeksAhead : 2,
            weekStartDay: d.weekStartDay === 1 ? 1 : 0,
            kmWeekStartDay: d.kmWeekStartDay === 0 ? 0 : 1,
            createdAt: d.createdAt?.toDate?.() || new Date(),
            updatedAt: d.updatedAt?.toDate?.() || new Date(),
          })

          // Journey
          const today = new Date()
          const journeys = await listJourneys(athleteId)
          const active = journeys.find(j =>
            new Date(j.startDate) <= today && new Date(j.goalRaceDate) >= today
          ) || journeys[journeys.length - 1]

          if (active) {
            setActiveJourney(active)
            const progress = computeJourneyProgress(active, today)
            const stage = progress.activeStage
            if (stage) {
              const s = new Date(stage.startDate)
              const e = new Date(stage.endDate)
              const total = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (7 * 86400000)))
              const cur   = Math.max(1, Math.ceil((today.getTime() - s.getTime()) / (7 * 86400000)))
              const offN  = d.offWeekInterval ?? 4
              setJourney({
                stageName: stageDisplayName(stage),
                weekInStage: cur,
                totalWeeksInStage: total,
                isOffWeek: cur % offN === 0,
                goalRaceDate: active.goalRaceDate,
                goalRaceEvent: active.goalRaceEvent,
              })
            }
          }
        }

        const wSnap = await getDocs(collection(db, 'workouts'))
        setWorkoutLibrary(wSnap.docs.filter(d => !d.data().libraryHidden).map(d => ({ ...(d.data() as Workout), id: d.id })))
      } catch (err) {
        console.error('Planner load error:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [athleteId])

  // ── Load assigned workouts for current month ──────────────────────────────
  useEffect(() => {
    const loadMonth = async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'assignedWorkouts'),
          where('athleteId', '==', athleteId),
                  ))
        setAssignedWorkouts(snap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id })))
        const logsSnap = await getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId)))
        setLogs(logsSnap.docs.map(d => {
          const data = d.data()
          return {
            id: d.id,
            athleteId: data.athleteId || athleteId,
            workoutId: data.workoutId || '',
            assignedWorkoutId: data.assignedWorkoutId || '',
            date: data.date || '',
            actualDistance: data.actualDistance ?? undefined,
            actualPace: data.actualPace ?? undefined,
            effort: legacyEffortToNumber(data.effort),
            comment: data.comment || '',
            splitLogs: data.splitLogs || [],
            createdAt: data.createdAt?.toDate?.() || new Date(),
          } as any
        }))
      } catch (err) {
        console.error('Month load error:', err)
      }
    }
    loadMonth()
  }, [athleteId, currentMonth])

  // ── Per-athlete week settings ─────────────────────────────────────────────
  // Calendar week start (0 = Sunday default, 1 = Monday)
  const calWeekStartsOn: 0 | 1 = athlete?.weekStartDay === 1 ? 1 : 0
  // Weekly-km counting start (1 = Monday default, 0 = Sunday)
  const kmWeekStartsOn: 0 | 1 = athlete?.kmWeekStartDay === 0 ? 0 : 1

  // ── Season-aware planning helpers ─────────────────────────────────────────
  /** Visual + coaching meta per journey stage type */
  const STAGE_META: Record<string, { he: string; chip: string; cell: string; guide: (weeksToRace: number | null, pace?: string | null) => string }> = {
    base:      { he: 'בסיס',        chip: 'bg-emerald-100 text-emerald-700 border-emerald-200', cell: 'bg-emerald-50/60',
                 guide: () => 'נפח אירובי — ריצות קלות, ריצה ארוכה בסוף השבוע, חיזוק. בלי איכות קשה.' },
    build:     { he: 'בנייה',       chip: 'bg-blue-100 text-blue-700 border-blue-200', cell: 'bg-blue-50/60',
                 guide: () => 'בנייה — סף/טמפו פעם בשבוע + אינטרוולים ארוכים (1000–1600). נפח גבוה, הארוכה נשארת.' },
    peak:      { he: 'שיא',         chip: 'bg-purple-100 text-purple-700 border-purple-200', cell: 'bg-purple-50/60',
                 guide: (_, pace) => `שיא — איכות בקצב תחרות${pace ? ` (${pace})` : ''}, סימולציות, הנפח מתחיל לרדת.` },
    taper:     { he: 'חידוד',       chip: 'bg-amber-100 text-amber-800 border-amber-300', cell: 'bg-amber-50/70',
                 guide: (w, pace) => `חידוד${w != null && w > 0 ? ` — ${w} שבועות לתחרות` : ''}: קטעים קצרים בקצב תחרות${pace ? ` (${pace})` : ''} ומהר ממנו, נפח יורד 20–40%, התאוששות מלאה בין קטעים.` },
    race_week: { he: 'שבוע תחרות',  chip: 'bg-red-100 text-red-700 border-red-200', cell: 'bg-red-50/70',
                 guide: () => 'שבוע תחרות — קל בלבד + פתיחות (strides) קצרות. שינה טובה, אמון בעבודה שנעשתה.' },
    recovery:  { he: 'התאוששות',    chip: 'bg-teal-100 text-teal-700 border-teal-200', cell: 'bg-teal-50/60',
                 guide: () => 'התאוששות — קל בלבד, נפח נמוך, בלי איכות.' },
    custom:    { he: 'שלב',         chip: 'bg-gray-100 text-gray-600 border-gray-200', cell: 'bg-gray-50',
                 guide: () => '' },
  }

  /** Race-pace hint: athlete's target pace or the journey's goal time */
  const goalPaceHint = athlete?.targetPaceKm || activeJourney?.goalRaceTarget || null

  /**
   * Season info for the week starting at `wkStart`: journey stage, countdown
   * to the goal race, down-week flag (every Nth week of the stage), and the
   * week's target km (stage volume, reduced 30% on down weeks).
   */
  const getWeekSeasonInfo = useCallback((wkStart: Date) => {
    if (!activeJourney?.goalRaceDate) return null
    const mid = addDays(wkStart, 3)
    const race = new Date(activeJourney.goalRaceDate)
    const weeksToRace = Math.ceil((race.getTime() - wkStart.getTime()) / (7 * 86400000))
    const stage: JourneyStage | null = activeJourney.stages?.find(s =>
      new Date(s.startDate) <= mid && new Date(s.endDate) >= mid
    ) || null
    let isDownWeek = false
    if (stage) {
      const offN = athlete?.offWeekInterval ?? 4
      const weekInStage = Math.max(1, Math.ceil((mid.getTime() - new Date(stage.startDate).getTime()) / (7 * 86400000)))
      isDownWeek = offN > 0 && weekInStage % offN === 0
    }
    const baseTarget = stage?.weeklyVolumeKm
      ?? (athlete?.weeklyKmRange ? Math.round((athlete.weeklyKmRange.min + athlete.weeklyKmRange.max) / 2) : null)
    const targetKm = baseTarget != null ? (isDownWeek ? Math.round(baseTarget * 0.7) : baseTarget) : null
    const meta = stage ? (STAGE_META[stage.type] || STAGE_META.custom) : null
    return { stage, meta, weeksToRace, isDownWeek, targetKm }
  }, [activeJourney, athlete])

  // ── Calendar helpers ──────────────────────────────────────────────────────
  const calendarWeeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: calWeekStartsOn })
    const end   = endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: calWeekStartsOn })
    const days  = eachDayOfInterval({ start, end })
    const weeks: Date[][] = []
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
    return weeks
  }, [currentMonth, calWeekStartsOn])

  const getWorkoutsForDay = useCallback((date: Date) => {
    const s = format(date, 'yyyy-MM-dd')
    return assignedWorkouts.filter(w => w.scheduledDate === s)
  }, [assignedWorkouts])

  const getWeekKm = useCallback((week: Date[]) =>
    week.reduce((sum, day) =>
      sum + getWorkoutsForDay(day).reduce((s, w) => s + (w.workout?.distance ?? 0), 0)
    , 0), [getWorkoutsForDay])

  const getDayType = useCallback((date: Date): TrainingDayType => {
    if (!athlete?.weekSchedule) return 'rest'
    return (athlete.weekSchedule[WEEKDAY_KEYS[date.getDay()]] as TrainingDayType) || 'rest'
  }, [athlete])

  // ── This-week km — follows the athlete's km-week start day ───────────────
  const thisWeekKm = useMemo(() => {
    const from = format(startOfWeek(new Date(), { weekStartsOn: kmWeekStartsOn }), 'yyyy-MM-dd')
    const to   = format(endOfWeek(new Date(),   { weekStartsOn: kmWeekStartsOn }), 'yyyy-MM-dd')
    return assignedWorkouts
      .filter(w => w.scheduledDate >= from && w.scheduledDate <= to)
      .reduce((s, w) => s + (w.workout?.distance ?? 0), 0)
  }, [assignedWorkouts, kmWeekStartsOn])

  // ── Assign ────────────────────────────────────────────────────────────────
  const handleCreateWorkout = async () => {
    // Empty title → auto-generate one from the type + distance/duration
    const finalTitle = newWO.title.trim() ||
      autoWorkoutTitle(workoutTypeLabels, newWO.type, { distance: newWO.distance, duration: newWO.duration })
    setCreatingWorkout(true)
    try {
      const ref = await addDoc(collection(db, 'workouts'), {
        title: finalTitle, type: newWO.type,
        description: newWO.description.trim(),
        distance: newWO.distance ? Number(newWO.distance) : null,
        duration: newWO.duration ? Number(newWO.duration) : null,
        notes: newWO.notes.trim() || null,
        createdBy: user?.id || null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      const created: Workout = {
        id: ref.id, title: finalTitle, type: newWO.type,
        description: newWO.description.trim(),
        distance: newWO.distance ? Number(newWO.distance) : undefined,
        duration: newWO.duration ? Number(newWO.duration) : undefined,
        notes: newWO.notes.trim() || undefined,
        createdBy: user?.id || '', createdAt: new Date(), updatedAt: new Date(),
      }
      setWorkoutLibrary(prev => [created, ...prev])
      // Auto-assign to selected date if one is selected
      if (selectedDate && user) {
        const dateStr = format(selectedDate, 'yyyy-MM-dd')
        const assignRef = await addDoc(collection(db, 'assignedWorkouts'), {
          workoutId: ref.id,
          workout: created,
          athleteId,
          assignedBy: user.id || null,
          scheduledDate: dateStr,
          status: 'scheduled',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        setAssignedWorkouts(prev => [...prev, {
          id: assignRef.id,
          workoutId: ref.id,
          workout: created,
          athleteId,
          assignedBy: user.id || '',
          scheduledDate: dateStr,
          status: 'scheduled',
          createdAt: new Date(),
          updatedAt: new Date(),
        } as any])
        toast.success(t.toastAdded)
      } else {
        toast.success(t.toastAdded)
      }
      setNewWO({ title: '', type: 'easy', distance: '', duration: '', description: '', notes: '' })
      setShowCreateWorkout(false)
    } catch { toast.error(t.tryAgainLaterText) }
    finally { setCreatingWorkout(false) }
  }

  const handleSaveEdit = async () => {
    if (!editingWorkout || !editWO.title.trim()) return
    setSavingEdit(true)
    try {
      const { updateDoc, doc } = await import('firebase/firestore')
      const updated = {
        title: editWO.title.trim(),
        type: editWO.type,
        description: editWO.description.trim(),
        distance: editWO.distance ? Number(editWO.distance) : null,
        duration: editWO.duration ? Number(editWO.duration) : null,
        notes: editWO.notes.trim() || null,
      }
      await updateDoc(doc(db, 'workouts', editingWorkout.id), { ...updated, updatedAt: serverTimestamp() })
      // Update in assigned workouts list
      setAssignedWorkouts(prev => prev.map(w =>
        w.workoutId === editingWorkout.id ? { ...w, workout: { ...w.workout, ...updated } as Workout } : w
      ))
      setWorkoutLibrary(prev => prev.map(w =>
        w.id === editingWorkout.id ? ({ ...w, ...updated } as Workout) : w
      ))
      setEditingWorkout(null)
      toast.success(t.toastUpdated)
    } catch { toast.error(t.tryAgainLaterText) }
    finally { setSavingEdit(false) }
  }

  const handleAssign = async () => {
    if (!selectedWorkout || !selectedDate || !user) return
    setAssigning(true)
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd')
      const ref = await addDoc(collection(db, 'assignedWorkouts'), {
        workoutId: selectedWorkout.id,
        workout: selectedWorkout,
        athleteId,
        assignedBy: user.id || null,
        scheduledDate: dateStr,
        status: 'scheduled',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setAssignedWorkouts(prev => [...prev, {
        id: ref.id,
        workoutId: selectedWorkout.id,
        workout: selectedWorkout,
        athleteId,
        assignedBy: user.id || '',
        scheduledDate: dateStr,
        status: 'scheduled',
        createdAt: new Date(),
        updatedAt: new Date(),
      }])
      setSelectedWorkout(null)
      toast.success(`✓ ${selectedWorkout.title} assigned`)
    } catch (err) {
      toast.error('Failed to assign workout')
    } finally {
      setAssigning(false)
    }
  }

  const handleRemove = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'assignedWorkouts', id))
      setAssignedWorkouts(prev => prev.filter(w => w.id !== id))
      toast.success('Workout removed')
    } catch {
      toast.error('Failed to remove')
    }
  }

  /** Assign an existing library workout to a specific date (used by the quick-assign sheet) */
  const assignWorkoutToDate = async (workout: Workout, dateStr: string) => {
    if (!user) return
    const ref = await addDoc(collection(db, 'assignedWorkouts'), {
      workoutId: workout.id,
      workout,
      athleteId,
      assignedBy: user.id || null,
      scheduledDate: dateStr,
      status: 'scheduled',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    setAssignedWorkouts(prev => [...prev, {
      id: ref.id, workoutId: workout.id, workout, athleteId,
      assignedBy: user.id || '', scheduledDate: dateStr, status: 'scheduled',
      createdAt: new Date(), updatedAt: new Date(),
    } as AssignedWorkout])
  }

  /** Remove a workout from the library (assigned copies keep working) */
  const handleDeleteLibraryWorkout = async (w: Workout) => {
    if (!confirm(`למחוק את "${w.title}" מהספרייה? אימונים שכבר שובצו לא יושפעו.`)) return
    try {
      await deleteDoc(doc(db, 'workouts', w.id))
      setWorkoutLibrary(prev => prev.filter(x => x.id !== w.id))
      toast.success(t.workoutDeleted)
    } catch { toast.error(t.errorDeleting) }
  }

  /** One-tap create+assign from the quick-assign sheet: type + numbers → done */
  const handleQuickCreateAssign = async () => {
    if (!qaType || !quickAssignDate || !user) return
    setQaSaving(true)
    try {
      const finalTitle = qaTitle.trim() ||
        autoWorkoutTitle(workoutTypeLabels, qaType, { distance: qaDistance, duration: qaDuration })
      const workoutData = {
        title: finalTitle, type: qaType,
        description: qaDesc.trim(),
        distance: qaDistance ? Number(qaDistance) : null,
        duration: qaDuration ? Number(qaDuration) : null,
        notes: null,
        createdBy: user.id || null,
      }
      const ref = await addDoc(collection(db, 'workouts'), {
        ...workoutData, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      const created: Workout = {
        ...workoutData, id: ref.id,
        description: workoutData.description,
        distance: workoutData.distance ?? undefined,
        duration: workoutData.duration ?? undefined,
        notes: undefined,
        createdBy: user.id || '', createdAt: new Date(), updatedAt: new Date(),
      }
      setWorkoutLibrary(prev => [created, ...prev])
      await assignWorkoutToDate(created, format(quickAssignDate, 'yyyy-MM-dd'))
      toast.success(`✓ ${finalTitle} — ${format(quickAssignDate, 'd/M')}`)
      resetQuickAssign()
      setQuickAssignDate(null)
    } catch {
      toast.error(t.tryAgainLaterText)
    } finally {
      setQaSaving(false)
    }
  }

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  const weekStart = startOfWeek(currentDate, { weekStartsOn: calWeekStartsOn })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: calWeekStartsOn })
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [currentDate, calWeekStartsOn])
  const monthWeeks2 = useMemo(() => {
    const ms = startOfMonth(currentDate), me = endOfMonth(currentDate)
    return eachWeekOfInterval({ start: ms, end: me }, { weekStartsOn: calWeekStartsOn })
  }, [currentDate, calWeekStartsOn])

  const DAY_LABELS_BASE = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
  // Rotate labels so the header matches the athlete's week start day
  const DAY_LABELS = [...DAY_LABELS_BASE.slice(calWeekStartsOn), ...DAY_LABELS_BASE.slice(0, calWeekStartsOn)]
  const TYPE_COLORS: Record<string, string> = {
    easy: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    long_run: 'bg-orange-100 text-orange-700 border-orange-200',
    tempo: 'bg-purple-100 text-purple-700 border-purple-200',
    intervals: 'bg-blue-100 text-blue-700 border-blue-200',
    hill_repeats: 'bg-amber-100 text-amber-700 border-amber-200',
    fartlek: 'bg-cyan-100 text-cyan-700 border-cyan-200',
    recovery: 'bg-gray-100 text-gray-600 border-gray-200',
    rest: 'bg-muted text-muted-foreground',
    race: 'bg-red-100 text-red-700 border-red-200',
    strength: 'bg-violet-100 text-violet-700 border-violet-200',
    cross_training: 'bg-teal-100 text-teal-700 border-teal-200',
    swim: 'bg-sky-100 text-sky-700 border-sky-200',
    bike: 'bg-indigo-100 text-indigo-700 border-indigo-200',
    time_trial: 'bg-rose-100 text-rose-700 border-rose-200',
  }

  // Quick-assign sheet: type picker order + emoji
  const QUICK_TYPES: WorkoutType[] = [
    'easy', 'intervals', 'tempo', 'long_run', 'hill_repeats', 'fartlek',
    'recovery', 'strength', 'swim', 'bike', 'race', 'time_trial',
  ]
  const TYPE_EMOJI: Record<string, string> = {
    easy: '🏃', intervals: '🔁', tempo: '⚡', long_run: '🛣️', hill_repeats: '⛰️',
    fartlek: '🎲', recovery: '🌿', strength: '🏋️', cross_training: '🔀',
    swim: '🏊', bike: '🚴', race: '🏁', time_trial: '⏱️', rest: '😴',
  }

  const getWorkoutsForDate2 = useCallback((dateStr: string) =>
    assignedWorkouts.filter(w => w.scheduledDate === dateStr)
  , [assignedWorkouts])

  const getWeekKm2 = useCallback((days: Date[]) =>
    days.reduce((s, d) => s + getWorkoutsForDate2(format(d,'yyyy-MM-dd')).reduce((a,w) => a+(w.workout?.distance??0),0),0)
  , [getWorkoutsForDate2])

  /**
   * Clone a workout into a new independent doc so the copy can be edited
   * (reps, distances...) without touching the original week or the library.
   * `libraryHidden` keeps these clones out of the workout library lists.
   */
  const cloneWorkoutDoc = async (src: Workout): Promise<Workout> => {
    const data: any = {
      title: src.title || 'אימון',
      type: src.type || 'easy',
      description: src.description || '',
      duration: src.duration ?? null,
      distance: src.distance ?? null,
      warmup: (src as any).warmup || null,
      cooldown: (src as any).cooldown || null,
      notes: src.notes || null,
      sets: (src.sets || []).map((s: any) => ({
        ...s,
        intervals: (s.intervals || []).map((iv: any) => ({ ...iv })),
      })),
      libraryHidden: true,
      createdBy: user?.id || null,
    }
    const ref = await addDoc(collection(db, 'workouts'), {
      ...data, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    })
    return { ...data, id: ref.id, createdAt: new Date(), updatedAt: new Date() } as Workout
  }

  /**
   * Copy all workouts from the week starting at `sourceStart` into the week
   * starting at `targetStart` (same weekdays). Every pasted workout is an
   * independent clone, so reps/distances can be edited per week.
   */
  const copyWeekTo = async (sourceStart: Date, targetStart: Date) => {
    const sourceEnd = endOfWeek(sourceStart, { weekStartsOn: calWeekStartsOn })
    const from = format(sourceStart, 'yyyy-MM-dd')
    const to = format(sourceEnd, 'yyyy-MM-dd')
    const weekWorkouts = assignedWorkouts.filter(w => w.scheduledDate >= from && w.scheduledDate <= to)
    if (weekWorkouts.length === 0) { toast.error(t.noWorkoutsYet); return }

    // Warn if the target week already has workouts (avoid double-pasting)
    const tFrom = format(targetStart, 'yyyy-MM-dd')
    const tTo = format(endOfWeek(targetStart, { weekStartsOn: calWeekStartsOn }), 'yyyy-MM-dd')
    const existingTarget = assignedWorkouts.filter(w => w.scheduledDate >= tFrom && w.scheduledDate <= tTo)
    if (existingTarget.length > 0 &&
        !confirm(`בשבוע היעד כבר יש ${existingTarget.length} אימונים. להעתיק בכל זאת?`)) return

    try {
      await Promise.all(weekWorkouts.map(async w => {
        const dayOfWeek = new Date(w.scheduledDate).getDay()
        const targetDay = new Date(targetStart)
        targetDay.setDate(targetStart.getDate() + ((dayOfWeek - targetStart.getDay() + 7) % 7))
        // Independent clone — coach can tweak the new week's reps freely
        const cloned = await cloneWorkoutDoc(w.workout)
        return addDoc(collection(db, 'assignedWorkouts'), {
          workoutId: cloned.id, workout: cloned,
          athleteId, assignedBy: user?.id || null,
          scheduledDate: format(targetDay, 'yyyy-MM-dd'),
          status: 'scheduled', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
      }))
      toast.success(`✓ ${weekWorkouts.length} אימונים הודבקו לשבוע ${format(targetStart, 'd/M')} — אפשר לערוך כל אחד בנפרד`)
      const snap = await getDocs(query(collection(db,'assignedWorkouts'),where('athleteId','==',athleteId)))
      setAssignedWorkouts(snap.docs.map(d => ({...(d.data() as AssignedWorkout), id: d.id})))
      setCopiedWeekStart(null)
      setCurrentDate(targetStart) // jump to the pasted week
    } catch { toast.error(t.tryAgainLaterText) }
  }

  const handleDeleteWorkout = async (aw: AssignedWorkout) => {
    try {
      await deleteDoc(doc(db, 'assignedWorkouts', aw.id))
      setAssignedWorkouts(prev => prev.filter(w => w.id !== aw.id))
      if (selectedAssignedId === aw.id) setSelectedAssignedId(null)
      toast.success(t.workoutDeleted)
    } catch { toast.error(t.errorDeleting) }
  }

  const handlePasteWorkout = async (dateStr: string) => {
    if (!copiedWorkout) return
    try {
      // Paste an independent clone so it can be edited without side effects
      const cloned = await cloneWorkoutDoc(copiedWorkout.workout)
      const ref = await addDoc(collection(db, 'assignedWorkouts'), {
        workoutId: cloned.id, workout: cloned,
        athleteId, assignedBy: user?.id || null,
        scheduledDate: dateStr, status: 'scheduled',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      setAssignedWorkouts(prev => [...prev, { ...copiedWorkout, workoutId: cloned.id, workout: cloned, id: ref.id, scheduledDate: dateStr, status: 'scheduled' } as any])
      toast.success(t.toastAdded)
      setCopiedWorkout(null)
    } catch { toast.error(t.tryAgainLaterText) }
  }

  const selectedAW = useMemo(() => assignedWorkouts.find(w => w.id === selectedAssignedId) || null, [assignedWorkouts, selectedAssignedId])
  const selectedLog = useMemo(() => selectedAW ? (logs.find(l => l.assignedWorkoutId === selectedAW.id) || logs.find(l => l.workoutId === selectedAW.workoutId && l.date === selectedAW.scheduledDate) || logs.find((l: any) => l.date === selectedAW.scheduledDate && (l.source === 'strava' || l.source === 'manual'))) : null, [selectedAW, logs])
  const filteredLibrary = useMemo(() => workoutLibrary.filter(w => w.title?.toLowerCase().includes(librarySearch.toLowerCase())), [workoutLibrary, librarySearch])

  // Last-14-days analysis (computed from loaded state, no API call)
  const analysisData = useMemo(() => {
    const cutoff = format(addDays(new Date(), -14), 'yyyy-MM-dd')
    const recent = [...assignedWorkouts]
      .filter(w => w.scheduledDate >= cutoff)
      .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
    const totalPlanned = recent.reduce((s, w) => s + (w.workout?.distance || 0), 0)
    const completed = recent.filter(w => w.status === 'completed')
    const totalDone = completed.reduce((s, w) => s + (w.workout?.distance || 0), 0)
    const recentLogs = recent.flatMap(w =>
      logs.filter(l => l.assignedWorkoutId === w.id || (l.workoutId === w.workoutId && l.date === w.scheduledDate))
    )
    const avgEffort = recentLogs.length > 0
      ? (recentLogs.reduce((s, l) => s + (l.effort || 0), 0) / recentLogs.length).toFixed(1)
      : null
    return { recent, totalPlanned: totalPlanned.toFixed(1), totalDone: totalDone.toFixed(1), avgEffort }
  }, [assignedWorkouts, logs])

  const handleGenerateReport = async () => {
    if (!athlete) return
    setAiReportLoading(true)
    setAiReport(null)
    try {
      const cutoff = format(addDays(new Date(), -21), 'yyyy-MM-dd')
      const todayStr = format(new Date(), 'yyyy-MM-dd')

      const sortedWorkouts = assignedWorkouts
        .filter(w => w.scheduledDate >= cutoff && w.scheduledDate <= todayStr)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))

      const last3WeeksWorkouts = sortedWorkouts.map(w => {
        const log = logs.find(l => l.assignedWorkoutId === w.id || (l.workoutId === w.workoutId && l.date === w.scheduledDate))
        return {
          date: w.scheduledDate,
          title: w.workout?.title || 'אימון',
          type: w.workout?.type || 'easy',
          plannedKm: w.workout?.distance || 0,
          status: w.status,
          actualKm: (log as any)?.actualDistance ?? null,
          effort: log?.effort ?? null,
          athleteComment: log?.comment || null,
          wasSkipped: w.status === 'skipped',
        }
      })

      const buildWeekSummary = (weekOffset: number) => {
        const wStart = format(addDays(new Date(), -7 * (weekOffset + 1)), 'yyyy-MM-dd')
        const wEnd = format(addDays(new Date(), -7 * weekOffset), 'yyyy-MM-dd')
        const wws = last3WeeksWorkouts.filter(w => w.date >= wStart && w.date <= wEnd)
        const comp = wws.filter(w => w.status === 'completed')
        const skip = wws.filter(w => w.status === 'skipped')
        const efforts = comp.filter(w => w.effort != null).map(w => w.effort as number)
        return {
          totalPlanned: wws.reduce((s, w) => s + (w.plannedKm || 0), 0).toFixed(1),
          totalActual: comp.reduce((s, w) => s + (w.actualKm || w.plannedKm || 0), 0).toFixed(1),
          completed: comp.length,
          skipped: skip.length,
          avgEffort: efforts.length > 0 ? (efforts.reduce((a, b) => a + b, 0) / efforts.length).toFixed(1) : null,
        }
      }

      const weeksToRace = journey?.goalRaceDate
        ? Math.ceil((new Date(journey.goalRaceDate).getTime() - new Date().getTime()) / (7 * 86400000))
        : null

      const res = await fetch('/api/coaching-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athleteName: athlete.name,
          athleteId,
          goalRace: journey?.goalRaceEvent || athlete.goals?.find((g: any) => g.status === 'active')?.title || null,
          goalRaceDate: journey?.goalRaceDate || null,
          weeksToRace,
          weeklyKmTarget: athlete.weeklyKmRange ? `${athlete.weeklyKmRange.min}-${athlete.weeklyKmRange.max}` : null,
          personalRecords: athlete.personalRecords || [],
          last3WeeksWorkouts,
          week1Summary: buildWeekSummary(2),
          week2Summary: buildWeekSummary(1),
          week3Summary: buildWeekSummary(0),
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setAiReport(data.report)
    } catch (err) {
      toast.error(t.tryAgainLaterText)
    } finally {
      setAiReportLoading(false)
    }
  }

  /** Shared send — used by both the workout-detail composer and the
   *  embedded athlete-view composer below the calendar. */
  const sendCoachMessage = async (text: string, workout?: AssignedWorkout | null) => {
    if (!user) return
    await addDoc(collection(db, 'coachMessages'), {
      athleteId,
      coachId: user.id,
      assignedWorkoutId: workout?.id || null,
      workoutTitle: workout?.workout?.title || null,
      message: text.trim(),
      createdAt: serverTimestamp(),
      read: false,
    })
    // Mirror to RTDB chat thread with full workout payload when tied to one
    const chatId = `${user.id}_${athleteId}`
    await push(ref(realtimeDb, `conversations/${chatId}/messages`), {
      senderId: user.id,
      senderName: user.name || t.theCoachFallback,
      content: text.trim(),
      type: 'coach_message',
      payload: workout ? {
        assignedWorkoutId: workout.id,
        workoutTitle: workout.workout?.title || '',
        workoutType: workout.workout?.type || '',
        description: workout.workout?.description || '',
        distance: workout.workout?.distance ?? null,
        duration: workout.workout?.duration ?? null,
        sets: workout.workout?.sets ?? [],
        warmup: workout.workout?.warmup || '',
        cooldown: workout.workout?.cooldown || '',
        notes: workout.workout?.notes || '',
        scheduledDate: workout.scheduledDate,
        status: workout.status,
      } : null,
      timestamp: Date.now(),
    })
  }

  const handleSendCoachMessage = async () => {
    if (!selectedAW || !coachMessageText.trim()) return
    setSendingCoachMessage(true)
    try {
      await sendCoachMessage(coachMessageText, selectedAW)
      setCoachMessageText('')
      toast.success(t.toastUpdated)
    } catch {
      toast.error(t.tryAgainLaterText)
    } finally {
      setSendingCoachMessage(false)
    }
  }

  const handleSendDayMessage = async () => {
    if (!selectedDate || !dayMessageText.trim()) return
    setSendingDayMessage(true)
    try {
      const dateStr = format(selectedDate, 'yyyy-MM-dd')
      const dayWorkout = assignedWorkouts.find(w => w.scheduledDate === dateStr) || null
      await sendCoachMessage(dayMessageText, dayWorkout)
      setDayMessageText('')
      toast.success(t.toastUpdated)
    } catch {
      toast.error(t.tryAgainLaterText)
    } finally {
      setSendingDayMessage(false)
    }
  }

  const handleWeeklySummary = async () => {
    if (!athlete) return
    setWeeklySummaryLoading(true)
    setWeeklySummary(null)
    try {
      const weekStart = format(startOfWeek(new Date(), { weekStartsOn: kmWeekStartsOn }), 'yyyy-MM-dd')
      const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: kmWeekStartsOn }), 'yyyy-MM-dd')
      const weekWorkouts = assignedWorkouts.filter(w => w.scheduledDate >= weekStart && w.scheduledDate <= weekEnd)

      const enrichedWorkouts = weekWorkouts.map(w => {
        const log = logs.find(l => l.assignedWorkoutId === w.id)
        return {
          scheduledDate: w.scheduledDate,
          status: w.status,
          title: w.workout?.title || 'אימון',
          distance: w.workout?.distance || 0,
          actualDistance: log?.actualDistance ?? null,
          effort: log?.effort ?? null,
          comment: log?.comment || null,
        }
      })

      const nextWeekWorkouts = assignedWorkouts
        .filter(w => w.scheduledDate > weekEnd && w.scheduledDate <= format(addDays(new Date(weekEnd), 7), 'yyyy-MM-dd'))
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
        .map(w => ({ scheduledDate: w.scheduledDate, title: w.workout?.title || 'אימון', distance: w.workout?.distance || 0 }))

      const res = await fetch('/api/weekly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athleteName: athlete.name,
          athleteId,
          weekStartDate: weekStart,
          weekEndDate: weekEnd,
          weekWorkouts: enrichedWorkouts,
          nextWeekWorkouts,
          coachNotes: weeklyCoachNote,
        }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setWeeklySummary(data.summary)
      setWeeklyCoachNote(data.summary?.coachNote || '')
      setShowWeeklySummary(true)
    } catch (err) {
      toast.error('שגיאה בסיכום: ' + String(err))
    } finally {
      setWeeklySummaryLoading(false)
    }
  }

  const handleApproveWeeklySummary = async () => {
    if (!weeklySummary) return
    setSavingWeeklySummary(true)
    try {
      const weekStart = format(startOfWeek(new Date(), { weekStartsOn: kmWeekStartsOn }), 'yyyy-MM-dd')
      const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: kmWeekStartsOn }), 'yyyy-MM-dd')
      await addDoc(collection(db, 'weeklyNotes'), {
        athleteId, weekStart, weekEnd,
        summary: weeklySummary.weekSummary,
        achievements: weeklySummary.achievements,
        improvements: weeklySummary.improvements,
        nextWeekFocus: weeklySummary.nextWeekFocus,
        coachNote: weeklyCoachNote,
        approved: true,
        createdAt: serverTimestamp(),
      })
      toast.success(t.toastUpdated)
      setShowWeeklySummary(false)
      setWeeklySummary(null)
    } catch (err) {
      toast.error(t.tryAgainLaterText)
    } finally {
      setSavingWeeklySummary(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )

  if (!athlete) return (
    <div className="p-6">
      <Link href="/coach/athletes">
        <Button variant="ghost"><ArrowLeft className="h-4 w-4 mr-2" />Back</Button>
      </Link>
      <p className="mt-4 text-muted-foreground">Athlete not found.</p>
    </div>
  )

  const selectedDayWorkouts = selectedDate ? getWorkoutsForDay(selectedDate) : []
  const selectedDayType     = selectedDate ? getDayType(selectedDate) : 'rest'




  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Main content */}
      <div className="flex-1 min-w-0 space-y-4">

        {/* Athlete header */}
        <div className="flex items-center gap-3 flex-wrap">
          <Link href={`/coach/athletes/${athleteId}`}>
            <Button variant="ghost" size="sm" className="text-muted-foreground">
              <ArrowLeft className="h-4 w-4 mr-1"/>{t.backBtn}
            </Button>
          </Link>
          <Avatar className="h-10 w-10">
            <AvatarImage src={athlete?.photoURL}/>
            <AvatarFallback className="bg-navy text-white">{athlete?.name?.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <Link href={`/coach/athletes/${athleteId}`} title="לפרופיל הספורטאי — שיאים, זמנים ופרטים">
                <h1 className="font-bold text-navy text-xl hover:text-gold transition-colors cursor-pointer underline-offset-4 hover:underline">{athlete?.name}</h1>
              </Link>
              {/* Quick athlete switcher — jump straight to another athlete's planner */}
              {allAthletes.length > 1 && (
                <select
                  value={athleteId}
                  onChange={e => { if (e.target.value !== athleteId) router.push(`/coach/athletes/${e.target.value}/planner`) }}
                  className="h-7 text-xs rounded-lg border border-border bg-white px-1.5 text-navy font-semibold cursor-pointer hover:border-gold/50 transition-colors"
                  title="מעבר מהיר לספורטאי אחר"
                >
                  {allAthletes.map(a => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {journey && <Badge className="bg-navy/10 text-navy border-navy/20 text-xs">{journey.stageName} · שבוע {journey.weekInStage}/{journey.totalWeeksInStage}</Badge>}
              {journey && <Badge variant="outline" className={cn('text-xs', journey.isOffWeek ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200')}>{journey.isOffWeek ? t.offWeekLabel : t.trainingWeekLabel}</Badge>}
              {athlete?.weeklyKmRange && <span className="text-xs text-muted-foreground">{athlete.weeklyKmRange.min}–{athlete.weeklyKmRange.max} {t.km}</span>}
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs border-gold/40 text-gold hover:bg-gold/10 ml-auto flex-shrink-0"
            onClick={handleWeeklySummary} disabled={weeklySummaryLoading}>
            {weeklySummaryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1"/> : <BarChart2 className="h-3.5 w-3.5 mr-1"/>}
            סיכום שבועי 📊
          </Button>
        </div>

        {/* Season panel — goal race countdown + stage guidance for planning */}
        {activeJourney?.goalRaceDate && (() => {
          const todayInfo = getWeekSeasonInfo(weekStart)
          const race = new Date(activeJourney.goalRaceDate)
          const weeksOut = Math.max(0, Math.ceil((race.getTime() - Date.now()) / (7 * 86400000)))
          return (
            <div className="rounded-2xl border border-navy/15 bg-gradient-to-l from-navy/[0.04] to-transparent px-4 py-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-black text-navy">🎯 {activeJourney.goalRaceEvent || 'תחרות מטרה'}</span>
                <span className="text-xs text-muted-foreground">{format(race, 'd/M/yyyy')}</span>
                <span className="text-xs font-bold bg-navy text-white px-2.5 py-0.5 rounded-full">
                  עוד {weeksOut} שבועות
                </span>
                {todayInfo?.meta && (
                  <span className={cn('text-xs font-bold px-2.5 py-0.5 rounded-full border', todayInfo.meta.chip)}>
                    {todayInfo.stage ? stageDisplayName(todayInfo.stage) : todayInfo.meta.he}
                  </span>
                )}
                {todayInfo?.isDownWeek && (
                  <span className="text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 px-2.5 py-0.5 rounded-full">
                    ⬇ שבוע ירידה
                  </span>
                )}
                {goalPaceHint && (
                  <span className="text-xs font-semibold text-navy" dir="ltr">🏁 {goalPaceHint}</span>
                )}
              </div>
              {todayInfo?.meta && todayInfo.meta.guide(todayInfo.weeksToRace, goalPaceHint) && (
                <p className="text-xs text-navy/80 leading-relaxed">
                  {todayInfo.meta.guide(todayInfo.weeksToRace, goalPaceHint)}
                </p>
              )}
            </div>
          )
        })()}

        {/* Copy-week banner — choose a target week */}
        {copiedWeekStart && (
          <div className="rounded-xl border-2 border-emerald-500 bg-emerald-50 px-4 py-2 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Copy className="h-4 w-4 text-emerald-600"/>
              <p className="text-sm font-medium text-navy">
                שבוע <span className="font-bold text-emerald-700">{format(copiedWeekStart, 'd/M')}</span> הועתק — בחר שבוע להדבקה
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                onClick={() => copyWeekTo(copiedWeekStart, addWeeks(copiedWeekStart, 1))}>
                לשבוע הבא
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setCopiedWeekStart(null)}><X className="h-3.5 w-3.5"/></Button>
            </div>
          </div>
        )}

        {/* Copy banner */}
        {copiedWorkout && (
          <div className="rounded-xl border-2 border-gold bg-gold/5 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardPaste className="h-4 w-4 text-gold"/>
              <p className="text-sm font-medium text-navy">מועתק: <span className="text-gold font-bold">{copiedWorkout.workout?.title}</span> — לחץ על יום לשיבוץ</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCopiedWorkout(null)}><X className="h-3.5 w-3.5"/></Button>
          </div>
        )}

        {/* Calendar */}
        <Card>
          <CardContent className="pt-4">
            {/* Nav + Toggle */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='week' ? subWeeks(d,1) : subMonths(d,1))}><ChevronRight className="h-4 w-4"/></Button>
              <div className="flex flex-col items-center gap-1">
                <p className="font-semibold text-navy text-base">
                  {viewMode==='week' ? `${format(weekStart,'d MMM')} – ${format(weekEnd,'d MMM yyyy')}` : format(currentDate,'MMMM yyyy')}
                </p>
                <div className="flex gap-1 bg-muted rounded-full p-0.5">
                  <button onClick={() => setViewMode('week')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='week' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>שבוע</button>
                  <button onClick={() => setViewMode('month')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='month' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>חודש</button>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='week' ? addWeeks(d,1) : addMonths(d,1))}><ChevronLeft className="h-4 w-4"/></Button>
              {viewMode === 'week' && !copiedWeekStart && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCopiedWeekStart(weekStart)}>
                  <Copy className="h-3 w-3 mr-1"/>העתק שבוע
                </Button>
              )}
              {viewMode === 'week' && copiedWeekStart && !isSameDay(weekStart, copiedWeekStart) && (
                <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => copyWeekTo(copiedWeekStart, weekStart)}>
                  <ClipboardPaste className="h-3 w-3 mr-1"/>הדבק לשבוע זה
                </Button>
              )}
            </div>

            {/* Week View */}
            {viewMode === 'week' && (
              <div className="overflow-x-auto -mx-2 px-2">
                <div style={{minWidth:'560px'}}>
                  <div className="grid grid-cols-8 gap-2 mb-2">
                    {DAY_LABELS.map((d,i) => <div key={i} className="text-center text-xs font-semibold text-muted-foreground py-1">{d}</div>)}
                    <div className="text-center text-xs font-semibold text-muted-foreground py-1">KM</div>
                  </div>
                  <div className="grid grid-cols-8 gap-2">
                    {weekDays.map((day, di) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      const dayWorkouts = getWorkoutsForDate2(dateStr)
                      const todayFlag = isToday(day)
                      return (
                        <div key={di}
                          onClick={() => {
                            if (copiedWorkout) handlePasteWorkout(dateStr)
                            else { setSelectedDate(day); resetQuickAssign(); setQuickAssignDate(day) }
                          }}
                          className={cn('min-h-[130px] rounded-xl border transition-all cursor-pointer',
                            todayFlag ? 'border-gold bg-gold/5' : 'border-border hover:border-gold/40',
                            selectedDate && isSameDay(day, selectedDate) && selectedWorkout ? 'ring-2 ring-gold border-gold bg-gold/5' : '',
                            copiedWorkout ? 'hover:border-gold hover:bg-gold/5' : ''
                          )}>
                          <div className="p-1.5 border-b border-border/40 text-center">
                            <p className={cn('text-xs font-bold', todayFlag ? 'text-gold' : 'text-navy/70')}>{format(day,'d')}</p>
                          </div>
                          <div className="p-1.5 space-y-1">
                            {dayWorkouts.map(w => {
                              const matchLog = logs.find((l: any) => l.assignedWorkoutId === w.id || (l.workoutId === w.workoutId && l.date === dateStr))
                              const isCompleted = w.status === 'completed' || !!matchLog?.actualDistance
                              return (
                                <button key={w.id}
                                  onClick={e => { e.stopPropagation(); setSelectedAssignedId(prev => prev === w.id ? null : w.id); setSelectedDate(day) }}
                                  className={cn('w-full text-left text-[10px] rounded-lg px-1.5 py-1.5 border transition-all hover:opacity-80',
                                    TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                    isCompleted ? 'opacity-70' : '',
                                    selectedAssignedId === w.id ? 'ring-2 ring-navy' : ''
                                  )}>
                                  <p className="font-semibold truncate">{w.workout?.title}</p>
                                  {w.workout?.distance && <p className="opacity-70">{w.workout.distance}k</p>}
                                  {matchLog?.actualDistance && (
                                    <p className="text-emerald-700 font-bold text-[9px]">{matchLog.actualDistance}k בוצע</p>
                                  )}
                                  {isCompleted && !matchLog?.actualDistance && <p className="text-emerald-600 text-[9px]">הושלם</p>}
                                </button>
                              )
                            })}
                            {copiedWorkout && dayWorkouts.length === 0 && (
                              <div className="h-8 rounded border-2 border-dashed border-gold/40 flex items-center justify-center">
                                <Plus className="h-3 w-3 text-gold/50"/>
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                    <div className="flex flex-col items-center justify-center rounded-xl bg-muted/30 border border-border/30 min-h-[130px]">
                      <p className="text-lg font-bold text-navy">{getWeekKm2(weekDays)}</p>
                      <p className="text-[10px] text-muted-foreground">ק"מ</p>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Month View */}
            {viewMode === 'month' && (
              <div className="overflow-x-auto -mx-2 px-2">
                <div style={{minWidth:'480px'}}>
                  <div className="grid grid-cols-8 gap-1 mb-1">
                    {DAY_LABELS.map((d,i) => <div key={i} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>)}
                    <div className="text-center text-[10px] font-semibold text-muted-foreground py-1">KM</div>
                  </div>
                  <div className="space-y-1">
                    {monthWeeks2.map((weekStartDay, wi) => {
                      const days = eachDayOfInterval({ start: weekStartDay, end: endOfWeek(weekStartDay,{weekStartsOn:calWeekStartsOn}) })
                      const wKm = getWeekKm2(days)
                      return (
                        <div key={wi} className="grid grid-cols-8 gap-1">
                          {days.map((day, di) => {
                            const inMonth = isSameMonth(day, currentDate)
                            const dateStr = format(day, 'yyyy-MM-dd')
                            const dayWorkouts = getWorkoutsForDate2(dateStr)
                            const todayFlag = isToday(day)
                            return (
                              <div key={di}
                                onClick={() => {
                                  if (copiedWorkout && inMonth) handlePasteWorkout(dateStr)
                                  else if (inMonth) { setSelectedDate(day); resetQuickAssign(); setQuickAssignDate(day) }
                                }}
                                className={cn('min-h-[80px] rounded-lg p-1 border transition-all',
                                  !inMonth ? 'opacity-20 border-transparent' : 'border-border',
                                  todayFlag ? 'border-gold/60 bg-gold/5' : '',
                                  copiedWorkout && inMonth ? 'cursor-pointer hover:border-gold' : ''
                                )}>
                                <p className={cn('text-[10px] font-semibold mb-1', todayFlag ? 'text-gold' : 'text-navy')}>{format(day,'d')}</p>
                                <div className="space-y-0.5">
                                  {dayWorkouts.slice(0,3).map(w => {
                                    const mLog = logs.find((l: any) => l.assignedWorkoutId === w.id || (l.workoutId === w.workoutId && l.date === dateStr))
                                    const isDone = w.status === 'completed' || !!mLog?.actualDistance
                                    return (
                                      <button key={w.id}
                                        onClick={e => { e.stopPropagation(); setSelectedAssignedId(prev => prev === w.id ? null : w.id); if (inMonth) setSelectedDate(day) }}
                                        className={cn('w-full text-left text-[8px] rounded px-0.5 py-0.5 border truncate hover:opacity-75',
                                          TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                          isDone ? 'opacity-60' : '',
                                          selectedAssignedId === w.id ? 'ring-1 ring-navy font-bold' : ''
                                        )}>
                                        {isDone ? '✓ ' : ''}{w.workout?.title}
                                      </button>
                                    )
                                  })}
                                  {dayWorkouts.length > 3 && <p className="text-[8px] text-muted-foreground">+{dayWorkouts.length-3}</p>}
                                </div>
                              </div>
                            )
                          })}
                          {(() => {
                            const si = getWeekSeasonInfo(weekStartDay)
                            const kmOk = si?.targetKm ? Math.abs(wKm - si.targetKm) <= si.targetKm * 0.1 : null
                            return (
                          <div className={cn('flex flex-col items-center justify-center gap-0.5 rounded-lg py-1',
                            si?.isDownWeek ? 'bg-amber-100/80 ring-1 ring-amber-300' : si?.meta ? si.meta.cell : 'bg-muted/30')}>
                            {si?.meta && (
                              <span className={cn('text-[8px] font-bold px-1 py-px rounded-full border leading-none', si.meta.chip)}>
                                {si.isDownWeek ? '⬇ ירידה' : si.meta.he}{si.weeksToRace != null && si.weeksToRace >= 0 ? ` · ‑${si.weeksToRace}` : ''}
                              </span>
                            )}
                            {wKm > 0 ? <><p className={cn('text-xs font-bold', kmOk == null ? 'text-navy' : kmOk ? 'text-emerald-700' : wKm < (si?.targetKm || 0) ? 'text-amber-700' : 'text-red-600')}>{wKm}</p></> : <p className="text-[9px] text-muted-foreground">—</p>}
                            {si?.targetKm != null && (
                              <p className="text-[8px] text-muted-foreground leading-none">יעד {si.targetKm}</p>
                            )}
                            {/* Copy / paste this week (paste mode when a week is copied) */}
                            {copiedWeekStart && !isSameDay(weekStartDay, copiedWeekStart) ? (
                              <button
                                onClick={() => copyWeekTo(copiedWeekStart, weekStartDay)}
                                title={`הדבק לשבוע ${format(weekStartDay, 'd/M')}`}
                                className="w-6 h-6 rounded-md bg-emerald-600 text-white flex items-center justify-center active:scale-90 transition-all">
                                <ClipboardPaste className="h-3 w-3"/>
                              </button>
                            ) : !copiedWeekStart ? (
                              <button
                                onClick={() => setCopiedWeekStart(weekStartDay)}
                                title={`העתק שבוע ${format(weekStartDay, 'd/M')}`}
                                className="w-6 h-6 rounded-md border border-border bg-white text-muted-foreground hover:text-navy hover:border-gold/50 flex items-center justify-center active:scale-90 transition-all">
                                <Copy className="h-3 w-3"/>
                              </button>
                            ) : null}
                          </div>
                            )
                          })()}
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Athlete's exact view — the same component the athlete sees, for
            whichever date the coach last tapped on the calendar above */}
        {selectedDate && (
          <Card className="border-navy/15">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2">
                👤 בדיוק כמו שהספורטאי רואה
                <span className="text-xs font-normal text-muted-foreground">— {format(selectedDate, 'EEEE, d MMMM')}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <AthletePlannerView overrideAthleteId={athleteId} initialDate={format(selectedDate, 'yyyy-MM-dd')} />

              {/* Send a message tied to this day — same composer style as the workout panel */}
              <div className="space-y-1.5 border-t pt-3 mt-4" dir="rtl">
                <Label className="text-xs font-semibold text-navy">שלח הודעה לספורטאי על היום הזה</Label>
                <Textarea
                  value={dayMessageText}
                  onChange={e => setDayMessageText(e.target.value)}
                  placeholder={t.typeMessage}
                  className="text-xs min-h-[60px]"
                  dir="rtl"
                />
                <Button
                  size="sm"
                  className="w-full h-8 text-xs bg-navy text-white hover:bg-navy/90"
                  onClick={handleSendDayMessage}
                  disabled={sendingDayMessage || !dayMessageText.trim()}
                >
                  {sendingDayMessage && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1"/>}
                  <Send className="h-3.5 w-3.5 mr-1"/>
                  שלח הערה
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Selected workout detail + log */}
        {selectedAW && (
          <Card className="border-gold/30">
            <CardContent className="pt-4 space-y-3">
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-bold text-navy text-lg">{selectedAW.workout?.title}</p>
                  <p className="text-xs text-muted-foreground">{format(parseISO(selectedAW.scheduledDate),'EEEE, d MMMM yyyy')}</p>
                  <div className="flex gap-2 mt-1 flex-wrap">
                    {selectedAW.workout?.distance && <Badge variant="outline" className="text-xs"><MapPin className="h-3 w-3 mr-1"/>{selectedAW.workout.distance} {t.km}</Badge>}
                    {selectedAW.workout?.duration && <Badge variant="outline" className="text-xs"><Clock className="h-3 w-3 mr-1"/>{selectedAW.workout.duration} {t.min}</Badge>}
                    <Badge variant="outline" className={cn('text-xs', selectedAW.status==='completed' ? 'bg-emerald-100 text-emerald-700' : selectedAW.status==='skipped' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700')}>
                      {selectedAW.status==='completed' ? t.completedBadge : selectedAW.status==='skipped' ? t.skippedBadge : t.scheduledBadge}
                    </Badge>
                  </div>
                  {/* Beyond the athlete's rolling visibility window — offer to show it early */}
                  {(() => {
                    const visW = athlete?.visibleWeeksAhead ?? 2
                    if (visW <= 0) return null
                    const cutoff = format(addWeeks(startOfWeek(new Date(), { weekStartsOn: 6 }), visW), 'yyyy-MM-dd')
                    const bypasses = selectedAW.showAheadOverride || selectedAW.workout?.type === 'race' || selectedAW.workout?.type === 'time_trial'
                    if (selectedAW.scheduledDate < cutoff || bypasses) return bypasses && selectedAW.scheduledDate >= cutoff ? (
                      <button
                        onClick={async () => {
                          await updateDoc(doc(db, 'assignedWorkouts', selectedAW.id), { showAheadOverride: false })
                          setAssignedWorkouts(prev => prev.map(w => w.id === selectedAW.id ? { ...w, showAheadOverride: false } : w))
                        }}
                        className="mt-1.5 text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-2.5 py-1 w-fit">
                        ✓ גלוי לספורטאי מראש — לחץ להסתרה
                      </button>
                    ) : null
                    return (
                      <button
                        onClick={async () => {
                          await updateDoc(doc(db, 'assignedWorkouts', selectedAW.id), { showAheadOverride: true })
                          setAssignedWorkouts(prev => prev.map(w => w.id === selectedAW.id ? { ...w, showAheadOverride: true } : w))
                          toast.success('הספורטאי יראה את האימון הזה כבר עכשיו')
                        }}
                        className="mt-1.5 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 w-fit">
                        👁 מעבר לחלון הרגיל — הצג לספורטאי מראש
                      </button>
                    )
                  })()}
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setCopiedWorkout(selectedAW); setSelectedAssignedId(null); toast.success(t.toastAdded) }}>
                    <Copy className="h-3 w-3 mr-1"/>{t.copyBtn}
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setBuilderWorkoutId(selectedAW.workoutId); setEditingAssignedId(selectedAW.id); setShowBuilderDialog(true) }}>
                    <Pencil className="h-3 w-3 mr-1"/>{t.editBtn}
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDeleteWorkout(selectedAW)}>
                    <Trash2 className="h-3 w-3 mr-1"/>{t.deleteBtn}
                  </Button>
                </div>
              </div>

              {/* Workout details */}
              {selectedAW.workout?.description && <p className="text-xs text-muted-foreground leading-relaxed">{selectedAW.workout.description}</p>}
              {selectedAW.workout?.warmup && (
                <div className="bg-emerald-50 rounded-lg p-2.5 border border-emerald-100">
                  <p className="text-xs font-semibold text-emerald-700 mb-1">חימום</p>
                  <p className="text-xs text-emerald-800">{selectedAW.workout.warmup}</p>
                </div>
              )}
              {selectedAW.workout?.sets && selectedAW.workout.sets.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-navy border-b pb-1">סטים</p>
                  {selectedAW.workout.sets.map((set, si) => {
                    const hasIntervals = (set as any).intervals?.length > 0
                    return (
                      <div key={si} className="rounded-lg border overflow-hidden">
                        <div className="bg-navy/5 px-3 py-2 flex items-center justify-between">
                          <span className="text-xs font-bold text-navy">סט {si+1}{set.reps>1?` · ${set.reps} חזרות`:''}
                            {!hasIntervals && (set.distance||set.duration) && ` · ${set.distance||set.duration}`}
                            {!hasIntervals && set.pace && <span className="font-normal text-muted-foreground"> @ {set.pace}</span>}
                          </span>
                          {set.rest && <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">מנוחה: {set.rest}</span>}
                        </div>
                        {hasIntervals && (
                          <div className="px-3 py-2 space-y-1">
                            {((set as any).intervals as any[]).map((iv:any, ii:number) => (
                              <div key={ii} className="flex items-center gap-2 text-xs bg-white/70 rounded px-2 py-1.5 border border-border/50">
                                <span className="w-5 h-5 rounded-full bg-navy text-white font-bold flex items-center justify-center text-[10px]">{ii+1}</span>
                                <span className="font-bold text-navy">{iv.distance}</span>
                                {iv.pace && <span className="text-muted-foreground">@ {iv.pace}</span>}
                                {iv.rest && <span className="text-muted-foreground ml-auto">מנוחה: {iv.rest}</span>}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {selectedAW.workout?.cooldown && (
                <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
                  <p className="text-xs font-semibold text-blue-700 mb-1">שחרור</p>
                  <p className="text-xs text-blue-800">{selectedAW.workout.cooldown}</p>
                </div>
              )}

              {/* Athlete log — full detail, same view the athlete sees */}
              {selectedLog && (
                <div className="space-y-2">
                  <p className="text-xs font-bold text-emerald-700">איך היה לו — תצוגת ספורטאי מלאה</p>
                  <ActivityDetailView log={selectedLog as any} plannedDistance={selectedAW.workout?.distance ?? null} />
                </div>
              )}

              {/* Coach message to athlete */}
              <div className="space-y-1.5 border-t pt-3" dir="rtl">
                <Label className="text-xs font-semibold text-navy">{t.coachNotesLabel}</Label>
                <Textarea
                  value={coachMessageText}
                  onChange={e => setCoachMessageText(e.target.value)}
                  placeholder={t.typeMessage}
                  className="text-xs min-h-[60px]"
                  dir="rtl"
                />
                <Button
                  size="sm"
                  className="w-full h-8 text-xs bg-navy text-white hover:bg-navy/90"
                  onClick={handleSendCoachMessage}
                  disabled={sendingCoachMessage || !coachMessageText.trim()}
                >
                  {sendingCoachMessage && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1"/>}
                  <Send className="h-3.5 w-3.5 mr-1"/>
                  שלח הערה
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* AI Coaching Report — collapsed by default, opens on demand */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4 cursor-pointer" onClick={() => setShowAiSection(p => !p)}>
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-muted-foreground">
                <Sparkles className="h-4 w-4 text-gold/60"/>
                דוח ניתוח AI
              </span>
              <ChevronLeft className={cn('h-4 w-4 text-muted-foreground transition-transform', showAiSection && '-rotate-90')}/>
            </CardTitle>
          </CardHeader>
          {showAiSection && (
          <CardContent className="px-4 pb-4 space-y-3">
            <Button
              onClick={handleGenerateReport}
              disabled={aiReportLoading}
              className="w-full bg-gold hover:bg-gold/90 text-navy font-bold h-10"
            >
              {aiReportLoading
                ? <><Loader2 className="h-4 w-4 animate-spin mr-2"/>מנתח 3 שבועות של נתונים...</>
                : <><Sparkles className="h-4 w-4 mr-2"/>צור דוח ניתוח AI</>}
            </Button>

            {aiReport && (
              <div className="space-y-4" dir="rtl">
                {/* Week type + fitness status */}
                <div className="flex items-start gap-2 flex-wrap">
                  <Badge className={cn('text-xs border flex-shrink-0',
                    aiReport.weekType === 'down_week' ? 'bg-amber-100 text-amber-800 border-amber-200' :
                    aiReport.weekType === 'build_week' ? 'bg-blue-100 text-blue-800 border-blue-200' :
                    aiReport.weekType === 'recovery_week' ? 'bg-purple-100 text-purple-800 border-purple-200' :
                    'bg-emerald-100 text-emerald-800 border-emerald-200'
                  )}>
                    {aiReport.weekType === 'down_week' ? 'שבוע ירידה' :
                     aiReport.weekType === 'build_week' ? 'שבוע בנייה' :
                     aiReport.weekType === 'recovery_week' ? 'שבוע התאוששות' : 'שבוע רגיל'}
                  </Badge>
                  <p className="text-xs text-muted-foreground flex-1 min-w-0">{aiReport.weekTypeReason}</p>
                </div>
                {aiReport.fitnessStatus && (
                  <div className="rounded-lg bg-navy/5 border border-navy/10 p-3">
                    <p className="text-[10px] font-bold text-navy mb-1">מצב כושר נוכחי</p>
                    <p className="text-xs text-navy leading-relaxed">{aiReport.fitnessStatus}</p>
                  </div>
                )}

                {/* 3-week analysis cards */}
                {(aiReport.week1Analysis || aiReport.week2Analysis || aiReport.week3Analysis) && (
                  <div className="space-y-2">
                    <p className="text-xs font-semibold text-navy border-b pb-1">ניתוח שלושת השבועות האחרונים</p>
                    <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                      {[
                        { label: `${t.week} 1`, text: aiReport.week1Analysis },
                        { label: `${t.week} 2`, text: aiReport.week2Analysis },
                        { label: `${t.week} 3`, text: aiReport.week3Analysis },
                      ].map((wk, i) => wk.text ? (
                        <div key={i} className="rounded-lg bg-muted/30 border border-border/40 p-2.5">
                          <p className="text-[10px] font-bold text-navy mb-1">{wk.label}</p>
                          <p className="text-[11px] text-muted-foreground leading-relaxed">{wk.text}</p>
                        </div>
                      ) : null)}
                    </div>
                  </div>
                )}

                {/* Strengths + Struggles */}
                {(aiReport.strengths || aiReport.struggles) && (
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    {aiReport.strengths && (
                      <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3">
                        <p className="text-[10px] font-bold text-emerald-700 mb-1">חוזקות</p>
                        <p className="text-xs text-emerald-800 leading-relaxed">{aiReport.strengths}</p>
                      </div>
                    )}
                    {aiReport.struggles && (
                      <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                        <p className="text-[10px] font-bold text-amber-700 mb-1">נקודות לשיפור</p>
                        <p className="text-xs text-amber-800 leading-relaxed">{aiReport.struggles}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Load + Goal analysis */}
                {(aiReport.loadAnalysis || aiReport.goalProgressAnalysis) && (
                  <div className="rounded-xl bg-navy p-3 space-y-2">
                    {aiReport.loadAnalysis && (
                      <div>
                        <p className="text-[10px] font-bold text-gold mb-1">ניתוח עומס</p>
                        <p className="text-xs text-white leading-relaxed">{aiReport.loadAnalysis}</p>
                      </div>
                    )}
                    {aiReport.goalProgressAnalysis && (
                      <div>
                        <p className="text-[10px] font-bold text-gold mb-1">התקדמות לקראת המטרה</p>
                        <p className="text-xs text-white leading-relaxed">{aiReport.goalProgressAnalysis}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Key observations */}
                {aiReport.keyObservations?.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-navy border-b pb-1">תצפיות מרכזיות</p>
                    {aiReport.keyObservations.map((obs: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 py-1">
                        <span className="w-5 h-5 rounded-full bg-navy text-white text-[10px] font-bold flex items-center justify-center flex-shrink-0 mt-0.5">{i+1}</span>
                        <p className="text-xs text-navy leading-relaxed">{obs}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Coach recommendations */}
                {aiReport.coachRecommendations && (
                  <div className="rounded-xl border-2 border-gold/40 bg-gold/5 p-3">
                    <p className="text-[10px] font-bold text-navy mb-1">המלצות למאמן לשבוע הקרוב</p>
                    <p className="text-xs text-navy leading-relaxed">{aiReport.coachRecommendations}</p>
                  </div>
                )}

                {/* Risk flags */}
                {aiReport.riskFlags?.length > 0 && (
                  <div className="space-y-1">
                    {aiReport.riskFlags.map((flag: string, i: number) => (
                      <div key={i} className="rounded-lg bg-red-50 border border-red-200 px-3 py-2">
                        <p className="text-xs text-red-700 font-semibold">{flag}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
          )}
        </Card>

      </div>

      {/* Weekly Summary Dialog */}
      <Dialog open={showWeeklySummary} onOpenChange={setShowWeeklySummary}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">סיכום שבועי 📊 — {athlete?.name}</DialogTitle>
          </DialogHeader>
          {weeklySummary && (
            <div className="space-y-4">
              <div className="rounded-xl bg-navy p-4 space-y-3">
                <div>
                  <p className="text-xs font-bold text-gold mb-1">סיכום השבוע</p>
                  <p className="text-xs text-white leading-relaxed">{weeklySummary.weekSummary}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-gold mb-1">הישגים</p>
                  <p className="text-xs text-white leading-relaxed">{weeklySummary.achievements}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-gold mb-1">נקודות לשיפור</p>
                  <p className="text-xs text-white leading-relaxed">{weeklySummary.improvements}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-gold mb-1">פוקוס שבוע הבא</p>
                  <p className="text-xs text-white leading-relaxed">{weeklySummary.nextWeekFocus}</p>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">{t.coachNotesLabel}</Label>
                <Textarea
                  value={weeklyCoachNote}
                  onChange={e => setWeeklyCoachNote(e.target.value)}
                  className="text-xs min-h-[80px]"
                  placeholder={t.typeMessage}
                  dir="rtl"
                />
              </div>
              <Button onClick={handleApproveWeeklySummary} disabled={savingWeeklySummary} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold">
                {savingWeeklySummary && <Loader2 className="h-4 w-4 animate-spin mr-2"/>}
                אשר ושלח לספורטאי ✅
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Right sidebar */}
      <div className="w-full lg:w-72 lg:flex-shrink-0 space-y-4">

        {/* Assign workout panel */}
        <Card className="lg:sticky lg:top-4">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">שיבוץ אימון</CardTitle>
              <Button size="sm" variant="outline" className="h-7 text-xs border-gold/40 text-gold hover:bg-gold/10"
                onClick={() => { setBuilderWorkoutId(undefined); setShowBuilderDialog(true) }}>
                <Plus className="h-3 w-3 mr-1"/>{t.createWorkoutTitle}
              </Button>
            </div>
            {selectedDate && <p className="text-xs text-muted-foreground mt-1">{format(selectedDate,'EEEE, d MMMM')}</p>}
            <div className="relative mt-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
              <Input value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} placeholder={t.searchWorkoutsPh} className="pl-7 h-7 text-xs" dir="auto"/>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {filteredLibrary.map(workout => (
                <button key={workout.id}
                  onClick={() => setSelectedWorkout(selectedWorkout?.id === workout.id ? null : workout)}
                  className={cn('w-full text-left rounded-lg border p-2 text-xs transition-all',
                    selectedWorkout?.id === workout.id ? 'border-gold bg-gold/5' : 'border-border hover:border-gold/40'
                  )}>
                  <p className="font-semibold truncate text-navy">{workout.title}</p>
                  <div className="flex gap-2 text-muted-foreground mt-0.5">
                    {workout.distance && <span>{workout.distance}k</span>}
                    {workout.duration && <span>{workout.duration}'</span>}
                  </div>
                </button>
              ))}
            </div>
            {selectedWorkout && selectedDate && (
              <Button onClick={handleAssign} disabled={assigning} className="w-full mt-2 bg-gold hover:bg-gold/90 text-navy h-8 text-sm">
                {assigning ? <Loader2 className="h-4 w-4 animate-spin mr-1"/> : <Plus className="h-4 w-4 mr-1"/>}
                שבץ ל-{format(selectedDate,'d/M')}
              </Button>
            )}
            {!selectedDate && <p className="text-xs text-muted-foreground text-center mt-2">לחץ על יום בלוח לשיבוץ</p>}
          </CardContent>
        </Card>

        {/* Athlete data */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">נתוני אתלט</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {/* Week settings — per athlete */}
            <div>
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">הגדרות שבוע</p>
              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">תחילת שבוע בלוח</span>
                  <select
                    value={calWeekStartsOn}
                    onChange={async e => {
                      const v = Number(e.target.value) === 1 ? 1 : 0
                      setAthlete(prev => prev ? { ...prev, weekStartDay: v as 0 | 1 } : prev)
                      const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                      await ud(dc(db, 'users', athleteId), { weekStartDay: v })
                    }}
                    className="h-7 text-xs rounded-lg border border-border bg-white px-1.5 font-semibold text-navy">
                    <option value={0}>ראשון</option>
                    <option value={1}>שני</option>
                  </select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">שבועות פתוחים לספורטאי</span>
                  <select
                    value={athlete?.visibleWeeksAhead ?? 2}
                    onChange={async e => {
                      const v = Number(e.target.value)
                      setAthlete(prev => prev ? { ...prev, visibleWeeksAhead: v } : prev)
                      const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                      await ud(dc(db, 'users', athleteId), { visibleWeeksAhead: v })
                      toast.success(v === 0 ? 'הספורטאי רואה את כל התכנית' : `הספורטאי רואה ${v} שבועות קדימה (מתגלגל בשבת)`)
                    }}
                    className="h-7 text-xs rounded-lg border border-border bg-white px-1.5 font-semibold text-navy">
                    <option value={2}>2 שבועות</option>
                    <option value={3}>3 שבועות</option>
                    <option value={4}>4 שבועות</option>
                    <option value={0}>הכל</option>
                  </select>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">ספירת ק&quot;מ שבועית מ־</span>
                  <select
                    value={kmWeekStartsOn}
                    onChange={async e => {
                      const v = Number(e.target.value) === 0 ? 0 : 1
                      setAthlete(prev => prev ? { ...prev, kmWeekStartDay: v as 0 | 1 } : prev)
                      const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                      await ud(dc(db, 'users', athleteId), { kmWeekStartDay: v })
                    }}
                    className="h-7 text-xs rounded-lg border border-border bg-white px-1.5 font-semibold text-navy">
                    <option value={0}>ראשון</option>
                    <option value={1}>שני</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Goals & athlete data — everything editable in place */}
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">מטרות ונתונים</p>
                <Link href={`/coach/athletes/${athleteId}/journey`}
                  className="text-[10px] font-semibold text-gold hover:underline underline-offset-2">
                  עריכת מסע מלאה ←
                </Link>
              </div>
              <div className="space-y-1.5">
                {/* Goal race (journey) */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground flex-shrink-0">🎯 תחרות מטרה</span>
                  <Input
                    className="h-7 text-xs font-bold text-navy text-right"
                    value={activeJourney?.goalRaceEvent || ''}
                    placeholder="מרתון ת״א"
                    disabled={!activeJourney}
                    onChange={e => setActiveJourney(prev => prev ? { ...prev, goalRaceEvent: e.target.value } : prev)}
                    onBlur={() => activeJourney && saveJourney(athleteId, activeJourney).catch(() => toast.error(t.toastSaveJourneyFailed))}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground flex-shrink-0">📅 תאריך</span>
                  <Input
                    type="date"
                    className="h-7 text-xs font-bold text-navy"
                    value={activeJourney?.goalRaceDate || ''}
                    disabled={!activeJourney}
                    onChange={e => setActiveJourney(prev => prev ? { ...prev, goalRaceDate: e.target.value } : prev)}
                    onBlur={() => activeJourney && saveJourney(athleteId, activeJourney).catch(() => toast.error(t.toastSaveJourneyFailed))}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground flex-shrink-0">⏱ יעד זמן</span>
                  <Input
                    className="h-7 text-xs font-bold text-navy text-center"
                    value={activeJourney?.goalRaceTarget || ''}
                    placeholder="2:59:00"
                    dir="ltr"
                    disabled={!activeJourney}
                    onChange={e => setActiveJourney(prev => prev ? { ...prev, goalRaceTarget: e.target.value } : prev)}
                    onBlur={() => activeJourney && saveJourney(athleteId, activeJourney).catch(() => toast.error(t.toastSaveJourneyFailed))}
                  />
                </div>
                {!activeJourney && (
                  <p className="text-[10px] text-amber-600">אין מסע פעיל — צור אחד בעריכת מסע מלאה</p>
                )}
                {/* Weekly km range */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground flex-shrink-0">ק"מ שבועי</span>
                  <div className="flex items-center gap-1" dir="ltr">
                    <Input type="number" className="h-7 w-14 text-xs font-bold text-navy text-center"
                      value={athlete?.weeklyKmRange?.min ?? ''}
                      placeholder="40"
                      onChange={async e => {
                        const min = Number(e.target.value) || 0
                        const range = { min, max: athlete?.weeklyKmRange?.max ?? min }
                        setAthlete(prev => prev ? { ...prev, weeklyKmRange: range } : prev)
                        const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                        await ud(dc(db, 'users', athleteId), { weeklyKmRange: range })
                      }}/>
                    <span className="text-xs text-muted-foreground">–</span>
                    <Input type="number" className="h-7 w-14 text-xs font-bold text-navy text-center"
                      value={athlete?.weeklyKmRange?.max ?? ''}
                      placeholder="60"
                      onChange={async e => {
                        const max = Number(e.target.value) || 0
                        const range = { min: athlete?.weeklyKmRange?.min ?? 0, max }
                        setAthlete(prev => prev ? { ...prev, weeklyKmRange: range } : prev)
                        const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                        await ud(dc(db, 'users', athleteId), { weeklyKmRange: range })
                      }}/>
                  </div>
                </div>
                {/* Down-week interval */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground flex-shrink-0">שבוע ירידה כל</span>
                  <select
                    value={athlete?.offWeekInterval ?? 4}
                    onChange={async e => {
                      const v = Number(e.target.value)
                      setAthlete(prev => prev ? { ...prev, offWeekInterval: v } : prev)
                      const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                      await ud(dc(db, 'users', athleteId), { offWeekInterval: v })
                    }}
                    className="h-7 text-xs rounded-lg border border-border bg-white px-1.5 font-semibold text-navy">
                    <option value={2}>2 שבועות</option>
                    <option value={3}>3 שבועות</option>
                    <option value={4}>4 שבועות</option>
                    <option value={5}>5 שבועות</option>
                    <option value={0}>ללא</option>
                  </select>
                </div>
                {/* Target race pace */}
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground flex-shrink-0">קצב מטרה</span>
                  <Input
                    className="h-7 w-24 text-xs font-bold text-navy text-center"
                    value={athlete?.targetPaceKm || ''}
                    placeholder="4:15/km"
                    dir="ltr"
                    onChange={e => setAthlete(prev => prev ? { ...prev, targetPaceKm: e.target.value } : prev)}
                    onBlur={async e => {
                      const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                      await ud(dc(db, 'users', athleteId), { targetPaceKm: e.target.value.trim() || null })
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Training paces - editable */}
            <div className="border-t pt-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">אזור קצב</p>
              {athlete?.trainingPaces && athlete.trainingPaces.length > 0 ? (
                <div className="space-y-1.5">
                  {athlete.trainingPaces.map((p, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground capitalize w-20 flex-shrink-0">{p.type}</span>
                      <Input
                        className="h-6 text-xs font-bold text-navy text-right w-20"
                        value={p.pace}
                        onChange={async (e) => {
                          if (!athlete) return
                          const newPaces = athlete.trainingPaces.map((tp, ti) => ti === i ? { ...tp, pace: e.target.value } : tp)
                          setAthlete(prev => prev ? { ...prev, trainingPaces: newPaces } : prev)
                          const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                          await ud(dc(db, 'users', athleteId), { trainingPaces: newPaces })
                        }}
                      />
                    </div>
                  ))}
                </div>
              ) : <p className="text-xs text-muted-foreground">לא הוגדרו טמפואים</p>}
            </div>

            {/* Goals */}
            {athlete?.goals && athlete.goals.filter(g=>g.status==='active').length > 0 && (
              <div className="border-t pt-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">מטרות</p>
                {athlete.goals.filter(g=>g.status==='active').map((g,i) => (
                  <div key={i} className="text-xs text-navy">{g.title}</div>
                ))}
              </div>
            )}

            {/* Events */}
            {athlete?.events && athlete.events.length > 0 && (
              <div className="border-t pt-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">אירועים</p>
                <div className="flex flex-wrap gap-1">
                  {athlete.events.map((e,i) => <Badge key={i} variant="outline" className="text-[10px]">{e}</Badge>)}
                </div>
              </div>
            )}

            {/* Personal Records */}
            {athlete?.personalRecords && athlete.personalRecords.length > 0 && (
              <div className="border-t pt-3">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">שיאים אישיים</p>
                <div className="space-y-1">
                  {athlete.personalRecords.slice(0,5).map((pr,i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">{pr.event}</span>
                      <span className="font-bold text-navy">{pr.time}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick-assign sheet — tap a day, tap a type, enter numbers, done */}
      <Dialog open={!!quickAssignDate} onOpenChange={(open) => { if (!open) { setQuickAssignDate(null); resetQuickAssign() } }}>
        <DialogContent className="max-w-md w-full max-h-[88vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">
              {quickAssignDate && format(quickAssignDate, 'EEEE, d MMMM')}
            </DialogTitle>
          </DialogHeader>
          {quickAssignDate && (() => {
            const qaDateStr = format(quickAssignDate, 'yyyy-MM-dd')
            const existingWs = getWorkoutsForDate2(qaDateStr)
            return (
              <div className="space-y-4">
                {/* Existing workouts that day */}
                {existingWs.length > 0 && (
                  <div className="space-y-1.5">
                    {existingWs.map(w => (
                      <div key={w.id} className={cn('rounded-xl border px-3 py-2 flex items-center gap-2', TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy)}>
                        <span className="text-sm">{TYPE_EMOJI[w.workout?.type] || '🏃'}</span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-bold truncate">{w.workout?.title}</p>
                          {w.workout?.distance && <p className="text-[10px] opacity-70">{w.workout.distance} ק"מ</p>}
                        </div>
                        <button
                          onClick={() => { setBuilderWorkoutId(w.workoutId); setEditingAssignedId(w.id); setQuickAssignDate(null); setShowBuilderDialog(true) }}
                          className="text-[10px] font-semibold bg-white/70 border border-black/10 rounded-full px-2 py-0.5">
                          {t.editBtn}
                        </button>
                        <button onClick={() => handleRemove(w.id)}
                          className="w-6 h-6 rounded-full hover:bg-red-100 text-red-400 flex items-center justify-center text-xs">✕</button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Type chips — tap a type to browse that part of the library */}
                <div>
                  <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">בחר סוג אימון</p>
                  <div className="flex flex-wrap gap-1.5">
                    {QUICK_TYPES.map(ty => (
                      <button key={ty} onClick={() => { setQaType(prev => prev === ty ? null : ty); setQaShowCreate(false) }}
                        className={cn('text-xs font-semibold px-3 py-1.5 rounded-full border transition-all active:scale-95',
                          TYPE_COLORS[ty] || TYPE_COLORS.easy,
                          qaType === ty ? 'ring-2 ring-navy/60' : 'opacity-80 hover:opacity-100')}>
                        {workoutTypeLabels[ty]}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Library workouts of the chosen type — tap to assign, ✕ deletes from library */}
                {qaType && (() => {
                  const typeWorkouts = workoutLibrary.filter(w => w.type === qaType)
                  return (
                    <div className="space-y-2">
                      {typeWorkouts.length > 0 ? (
                        <div className="max-h-56 overflow-y-auto space-y-1 rounded-xl border border-border p-1.5 bg-muted/10">
                          {typeWorkouts.map(w => (
                            <div key={w.id} className="flex items-center gap-1">
                              <button
                                onClick={async () => {
                                  try {
                                    await assignWorkoutToDate(w, qaDateStr)
                                    toast.success(`✓ ${w.title} — ${format(quickAssignDate, 'd/M')}`)
                                    setQuickAssignDate(null); resetQuickAssign()
                                  } catch { toast.error(t.tryAgainLaterText) }
                                }}
                                className="flex-1 min-w-0 text-right rounded-xl border border-border hover:border-gold/60 bg-white px-3 py-2.5 transition-all active:scale-[0.99]">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-bold text-navy truncate flex-1">{w.title}</p>
                                  {w.distance ? <span className="text-[11px] text-muted-foreground flex-shrink-0">{w.distance} ק"מ</span> : null}
                                  {w.duration ? <span className="text-[11px] text-muted-foreground flex-shrink-0">{w.duration}'</span> : null}
                                </div>
                                {w.description ? <p className="text-[11px] text-gray-400 truncate mt-0.5">{w.description}</p> : null}
                              </button>
                              <button
                                onClick={() => handleDeleteLibraryWorkout(w)}
                                title="מחק מהספרייה"
                                className="w-7 h-7 rounded-full flex items-center justify-center text-gray-300 hover:text-red-500 hover:bg-red-50 flex-shrink-0 text-sm">✕</button>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground text-center py-2">אין אימוני {workoutTypeLabels[qaType]} בספרייה — צור חדש למטה</p>
                      )}

                      {/* Create a new workout of this type */}
                      {!qaShowCreate ? (
                        <Button variant="outline" onClick={() => setQaShowCreate(true)}
                          className="w-full h-10 text-xs rounded-xl border-gold/40 text-gold hover:bg-gold/10">
                          <Plus className="h-3.5 w-3.5 ml-1"/>אימון {workoutTypeLabels[qaType]} חדש
                        </Button>
                      ) : (
                        <div className="space-y-2.5 rounded-2xl border border-gold/30 bg-gold/5 p-3">
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="text-[10px] text-muted-foreground block mb-1">ק"מ</label>
                              <Input type="number" step="0.5" min="0" inputMode="decimal" value={qaDistance}
                                onChange={e => setQaDistance(e.target.value)}
                                className="h-11 text-base text-center font-bold rounded-xl bg-white" placeholder="10"/>
                            </div>
                            <div>
                              <label className="text-[10px] text-muted-foreground block mb-1">{t.durationMinLabel}</label>
                              <Input type="number" min="0" inputMode="numeric" value={qaDuration}
                                onChange={e => setQaDuration(e.target.value)}
                                className="h-11 text-base text-center font-bold rounded-xl bg-white" placeholder="60"/>
                            </div>
                          </div>
                          <Input value={qaTitle} onChange={e => setQaTitle(e.target.value)}
                            placeholder={`שם (לא חובה) — "${autoWorkoutTitle(workoutTypeLabels, qaType, { distance: qaDistance, duration: qaDuration })}"`}
                            className="h-10 text-sm rounded-xl bg-white" dir="rtl"/>
                          <Textarea value={qaDesc} onChange={e => setQaDesc(e.target.value)}
                            placeholder="הוראות לספורטאי (לא חובה)" dir="rtl"
                            className="text-sm rounded-xl bg-white resize-none h-16"/>
                          <Button onClick={handleQuickCreateAssign} disabled={qaSaving}
                            className="w-full h-12 bg-navy hover:bg-navy/90 text-white font-bold rounded-xl text-base">
                            {qaSaving ? <Loader2 className="h-4 w-4 animate-spin"/> : `שבץ ל-${format(quickAssignDate, 'd/M')} ✓`}
                          </Button>
                        </div>
                      )}
                    </div>
                  )
                })()}

                {/* Full builder for interval workouts */}
                <Button variant="outline"
                  onClick={() => { setBuilderWorkoutId(undefined); setShowBuilderDialog(true) }}
                  className="w-full h-10 text-xs rounded-xl">
                  <Plus className="h-3.5 w-3.5 ml-1"/>אימון מפורט (סטים ואינטרוולים)
                </Button>
              </div>
            )
          })()}
        </DialogContent>
      </Dialog>

      {/* Full Workout Builder Dialog */}
      <Dialog open={showBuilderDialog} onOpenChange={(open) => { if (!open) { setShowBuilderDialog(false); setBuilderWorkoutId(undefined) } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{builderWorkoutId ? t.editWorkoutTitle : t.createWorkoutTitle}</DialogTitle>
          </DialogHeader>
          {showBuilderDialog && (
            <WorkoutBuilder
              workoutId={builderWorkoutId}
              hideBackButton
              onDone={async (savedWorkout?: any) => {
                const wid = builderWorkoutId
                const aid = editingAssignedId
                setShowBuilderDialog(false)
                setBuilderWorkoutId(undefined)
                setEditingAssignedId(null)
                // New workout built from the quick-assign sheet → assign it
                // straight to the tapped date
                if (!wid && savedWorkout?.id && quickAssignDate) {
                  try {
                    await assignWorkoutToDate(savedWorkout as Workout, format(quickAssignDate, 'yyyy-MM-dd'))
                    toast.success(`✓ ${savedWorkout.title} — ${format(quickAssignDate, 'd/M')}`)
                  } catch { toast.error(t.tryAgainLaterText) }
                  setQuickAssignDate(null)
                  resetQuickAssign()
                }
                if (wid) {
                  // Get fresh workout data
                  const { getDoc, updateDoc: ud, doc: dc } = await import('firebase/firestore')
                  const wSnap = await getDoc(dc(db, 'workouts', wid))
                  if (wSnap.exists()) {
                    const freshWorkout = { ...wSnap.data(), id: wid } as Workout
                    // Update only the specific assigned workout
                    if (aid) {
                      await ud(dc(db, 'assignedWorkouts', aid), { workout: freshWorkout })
                    }
                  }
                }
                // Reload library and assignments
                const wLibSnap = await getDocs(collection(db, 'workouts'))
                setWorkoutLibrary(wLibSnap.docs.filter(d => !d.data().libraryHidden).map(d => ({ ...(d.data() as Workout), id: d.id })))
                const snap = await getDocs(query(collection(db,'assignedWorkouts'),where('athleteId','==',athleteId)))
                setAssignedWorkouts(snap.docs.map(d => ({...(d.data() as AssignedWorkout), id: d.id})))
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
