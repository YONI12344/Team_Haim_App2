'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
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
import { db } from '@/lib/firebase'
import {
  collection, doc, getDoc, getDocs, query,
  where, addDoc, serverTimestamp, deleteDoc,
} from 'firebase/firestore'
import type { AthleteProfile, Workout, AssignedWorkout, TrainingDayType, WorkoutLog, WorkoutType } from '@/lib/types'
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

  // AI coaching report
  const [aiReport, setAiReport] = useState<any>(null)
  const [aiReportLoading, setAiReportLoading] = useState(false)
  // Coach messages
  const [coachMessageText, setCoachMessageText] = useState('')
  const [sendingCoachMessage, setSendingCoachMessage] = useState(false)

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
      toast.error('שגיאה ביצירת דוח: ' + String(err))
    } finally {
      setAiReportLoading(false)
    }
  }

  const handleSendCoachMessage = async () => {
    if (!selectedAW || !user || !coachMessageText.trim()) return
    setSendingCoachMessage(true)
    try {
      await addDoc(collection(db, 'coachMessages'), {
        athleteId,
        coachId: user.id,
        assignedWorkoutId: selectedAW.id,
        workoutTitle: selectedAW.workout?.title || 'אימון',
        message: coachMessageText.trim(),
        createdAt: serverTimestamp(),
        read: false,
      })
      setCoachMessageText('')
      toast.success('הערה נשלחה לספורטאי!')
    } catch {
      toast.error('שגיאה בשליחה')
    } finally {
      setSendingCoachMessage(false)
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
                            {dayWorkouts.map(w => {
                              const matchLog = logs.find((l: any) => l.assignedWorkoutId === w.id || (l.workoutId === w.workoutId && l.date === dateStr))
                              const isCompleted = w.status === 'completed' || !!matchLog?.actualDistance
                              return (
                                <button key={w.id}
                                  onClick={e => { e.stopPropagation(); setSelectedAssignedId(prev => prev === w.id ? null : w.id) }}
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
                                  {dayWorkouts.slice(0,3).map(w => {
                                    const mLog = logs.find((l: any) => l.assignedWorkoutId === w.id || (l.workoutId === w.workoutId && l.date === dateStr))
                                    const isDone = w.status === 'completed' || !!mLog?.actualDistance
                                    return (
                                      <button key={w.id}
                                        onClick={e => { e.stopPropagation(); setSelectedAssignedId(prev => prev === w.id ? null : w.id) }}
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

              {/* Coach message to athlete */}
              <div className="space-y-1.5 border-t pt-3" dir="rtl">
                <Label className="text-xs font-semibold text-navy">הערת מאמן לספורטאי</Label>
                <Textarea
                  value={coachMessageText}
                  onChange={e => setCoachMessageText(e.target.value)}
                  placeholder="כתוב הערה אישית לספורטאי על אימון זה..."
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

        {/* AI Coaching Report */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-gold"/>
              דוח ניתוח AI
            </CardTitle>
          </CardHeader>
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
                        { label: 'שבוע 1', text: aiReport.week1Analysis },
                        { label: 'שבוע 2', text: aiReport.week2Analysis },
                        { label: 'שבוע 3', text: aiReport.week3Analysis },
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
