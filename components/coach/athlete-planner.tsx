'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Plus, X,
  Loader2, MapPin, Clock, Check, Calendar, Search, Copy, Pencil, Trash2, ClipboardPaste,
  BarChart2,
} from 'lucide-react'
import Link from 'next/link'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, addDays, eachDayOfInterval, eachWeekOfInterval, isSameMonth,
  isSameDay, isToday, parseISO,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase'
import {
  collection, doc, getDoc, getDocs, query,
  where, addDoc, serverTimestamp, deleteDoc,
} from 'firebase/firestore'
import type { AthleteProfile, Workout, AssignedWorkout, TrainingDayType, WorkoutLog } from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import { listJourneys, computeJourneyProgress } from '@/lib/journey'
import { useAuth } from '@/contexts/auth-context'
import { useWorkoutTypeLabels } from '@/lib/workout-labels'
import { WorkoutBuilder } from '@/components/coach/workout-builder'
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

const HEBREW_DAY_NAMES = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת']

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
  const workoutTypeLabels = useWorkoutTypeLabels()

  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
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
  const [librarySearch, setLibrarySearch] = useState('')

  // AI coaching form
  const [selectedTrainingDays, setSelectedTrainingDays] = useState<number[]>([1, 3, 5])
  const [mainGoal, setMainGoal] = useState('בסיס אירובי')
  const [aiNote, setAiNote] = useState('')
  const [loadLevel, setLoadLevel] = useState<'light' | 'normal' | 'hard'>('normal')
  const [planLoading, setPlanLoading] = useState(false)
  const [generatedPlan, setGeneratedPlan] = useState<any>(null)
  const [approvingPlan, setApprovingPlan] = useState(false)
  const [expandedWorkout, setExpandedWorkout] = useState<number | null>(null)
  const [planEditMap, setPlanEditMap] = useState<Record<number, { title?: string; notes?: string }>>({})

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
            const progress = computeJourneyProgress(active, today)
            const stage = progress.activeStage
            if (stage) {
              const s = new Date(stage.startDate)
              const e = new Date(stage.endDate)
              const total = Math.max(1, Math.ceil((e.getTime() - s.getTime()) / (7 * 86400000)))
              const cur   = Math.max(1, Math.ceil((today.getTime() - s.getTime()) / (7 * 86400000)))
              const offN  = d.offWeekInterval ?? 4
              setJourney({
                stageName: stage.name,
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
        setWorkoutLibrary(wSnap.docs.map(d => ({ ...(d.data() as Workout), id: d.id })))
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

  // ── Calendar helpers ──────────────────────────────────────────────────────
  const calendarWeeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 })
    const end   = endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 0 })
    const days  = eachDayOfInterval({ start, end })
    const weeks: Date[][] = []
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
    return weeks
  }, [currentMonth])

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

  // ── This-week km ─────────────────────────────────────────────────────────
  const thisWeekKm = useMemo(() => {
    const from = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
    const to   = format(endOfWeek(new Date(),   { weekStartsOn: 1 }), 'yyyy-MM-dd')
    return assignedWorkouts
      .filter(w => w.scheduledDate >= from && w.scheduledDate <= to)
      .reduce((s, w) => s + (w.workout?.distance ?? 0), 0)
  }, [assignedWorkouts])

  // ── Assign ────────────────────────────────────────────────────────────────
  const handleCreateWorkout = async () => {
    if (!newWO.title.trim()) return
    setCreatingWorkout(true)
    try {
      const ref = await addDoc(collection(db, 'workouts'), {
        title: newWO.title.trim(), type: newWO.type,
        description: newWO.description.trim(),
        distance: newWO.distance ? Number(newWO.distance) : null,
        duration: newWO.duration ? Number(newWO.duration) : null,
        notes: newWO.notes.trim() || null,
        createdBy: user?.id || null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      const created: Workout = {
        id: ref.id, title: newWO.title.trim(), type: newWO.type,
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
        toast.success('אימון נוצר ושובץ ליום!')
      } else {
        toast.success('אימון נוצר בהצלחה!')
      }
      setNewWO({ title: '', type: 'easy', distance: '', duration: '', description: '', notes: '' })
      setShowCreateWorkout(false)
    } catch { toast.error('שגיאה ביצירת אימון') }
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
        w.workoutId === editingWorkout.id ? { ...w, workout: { ...w.workout, ...updated } } : w
      ))
      setWorkoutLibrary(prev => prev.map(w =>
        w.id === editingWorkout.id ? { ...w, ...updated } : w
      ))
      setEditingWorkout(null)
      toast.success('אימון עודכן!')
    } catch { toast.error('שגיאה בעדכון אימון') }
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

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 })
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [currentDate])
  const monthWeeks2 = useMemo(() => {
    const ms = startOfMonth(currentDate), me = endOfMonth(currentDate)
    return eachWeekOfInterval({ start: ms, end: me }, { weekStartsOn: 0 })
  }, [currentDate])

  const DAY_LABELS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
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
  }

  const getWorkoutsForDate2 = useCallback((dateStr: string) =>
    assignedWorkouts.filter(w => w.scheduledDate === dateStr)
  , [assignedWorkouts])

  const getWeekKm2 = useCallback((days: Date[]) =>
    days.reduce((s, d) => s + getWorkoutsForDate2(format(d,'yyyy-MM-dd')).reduce((a,w) => a+(w.workout?.distance??0),0),0)
  , [getWorkoutsForDate2])

  const handleCopyWeek = async () => {
    const from = format(weekStart, 'yyyy-MM-dd')
    const to = format(weekEnd, 'yyyy-MM-dd')
    const weekWorkouts = assignedWorkouts.filter(w => w.scheduledDate >= from && w.scheduledDate <= to)
    if (weekWorkouts.length === 0) { toast.error('אין אימונים בשבוע זה'); return }
    const nextWeekStart = addWeeks(weekStart, 1)
    try {
      await Promise.all(weekWorkouts.map(w => {
        const srcDate = new Date(w.scheduledDate)
        const dayOfWeek = srcDate.getDay()
        const targetDate = format(addWeeks(startOfWeek(weekStart,{weekStartsOn:0}),1), 'yyyy-MM-dd').slice(0,8) + String(dayOfWeek)
        const targetDay = new Date(nextWeekStart)
        targetDay.setDate(nextWeekStart.getDate() + ((dayOfWeek - nextWeekStart.getDay() + 7) % 7))
        return addDoc(collection(db, 'assignedWorkouts'), {
          workoutId: w.workoutId, workout: w.workout,
          athleteId, assignedBy: user?.id || null,
          scheduledDate: format(targetDay, 'yyyy-MM-dd'),
          status: 'scheduled', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
      }))
      toast.success('שבוע הועתק לשבוע הבא!')
      const snap = await getDocs(query(collection(db,'assignedWorkouts'),where('athleteId','==',athleteId)))
      setAssignedWorkouts(snap.docs.map(d => ({...(d.data() as AssignedWorkout), id: d.id})))
    } catch { toast.error('שגיאה בהעתקה') }
  }

  const handleDeleteWorkout = async (aw: AssignedWorkout) => {
    try {
      await deleteDoc(doc(db, 'assignedWorkouts', aw.id))
      setAssignedWorkouts(prev => prev.filter(w => w.id !== aw.id))
      if (selectedAssignedId === aw.id) setSelectedAssignedId(null)
      toast.success('אימון נמחק')
    } catch { toast.error('שגיאה במחיקה') }
  }

  const handlePasteWorkout = async (dateStr: string) => {
    if (!copiedWorkout) return
    try {
      const ref = await addDoc(collection(db, 'assignedWorkouts'), {
        workoutId: copiedWorkout.workoutId, workout: copiedWorkout.workout,
        athleteId, assignedBy: user?.id || null,
        scheduledDate: dateStr, status: 'scheduled',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      setAssignedWorkouts(prev => [...prev, { ...copiedWorkout, id: ref.id, scheduledDate: dateStr, status: 'scheduled' } as any])
      toast.success('אימון הודבק!')
      setCopiedWorkout(null)
    } catch { toast.error('שגיאה בהדבקה') }
  }

  const selectedAW = useMemo(() => assignedWorkouts.find(w => w.id === selectedAssignedId) || null, [assignedWorkouts, selectedAssignedId])
  const selectedLog = useMemo(() => selectedAW ? (logs.find(l => l.assignedWorkoutId === selectedAW.id) || logs.find(l => l.workoutId === selectedAW.workoutId && l.date === selectedAW.scheduledDate)) : null, [selectedAW, logs])
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

  const toggleTrainingDay = (dayNum: number) => {
    setSelectedTrainingDays(prev =>
      prev.includes(dayNum) ? prev.filter(d => d !== dayNum) : [...prev, dayNum].sort((a, b) => a - b)
    )
  }

  const handleGeneratePlan = async () => {
    if (!athlete || selectedTrainingDays.length === 0) {
      toast.error('בחר לפחות יום אימון אחד')
      return
    }
    setPlanLoading(true)
    setGeneratedPlan(null)
    setPlanEditMap({})
    setExpandedWorkout(null)
    try {
      const planStart = addDays(new Date(), 1)
      planStart.setHours(0, 0, 0, 0)

      // Build explicit per-day schedule so the model cannot make mistakes
      const trainingOffsets: number[] = []
      const restOffsets: number[] = []
      const dayScheduleLines = Array.from({ length: 14 }, (_, i) => {
        const d = addDays(planStart, i)
        const dayNum = d.getDay()
        const isTrain = selectedTrainingDays.includes(dayNum)
        if (isTrain) trainingOffsets.push(i) else restOffsets.push(i)
        return `dayOffset ${i}: ${HEBREW_DAY_NAMES[dayNum]} ${format(d, 'd/M/yyyy')} → ${isTrain ? 'יום אימון' : 'מנוחה (type: rest)'}`
      }).join('\n')

      const loadMap = { light: 'קל - נפח מופחת 20%', normal: 'רגיל', hard: 'קשה - נפח מוגבר 15%' }
      const weeksToRace = journey?.goalRaceDate
        ? Math.ceil((new Date(journey.goalRaceDate).getTime() - new Date().getTime()) / (7 * 86400000))
        : null

      const userMessage = `ספורטאי: ${athlete.name}
מירוץ יעד: ${journey?.goalRaceEvent || athlete.events?.[0] || 'לא הוגדר'}
תאריך מירוץ: ${journey?.goalRaceDate || 'לא הוגדר'}
שבועות למירוץ: ${weeksToRace ?? 'לא ידוע'}
שיאים: ${athlete.personalRecords?.map((p: any) => `${p.event}: ${p.time}`).join(', ') || 'לא הוגדרו'}
יעד ק"מ שבועי: ${athlete.weeklyKmRange ? `${athlete.weeklyKmRange.min}–${athlete.weeklyKmRange.max}` : 'לא הוגדר'}
מטרה: ${mainGoal}
עומס: ${loadMap[loadLevel]}
הערת מאמן: ${aiNote || 'אין'}

לוח 14 הימים הקרובים:
${dayScheduleLines}

CRITICAL RULES:
- dayOffsets שחייבים להיות אימונים אמיתיים: [${trainingOffsets.join(', ')}]
- dayOffsets שחייבים להיות rest: [${restOffsets.join(', ')}]
- אימוני rest: type="rest", title="מנוחה", distance=0, duration=0, warmup="", mainSet="", cooldown=""
- אימונים אמיתיים: type חייב להיות easy/fartlek/hills/threshold/long (לא rest!)
- ריצה ארוכה תמיד ביום שישי או שבת (dayOffset של אותו יום)
- לא שני ימים קשים ברצף`

      const res = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userMessage }),
      })
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      const plan = JSON.parse(data.text)
      setGeneratedPlan({ ...plan, planStart: format(planStart, 'yyyy-MM-dd') })
    } catch (err) {
      toast.error('שגיאה ביצירת תוכנית: ' + String(err))
    } finally {
      setPlanLoading(false)
    }
  }

  const handleApprovePlan = async () => {
    if (!generatedPlan || !user) return
    setApprovingPlan(true)
    try {
      const planStart = generatedPlan.planStart
        ? (() => { const d = new Date(generatedPlan.planStart + 'T00:00:00'); return d })()
        : addDays(new Date(), 1)
      await Promise.all(generatedPlan.workouts.map(async (w: any) => {
        const scheduledDate = format(addDays(planStart, w.dayOffset), 'yyyy-MM-dd')
        const edits = planEditMap[w.dayOffset] || {}
        const workout = {
          id: `ai-${Date.now()}-${w.dayOffset}`,
          title: edits.title ?? w.title,
          type: w.type,
          description: w.description || '',
          distance: w.distance || null,
          duration: w.duration || null,
          warmup: w.warmup || '',
          mainSet: w.mainSet || '',
          cooldown: w.cooldown || '',
          notes: edits.notes ?? w.notes ?? '',
          sets: Array.isArray(w.sets) ? w.sets : [],
          createdBy: user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        await addDoc(collection(db, 'assignedWorkouts'), {
          workoutId: workout.id, workout, athleteId,
          assignedBy: user.id || null, scheduledDate, status: 'approved',
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
      }))
      const snap = await getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId)))
      setAssignedWorkouts(snap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id })))
      toast.success('תוכנית אושרה ונשלחה לספורטאי!')
      setGeneratedPlan(null)
      setPlanEditMap({})
      setExpandedWorkout(null)
    } catch (err) {
      toast.error('שגיאה באישור: ' + String(err))
    } finally {
      setApprovingPlan(false)
    }
  }

  const handleWeeklySummary = async () => {
    if (!athlete) return
    setWeeklySummaryLoading(true)
    setWeeklySummary(null)
    try {
      const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const weekWorkouts = assignedWorkouts.filter(w => w.scheduledDate >= weekStart && w.scheduledDate <= weekEnd)
      const res = await fetch('/api/weekly-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          athleteName: athlete.name, athleteId, weekStartDate: weekStart, weekEndDate: weekEnd,
          weekWorkouts: weekWorkouts.map(w => ({
            scheduledDate: w.scheduledDate,
            workout: { title: w.workout?.title, distance: w.workout?.distance },
            status: w.status,
          })),
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
      const weekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const weekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
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
      toast.success('סיכום שבועי נשלח לספורטאי!')
      setShowWeeklySummary(false)
      setWeeklySummary(null)
    } catch (err) {
      toast.error('שגיאה בשמירה: ' + String(err))
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
              <ArrowLeft className="h-4 w-4 mr-1"/>חזרה
            </Button>
          </Link>
          <Avatar className="h-10 w-10">
            <AvatarImage src={athlete?.photoURL}/>
            <AvatarFallback className="bg-navy text-white">{athlete?.name?.charAt(0)}</AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <h1 className="font-bold text-navy text-xl">{athlete?.name}</h1>
            <div className="flex items-center gap-2 flex-wrap">
              {journey && <Badge className="bg-navy/10 text-navy border-navy/20 text-xs">{journey.stageName} · שבוע {journey.weekInStage}/{journey.totalWeeksInStage}</Badge>}
              {journey && <Badge variant="outline" className={cn('text-xs', journey.isOffWeek ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200')}>{journey.isOffWeek ? 'שבוע מנוחה' : 'שבוע אימון'}</Badge>}
              {athlete?.weeklyKmRange && <span className="text-xs text-muted-foreground">יעד: {athlete.weeklyKmRange.min}–{athlete.weeklyKmRange.max} ק"מ/שבוע</span>}
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs border-gold/40 text-gold hover:bg-gold/10 ml-auto flex-shrink-0"
            onClick={handleWeeklySummary} disabled={weeklySummaryLoading}>
            {weeklySummaryLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1"/> : <BarChart2 className="h-3.5 w-3.5 mr-1"/>}
            סיכום שבועי 📊
          </Button>
        </div>

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
              {viewMode === 'week' && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleCopyWeek}>
                  <Copy className="h-3 w-3 mr-1"/>העתק שבוע
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
                            else setSelectedDate(day)
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
                            {dayWorkouts.map(w => (
                              <button key={w.id}
                                onClick={e => { e.stopPropagation(); setSelectedAssignedId(prev => prev === w.id ? null : w.id) }}
                                className={cn('w-full text-left text-[10px] rounded-lg px-1.5 py-1.5 border transition-all hover:opacity-80',
                                  TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                  w.status==='completed' ? 'opacity-60' : '',
                                  selectedAssignedId === w.id ? 'ring-2 ring-navy' : ''
                                )}>
                                <p className="font-semibold truncate">{w.workout?.title}</p>
                                {w.workout?.distance && <p className="opacity-70">{w.workout.distance}k</p>}
                              </button>
                            ))}
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
                      const days = eachDayOfInterval({ start: weekStartDay, end: endOfWeek(weekStartDay,{weekStartsOn:0}) })
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
                                  else if (inMonth) setSelectedDate(day)
                                }}
                                className={cn('min-h-[80px] rounded-lg p-1 border transition-all',
                                  !inMonth ? 'opacity-20 border-transparent' : 'border-border',
                                  todayFlag ? 'border-gold/60 bg-gold/5' : '',
                                  copiedWorkout && inMonth ? 'cursor-pointer hover:border-gold' : ''
                                )}>
                                <p className={cn('text-[10px] font-semibold mb-1', todayFlag ? 'text-gold' : 'text-navy')}>{format(day,'d')}</p>
                                <div className="space-y-0.5">
                                  {dayWorkouts.slice(0,3).map(w => (
                                    <button key={w.id}
                                      onClick={e => { e.stopPropagation(); setSelectedAssignedId(prev => prev === w.id ? null : w.id) }}
                                      className={cn('w-full text-left text-[8px] rounded px-0.5 py-0.5 border truncate hover:opacity-75',
                                        TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                        selectedAssignedId === w.id ? 'ring-1 ring-navy font-bold' : ''
                                      )}>
                                      {w.workout?.title}
                                    </button>
                                  ))}
                                  {dayWorkouts.length > 3 && <p className="text-[8px] text-muted-foreground">+{dayWorkouts.length-3}</p>}
                                </div>
                              </div>
                            )
                          })}
                          <div className="flex flex-col items-center justify-center rounded-lg bg-muted/30">
                            {wKm > 0 ? <><p className="text-xs font-bold text-navy">{wKm}</p><p className="text-[9px] text-muted-foreground">ק"מ</p></> : <p className="text-[9px] text-muted-foreground">—</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

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
                    {selectedAW.workout?.distance && <Badge variant="outline" className="text-xs"><MapPin className="h-3 w-3 mr-1"/>{selectedAW.workout.distance} ק"מ</Badge>}
                    {selectedAW.workout?.duration && <Badge variant="outline" className="text-xs"><Clock className="h-3 w-3 mr-1"/>{selectedAW.workout.duration} דק'</Badge>}
                    <Badge variant="outline" className={cn('text-xs', selectedAW.status==='completed' ? 'bg-emerald-100 text-emerald-700' : selectedAW.status==='skipped' ? 'bg-red-100 text-red-600' : 'bg-amber-100 text-amber-700')}>
                      {selectedAW.status==='completed'?'הושלם':selectedAW.status==='skipped'?'דולג':'מתוכנן'}
                    </Badge>
                  </div>
                </div>
                <div className="flex gap-1 flex-shrink-0">
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setCopiedWorkout(selectedAW); setSelectedAssignedId(null); toast.success('אימון הועתק') }}>
                    <Copy className="h-3 w-3 mr-1"/>העתק
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => { setBuilderWorkoutId(selectedAW.workoutId); setEditingAssignedId(selectedAW.id); setShowBuilderDialog(true) }}>
                    <Pencil className="h-3 w-3 mr-1"/>ערוך
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => handleDeleteWorkout(selectedAW)}>
                    <Trash2 className="h-3 w-3 mr-1"/>מחק
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

              {/* Athlete log */}
              {selectedLog && (
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-3 space-y-2">
                  <p className="text-xs font-bold text-emerald-700">דוח אתלט</p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <span className="bg-white rounded-lg px-2 py-1 border border-emerald-200">מאמץ: <strong>{selectedLog.effort}/10</strong></span>
                    {selectedLog.actualDistance && <span className="bg-white rounded-lg px-2 py-1 border border-emerald-200">ק"מ בפועל: <strong>{selectedLog.actualDistance}</strong></span>}
                    {selectedLog.actualPace && <span className="bg-white rounded-lg px-2 py-1 border border-emerald-200">טמפו: <strong>{selectedLog.actualPace}</strong></span>}
                  </div>
                  {selectedLog.comment && (
                    <div className="bg-white rounded-lg p-2.5 border border-emerald-200">
                      <p className="text-[10px] text-emerald-700 font-semibold mb-1">הערות אתלט</p>
                      <p className="text-xs text-navy leading-relaxed">{selectedLog.comment}</p>
                    </div>
                  )}
                  {selectedLog.splitLogs && selectedLog.splitLogs.length > 0 && (
                    <div className="space-y-1">
                      <p className="text-[10px] text-emerald-700 font-semibold">זמנים</p>
                      {selectedLog.splitLogs.map((s:any, i:number) => (
                        <div key={i} className="flex items-center gap-2 text-xs bg-white rounded px-2 py-1 border border-emerald-200">
                          <span className="font-bold text-navy w-16">{s.distance || `חזרה ${i+1}`}</span>
                          {s.time && <span className="text-emerald-700 font-bold">{s.time}</span>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* STEP 1 — Last-14-days auto analysis */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">מה קרה השבועיים האחרונים 📊</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
            {/* Stats row */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg bg-navy/5 border border-navy/10 p-2 text-center">
                <p className="text-base font-bold text-navy">{analysisData.totalPlanned}</p>
                <p className="text-[10px] text-muted-foreground">ק"מ מתוכנן</p>
              </div>
              <div className="rounded-lg bg-emerald-50 border border-emerald-100 p-2 text-center">
                <p className="text-base font-bold text-emerald-700">{analysisData.totalDone}</p>
                <p className="text-[10px] text-muted-foreground">ק"מ בוצע</p>
              </div>
              <div className="rounded-lg bg-gold/10 border border-gold/20 p-2 text-center">
                <p className="text-base font-bold text-navy">{analysisData.avgEffort ?? '—'}</p>
                <p className="text-[10px] text-muted-foreground">מאמץ ממוצע</p>
              </div>
            </div>
            {/* Workout rows */}
            {analysisData.recent.length === 0 ? (
              <p className="text-xs text-muted-foreground text-center py-2">אין אימונים ב-14 הימים האחרונים</p>
            ) : (
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {analysisData.recent.map(w => {
                  const matchLog = logs.find(l => l.assignedWorkoutId === w.id || (l.workoutId === w.workoutId && l.date === w.scheduledDate))
                  return (
                    <div key={w.id} className="grid grid-cols-[auto_1fr_auto_auto] gap-2 items-center text-xs rounded-lg px-2 py-1.5 bg-muted/30">
                      <span className="text-muted-foreground w-14 flex-shrink-0">{format(parseISO(w.scheduledDate), 'd/M')}</span>
                      <span className="font-medium text-navy truncate" dir="rtl">{w.workout?.title || 'אימון'}</span>
                      <Badge variant="outline" className={cn('text-[10px] px-1.5 py-0 h-5',
                        w.status === 'completed' ? 'bg-emerald-100 text-emerald-700 border-emerald-200' :
                        w.status === 'skipped' ? 'bg-red-100 text-red-600 border-red-200' :
                        'bg-amber-100 text-amber-700 border-amber-200'
                      )}>
                        {w.status === 'completed' ? '✓' : w.status === 'skipped' ? '✗' : '⏳'}
                      </Badge>
                      <span className="text-muted-foreground w-12 text-right">
                        {matchLog?.effort ? `${matchLog.effort}/10` : w.workout?.distance ? `${w.workout.distance}k` : ''}
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* STEP 2 — Coach inputs form */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">תכנון אימונים 🗓️</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-4">
            {/* Training days checkboxes */}
            <div>
              <Label className="text-xs font-semibold mb-2 block">ימי אימון השבוע</Label>
              <div className="flex flex-wrap gap-1.5">
                {HEBREW_DAY_NAMES.map((name, i) => (
                  <button key={i} onClick={() => toggleTrainingDay(i)}
                    className={cn('px-3 py-1.5 rounded-full text-xs font-medium border transition-all',
                      selectedTrainingDays.includes(i)
                        ? 'bg-navy text-white border-navy'
                        : 'bg-white text-muted-foreground border-border hover:border-navy/40'
                    )}>
                    {name}
                  </button>
                ))}
              </div>
            </div>

            {/* Main goal dropdown */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">מטרה עיקרית</Label>
              <Select value={mainGoal} onValueChange={setMainGoal}>
                <SelectTrigger className="h-8 text-xs" dir="rtl">
                  <SelectValue/>
                </SelectTrigger>
                <SelectContent dir="rtl">
                  {['בסיס אירובי', 'פיתוח מהירות', 'חיזוק סף', 'שיא', 'טייפר'].map(g => (
                    <SelectItem key={g} value={g} className="text-xs">{g}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Load level */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">רמת עומס</Label>
              <div className="flex gap-2">
                {(['light', 'normal', 'hard'] as const).map(lvl => (
                  <button key={lvl} onClick={() => setLoadLevel(lvl)}
                    className={cn('flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all',
                      loadLevel === lvl
                        ? lvl === 'light' ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                          : lvl === 'hard' ? 'bg-red-100 text-red-800 border-red-300'
                          : 'bg-navy text-white border-navy'
                        : 'bg-white text-muted-foreground border-border hover:border-navy/40'
                    )}>
                    {lvl === 'light' ? 'קל' : lvl === 'normal' ? 'רגיל' : 'קשה'}
                  </button>
                ))}
              </div>
            </div>

            {/* Coach note */}
            <div>
              <Label className="text-xs font-semibold mb-1.5 block">הערה לAI</Label>
              <Textarea value={aiNote} onChange={e => setAiNote(e.target.value)}
                placeholder="לדוגמה: תוסיף גבעות השבוע, היה קשה לו בשבוע שעבר..."
                className="text-xs min-h-[60px]" dir="rtl"/>
            </div>

            {/* Generate button */}
            <Button onClick={handleGeneratePlan} disabled={planLoading || selectedTrainingDays.length === 0}
              className="w-full bg-gold hover:bg-gold/90 text-navy font-bold h-10">
              {planLoading ? <><Loader2 className="h-4 w-4 animate-spin mr-2"/>יוצר תוכנית...</> : 'צור תוכנית 2 שבועות ✨'}
            </Button>
          </CardContent>
        </Card>

        {/* STEP 4 — Plan review */}
        {generatedPlan && (() => {
          const planStart = generatedPlan.planStart
            ? new Date(generatedPlan.planStart + 'T00:00:00')
            : addDays(new Date(), 1)
          return (
            <Card className="border-gold/30">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">תוכנית מוכנה לאישור ✨</CardTitle>
                  <Button variant="ghost" size="sm" className="text-xs text-muted-foreground h-7" onClick={() => setGeneratedPlan(null)}>נקה</Button>
                </div>
                {generatedPlan.planSummary && (
                  <div className="mt-2 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2 space-y-0.5" dir="rtl">
                    <p className="text-xs font-bold text-blue-800">{generatedPlan.planSummary.keyFocus}</p>
                    <p className="text-[11px] text-blue-700">{generatedPlan.planSummary.rationale}</p>
                    <div className="flex gap-4 text-[11px] text-blue-600 pt-0.5">
                      <span>שבוע 1: {generatedPlan.planSummary.week1TotalKm} ק"מ</span>
                      <span>שבוע 2: {generatedPlan.planSummary.week2TotalKm} ק"מ</span>
                    </div>
                  </div>
                )}
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                {generatedPlan.workouts?.map((w: any) => {
                  const date = addDays(planStart, w.dayOffset)
                  const displayTitle = planEditMap[w.dayOffset]?.title ?? w.title
                  const displayNotes = planEditMap[w.dayOffset]?.notes ?? w.notes
                  const isExpanded = expandedWorkout === w.dayOffset
                  const isRest = w.type === 'rest'
                  if (isRest) return (
                    <div key={w.dayOffset} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-muted/30 text-xs text-muted-foreground" dir="rtl">
                      <span className="w-24 flex-shrink-0 font-medium">{HEBREW_DAY_NAMES[date.getDay()]} {format(date, 'd/M')}</span>
                      <span>מנוחה</span>
                    </div>
                  )
                  return (
                    <div key={w.dayOffset} className={cn('rounded-xl border overflow-hidden transition-all', TYPE_COLORS[w.type] || TYPE_COLORS.easy)}>
                      {/* Header row */}
                      <div className="flex items-center gap-2 px-3 py-2 cursor-pointer" onClick={() => setExpandedWorkout(isExpanded ? null : w.dayOffset)} dir="rtl">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-[11px] font-semibold text-muted-foreground w-24 flex-shrink-0">{HEBREW_DAY_NAMES[date.getDay()]} {format(date, 'd/M')}</span>
                            <span className="font-bold text-xs text-navy truncate">{displayTitle}</span>
                          </div>
                          <div className="flex gap-2 mt-0.5 text-[11px] opacity-70">
                            {w.distance > 0 && <span>{w.distance} ק"מ</span>}
                            {w.duration > 0 && <span>{w.duration} דק'</span>}
                          </div>
                        </div>
                        <span className="text-[10px] text-muted-foreground flex-shrink-0">{isExpanded ? '▲' : '▼'}</span>
                      </div>
                      {/* Expanded details */}
                      {isExpanded && (
                        <div className="border-t border-border/40 bg-white/60 px-3 py-2 space-y-2" dir="rtl">
                          {w.warmup && <p className="text-[11px]"><span className="font-semibold">חימום: </span>{w.warmup}</p>}
                          {w.mainSet && <p className="text-[11px] leading-relaxed"><span className="font-semibold">עיקרי: </span>{w.mainSet}</p>}
                          {w.cooldown && <p className="text-[11px]"><span className="font-semibold">שחרור: </span>{w.cooldown}</p>}
                          {/* Inline edit */}
                          <div className="pt-1 space-y-1.5">
                            <Input value={displayTitle} onChange={e => setPlanEditMap(m => ({ ...m, [w.dayOffset]: { ...m[w.dayOffset], title: e.target.value } }))}
                              className="h-7 text-xs" placeholder="כותרת" dir="rtl"/>
                            <Input value={displayNotes} onChange={e => setPlanEditMap(m => ({ ...m, [w.dayOffset]: { ...m[w.dayOffset], notes: e.target.value } }))}
                              className="h-7 text-xs" placeholder="הערת מאמן" dir="rtl"/>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                <Button onClick={handleApprovePlan} disabled={approvingPlan} className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-bold mt-2">
                  {approvingPlan && <Loader2 className="h-4 w-4 animate-spin mr-2"/>}
                  אשר ושלח לספורטאי ✅
                </Button>
              </CardContent>
            </Card>
          )
        })()}
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
                <Label className="text-xs font-semibold">הערת מאמן אישית</Label>
                <Textarea
                  value={weeklyCoachNote}
                  onChange={e => setWeeklyCoachNote(e.target.value)}
                  className="text-xs min-h-[80px]"
                  placeholder="הוסף הערה אישית לספורטאי..."
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
                <Plus className="h-3 w-3 mr-1"/>צור חדש
              </Button>
            </div>
            {selectedDate && <p className="text-xs text-muted-foreground mt-1">{format(selectedDate,'EEEE, d MMMM')}</p>}
            <div className="relative mt-2">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
              <Input value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} placeholder="חיפוש אימון..." className="pl-7 h-7 text-xs" dir="auto"/>
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
            {/* Training paces - editable */}
            <div>
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

      {/* Full Workout Builder Dialog */}
      <Dialog open={showBuilderDialog} onOpenChange={(open) => { if (!open) { setShowBuilderDialog(false); setBuilderWorkoutId(undefined) } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{builderWorkoutId ? 'ערוך אימון' : 'צור אימון חדש'}</DialogTitle>
          </DialogHeader>
          {showBuilderDialog && (
            <WorkoutBuilder
              workoutId={builderWorkoutId}
              hideBackButton
              onDone={async () => {
                const wid = builderWorkoutId
                const aid = editingAssignedId
                setShowBuilderDialog(false)
                setBuilderWorkoutId(undefined)
                setEditingAssignedId(null)
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
                setWorkoutLibrary(wLibSnap.docs.map(d => ({ ...(d.data() as Workout), id: d.id })))
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
