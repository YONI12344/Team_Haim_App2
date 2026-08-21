'use client'

import { useEffect, useState, useMemo, useCallback, type DragEvent } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import {
  ArrowLeft, ChevronLeft, ChevronRight, Plus, X,
  Loader2, Clock, Check, Calendar, Copy, Pencil, Trash2, ClipboardPaste,
  BarChart2, Sparkles, Send, FlaskConical, Target, NotebookPen, User, Eye, AlertTriangle,
  ClipboardList, Repeat, Folder, ZoomIn, ZoomOut,
} from 'lucide-react'
import Link from 'next/link'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, addDays, eachDayOfInterval, eachWeekOfInterval, isSameMonth,
  isSameDay, isToday,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { db, realtimeDb } from '@/lib/firebase'
import { ref, push } from 'firebase/database'
import {
  collection, doc, getDoc, getDocs, query,
  where, addDoc, serverTimestamp, deleteDoc, updateDoc, writeBatch,
} from 'firebase/firestore'
import type { AthleteProfile, Workout, AssignedWorkout, TrainingDayType, WorkoutLog, WorkoutType, JourneyDoc, JourneyStage, Lead, ExperienceLevel } from '@/lib/types'
import { occurrenceDates, isDownWeekFor, MAX_OCCURRENCES, type RepeatFrequency } from '@/lib/recurrence'
import { sortBySession } from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import { listJourneys, computeJourneyProgress, saveJourney, stageDisplayName, isRestWeek } from '@/lib/journey'
import { useAuth } from '@/contexts/auth-context'
import { useWorkoutTypeLabels, autoWorkoutTitle } from '@/lib/workout-labels'
import { secToPace } from '@/lib/physiology'
import { WorkoutBuilder } from '@/components/coach/workout-builder'
import { LinkedRoutinesEditor, type LinkedRoutine } from '@/components/coach/linked-routines-editor'
import { AthletePlannerView } from '@/components/athlete/athlete-planner-view'
import { useLanguage } from '@/contexts/language-context'
import { toast } from 'sonner'
import { MarkDayOffDialog } from '@/components/shared/mark-day-off-dialog'
import { useDaysOff } from '@/hooks/useDaysOff'

type RoutineTypeRule = { id: string; types: WorkoutType[]; routines: LinkedRoutine[] }

const ALL_WORKOUT_TYPES: WorkoutType[] = [
  'easy', 'long_run', 'tempo', 'intervals', 'hill_repeats', 'fartlek',
  'recovery', 'strength', 'stretch', 'cross_training', 'swim', 'bike',
  'rest', 'race', 'time_trial', 'threshold',
]

const WEEKDAY_KEYS = [
  'sunday','monday','tuesday','wednesday','thursday','friday','saturday',
] as const

// No single running session realistically exceeds this — catches obvious
// data-entry typos (e.g. 150 instead of 15) so they jump out while scanning.
const SUSPICIOUS_DISTANCE_KM = 60
const isSuspiciousDistance = (d?: number | null) => d != null && d > SUSPICIOUS_DISTANCE_KM

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

  // Week/month grid zoom — a real two-finger pinch gesture on a nested
  // horizontal-scroll grid is unreliable across phones/browsers (fights
  // with the scroll container, no native support for scaling just one
  // element), so this is a manual scale control instead: reliable
  // everywhere, same "bigger/smaller" outcome. Native page pinch-zoom
  // still works too — nothing in this app disables it.
  const [gridZoom, setGridZoom] = useState(1)
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  // Full active journey — powers season-aware planning in the month view
  const [activeJourney, setActiveJourney] = useState<JourneyDoc | null>(null)
  // All of this athlete's journeys — kept for the "repeat this workout"
  // control's down-week skip (isDownWeekFor needs the full list, not just
  // whichever one is active today, since a repeat can run for months).
  const [allJourneys, setAllJourneys] = useState<JourneyDoc[]>([])
  // All athletes — for the quick switcher in the header
  const [allAthletes, setAllAthletes] = useState<{ id: string; name: string }[]>([])
  // This athlete's default routine links (warm-up/activation/cooldown) —
  // auto-applied to any workout assigned to them that doesn't already
  // carry its own linkedRoutines. Edited as a local draft with its own
  // Save button since it's a list of text fields, not a single toggle.
  const [defaultRoutinesDraft, setDefaultRoutinesDraft] = useState<LinkedRoutine[]>([])
  // Per-workout-type rules — e.g. easy/long_run/recovery get one lighter
  // warm-up, tempo/intervals/hill_repeats/fartlek/threshold get another
  // with more activation drills. First matching rule wins; the flat
  // default above is the fallback for any type no rule covers.
  const [routineRulesDraft, setRoutineRulesDraft] = useState<RoutineTypeRule[]>([])
  const [savingDefaultRoutines, setSavingDefaultRoutines] = useState(false)
  const [routineOptions, setRoutineOptions] = useState<Workout[]>([])

  useEffect(() => {
    getDocs(collection(db, 'workouts')).then((snap) => {
      const options = snap.docs
        .map((d) => ({ ...(d.data() as Workout), id: d.id }))
        .filter((w) => w.type === 'stretch' && !w.libraryHidden)
        .sort((a, b) => (b.isWarmup ? 1 : 0) - (a.isWarmup ? 1 : 0) || a.title.localeCompare(b.title))
      setRoutineOptions(options)
    }).catch((err) => console.error('Error loading routine options:', err))
  }, [])

  useEffect(() => {
    setDefaultRoutinesDraft(athlete?.defaultLinkedRoutines || [])
    setRoutineRulesDraft(athlete?.defaultLinkedRoutinesByType || [])
  }, [athlete?.defaultLinkedRoutines, athlete?.defaultLinkedRoutinesByType])

  const saveDefaultRoutines = async () => {
    setSavingDefaultRoutines(true)
    try {
      const complete = defaultRoutinesDraft.filter((l) => l.workoutId && l.label.trim())
      const completeRules = routineRulesDraft
        .map((r) => ({ ...r, routines: r.routines.filter((l) => l.workoutId && l.label.trim()) }))
        .filter((r) => r.types.length > 0 && r.routines.length > 0)
      const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
      await ud(dc(db, 'users', athleteId), { defaultLinkedRoutines: complete, defaultLinkedRoutinesByType: completeRules })
      setAthlete((prev) => (prev ? { ...prev, defaultLinkedRoutines: complete, defaultLinkedRoutinesByType: completeRules } : prev))

      // Retroactively resync already-scheduled FUTURE workouts too — a
      // default only auto-applies at the moment a workout is assigned
      // (see withAthleteDefaultRoutines), so without this a coach saving
      // a changed rule would have to re-assign everything already on the
      // schedule just to see it take effect. Covers three cases:
      //  - empty slot -> a rule now matches: fill it in
      //  - was filled FROM a default, rule changed: update to the new routines
      //  - was filled FROM a default, rule removed/no longer matches: clear it
      // Never touches a workout whose routines the coach set directly on
      // the template itself (linkedRoutinesFromDefault stays unset/false
      // for those) — only ones this same default system put there.
      const pickDefaultFor = (type: WorkoutType) => {
        const rule = completeRules.find((r) => r.types.includes(type))
        if (rule?.routines.length) return rule.routines
        return complete.length ? complete : null
      }
      const todayStr = format(new Date(), 'yyyy-MM-dd')
      const toResync = assignedWorkouts.filter((aw) =>
        aw.status === 'scheduled' && aw.scheduledDate >= todayStr
        && (!aw.workout.linkedRoutines?.length || aw.linkedRoutinesFromDefault === true),
      )
      let patchedCount = 0
      let clearedCount = 0
      const resolvedById = new Map<string, { routines: LinkedRoutine[] | null }>()
      for (const aw of toResync) {
        const routines = pickDefaultFor(aw.workout.type)
        resolvedById.set(aw.id, { routines })
        if (routines) {
          await ud(dc(db, 'assignedWorkouts', aw.id), { 'workout.linkedRoutines': routines, linkedRoutinesFromDefault: true })
          patchedCount++
        } else if (aw.linkedRoutinesFromDefault) {
          await ud(dc(db, 'assignedWorkouts', aw.id), { 'workout.linkedRoutines': [], linkedRoutinesFromDefault: false })
          clearedCount++
        }
      }
      if (patchedCount > 0 || clearedCount > 0) {
        setAssignedWorkouts((prev) => prev.map((aw) => {
          const resolved = resolvedById.get(aw.id)
          if (!resolved) return aw
          return resolved.routines
            ? { ...aw, workout: { ...aw.workout, linkedRoutines: resolved.routines }, linkedRoutinesFromDefault: true }
            : { ...aw, workout: { ...aw.workout, linkedRoutines: [] }, linkedRoutinesFromDefault: false }
        }))
      }

      // A row missing a workout type, a chosen routine, or a title gets
      // silently dropped by the filters above (Firestore has nowhere to
      // put an incomplete rule) — surface that instead of a blanket
      // "saved" toast, so an incomplete row doesn't just vanish unnoticed.
      const droppedFlat = defaultRoutinesDraft.length - complete.length
      const droppedRules = routineRulesDraft.length - completeRules.length
      const syncNote = [
        patchedCount > 0 ? `עודכנו ${patchedCount}` : '',
        clearedCount > 0 ? `הוסרו מ-${clearedCount}` : '',
      ].filter(Boolean).join(' · ')
      if (droppedFlat > 0 || droppedRules > 0) {
        toast.warning(`נשמר, אבל ${droppedFlat + droppedRules} שורות לא נשמרו — חסר בהן סוג אימון, שגרה, או כותרת`)
      } else {
        toast.success(`שגרות ברירת המחדל נשמרו${syncNote ? ` · ${syncNote} אימונים שכבר משובצים` : ''}`)
      }
    } catch (err) {
      console.error('Error saving default routines:', err)
      toast.error('שמירה נכשלה')
    } finally {
      setSavingDefaultRoutines(false)
    }
  }

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
  // "Armed" bank workout — click a workout in the folder browser, then
  // click any day on the calendar to place it there (same two-tap pattern
  // as the copiedWorkout paste flow above, so it also works without drag,
  // which plain HTML5 drag-and-drop doesn't support on touch devices).
  const [armedBankWorkout, setArmedBankWorkout] = useState<Workout | null>(null)

  // "Repeat this workout" — opened from the already-scheduled workout's
  // detail header (clicking a day that has a workout), not from the drag
  // itself, so a drag-drop stays a single simple placement.
  const [showRepeatPanel, setShowRepeatPanel] = useState(false)
  const [repeatFrequency, setRepeatFrequency] = useState<RepeatFrequency>('weekly')
  const [repeatUntil, setRepeatUntil] = useState('')
  const [repeatSkipDownWeeks, setRepeatSkipDownWeeks] = useState(true)
  const [repeatSaving, setRepeatSaving] = useState(false)

  // AI coaching report — collapsed by default to keep the screen clean
  const [aiReport, setAiReport] = useState<any>(null)
  const [aiReportLoading, setAiReportLoading] = useState(false)
  const [showAiSection, setShowAiSection] = useState(false)

  // Original application ("apply" form) data — only lives in the `leads`
  // collection; auth-context.tsx only copies a handful of structured
  // fields onto the athlete's own profile on conversion; everything else
  // (goals, lifestyle, facilities, devices...) only exists here. Fetched
  // by email once the athlete profile itself has loaded, collapsed by
  // default same as the AI report above.
  const [leadData, setLeadData] = useState<Lead | null>(null)
  const [leadLoading, setLeadLoading] = useState(false)
  const [showLeadSection, setShowLeadSection] = useState(false)
  useEffect(() => {
    if (!athlete?.email) return
    let cancelled = false
    setLeadLoading(true)
    // Plain equality filter only (no orderBy) — combining it with a sort
    // on a different field would need a composite index; sorting the
    // handful of matches client-side avoids that entirely.
    getDocs(query(collection(db, 'leads'), where('email', '==', athlete.email)))
      .then((snap) => {
        if (cancelled) return
        if (snap.empty) { setLeadData(null); return }
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead))
        docs.sort((a, b) => (b.createdAt as any)?.toMillis?.() - (a.createdAt as any)?.toMillis?.() || 0)
        setLeadData(docs[0])
      })
      .catch((err) => console.error('Error loading application data:', err))
      .finally(() => { if (!cancelled) setLeadLoading(false) })
    return () => { cancelled = true }
  }, [athlete?.email])

  // Workout Bank side panel — this athlete's own level's bank, draggable
  // onto the calendar. Level itself is stored on the athlete profile
  // (same experienceLevel field used by the assign page's level filter).
  const [bankWorkouts, setBankWorkouts] = useState<Workout[]>([])
  // Which type-folders are expanded, e.g. { easy: true } — folders start
  // closed so the browser stays compact under the calendar.
  const [openBankFolders, setOpenBankFolders] = useState<Record<string, boolean>>({})
  useEffect(() => {
    if (!athlete?.experienceLevel) { setBankWorkouts([]); return }
    getDocs(query(collection(db, 'workouts'), where('bankLevel', '==', athlete.experienceLevel)))
      .then((snap) => setBankWorkouts(snap.docs.map((d) => ({ ...(d.data() as Workout), id: d.id }))))
      .catch((err) => console.error('Error loading bank workouts:', err))
  }, [athlete?.experienceLevel])

  const setAthleteLevel = async (level: ExperienceLevel) => {
    if (!athlete) return
    setAthlete({ ...athlete, experienceLevel: level })
    try {
      await updateDoc(doc(db, 'users', athleteId), { experienceLevel: level })
    } catch (err) {
      console.error('Error saving athlete level:', err)
      toast.error('שמירת הרמה נכשלה')
    }
  }

  // Native HTML5 drag-and-drop (no library in this repo) — a bank card
  // sets its workout id as the drag payload; a calendar day cell reads it
  // back on drop and assigns via the exact same path as the quick-assign
  // dialog (assignWorkoutToDate below).
  const handleBankDragStart = (e: DragEvent, workout: Workout) => {
    e.dataTransfer.setData('text/plain', workout.id)
    e.dataTransfer.effectAllowed = 'copy'
  }
  const handleDayDrop = (e: DragEvent, dateStr: string) => {
    e.preventDefault()
    const workoutId = e.dataTransfer.getData('text/plain')
    const workout = bankWorkouts.find((w) => w.id === workoutId)
    if (workout) assignWorkoutToDate(workout, dateStr)
  }

  // Quick-assign sheet — opens when the coach taps a day on the calendar
  const [quickAssignDate, setQuickAssignDate] = useState<Date | null>(null)
  const { dayOffFor, markDayOff, removeDayOff } = useDaysOff(athleteId)
  const [markDayOffOpen, setMarkDayOffOpen] = useState(false)
  const [markDayOffDate, setMarkDayOffDate] = useState<string>(() => format(new Date(), 'yyyy-MM-dd'))
  const [qaType, setQaType] = useState<WorkoutType | null>(null)
  const [qaTitle, setQaTitle] = useState('')
  const [qaDistance, setQaDistance] = useState('')
  const [qaDuration, setQaDuration] = useState('')
  const [qaDesc, setQaDesc] = useState('')
  const [qaSession, setQaSession] = useState<'am' | 'pm' | 'other'>('am')
  const [qaSaving, setQaSaving] = useState(false)
  const [qaSearch, setQaSearch] = useState('')
  const [qaShowCreate, setQaShowCreate] = useState(false)

  const resetQuickAssign = () => {
    setQaType(null); setQaTitle(''); setQaDistance(''); setQaDuration(''); setQaDesc(''); setQaSearch(''); setQaShowCreate(false)
  }

  // Smart default session for a new workout on the tapped day: first
  // workout of the day → morning, second → evening, third+ → other
  useEffect(() => {
    if (!quickAssignDate) return
    const dateStr = format(quickAssignDate, 'yyyy-MM-dd')
    const count = assignedWorkouts.filter(w => w.scheduledDate === dateStr).length
    setQaSession(count === 0 ? 'am' : count === 1 ? 'pm' : 'other')
  }, [quickAssignDate, assignedWorkouts])
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
            experienceLevel: d.experienceLevel,
            weekSchedule: d.weekSchedule,
            weeklyKmRange: d.weeklyKmRange,
            offWeekInterval: d.offWeekInterval,
            offWeekAnchorDate: d.offWeekAnchorDate,
            targetPaceKm: d.targetPaceKm,
            physiology: d.physiology,
            labVisibleToAthlete: d.labVisibleToAthlete === true,
            strengthToolsVisibleToAthlete: d.strengthToolsVisibleToAthlete === true,
            injuryToolsVisibleToAthlete: d.injuryToolsVisibleToAthlete === true,
            defaultLinkedRoutines: Array.isArray(d.defaultLinkedRoutines) ? d.defaultLinkedRoutines : [],
            defaultLinkedRoutinesByType: Array.isArray(d.defaultLinkedRoutinesByType) ? d.defaultLinkedRoutinesByType : [],
            coachPrivateNotes: d.coachPrivateNotes || '',
            visibleWeeksAhead: typeof d.visibleWeeksAhead === 'number' ? d.visibleWeeksAhead : 2,
            weekStartDay: d.weekStartDay === 1 ? 1 : 0,
            kmWeekStartDay: d.kmWeekStartDay === 0 ? 0 : 1,
            createdAt: d.createdAt?.toDate?.() || new Date(),
            updatedAt: d.updatedAt?.toDate?.() || new Date(),
          })

          // Journey
          const today = new Date()
          const journeys = await listJourneys(athleteId)
          setAllJourneys(journeys)
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
                isOffWeek: isRestWeek(today, offN, d.offWeekAnchorDate, stage.startDate),
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
      isDownWeek = isRestWeek(mid, offN, athlete?.offWeekAnchorDate, stage.startDate)
    }
    const baseTarget = stage?.weeklyVolumeKm
      ?? (athlete?.weeklyKmRange ? Math.round((athlete.weeklyKmRange.min + athlete.weeklyKmRange.max) / 2) : null)
    const targetKm = baseTarget != null ? (isDownWeek ? Math.round(baseTarget * 0.7) : baseTarget) : null
    const meta = stage ? (STAGE_META[stage.type] || STAGE_META.custom) : null
    return { stage, meta, weeksToRace, isDownWeek, targetKm }
  }, [activeJourney, athlete])

  /**
   * Weekly km target for coloring the KM total, even without an active
   * journey — falls back to the athlete's plain weeklyKmRange average so
   * every athlete gets on-track feedback, not just ones with a full season
   * plan configured.
   */
  const getWeekTargetKm = useCallback((wkStart: Date): number | null => {
    const info = getWeekSeasonInfo(wkStart)
    if (info?.targetKm != null) return info.targetKm
    return athlete?.weeklyKmRange
      ? Math.round((athlete.weeklyKmRange.min + athlete.weeklyKmRange.max) / 2)
      : null
  }, [getWeekSeasonInfo, athlete])

  /**
   * Moves the recurring rest-week cadence to re-anchor at `wkStart` —
   * vacation, illness, fatigue, etc. That week (and every offWeekInterval
   * weeks before/after it) becomes the recovery week going forward,
   * replacing the old fixed count from the journey stage's start date.
   */
  const handleSetRestWeek = async (wkStart: Date) => {
    const dateStr = format(wkStart, 'yyyy-MM-dd')
    try {
      await updateDoc(doc(db, 'users', athleteId), { offWeekAnchorDate: dateStr })
      setAthlete(prev => prev ? { ...prev, offWeekAnchorDate: dateStr } : prev)
      toast.success('שבוע זה סומן כשבוע המנוחה — הקצב יתעדכן בהתאם')
    } catch (e) {
      console.error(e)
      toast.error('שמירה נכשלה')
    }
  }

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
    return sortBySession(assignedWorkouts.filter(w => w.scheduledDate === s))
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
      // A workout the coach hand-builds for a specific real athlete right
      // here is exactly what the Workout Bank wants — "a real, coach-
      // authored session" (see lib/types.ts Workout.bankLevel) — so it's
      // auto-tagged at this athlete's level instead of staying invisible
      // to the Bakken generator until someone remembers to add it by hand.
      const autoBankLevel = athlete?.experienceLevel || null
      const ref = await addDoc(collection(db, 'workouts'), {
        title: finalTitle, type: newWO.type,
        description: newWO.description.trim(),
        distance: newWO.distance ? Number(newWO.distance) : null,
        duration: newWO.duration ? Number(newWO.duration) : null,
        notes: newWO.notes.trim() || null,
        bankLevel: autoBankLevel,
        createdBy: user?.id || null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      const created: Workout = {
        id: ref.id, title: finalTitle, type: newWO.type,
        description: newWO.description.trim(),
        distance: newWO.distance ? Number(newWO.distance) : undefined,
        duration: newWO.duration ? Number(newWO.duration) : undefined,
        notes: newWO.notes.trim() || undefined,
        ...(autoBankLevel ? { bankLevel: autoBankLevel } : {}),
        createdBy: user?.id || '', createdAt: new Date(), updatedAt: new Date(),
      }
      setWorkoutLibrary(prev => [created, ...prev])
      // Auto-assign to selected date if one is selected
      if (selectedDate && user) {
        const dateStr = format(selectedDate, 'yyyy-MM-dd')
        const assignedWorkout = withAthleteDefaultRoutines(created)
        const appliedDefault = !!assignedWorkout.linkedRoutines?.length
        const assignRef = await addDoc(collection(db, 'assignedWorkouts'), {
          workoutId: ref.id,
          workout: assignedWorkout,
          athleteId,
          assignedBy: user.id || null,
          scheduledDate: dateStr,
          status: 'scheduled',
          linkedRoutinesFromDefault: appliedDefault,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        setAssignedWorkouts(prev => [...prev, {
          id: assignRef.id,
          workoutId: ref.id,
          workout: assignedWorkout,
          athleteId,
          assignedBy: user.id || '',
          scheduledDate: dateStr,
          status: 'scheduled',
          linkedRoutinesFromDefault: appliedDefault,
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

  const handleRemove = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'assignedWorkouts', id))
      setAssignedWorkouts(prev => prev.filter(w => w.id !== id))
      toast.success('Workout removed')
    } catch {
      toast.error('Failed to remove')
    }
  }

  /** A workout template with no routine links of its own inherits this
   *  athlete's default (set above) at the moment it's assigned — the
   *  template itself is untouched, only the snapshot embedded on the new
   *  assignedWorkouts doc gets the default filled in. A template that
   *  already has its own linkedRoutines (e.g. a hard-day template linked
   *  to specific activation drills) always wins over the athlete default. */
  const withAthleteDefaultRoutines = (workout: Workout): Workout => {
    if (workout.linkedRoutines?.length) return workout
    const rule = athlete?.defaultLinkedRoutinesByType?.find((r) => r.types.includes(workout.type))
    if (rule?.routines.length) return { ...workout, linkedRoutines: rule.routines }
    if (!athlete?.defaultLinkedRoutines?.length) return workout
    return { ...workout, linkedRoutines: athlete.defaultLinkedRoutines }
  }

  /** Assign an existing library workout to a specific date (used by the quick-assign sheet) */
  const assignWorkoutToDate = async (workoutIn: Workout, dateStr: string, session?: 'am' | 'pm' | 'other') => {
    if (!user) return
    const workout = withAthleteDefaultRoutines(workoutIn)
    const appliedDefault = !workoutIn.linkedRoutines?.length && !!workout.linkedRoutines?.length
    // Same auto-bank-tagging as handleCreateWorkout below, for the other
    // path a workout reaches an athlete: picking an existing library
    // template that was never explicitly leveled. Only fills a gap —
    // never overrides a level the coach already set on purpose.
    if (!workout.bankLevel && athlete?.experienceLevel) {
      updateDoc(doc(db, 'workouts', workout.id), { bankLevel: athlete.experienceLevel }).catch((err) =>
        console.error('Error auto-tagging workout bank level:', err),
      )
    }
    // Session only matters once the day ends up with more than one workout —
    // a lone workout can happen any time, no need to tag it AM/PM
    const willBeMultiWorkoutDay = assignedWorkouts.some(w => w.scheduledDate === dateStr)
    const finalSession = willBeMultiWorkoutDay ? session : undefined
    const ref = await addDoc(collection(db, 'assignedWorkouts'), {
      workoutId: workout.id,
      workout,
      athleteId,
      assignedBy: user.id || null,
      scheduledDate: dateStr,
      status: 'scheduled',
      session: finalSession || null,
      linkedRoutinesFromDefault: appliedDefault,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    setAssignedWorkouts(prev => [...prev, {
      id: ref.id, workoutId: workout.id, workout, athleteId,
      assignedBy: user.id || '', scheduledDate: dateStr, status: 'scheduled', session: finalSession,
      linkedRoutinesFromDefault: appliedDefault,
      createdAt: new Date(), updatedAt: new Date(),
    } as AssignedWorkout])
  }

  /** Repeat an already-scheduled workout weekly/every-other-week onto
   *  future dates. The clicked instance itself is left untouched — this
   *  only adds new assignedWorkouts docs from the next occurrence on. */
  const handleRepeatWorkout = async () => {
    if (!user || !athlete || !selectedAW || !selectedDate || repeatFrequency === 'none' || !repeatUntil) return
    setRepeatSaving(true)
    try {
      const until = new Date(repeatUntil)
      const dates = occurrenceDates(selectedDate, repeatFrequency, until).slice(1) // skip the original instance
      const batch = writeBatch(db)
      let count = 0
      for (const date of dates) {
        if (repeatSkipDownWeeks && isDownWeekFor(athlete, allJourneys, date)) continue
        const dateStr = format(date, 'yyyy-MM-dd')
        const alreadyThere = assignedWorkouts.some(w => w.scheduledDate === dateStr && w.workoutId === selectedAW.workoutId)
        if (alreadyThere) continue
        const ref = doc(collection(db, 'assignedWorkouts'))
        batch.set(ref, {
          workoutId: selectedAW.workoutId,
          workout: selectedAW.workout,
          athleteId,
          assignedBy: user.id || null,
          scheduledDate: dateStr,
          status: 'scheduled',
          session: null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        count++
      }
      if (count === 0) {
        toast.error('לא נוצרו מופעים חדשים (כולם כבר קיימים או נופלים בשבועות פריקה)')
        return
      }
      await batch.commit()
      // Refresh from Firestore rather than reconstructing locally — simplest
      // way to get real ids/timestamps for the newly written docs.
      const snap = await getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId)))
      setAssignedWorkouts(snap.docs.map(d => ({ id: d.id, ...d.data() } as AssignedWorkout)))
      toast.success(`נוספו ${count} מופעים חוזרים`)
      setShowRepeatPanel(false)
      setRepeatUntil('')
    } catch (err) {
      console.error('Error repeating workout:', err)
      toast.error('שגיאה בשכפול האימון החוזר')
    } finally {
      setRepeatSaving(false)
    }
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
      await assignWorkoutToDate(created, format(quickAssignDate, 'yyyy-MM-dd'), qaSession)
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
  // Grouped into a handful of meaningful colors instead of one hue per type,
  // so color signals something (effort level / day type) at a glance:
  // easy & recovery = calm green, long run = orange, hard efforts = amber,
  // race day = brand gold, everything supplementary = neutral slate.
  const TYPE_COLORS: Record<string, string> = {
    easy: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    recovery: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    long_run: 'bg-orange-100 text-orange-700 border-orange-200',
    tempo: 'bg-amber-100 text-amber-700 border-amber-200',
    threshold: 'bg-pink-100 text-pink-700 border-pink-200',
    intervals: 'bg-amber-100 text-amber-700 border-amber-200',
    hill_repeats: 'bg-amber-100 text-amber-700 border-amber-200',
    fartlek: 'bg-amber-100 text-amber-700 border-amber-200',
    race: 'bg-gold/15 text-navy border-gold/40',
    time_trial: 'bg-gold/15 text-navy border-gold/40',
    strength: 'bg-slate-100 text-slate-600 border-slate-200',
    cross_training: 'bg-slate-100 text-slate-600 border-slate-200',
    swim: 'bg-slate-100 text-slate-600 border-slate-200',
    bike: 'bg-slate-100 text-slate-600 border-slate-200',
    rest: 'bg-muted text-muted-foreground',
  }
  // Same groups as TYPE_COLORS, reduced to a small solid dot — used on the
  // dark-navy calendar cell badges (matching the athlete's own workout-card
  // hero style) where a full pastel background would fight the dark bg
  // instead of the type still needing to read at a glance.
  const TYPE_DOT_COLORS: Record<string, string> = {
    easy: 'bg-emerald-400', recovery: 'bg-emerald-400',
    long_run: 'bg-orange-400',
    tempo: 'bg-amber-400', intervals: 'bg-amber-400', hill_repeats: 'bg-amber-400', fartlek: 'bg-amber-400',
    threshold: 'bg-pink-400',
    race: 'bg-gold', time_trial: 'bg-gold',
    strength: 'bg-slate-400', cross_training: 'bg-slate-400', swim: 'bg-slate-400', bike: 'bg-slate-400',
    rest: 'bg-slate-500',
  }

  // Mirrors athlete-planner-view.tsx's renderWorkoutDetail structure and
  // wording EXACTLY (set headers, intervals, both rest kinds, warmup/
  // cooldown labels) — just shrunk to tiny font for the calendar badge,
  // never reworded or restructured, so the coach reads the identical
  // content the athlete will see, not a different summary of it. Always
  // rtl — this app's workout content is Hebrew by default, and wrapping
  // the whole block in ltr (the earlier bug) scrambled embedded Hebrew
  // rest/warmup/cooldown text.
  const renderCompactWorkoutDetail = (workout: any) => {
    if (!workout) return null
    return (
      <div className="w-full min-w-0 space-y-0.5" dir="rtl">
        {workout.description && (
          <p className="opacity-90 font-medium text-[6px] leading-[7px] break-words">{workout.description}</p>
        )}
        {workout.warmup && (
          <p className="opacity-60 text-[6px] leading-[7px] break-words">{t.warmupLabel}: {workout.warmup}</p>
        )}
        {workout.sets?.map((set: any, si: number) => {
          const hasIntervals = set.intervals && set.intervals.length > 0
          const isLastSet = si === workout.sets.length - 1
          return (
            <div key={set.id || si} className="space-y-0.5">
              <p className="font-bold opacity-95 text-[6.5px] leading-[7.5px] break-words">
                {t.setLabelPrefix} {si + 1}
                {set.reps > 1 && !hasIntervals && ` · ${set.reps}× ${set.distance || set.duration || ''}`}
                {!hasIntervals && !(set.reps > 1) && (set.distance || set.duration) && ` · ${set.distance || set.duration}`}
                {hasIntervals && set.reps > 1 && ` · ${set.reps}×`}
                {set.pace && ` @ ${set.pace}`}
              </p>
              {hasIntervals && set.intervals.map((iv: any, ii: number) => (
                <p key={iv.id || ii} className="opacity-80 text-[6px] leading-[7px] break-words pr-1.5">
                  {ii + 1}. {iv.distance || iv.duration}{iv.pace ? ` @ ${iv.pace}` : ''}{iv.rest ? ` — ${t.restPrefix} ${iv.rest}` : ''}
                </p>
              ))}
              {(set.reps || 1) > 1 && set.restBetweenReps && (
                <p className="opacity-50 text-[6px] leading-[7px]">{t.restBetweenReps}: {set.restBetweenReps}</p>
              )}
              {!isLastSet && (
                <p className="opacity-50 text-[6px] leading-[7px]">{set.restAfterSet ? `${t.restBetweenSets}: ${set.restAfterSet}` : t.continueToNext}</p>
              )}
            </div>
          )
        })}
        {!!workout.strengthBlocks?.length && workout.strengthBlocks.map((b: any) => (
          <p key={b.id} className="opacity-90 font-medium text-[6px] leading-[7px] break-words">{b.label}: {b.exercises.map((ex: any) => ex.name).join(', ')}</p>
        ))}
        {workout.cooldown && (
          <p className="opacity-60 text-[6px] leading-[7px] break-words">{t.cooldownLabel}: {workout.cooldown}</p>
        )}
      </div>
    )
  }

  // Quick-assign sheet: type picker order + emoji
  const QUICK_TYPES: WorkoutType[] = [
    'easy', 'threshold', 'intervals', 'tempo', 'long_run', 'hill_repeats', 'fartlek',
    'recovery', 'strength', 'swim', 'bike', 'race', 'time_trial',
  ]
  const TYPE_EMOJI: Record<string, string> = {
    easy: '🏃', threshold: '🎯', intervals: '🔁', tempo: '⚡', long_run: '🛣️', hill_repeats: '⛰️',
    fartlek: '🎲', recovery: '🌿', strength: '🏋️', cross_training: '🔀',
    swim: '🏊', bike: '🚴', race: '🏁', time_trial: '⏱️', rest: '😴',
  }

  // Session labels for days with more than one workout (run AM, gym PM...)
  const SESSION_LABELS: Record<'am' | 'pm' | 'other', { emoji: string; label: string }> = {
    am: { emoji: '🌅', label: 'בוקר' },
    pm: { emoji: '🌇', label: 'ערב' },
    other: { emoji: '🕐', label: 'נוסף' },
  }

  const getWorkoutsForDate2 = useCallback((dateStr: string) =>
    sortBySession(assignedWorkouts.filter(w => w.scheduledDate === dateStr))
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

  /** Delete every assigned workout in the week starting at `weekStartDay` — coach-only, mirrors copyWeekTo. */
  const handleDeleteWeek = async (weekStartDay: Date) => {
    const weekEndDay = endOfWeek(weekStartDay, { weekStartsOn: calWeekStartsOn })
    const from = format(weekStartDay, 'yyyy-MM-dd')
    const to = format(weekEndDay, 'yyyy-MM-dd')
    const weekWorkouts = assignedWorkouts.filter(w => w.scheduledDate >= from && w.scheduledDate <= to)
    if (weekWorkouts.length === 0) { toast.error(t.noWorkoutsYet); return }
    if (!confirm(`למחוק ${weekWorkouts.length} אימונים משבוע ${format(weekStartDay, 'd/M')}–${format(weekEndDay, 'd/M')}? לא ניתן לבטל.`)) return
    try {
      await Promise.all(weekWorkouts.map(w => deleteDoc(doc(db, 'assignedWorkouts', w.id))))
      setAssignedWorkouts(prev => prev.filter(w => !(w.scheduledDate >= from && w.scheduledDate <= to)))
      if (selectedAssignedId && weekWorkouts.some(w => w.id === selectedAssignedId)) setSelectedAssignedId(null)
      toast.success(`✓ ${weekWorkouts.length} אימונים נמחקו משבוע ${format(weekStartDay, 'd/M')}`)
    } catch { toast.error(t.tryAgainLaterText) }
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

  // Workout Bank folder browser — one folder per workout type within the
  // athlete's level, so it reads as level (already fixed above) → type →
  // workouts, instead of one long flat list.
  const bankByType = useMemo(() => {
    const groups: Record<string, Workout[]> = {}
    for (const w of bankWorkouts) {
      if (!groups[w.type]) groups[w.type] = []
      groups[w.type].push(w)
    }
    return Object.entries(groups).sort((a, b) => a[0].localeCompare(b[0]))
  }, [bankWorkouts])

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
    <div className="space-y-4">

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
          {/* Bank level — decides which folder shows in the side panel */}
          <select
            value={athlete?.experienceLevel || ''}
            onChange={(e) => e.target.value && setAthleteLevel(e.target.value as ExperienceLevel)}
            className="h-8 text-xs rounded-lg border border-border bg-white px-2 text-navy font-semibold cursor-pointer hover:border-gold/50 transition-colors flex-shrink-0"
            title="רמת הספורטאי — קובעת איזה תיקייה בבנק האימונים מוצגת"
          >
            <option value="">רמה: לא נבחרה</option>
            <option value="beginner">מתחילים</option>
            <option value="intermediate">בינוני</option>
            <option value="advanced">מתקדם</option>
            <option value="professional">עילית</option>
          </select>
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
                <span className="flex items-center gap-1.5 text-sm font-black text-navy">
                  <Target className="h-3.5 w-3.5 text-gold"/>
                  {activeJourney.goalRaceEvent || 'תחרות מטרה'}
                </span>
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
                    שבוע ירידה
                  </span>
                )}
                {goalPaceHint && (
                  <span className="text-xs font-semibold text-navy" dir="ltr">{goalPaceHint}</span>
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

        {/* Bank-workout placement banner — mirrors the copy banner above */}
        {armedBankWorkout && (
          <div className="rounded-xl border-2 border-gold bg-gold/5 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Folder className="h-4 w-4 text-gold"/>
              <p className="text-sm font-medium text-navy">נבחר: <span className="text-gold font-bold">{armedBankWorkout.title}</span> — לחץ על יום לשיבוץ</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setArmedBankWorkout(null)}><X className="h-3.5 w-3.5"/></Button>
          </div>
        )}

        {/* Calendar + Bank folder browser side by side on desktop while
            browsing a date — the folder reserves no space until a date is
            selected, so it never blocks the schedule itself. */}
        <div className="flex flex-col lg:flex-row gap-4">
        <div className="flex-1 min-w-0">
        {/* Calendar */}
        <Card>
          <CardContent className="pt-4">
            {/* Nav + Toggle */}
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='week' ? subWeeks(d,1) : subMonths(d,1))}><ChevronLeft className="h-4 w-4"/></Button>
              <div className="flex flex-col items-center gap-1">
                <p className="font-semibold text-navy text-base">
                  {viewMode==='week' ? `${format(weekStart,'d MMM')} – ${format(weekEnd,'d MMM yyyy')}` : format(currentDate,'MMMM yyyy')}
                </p>
                <div className="flex gap-1 bg-muted rounded-full p-0.5">
                  <button onClick={() => setViewMode('week')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='week' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>שבוע</button>
                  <button onClick={() => setViewMode('month')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='month' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>חודש</button>
                </div>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='week' ? addWeeks(d,1) : addMonths(d,1))}><ChevronRight className="h-4 w-4"/></Button>
              {viewMode === 'week' && !copiedWeekStart && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setCopiedWeekStart(weekStart)}>
                  <Copy className="h-3 w-3 mr-1"/>העתק שבוע
                </Button>
              )}
              {viewMode === 'week' && !copiedWeekStart && (
                <Button variant="outline" size="sm" className="h-7 text-xs border-red-200 text-red-500 hover:bg-red-50 hover:text-red-600"
                  onClick={() => handleDeleteWeek(weekStart)}>
                  <Trash2 className="h-3 w-3 mr-1"/>מחק שבוע
                </Button>
              )}
              {viewMode === 'week' && copiedWeekStart && !isSameDay(weekStart, copiedWeekStart) && (
                <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700 text-white"
                  onClick={() => copyWeekTo(copiedWeekStart, weekStart)}>
                  <ClipboardPaste className="h-3 w-3 mr-1"/>הדבק לשבוע זה
                </Button>
              )}
              {viewMode === 'week' && (
                athlete?.offWeekAnchorDate === format(weekStart, 'yyyy-MM-dd') ? (
                  <span className="text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300 px-2.5 py-1 rounded-full">
                    🛌 שבוע המנוחה
                  </span>
                ) : (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleSetRestWeek(weekStart)}>
                    🛌 סמן כשבוע מנוחה
                  </Button>
                )
              )}
            </div>

            {/* Zoom control — bigger/smaller for the whole grid below, a
                reliable substitute for pinch-to-zoom on a nested
                horizontal-scroll grid (that gesture fights with the
                scroll container and isn't consistent across phones).
                Native page pinch-zoom still works on top of this too. */}
            {(viewMode === 'week' || viewMode === 'month') && (
              <div className="flex items-center justify-center gap-1 mb-3">
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={gridZoom <= 0.35}
                  onClick={() => setGridZoom(z => Math.max(0.35, Math.round((z - 0.15) * 100) / 100))}>
                  <ZoomOut className="h-3.5 w-3.5"/>
                </Button>
                <button onClick={() => setGridZoom(1)} className="text-[11px] text-muted-foreground w-12 text-center hover:text-navy" title="איפוס זום">
                  {Math.round(gridZoom * 100)}%
                </button>
                <Button variant="outline" size="icon" className="h-7 w-7" disabled={gridZoom >= 4}
                  onClick={() => setGridZoom(z => Math.min(4, Math.round((z + 0.15) * 100) / 100))}>
                  <ZoomIn className="h-3.5 w-3.5"/>
                </Button>
              </div>
            )}

            {/* Week View — same wide-column treatment as month view below. */}
            {viewMode === 'week' && (
              <div className="overflow-x-auto -mx-2 px-2">
                <div style={{ zoom: gridZoom }}>
                  <div className="grid gap-2 mb-2" style={{ gridTemplateColumns: 'repeat(7, minmax(190px, 1fr)) 80px' }}>
                    {DAY_LABELS.map((d,i) => <div key={i} className="text-center text-xs font-semibold text-muted-foreground py-1">{d}</div>)}
                    <div className="text-center text-xs font-semibold text-muted-foreground py-1">KM</div>
                  </div>
                  <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(7, minmax(190px, 1fr)) 80px' }}>
                    {weekDays.map((day, di) => {
                      const dateStr = format(day, 'yyyy-MM-dd')
                      const dayWorkouts = getWorkoutsForDate2(dateStr)
                      const todayFlag = isToday(day)
                      return (
                        <div key={di}
                          onClick={async () => {
                            if (copiedWorkout) handlePasteWorkout(dateStr)
                            else if (armedBankWorkout) {
                              await assignWorkoutToDate(armedBankWorkout, dateStr)
                              toast.success(`נוסף: ${armedBankWorkout.title}`)
                              setArmedBankWorkout(null)
                            }
                            else { setSelectedDate(day); resetQuickAssign(); setQuickAssignDate(day) }
                          }}
                          onDragOver={(e) => e.preventDefault()}
                          onDrop={(e) => handleDayDrop(e, dateStr)}
                          className={cn('min-h-[70px] min-w-0 rounded-xl border transition-all cursor-pointer',
                            todayFlag ? 'border-gold bg-gold/5' : 'border-border hover:border-gold/40',
                            (copiedWorkout || armedBankWorkout) ? 'hover:border-gold hover:bg-gold/5' : ''
                          )}>
                          <div className="p-1.5 border-b border-border/40 text-center">
                            <p className={cn('text-xs font-bold', todayFlag ? 'text-gold' : 'text-navy/70')}>{format(day,'d')}</p>
                          </div>
                          <div className="p-1.5 space-y-1">
                            {dayWorkouts.map(w => {
                              const matchLog = logs.find((l: any) => l.assignedWorkoutId === w.id || (l.workoutId === w.workoutId && l.date === dateStr))
                              const isCompleted = w.status === 'completed' || !!matchLog?.actualDistance
                              const suspicious = isSuspiciousDistance(w.workout?.distance)
                              // Same dark-navy gradient as the athlete's own workout-card
                              // hero (renderNavyWorkoutBlock in athlete-planner-view.tsx).
                              // Title stays a small one-liner up top; the full structure
                              // (warmup/sets/rest/cooldown/notes) is written out below it
                              // at genuinely tiny font — the grid's own zoom control (now up
                              // to 400%) is how the coach reads it, same idea as a dense
                              // spreadsheet cell you zoom into rather than one that resizes
                              // itself to fit its own content.
                              const metric = w.workout?.distance ? `${w.workout.distance}k` : w.workout?.duration ? `${w.workout.duration}'` : null
                              return (
                                <button key={w.id}
                                  dir="rtl"
                                  onClick={e => { e.stopPropagation(); setSelectedAssignedId(prev => prev === w.id ? null : w.id); setSelectedDate(day) }}
                                  className={cn('w-full text-right rounded-lg px-1.5 py-1.5 transition-all hover:opacity-90 flex flex-col gap-0.5 overflow-hidden',
                                    suspicious ? 'bg-gradient-to-br from-red-700 to-red-800 text-white' : 'bg-gradient-to-br from-[#0a1628] to-[#0a1628]/85 text-white',
                                    selectedAssignedId === w.id ? 'ring-2 ring-gold' : ''
                                  )}>
                                  <div className="w-full min-w-0 flex items-center gap-1 text-[8px]">
                                    <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', TYPE_DOT_COLORS[w.workout?.type as string] || TYPE_DOT_COLORS.easy)} />
                                    {suspicious && <AlertTriangle className="h-2.5 w-2.5 shrink-0"/>}
                                    {isCompleted && <span className="flex-shrink-0 text-emerald-400">✓</span>}
                                    <span className="flex-1 min-w-0 truncate font-bold">{w.workout?.title}</span>
                                    {metric && (
                                      <span className="flex-shrink-0 text-[7px] font-bold bg-gold text-navy px-1.5 py-0.5 rounded-full">{metric}</span>
                                    )}
                                  </div>
                                  {renderCompactWorkoutDetail(w.workout)}
                                  {(w as any).coachFeedback && (
                                    <p className="w-full min-w-0 opacity-60 text-[6px] leading-[7px] break-words" dir="rtl">מאמן: {(w as any).coachFeedback}</p>
                                  )}
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
                    {(() => {
                      const wkKm = getWeekKm2(weekDays)
                      const targetKm = getWeekTargetKm(weekStart)
                      const kmOk = targetKm ? Math.abs(wkKm - targetKm) <= targetKm * 0.1 : null
                      return (
                        <div className="flex flex-col items-center justify-center rounded-xl bg-muted/30 border border-border/30 min-h-[70px]">
                          <p className={cn('text-lg font-bold',
                            kmOk == null ? 'text-navy' : kmOk ? 'text-emerald-700' : wkKm < (targetKm || 0) ? 'text-amber-700' : 'text-red-600')}>
                            {wkKm}
                          </p>
                          <p className="text-[10px] text-muted-foreground">ק"מ</p>
                          {targetKm != null && <p className="text-[9px] text-muted-foreground">יעד {targetKm}</p>}
                        </div>
                      )
                    })()}
                  </div>
                </div>
              </div>
            )}

            {/* Month View — real card-width columns (like the athlete's own
                spreadsheet grid design), not a fixed 8-column layout
                squeezed into whatever the page happens to be wide. Scrolls
                horizontally; each day gets real reading width instead of
                cramming everything into ~60px. */}
            {viewMode === 'month' && (
              <div className="overflow-x-auto -mx-2 px-2">
                <div style={{ zoom: gridZoom }}>
                  <div className="grid gap-1 mb-1" style={{ gridTemplateColumns: 'repeat(7, minmax(170px, 1fr)) 70px' }}>
                    {DAY_LABELS.map((d,i) => <div key={i} className="text-center text-[10px] font-semibold text-muted-foreground py-1">{d}</div>)}
                    <div className="text-center text-[10px] font-semibold text-muted-foreground py-1">KM</div>
                  </div>
                  <div className="space-y-1">
                    {monthWeeks2.map((weekStartDay, wi) => {
                      const days = eachDayOfInterval({ start: weekStartDay, end: endOfWeek(weekStartDay,{weekStartsOn:calWeekStartsOn}) })
                      const wKm = getWeekKm2(days)
                      return (
                        <div key={wi} className="grid gap-1" style={{ gridTemplateColumns: 'repeat(7, minmax(170px, 1fr)) 70px' }}>
                          {days.map((day, di) => {
                            const inMonth = isSameMonth(day, currentDate)
                            const dateStr = format(day, 'yyyy-MM-dd')
                            const dayWorkouts = getWorkoutsForDate2(dateStr)
                            const todayFlag = isToday(day)
                            return (
                              <div key={di}
                                onClick={async () => {
                                  if (copiedWorkout && inMonth) handlePasteWorkout(dateStr)
                                  else if (armedBankWorkout && inMonth) {
                                    await assignWorkoutToDate(armedBankWorkout, dateStr)
                                    toast.success(`נוסף: ${armedBankWorkout.title}`)
                                    setArmedBankWorkout(null)
                                  }
                                  else if (inMonth) { setSelectedDate(day); resetQuickAssign(); setQuickAssignDate(day) }
                                }}
                                onDragOver={(e) => { if (inMonth) e.preventDefault() }}
                                onDrop={(e) => { if (inMonth) handleDayDrop(e, dateStr) }}
                                className={cn('min-h-[70px] min-w-0 rounded-lg p-1 border transition-all',
                                  !inMonth ? 'opacity-20 border-transparent' : 'border-border',
                                  todayFlag ? 'border-gold/60 bg-gold/5' : '',
                                  (copiedWorkout || armedBankWorkout) && inMonth ? 'cursor-pointer hover:border-gold' : ''
                                )}>
                                <p className={cn('text-[10px] font-semibold mb-1', todayFlag ? 'text-gold' : 'text-navy')}>{format(day,'d')}</p>
                                <div className="space-y-0.5">
                                  {dayWorkouts.slice(0,3).map(w => {
                                    const mLog = logs.find((l: any) => l.assignedWorkoutId === w.id || (l.workoutId === w.workoutId && l.date === dateStr))
                                    const isDone = w.status === 'completed' || !!mLog?.actualDistance
                                    const suspicious = isSuspiciousDistance(w.workout?.distance)
                                    // Same dark-navy hero style as the week view above.
                                    const metric = w.workout?.distance ? `${w.workout.distance}k` : w.workout?.duration ? `${w.workout.duration}'` : null
                                    return (
                                      <button key={w.id}
                                        dir="rtl"
                                        onClick={e => { e.stopPropagation(); setSelectedAssignedId(prev => prev === w.id ? null : w.id); if (inMonth) setSelectedDate(day) }}
                                        className={cn('w-full text-right rounded px-1.5 py-1.5 hover:opacity-90 flex flex-col gap-0.5 overflow-hidden',
                                          suspicious ? 'bg-gradient-to-br from-red-700 to-red-800 text-white' : 'bg-gradient-to-br from-[#0a1628] to-[#0a1628]/85 text-white',
                                          selectedAssignedId === w.id ? 'ring-1 ring-gold' : ''
                                        )}>
                                        {/* Hebrew content needs dir="rtl" + text-right — this
                                            whole grid had neither before, so Hebrew text was
                                            rendering/wrapping in the wrong direction. Click
                                            still opens the full card below (setSelectedDate
                                            above), same "exactly like the athlete sees" panel
                                            as always. Full structure written out below the
                                            title at tiny font — same zoom-to-read approach as
                                            the week view. */}
                                        <div className="w-full min-w-0 flex items-center gap-1 text-[8px]">
                                          <span className={cn('w-1.5 h-1.5 rounded-full flex-shrink-0', TYPE_DOT_COLORS[w.workout?.type as string] || TYPE_DOT_COLORS.easy)} />
                                          {suspicious && <AlertTriangle className="h-2 w-2 flex-shrink-0"/>}
                                          {isDone && <span className="flex-shrink-0 text-emerald-400">✓</span>}
                                          <span className="flex-1 min-w-0 truncate font-bold">{w.workout?.title}</span>
                                          {metric && (
                                            <span className="flex-shrink-0 text-[7px] font-bold bg-gold text-navy px-1 py-0.5 rounded-full">{metric}</span>
                                          )}
                                        </div>
                                        {renderCompactWorkoutDetail(w.workout)}
                                        {(w as any).coachFeedback && (
                                          <p className="w-full min-w-0 opacity-60 text-[6px] leading-[7px] break-words" dir="rtl">מאמן: {(w as any).coachFeedback}</p>
                                        )}
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
                            const targetKm = getWeekTargetKm(weekStartDay)
                            const kmOk = targetKm ? Math.abs(wKm - targetKm) <= targetKm * 0.1 : null
                            return (
                          <div className={cn('flex flex-col items-center justify-center gap-0.5 rounded-lg py-1',
                            si?.isDownWeek ? 'bg-amber-100/80 ring-1 ring-amber-300' : si?.meta ? si.meta.cell : 'bg-muted/30')}>
                            {si?.meta && (
                              <span className={cn('text-[8px] font-bold px-1 py-px rounded-full border leading-none', si.meta.chip)}>
                                {si.isDownWeek ? '⬇ ירידה' : si.meta.he}{si.weeksToRace != null && si.weeksToRace >= 0 ? ` · ‑${si.weeksToRace}` : ''}
                              </span>
                            )}
                            {wKm > 0 ? <><p className={cn('text-xs font-bold', kmOk == null ? 'text-navy' : kmOk ? 'text-emerald-700' : wKm < (targetKm || 0) ? 'text-amber-700' : 'text-red-600')}>{wKm}</p></> : <p className="text-[9px] text-muted-foreground">—</p>}
                            {targetKm != null && (
                              <p className="text-[8px] text-muted-foreground leading-none">יעד {targetKm}</p>
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
                            {/* Delete the whole week — coach-only, always available regardless of copy mode */}
                            {wKm > 0 && (
                              <button
                                onClick={() => handleDeleteWeek(weekStartDay)}
                                title={`מחק שבוע ${format(weekStartDay, 'd/M')}`}
                                className="w-6 h-6 rounded-md border border-red-200 bg-white text-red-400 hover:text-red-600 hover:border-red-400 flex items-center justify-center active:scale-90 transition-all">
                                <Trash2 className="h-3 w-3"/>
                              </button>
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
            )}
          </CardContent>
        </Card>
        </div>

        {/* Workout Bank folder browser — sits beside the schedule on
            desktop (only reserving width once a date is picked, so it
            never squeezes the calendar before then); stacks below it on
            small screens. One folder per workout type within the
            athlete's level (level picker is in the header above); saving
            a workout with bankLevel set to this athlete's level makes it
            show up here automatically, no extra step. Clicking a workout
            arms it — click any day on the calendar (or drag) to place it,
            same two-tap pattern as the copy/paste flow, so it also works
            without drag on touch devices. */}
        {selectedDate && (
        <div className="lg:w-80 flex-shrink-0">
          <Card className="border-gold/30 bg-gold/[0.03]">
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <Folder className="h-4 w-4 text-gold"/>
                בנק אימונים
                {athlete?.experienceLevel && (
                  <span className="text-xs font-normal text-muted-foreground">
                    — {athlete.experienceLevel === 'beginner' ? 'מתחילים' : athlete.experienceLevel === 'intermediate' ? 'בינוני' : athlete.experienceLevel === 'advanced' ? 'מתקדם' : 'עילית'}
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {!athlete?.experienceLevel ? (
                <p className="text-xs text-muted-foreground">בחרו רמה למעלה כדי לראות את הבנק המתאים.</p>
              ) : bankByType.length === 0 ? (
                <p className="text-xs text-muted-foreground">אין עדיין אימונים בבנק לרמה הזו.</p>
              ) : (
                <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1">
                  {bankByType.map(([type, items]) => (
                    <div key={type} className="rounded-lg border border-border overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setOpenBankFolders(p => ({ ...p, [type]: !p[type] }))}
                        className="w-full flex items-center justify-between px-2.5 py-2 text-xs font-semibold text-navy bg-white hover:bg-gold/5 transition-colors"
                      >
                        <span className="flex items-center gap-1.5">
                          <Folder className="h-3.5 w-3.5 text-gold"/>
                          {workoutTypeLabels?.[type as WorkoutType] || type}
                          <span className="text-muted-foreground font-normal">({items.length})</span>
                        </span>
                        <ChevronLeft className={cn('h-3.5 w-3.5 transition-transform', openBankFolders[type] && '-rotate-90')}/>
                      </button>
                      {openBankFolders[type] && (
                        <div className="px-2 pb-2 pt-1 space-y-1 bg-gold/[0.02]">
                          {items.map((w) => (
                            <div
                              key={w.id}
                              draggable
                              onDragStart={(e) => handleBankDragStart(e, w)}
                              onClick={() => setArmedBankWorkout(prev => prev?.id === w.id ? null : w)}
                              className={cn('rounded-md border bg-white px-2.5 py-1.5 text-xs cursor-pointer transition-colors',
                                armedBankWorkout?.id === w.id ? 'border-gold ring-1 ring-gold' : 'border-border hover:border-gold/50'
                              )}
                              title="לחצו לבחירה ואז על יום ביומן לשיבוץ, או גררו ישירות ליום"
                            >
                              <p className="font-medium text-navy truncate">{w.title}</p>
                              <p className="text-muted-foreground">
                                {w.duration ? `${w.duration} דק'` : ''}{w.duration && w.distance ? ' · ' : ''}{w.distance ? `${w.distance} ק"מ` : ''}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
        )}
        </div>

        {/* Athlete's exact view — the same component the athlete sees, for
            whichever date the coach last tapped on the calendar above.
            This replaced the old separate "workout detail" card entirely;
            its Copy/Edit/Delete actions now live in this card's header. */}
        {selectedDate && (
          <Card className="border-navy/15 overflow-hidden">
            {/* Slim action bar only — no separate "exactly like the athlete
                sees" title box above the workout card anymore. The actual
                dark-navy workout card (rendered by AthletePlannerView right
                below) already carries the real title, so a second generic
                header just duplicated it; this bar is now just the date +
                the coach-only actions. */}
            <CardHeader className="pb-2 pt-3 px-4">
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <CardTitle className="text-xs font-normal text-muted-foreground flex items-center gap-1.5">
                  <User className="h-3 w-3"/>
                  {format(selectedDate, 'EEEE, d MMMM')}
                </CardTitle>
                {selectedAW && (
                  <div className="flex gap-1 flex-shrink-0">
                    <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowRepeatPanel(v => !v)}>
                      <Repeat className="h-3 w-3 mr-1"/>חזרה
                    </Button>
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
                )}
              </div>
              {/* "Repeat this workout" — asks weekly/every-other-week + an
                  end date, then writes future assignedWorkouts docs from
                  this instance's date forward. Opened by the Repeat button
                  above, not by the drag-drop itself (drag stays a single
                  simple placement per the coach's request). */}
              {selectedAW && showRepeatPanel && (
                <div className="mt-2 p-2.5 rounded-lg border border-gold/40 bg-gold/5 flex flex-wrap items-end gap-2">
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] text-muted-foreground">תדירות</label>
                    <select
                      value={repeatFrequency}
                      onChange={(e) => setRepeatFrequency(e.target.value as RepeatFrequency)}
                      className="h-7 text-xs rounded-md border border-border bg-white px-1.5"
                    >
                      <option value="weekly">כל שבוע</option>
                      <option value="biweekly">כל שבועיים</option>
                    </select>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <label className="text-[10px] text-muted-foreground">עד תאריך (מקס׳ {MAX_OCCURRENCES} מופעים)</label>
                    <input
                      type="date"
                      value={repeatUntil}
                      onChange={(e) => setRepeatUntil(e.target.value)}
                      min={selectedDate ? format(selectedDate, 'yyyy-MM-dd') : undefined}
                      className="h-7 text-xs rounded-md border border-border bg-white px-1.5"
                    />
                  </div>
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1 cursor-pointer">
                    <Switch checked={repeatSkipDownWeeks} onCheckedChange={setRepeatSkipDownWeeks} className="scale-75"/>
                    דלג על שבועות פריקה
                  </label>
                  <Button size="sm" className="h-7 text-xs" disabled={!repeatUntil || repeatSaving} onClick={handleRepeatWorkout}>
                    {repeatSaving ? <Loader2 className="h-3 w-3 mr-1 animate-spin"/> : null}
                    החל חזרה
                  </Button>
                </div>
              )}
              {/* Beyond the athlete's rolling visibility window — offer to show it early */}
              {selectedAW && (() => {
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
                    className="mt-1.5 flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2.5 py-1 w-fit">
                    <Eye className="h-3 w-3"/>
                    מעבר לחלון הרגיל — הצג לספורטאי מראש
                  </button>
                )
              })()}
            </CardHeader>
            <CardContent className="px-4 pb-4">
              <AthletePlannerView overrideAthleteId={athleteId} initialDate={format(selectedDate, 'yyyy-MM-dd')} autoExpandWorkouts />

              {/* Coach comments — write feedback on this day, sent straight to the athlete */}
              <div className="space-y-1.5 border-t pt-3 mt-4" dir="rtl">
                <Label className="text-xs font-semibold text-navy">הערות מאמן — שלח לספורטאי על היום הזה</Label>
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

        {/* Original application data — collapsed by default. Only the
            leads/ collection has the FULL original form; the athlete's own
            profile only got a handful of structured fields copied over on
            conversion (see auth-context.tsx), everything else (goals,
            lifestyle, facilities, devices...) only lives here. */}
        {(leadData || leadLoading) && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4 cursor-pointer" onClick={() => setShowLeadSection(p => !p)}>
            <CardTitle className="text-sm flex items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-muted-foreground">
                <ClipboardList className="h-4 w-4 text-gold/60"/>
                נתוני בקשת ההצטרפות
              </span>
              <ChevronLeft className={cn('h-4 w-4 text-muted-foreground transition-transform', showLeadSection && '-rotate-90')}/>
            </CardTitle>
          </CardHeader>
          {showLeadSection && (
            <CardContent className="px-4 pb-4 space-y-2 text-xs" dir="rtl">
              {leadLoading ? (
                <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground"/></div>
              ) : leadData && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
                  {leadData.primaryGoal && <div><span className="font-semibold">מטרה עיקרית: </span>{leadData.primaryGoal}</div>}
                  {leadData.longTermGoal && <div><span className="font-semibold">מטרה ארוכת טווח: </span>{leadData.longTermGoal}</div>}
                  {leadData.runningExperienceDuration && <div><span className="font-semibold">שנות ניסיון: </span>{leadData.runningExperienceDuration}</div>}
                  {leadData.city && <div><span className="font-semibold">עיר: </span>{leadData.city}</div>}
                  {leadData.daysPerWeek != null && <div><span className="font-semibold">ימי אימון בשבוע: </span>{leadData.daysPerWeek}</div>}
                  {leadData.preferredDays && leadData.preferredDays.length > 0 && <div><span className="font-semibold">ימים מועדפים: </span>{leadData.preferredDays.join(', ')}</div>}
                  {leadData.facilitiesAccess && leadData.facilitiesAccess.length > 0 && <div><span className="font-semibold">מתקנים זמינים: </span>{leadData.facilitiesAccess.join(', ')}</div>}
                  {leadData.devicesUsed && leadData.devicesUsed.length > 0 && <div><span className="font-semibold">מכשירים: </span>{leadData.devicesUsed.join(', ')}</div>}
                  {leadData.shoesInfo && <div><span className="font-semibold">נעליים: </span>{leadData.shoesInfo}</div>}
                  {leadData.stravaOrGarminLink && <div><span className="font-semibold">Strava/Garmin: </span>{leadData.stravaOrGarminLink}</div>}
                  {leadData.recentRaceEvent && <div><span className="font-semibold">מירוץ אחרון: </span>{leadData.recentRaceEvent} {leadData.recentRaceTime} ({leadData.recentRaceDate})</div>}
                  {leadData.lifestyleNotes && <div className="sm:col-span-2"><span className="font-semibold">שינה/עומס חיים: </span>{leadData.lifestyleNotes}</div>}
                  {leadData.currentInjuries && <div className="sm:col-span-2"><span className="font-semibold">פציעה נוכחית: </span>{leadData.currentInjuries}</div>}
                  {leadData.medicalNotes && <div className="sm:col-span-2"><span className="font-semibold">הערות רפואיות: </span>{leadData.medicalNotes}</div>}
                  {leadData.additionalNotes && <div className="sm:col-span-2"><span className="font-semibold">הערות נוספות: </span>{leadData.additionalNotes}</div>}
                </div>
              )}
            </CardContent>
          )}
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

        {/* Lab summary — thresholds at a glance; full test entry lives in the Lab tab */}
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-sm flex items-center gap-1.5">
                <FlaskConical className="h-4 w-4 text-gold"/>
                ספים מהמעבדה
              </CardTitle>
              <Link href={`/coach/athletes/${athleteId}/planner?tab=lab`}
                className="text-[11px] font-semibold text-gold hover:underline underline-offset-2 flex-shrink-0">
                {athlete?.physiology?.lt2PaceSec ? 'בדיקה חדשה ←' : 'הוסף בדיקה ←'}
              </Link>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            {athlete?.physiology?.lt2PaceSec ? (
              <>
                <div className="grid grid-cols-3 gap-2">
                  <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">T1 · אירובי</p>
                    <p className="text-lg font-black text-emerald-700" dir="ltr">{secToPace(athlete.physiology.lt1PaceSec)}</p>
                  </div>
                  <div className="rounded-xl bg-amber-50 border border-amber-100 p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">T2 · אנאירובי</p>
                    <p className="text-lg font-black text-amber-700" dir="ltr">{secToPace(athlete.physiology.lt2PaceSec)}</p>
                  </div>
                  <div className="rounded-xl bg-navy/5 border border-navy/10 p-2.5 text-center">
                    <p className="text-[10px] text-muted-foreground mb-0.5">VO2max</p>
                    <p className="text-lg font-black text-navy">{athlete.physiology.vo2maxEst ?? '—'}</p>
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground text-center mt-2">
                  {athlete.physiology.source === 'test'
                    ? `מבדיקת לקטט ${athlete.physiology.testDate ? format(new Date(athlete.physiology.testDate), 'd/M/yy') : ''}`
                    : 'הערכה ידנית'}
                </p>
              </>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-2">
                אין עדיין נתוני מעבדה — הוסף בדיקת לקטט כדי לראות ספי T1/T2
              </p>
            )}
            <div className="flex items-center justify-between gap-2 border-t pt-3 mt-3">
              <span className="text-xs text-muted-foreground">גלוי לספורטאי</span>
              <Switch
                checked={!!athlete?.labVisibleToAthlete}
                onCheckedChange={async (checked) => {
                  setAthlete(prev => prev ? { ...prev, labVisibleToAthlete: checked } : prev)
                  const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                  await ud(dc(db, 'users', athleteId), { labVisibleToAthlete: checked })
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Strength/stretch platform (Exercise Library, Lift Mode, progress)
            — still being tested, off by default. Coach turns it on per
            athlete, same gating mechanism as the Lab above: checked
            directly on the athlete-facing pages too, not just used to hide
            buttons, so a direct URL visit stays blocked either way.
            Deliberately a separate switch from injury prevention below —
            turning one on doesn't expose the other. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">כלי כוח ומתיחות</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              ספריית תרגילים, מצב אימון עם וידאו/טיימר, מעקב התקדמות — פיצ&apos;ר בבדיקה, כבוי כברירת מחדל.
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">גלוי לספורטאי</span>
              <Switch
                checked={!!athlete?.strengthToolsVisibleToAthlete}
                onCheckedChange={async (checked) => {
                  setAthlete(prev => prev ? { ...prev, strengthToolsVisibleToAthlete: checked } : prev)
                  const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                  await ud(dc(db, 'users', athleteId), { strengthToolsVisibleToAthlete: checked })
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Injury prevention (/athlete/injury) — separate switch from
            strength/stretch on purpose, still being fixed up later. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">מניעת פציעות</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground mb-3">
              עמוד מניעת פציעות של הספורטאי (אזורי גוף, תרגילים, תוכנית שיקום) — עדיין בבנייה, כבוי כברירת מחדל.
            </p>
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-muted-foreground">גלוי לספורטאי</span>
              <Switch
                checked={!!athlete?.injuryToolsVisibleToAthlete}
                onCheckedChange={async (checked) => {
                  setAthlete(prev => prev ? { ...prev, injuryToolsVisibleToAthlete: checked } : prev)
                  const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                  await ud(dc(db, 'users', athleteId), { injuryToolsVisibleToAthlete: checked })
                }}
              />
            </div>
          </CardContent>
        </Card>

        {/* Default routine links for this athlete — auto-applied to any
            workout assigned to them that doesn't already have its own
            linkedRoutines set on the workout template itself (a specific
            hard-day template's own links always win). Same editor as the
            workout builder's own "שגרות מקושרות" section. */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">חימום ברירת מחדל לספורטאי</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-xs text-muted-foreground">
              יתווסף אוטומטית לכל אימון שמשויך לספורטאי הזה, חוץ מאימונים שכבר קושרו לשגרות משלהם בבנאי האימון.
            </p>

            {/* Per-type rules — checked first, in order, first match wins */}
            <div className="space-y-3">
              <Label className="text-xs font-semibold">חימום לפי סוג אימון</Label>
              <p className="text-[11px] text-muted-foreground">
                לדוגמה: חימום קל לימי ריצה קלה, חימום מלא + הפעלה ספציפית לימי איכות. הכלל הראשון שתואם את סוג האימון הוא שיחול.
              </p>
              {routineRulesDraft.map((rule, ri) => (
                <div key={rule.id} className="rounded-lg border border-border p-2.5 space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1.5">
                      {ALL_WORKOUT_TYPES.map((wt) => {
                        const active = rule.types.includes(wt)
                        return (
                          <button
                            key={wt}
                            type="button"
                            onClick={() => setRoutineRulesDraft((prev) => prev.map((r, i) => (i === ri
                              ? { ...r, types: active ? r.types.filter((t) => t !== wt) : [...r.types, wt] }
                              : r)))}
                            className={cn(
                              'px-2 py-1 rounded-full text-[11px] font-semibold border transition-colors',
                              active ? 'bg-[#0a1628] text-white border-[#0a1628]' : 'bg-white text-gray-500 border-gray-200',
                            )}
                          >
                            {workoutTypeLabels[wt]}
                          </button>
                        )
                      })}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setRoutineRulesDraft((prev) => prev.filter((_, i) => i !== ri))}
                      className="text-destructive hover:text-destructive h-8 w-8 shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  <LinkedRoutinesEditor
                    value={rule.routines}
                    onChange={(next) => setRoutineRulesDraft((prev) => prev.map((r, i) => (i === ri ? { ...r, routines: next } : r)))}
                    routineOptions={routineOptions}
                  />
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRoutineRulesDraft((prev) => [...prev, { id: `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, types: [], routines: [] }])}
              >
                <Plus className="h-4 w-4 mr-1" />הוסף כלל לפי סוג אימון
              </Button>
            </div>

            {/* Flat fallback — used when no rule above matches the workout's type */}
            <div className="space-y-2 pt-3 border-t">
              <Label className="text-xs font-semibold">ברירת מחדל כללית (לכל שאר סוגי האימונים)</Label>
              <LinkedRoutinesEditor value={defaultRoutinesDraft} onChange={setDefaultRoutinesDraft} routineOptions={routineOptions} />
            </div>

            <Button onClick={saveDefaultRoutines} disabled={savingDefaultRoutines} size="sm" className="w-full">
              {savingDefaultRoutines ? 'שומר...' : 'שמור ברירת מחדל'}
            </Button>
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
                    className="h-8 text-xs rounded-lg border border-border bg-white px-1.5 font-semibold text-navy">
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
                    className="h-8 text-xs rounded-lg border border-border bg-white px-1.5 font-semibold text-navy">
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
                    className="h-8 text-xs rounded-lg border border-border bg-white px-1.5 font-semibold text-navy">
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
                  <span className="text-xs text-muted-foreground flex-shrink-0">תחרות מטרה</span>
                  <Input
                    className="h-8 text-xs font-bold text-navy text-right"
                    value={activeJourney?.goalRaceEvent || ''}
                    placeholder="מרתון ת״א"
                    disabled={!activeJourney}
                    onChange={e => setActiveJourney(prev => prev ? { ...prev, goalRaceEvent: e.target.value } : prev)}
                    onBlur={() => activeJourney && saveJourney(athleteId, activeJourney).catch(() => toast.error(t.toastSaveJourneyFailed))}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground flex-shrink-0">תאריך</span>
                  <Input
                    type="date"
                    className="h-8 text-xs font-bold text-navy"
                    value={activeJourney?.goalRaceDate || ''}
                    disabled={!activeJourney}
                    onChange={e => setActiveJourney(prev => prev ? { ...prev, goalRaceDate: e.target.value } : prev)}
                    onBlur={() => activeJourney && saveJourney(athleteId, activeJourney).catch(() => toast.error(t.toastSaveJourneyFailed))}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground flex-shrink-0">יעד זמן</span>
                  <Input
                    className="h-8 text-xs font-bold text-navy text-center"
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
                    <Input type="number" className="h-8 w-14 text-xs font-bold text-navy text-center"
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
                    <Input type="number" className="h-8 w-14 text-xs font-bold text-navy text-center"
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
                    className="h-8 text-xs rounded-lg border border-border bg-white px-1.5 font-semibold text-navy">
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
                    className="h-8 w-24 text-xs font-bold text-navy text-center"
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

            {/* Private coach notes — never shown to the athlete */}
            <div className="border-t pt-3">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1">
                <NotebookPen className="h-3 w-3"/>
                הערות פרטיות <span className="normal-case font-normal">(רק אתה רואה)</span>
              </p>
              <Textarea
                value={athlete?.coachPrivateNotes || ''}
                onChange={e => setAthlete(prev => prev ? { ...prev, coachPrivateNotes: e.target.value } : prev)}
                onBlur={async e => {
                  const { updateDoc: ud, doc: dc } = await import('firebase/firestore')
                  await ud(dc(db, 'users', athleteId), { coachPrivateNotes: e.target.value })
                }}
                placeholder="נעלי ריצה, פציעות עבר, הרגלים, מה שכדאי לזכור..."
                className="text-xs min-h-[70px] resize-none bg-amber-50/40 border-amber-200/60"
                dir="rtl"
              />
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
                        className="h-7 text-xs font-bold text-navy text-right w-20"
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

      {/* Quick-assign sheet — tap a day, tap a type, enter numbers, done */}
      <Dialog open={!!quickAssignDate} onOpenChange={(open) => { if (!open) { setQuickAssignDate(null); resetQuickAssign() } }}>
        <DialogContent className="max-w-md max-h-[88vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">
              {quickAssignDate && format(quickAssignDate, 'EEEE, d MMMM')}
            </DialogTitle>
          </DialogHeader>
          {quickAssignDate && (() => {
            const qaDateStr = format(quickAssignDate, 'yyyy-MM-dd')
            const existingWs = getWorkoutsForDate2(qaDateStr)
            const dayOff = dayOffFor(qaDateStr)
            return (
              <div className="space-y-4">
                {/* Day off (sick/trip/other) — suppresses the athlete's
                    reminders and the "missed workout" alert for this date */}
                {dayOff ? (
                  <div className="rounded-xl border border-navy/10 bg-navy/5 px-3 py-2 flex items-center justify-between gap-2">
                    <p className="text-xs font-bold text-navy">
                      {dayOff.reason === 'sick' ? t.dayOffCardTitleSick : dayOff.reason === 'trip' ? t.dayOffCardTitleTrip : t.dayOffCardTitleOther}
                      {dayOff.note ? ` — ${dayOff.note}` : ''}
                    </p>
                    <button
                      onClick={async () => {
                        try { await removeDayOff(dayOff.id); toast.success(t.dayOffToastRemoved) }
                        catch (e) { console.error(e); toast.error('שמירה נכשלה') }
                      }}
                      className="text-[11px] font-semibold text-navy/60 hover:text-navy underline underline-offset-2 flex-shrink-0">
                      {t.dayOffUndoBtn}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => { setMarkDayOffDate(qaDateStr); setQuickAssignDate(null); setMarkDayOffOpen(true) }}
                    className="w-full text-xs font-semibold text-muted-foreground hover:text-navy px-2 py-1.5 rounded-xl border border-dashed border-border transition-all active:scale-[0.98]">
                    {t.markDayOffBtn}
                  </button>
                )}

                {/* Existing workouts that day */}
                {existingWs.length > 0 && (
                  <div className="space-y-1.5">
                    {existingWs.length > 1 && (
                      <p className="text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                        יש כבר {existingWs.length} אימונים ביום זה — ודא שלכל אחד סימון בוקר/ערב נכון כדי ש-Strava ידע להתאים נכון
                      </p>
                    )}
                    {existingWs.map(w => {
                      const sInfo = w.session ? SESSION_LABELS[w.session] : null
                      const suspicious = isSuspiciousDistance(w.workout?.distance)
                      return (
                        <div key={w.id} className={cn('rounded-xl border px-3 py-2 flex items-center gap-2',
                          suspicious ? 'bg-red-100 text-red-700 border-red-300' : (TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy))}>
                          <span className="text-sm">{TYPE_EMOJI[w.workout?.type] || '🏃'}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="text-xs font-bold truncate">{w.workout?.title}</p>
                              {sInfo && (
                                <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-white/70 border border-black/10 flex-shrink-0">
                                  {sInfo.emoji} {sInfo.label}
                                </span>
                              )}
                            </div>
                            {w.workout?.distance && (
                              <p className={cn('text-[10px] flex items-center gap-0.5', suspicious ? 'font-bold' : 'opacity-70')}>
                                {suspicious && <AlertTriangle className="h-2.5 w-2.5"/>}
                                {w.workout.distance} ק"מ
                              </p>
                            )}
                          </div>
                          {/* Session only matters once there's more than one workout that day */}
                          {existingWs.length > 1 && (
                            <select
                              value={w.session || ''}
                              onChange={async e => {
                                const v = (e.target.value || null) as 'am' | 'pm' | 'other' | null
                                await updateDoc(doc(db, 'assignedWorkouts', w.id), { session: v })
                                setAssignedWorkouts(prev => prev.map(x => x.id === w.id ? { ...x, session: v ?? undefined } : x))
                              }}
                              className="h-6 text-[10px] rounded-full border border-black/10 bg-white/80 px-1 font-semibold flex-shrink-0">
                              <option value="">—</option>
                              <option value="am">🌅 בוקר</option>
                              <option value="pm">🌇 ערב</option>
                              <option value="other">🕐 נוסף</option>
                            </select>
                          )}
                          <button
                            onClick={() => { setBuilderWorkoutId(w.workoutId); setEditingAssignedId(w.id); setQuickAssignDate(null); setShowBuilderDialog(true) }}
                            className="text-[10px] font-semibold bg-white/70 border border-black/10 rounded-full px-2 py-0.5 flex-shrink-0">
                            {t.editBtn}
                          </button>
                          <button onClick={() => handleRemove(w.id)}
                            className="w-6 h-6 rounded-full hover:bg-red-100 text-red-400 flex items-center justify-center text-xs flex-shrink-0">✕</button>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* Session for the NEW workout — only relevant once the day has
                    more than one workout; a single workout can happen anytime */}
                {existingWs.length > 0 && (
                  <div>
                    <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">מתי ביום (לאימון החדש)</p>
                    <div className="flex gap-1.5">
                      {(['am', 'pm', 'other'] as const).map(s => (
                        <button key={s} onClick={() => setQaSession(s)}
                          className={cn('flex-1 text-xs font-semibold px-2 py-1.5 rounded-xl border transition-all active:scale-95',
                            qaSession === s ? 'bg-navy text-white border-navy' : 'bg-white text-gray-500 border-border')}>
                          {SESSION_LABELS[s].emoji} {SESSION_LABELS[s].label}
                        </button>
                      ))}
                    </div>
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
                                    await assignWorkoutToDate(w, qaDateStr, qaSession)
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
                    await assignWorkoutToDate(savedWorkout as Workout, format(quickAssignDate, 'yyyy-MM-dd'), qaSession)
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
      <MarkDayOffDialog
        open={markDayOffOpen}
        onOpenChange={setMarkDayOffOpen}
        defaultDate={markDayOffDate}
        onSubmit={async (payload) => {
          try {
            await markDayOff({ ...payload, createdBy: user?.id || '' })
            toast.success(t.dayOffToastAdded)
          } catch (e) {
            console.error(e)
            toast.error('שמירה נכשלה')
          }
        }}
      />
    </div>
  )
}
