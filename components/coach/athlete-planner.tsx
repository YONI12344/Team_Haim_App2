'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
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
  Loader2, MapPin, Clock, Check, Calendar,
} from 'lucide-react'
import Link from 'next/link'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, eachDayOfInterval, isSameMonth,
  isSameDay, isToday, parseISO,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase'
import {
  collection, doc, getDoc, getDocs, query,
  where, addDoc, serverTimestamp, deleteDoc,
} from 'firebase/firestore'
import type { AthleteProfile, Workout, AssignedWorkout, TrainingDayType } from '@/lib/types'
import { listJourneys, computeJourneyProgress } from '@/lib/journey'
import { useAuth } from '@/contexts/auth-context'
import { useWorkoutTypeLabels } from '@/lib/workout-labels'
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
  const workoutTypeLabels = useWorkoutTypeLabels()

  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  const [journey, setJourney] = useState<JourneySummary | null>(null)
  const [workoutLibrary, setWorkoutLibrary] = useState<Workout[]>([])
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [loading, setLoading] = useState(true)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [showCreateWorkout, setShowCreateWorkout] = useState(false)
  const [creatingWorkout, setCreatingWorkout] = useState(false)
  const [newWO, setNewWO] = useState({ title: '', type: 'easy' as WorkoutType, distance: '', duration: '', description: '', notes: '' })

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
      setNewWO({ title: '', type: 'easy', distance: '', duration: '', description: '', notes: '' })
      setShowCreateWorkout(false)
      toast.success('אימון נוצר בהצלחה!')
    } catch { toast.error('שגיאה ביצירת אימון') }
    finally { setCreatingWorkout(false) }
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

  return (
    <div className="space-y-4">

      {/* ── Header ── */}
      <div className="flex items-center gap-3">
        <Link href={`/coach/athletes/${athleteId}`}>
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4 mr-2" />Back
          </Button>
        </Link>
        <Avatar className="h-10 w-10 border-2 border-gold/20">
          <AvatarImage src={athlete.photoURL} alt={athlete.name} />
          <AvatarFallback className="bg-gold/10 text-gold">{getInitials(athlete.name)}</AvatarFallback>
        </Avatar>
        <div>
          <h1 className="text-xl font-serif font-bold text-navy">{athlete.name} — Training Planner</h1>
          <p className="text-sm text-muted-foreground">{athlete.events.slice(0,3).join(' · ')}</p>
        </div>
      </div>

      {/* ── Info Banner ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

        {/* Stage card */}
        <Card className="border-navy/20">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Current Stage</p>
            {journey ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-navy/10 text-navy border-navy/20">{journey.stageName}</Badge>
                  <span className="text-sm font-semibold text-navy">
                    Week {journey.weekInStage}/{journey.totalWeeksInStage}
                  </span>
                  <Badge variant="outline" className={cn('text-xs', journey.isOffWeek
                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                    : 'bg-emerald-100 text-emerald-700 border-emerald-200')}>
                    {journey.isOffWeek ? '🔄 Off week' : '💪 On week'}
                  </Badge>
                </div>
                {journey.goalRaceEvent && (
                  <p className="text-xs text-muted-foreground">
                    🏁 {journey.goalRaceEvent} · {format(parseISO(journey.goalRaceDate), 'MMM d, yyyy')}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No journey set up yet</p>
            )}
          </CardContent>
        </Card>

        {/* KM card */}
        <Card className="border-gold/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">This Week KM</p>
            {athlete.weeklyKmRange ? (
              <div className="space-y-1.5">
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-navy">{thisWeekKm}</span>
                  <span className="text-sm text-muted-foreground mb-0.5">
                    / {athlete.weeklyKmRange.min}–{athlete.weeklyKmRange.max} km
                  </span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div
                    className={cn('h-2 rounded-full transition-all',
                      thisWeekKm >= athlete.weeklyKmRange.min ? 'bg-emerald-500' : 'bg-gold')}
                    style={{ width: `${Math.min(100, (thisWeekKm / athlete.weeklyKmRange.max) * 100)}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground">
                  {thisWeekKm >= athlete.weeklyKmRange.min
                    ? '✓ Target reached this week'
                    : `${athlete.weeklyKmRange.min - thisWeekKm}–${athlete.weeklyKmRange.max - thisWeekKm} km still to assign`}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No km target set — set it in profile</p>
            )}
          </CardContent>
        </Card>

        {/* Schedule template card */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Weekly Template</p>
            {athlete.weekSchedule ? (
              <div className="grid grid-cols-7 gap-1">
                {(['Mon','Tue','Wed','Thu','Fri','Sat','Sun'] as const).map((label, i) => {
                  const key = WEEKDAY_KEYS[i === 6 ? 0 : i + 1]
                  const type: TrainingDayType = (athlete.weekSchedule![key] as TrainingDayType) || 'rest'
                  return (
                    <div key={label} className="text-center">
                      <p className="text-[10px] text-muted-foreground mb-1">{label}</p>
                      <div className={cn('rounded px-0.5 py-1 text-center', DAY_BG[type])}>
                        <span className={cn('w-2 h-2 rounded-full inline-block', DAY_DOT[type])} />
                        <p className="text-[9px] mt-0.5 font-medium capitalize leading-tight">
                          {type === 'long_run' ? 'Long' : type === 'workout' ? 'WO' : type}
                        </p>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No template set — set it in profile</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Calendar + Panel ── */}
      <div className="grid lg:grid-cols-3 gap-4">

        {/* Calendar */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="pt-4">
              {/* Month nav */}
              <div className="flex items-center justify-between mb-4">
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <h2 className="font-semibold text-navy text-lg">{format(currentMonth, 'MMMM yyyy')}</h2>
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              {/* Column headers */}
              <div className="grid grid-cols-8 gap-1 mb-1">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                  <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
                ))}
                <div className="text-center text-xs font-medium text-muted-foreground py-1">KM</div>
              </div>

              {/* Weeks */}
              <div className="space-y-1">
                {calendarWeeks.map((week, wi) => {
                  const weekKm = getWeekKm(week)
                  return (
                    <div key={wi} className="grid grid-cols-8 gap-1 items-stretch">
                      {week.map((day, di) => {
                        const inMonth = isSameMonth(day, currentMonth)
                        const dayWorkouts = getWorkoutsForDay(day)
                        const dayType = getDayType(day)
                        const isSelected = selectedDate ? isSameDay(day, selectedDate) : false
                        const todayFlag = isToday(day)
                        return (
                          <button
                            key={di}
                            onClick={() => { setSelectedDate(day); setSelectedWorkout(null) }}
                            className={cn(
                              'min-h-[72px] rounded-lg p-1.5 text-left border transition-all text-navy',
                              !inMonth && 'opacity-25 pointer-events-none',
                              inMonth && DAY_BG[dayType],
                              isSelected ? 'ring-2 ring-gold border-gold' : 'border-border hover:border-gold/50',
                              todayFlag && !isSelected && 'border-gold/40',
                            )}
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className={cn(
                                'text-xs font-semibold',
                                todayFlag
                                  ? 'w-5 h-5 flex items-center justify-center bg-gold text-white rounded-full text-[10px]'
                                  : 'text-navy',
                              )}>
                                {format(day, 'd')}
                              </span>
                              {inMonth && dayType !== 'rest' && dayType !== 'off' && (
                                <span className={cn('w-1.5 h-1.5 rounded-full', DAY_DOT[dayType])} />
                              )}
                            </div>
                            <div className="space-y-0.5">
                              {dayWorkouts.slice(0,2).map(w => (
                                <div key={w.id} className="text-[10px] leading-tight bg-white/80 rounded px-1 py-0.5 truncate">
                                  {w.workout.title}{w.workout.distance ? ` ${w.workout.distance}k` : ''}
                                </div>
                              ))}
                              {dayWorkouts.length > 2 && (
                                <p className="text-[10px] text-muted-foreground">+{dayWorkouts.length - 2}</p>
                              )}
                            </div>
                          </button>
                        )
                      })}
                      {/* Week KM */}
                      <div className="flex flex-col items-center justify-center rounded-lg bg-muted/30 px-1">
                        {weekKm > 0 ? (
                          <>
                            <p className="text-sm font-bold text-navy">{weekKm}</p>
                            <p className="text-[10px] text-muted-foreground">km</p>
                            {athlete.weeklyKmRange && (
                              <p className={cn('text-[9px] mt-0.5',
                                weekKm >= athlete.weeklyKmRange.min ? 'text-emerald-600' : 'text-amber-600')}>
                                {weekKm >= athlete.weeklyKmRange.min ? '✓' : `↑${athlete.weeklyKmRange.min - weekKm}`}
                              </p>
                            )}
                          </>
                        ) : (
                          <p className="text-[10px] text-muted-foreground">—</p>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* Legend */}
              <div className="flex gap-4 mt-3 flex-wrap border-t pt-3">
                {[['easy','bg-emerald-400','Easy'],['workout','bg-blue-400','Workout'],['long_run','bg-orange-400','Long Run']].map(([,dot,label]) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className={cn('w-2.5 h-2.5 rounded-full', dot)} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5 ml-auto">
                  <span className="text-xs text-muted-foreground">KM column = week total</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Assign Panel ── */}
        <div>
          <Card className="sticky top-4">
            <CardContent className="pt-4">
              {selectedDate ? (
                <div className="space-y-4">
                  {/* Day header */}
                  <div className="border-b pb-3">
                    <h3 className="font-bold text-navy text-lg">{format(selectedDate, 'EEEE')}</h3>
                    <p className="text-sm text-muted-foreground">{format(selectedDate, 'MMMM d, yyyy')}</p>
                    <Badge variant="outline" className={cn('mt-1.5 text-xs capitalize', DAY_BADGE[selectedDayType])}>
                      {selectedDayType.replace('_',' ')} day
                    </Badge>
                  </div>

                  {/* Already assigned */}
                  {selectedDayWorkouts.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Assigned</p>
                      {selectedDayWorkouts.map(w => (
                        <div key={w.id} className="flex items-center justify-between p-2 rounded-lg border bg-muted/30">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-navy truncate">{w.workout.title}</p>
                            <p className="text-xs text-muted-foreground">
                              {w.workout.distance ? `${w.workout.distance} km` : ''}
                              {w.workout.duration ? ` · ${w.workout.duration} min` : ''}
                            </p>
                          </div>
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <Link href={`/coach/workouts/${w.workoutId}/edit`}>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-gold">
                                <span className="text-xs">✏️</span>
                              </Button>
                            </Link>
                            <Button
                              variant="ghost" size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleRemove(w.id)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Workout picker */}
                  <div className="space-y-2">

                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        {selectedDayWorkouts.length > 0 ? 'הוסף עוד' : 'בחר אימון'}
                      </p>
                      <Button size="sm" variant="outline"
                        className="h-7 text-xs border-gold/40 text-gold hover:bg-gold/10"
                        onClick={() => setShowCreateWorkout(true)}>
                        ➕ צור חדש
                      </Button>
                    </div>
                    <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                      {workoutLibrary.map(workout => (
                        <button
                          key={workout.id}
                          onClick={() => setSelectedWorkout(
                            selectedWorkout?.id === workout.id ? null : workout
                          )}
                          className={cn(
                            'w-full p-2.5 rounded-lg border text-left transition-all',
                            selectedWorkout?.id === workout.id
                              ? 'border-gold bg-gold/5'
                              : 'border-border hover:bg-muted/50',
                          )}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-navy truncate">{workout.title}</p>
                              <div className="flex gap-2 text-xs text-muted-foreground mt-0.5">
                                {workout.distance && (
                                  <span className="flex items-center gap-0.5">
                                    <MapPin className="h-3 w-3" />{workout.distance} km
                                  </span>
                                )}
                                {workout.duration && (
                                  <span className="flex items-center gap-0.5">
                                    <Clock className="h-3 w-3" />{workout.duration} min
                                  </span>
                                )}
                              </div>
                            </div>
                            {selectedWorkout?.id === workout.id && (
                              <Check className="h-4 w-4 text-gold flex-shrink-0" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <Button
                    onClick={handleAssign}
                    disabled={!selectedWorkout || assigning}
                    className="w-full bg-gold hover:bg-gold/90 text-navy"
                  >
                    {assigning
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Assigning…</>
                      : <><Plus className="h-4 w-4 mr-2" />Assign Workout</>}
                  </Button>
                </div>
              ) : (
                <div className="text-center py-10 text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">Click any day</p>
                  <p className="text-xs mt-1">to view or assign workouts</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
      {/* Create Workout Dialog */}
      <Dialog open={showCreateWorkout} onOpenChange={setShowCreateWorkout}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>➕ צור אימון חדש</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-2">
            <div className="space-y-1">
              <Label className="text-sm">שם האימון *</Label>
              <Input placeholder="למשל: ריצה קלה 60 דקות"
                value={newWO.title} onChange={e => setNewWO(p => ({...p, title: e.target.value}))} />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">סוג</Label>
              <Select value={newWO.type} onValueChange={v => setNewWO(p => ({...p, type: v as WorkoutType}))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="easy">קל</SelectItem>
                  <SelectItem value="long_run">ריצה ארוכה</SelectItem>
                  <SelectItem value="tempo">טמפו</SelectItem>
                  <SelectItem value="intervals">אינטרוולים</SelectItem>
                  <SelectItem value="hill_repeats">גבעות</SelectItem>
                  <SelectItem value="fartlek">פארטלק</SelectItem>
                  <SelectItem value="recovery">התאוששות</SelectItem>
                  <SelectItem value="strength">כוח</SelectItem>
                  <SelectItem value="rest">מנוחה</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-sm">מרחק (ק"מ)</Label>
                <Input type="number" placeholder="10" value={newWO.distance}
                  onChange={e => setNewWO(p => ({...p, distance: e.target.value}))} />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">משך (דקות)</Label>
                <Input type="number" placeholder="60" value={newWO.duration}
                  onChange={e => setNewWO(p => ({...p, duration: e.target.value}))} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">תיאור</Label>
              <Textarea placeholder="תיאור האימון..." className="resize-none h-20"
                value={newWO.description} onChange={e => setNewWO(p => ({...p, description: e.target.value}))} />
            </div>
            <div className="space-y-1">
              <Label className="text-sm">הערות</Label>
              <Input placeholder="הערות נוספות..." value={newWO.notes}
                onChange={e => setNewWO(p => ({...p, notes: e.target.value}))} />
            </div>
            <Button onClick={handleCreateWorkout} disabled={!newWO.title.trim() || creatingWorkout}
              className="w-full bg-gold hover:bg-gold/90 text-navy">
              {creatingWorkout ? <><Loader2 className="h-4 w-4 animate-spin mr-2"/>יוצר...</> : 'צור אימון'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}