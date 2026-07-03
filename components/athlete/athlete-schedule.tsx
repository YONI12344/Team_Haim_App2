'use client'

import { useState, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { 
  format, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameDay, 
  addWeeks, 
  subWeeks,
  startOfMonth,
  endOfMonth,
  addMonths,
  subMonths,
  parseISO,
  isToday,
} from 'date-fns'
import { ChevronLeft, ChevronRight, Clock, Activity, Check, X, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useRouter, useSearchParams } from 'next/navigation'
import type { AssignedWorkout, Workout, WorkoutLog, WorkoutType } from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { WorkoutLogForm } from '@/components/athlete/workout-log-form'
import { collection, getDocs, query, where, DocumentData, QueryDocumentSnapshot, doc, deleteDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { workoutTypeColors, useWorkoutTypeLabels } from '@/lib/workout-labels'

function mapDocToAssignedWorkout(d: QueryDocumentSnapshot<DocumentData>): AssignedWorkout {
  const data = d.data()
  return {
    id: d.id,
    workoutId: data.workoutId || '',
    workout: (data.workout || {}) as Workout,
    athleteId: data.athleteId || '',
    assignedBy: data.assignedBy || '',
    scheduledDate: data.scheduledDate || '',
    status: data.status || 'scheduled',
    athleteNotes: data.athleteNotes,
    coachFeedback: data.coachFeedback,
    completedAt: data.completedAt?.toDate?.(),
    actualDuration: data.actualDuration,
    actualDistance: data.actualDistance,
    perceivedEffort: data.perceivedEffort,
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  }
}

function mapDocToWorkoutLog(d: QueryDocumentSnapshot<DocumentData>, fallbackAthleteId: string): WorkoutLog {
  const data = d.data()
  return {
    id: d.id,
    athleteId: data.athleteId || fallbackAthleteId,
    workoutId: data.workoutId || '',
    date: data.date || '',
    actualDistance: data.actualDistance ?? undefined,
    actualPace: data.actualPace ?? undefined,
    effort: legacyEffortToNumber(data.effort),
    comment: data.comment || '',
    source: data.source || undefined,
    splitLogs: data.splitLogs || [],
    createdAt: data.createdAt?.toDate?.() || new Date(),
  } as WorkoutLog & { source?: string }
}

type ViewMode = 'week' | 'month'

interface AthleteScheduleProps {
  athleteId?: string
  readOnly?: boolean
}

export function AthleteSchedule({ athleteId: propAthleteId, readOnly = false }: AthleteScheduleProps = {}) {
  const { user } = useAuth()
  const { t } = useLanguage()
  const router = useRouter()
  const searchParams = useSearchParams()
  const autoOpenId = searchParams?.get('workoutId')
  const autoOpened = useRef(false)
  const athleteId = propAthleteId || user?.id || ''
  const workoutTypeLabels = useWorkoutTypeLabels()
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('day')
  const [selectedWorkout, setSelectedWorkout] = useState<AssignedWorkout | null>(null)
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [assigned, setAssigned] = useState<AssignedWorkout[]>([])
  const isCoach = user?.role === 'coach'

  // Auto-open workout from URL param
  useEffect(() => {
    if (!autoOpenId || autoOpened.current || assigned.length === 0) return
    const found = assigned.find(w => w.id === autoOpenId)
    if (found) {
      setSelectedWorkout(found)
      autoOpened.current = true
    }
  }, [autoOpenId, assigned])
  const [editingWorkout, setEditingWorkout] = useState<AssignedWorkout | null>(null)
  const [editDate, setEditDate] = useState<string>('')
  const [editWorkout, setEditWorkout] = useState<Partial<Workout>>({})
  const [isSavingEdit, setIsSavingEdit] = useState(false)

  const handleEditSave = async () => {
    if (!editingWorkout || !editDate) return
    setIsSavingEdit(true)
    try {
      const updatedWorkout = { ...editingWorkout.workout, ...editWorkout }
      await updateDoc(doc(db, 'assignedWorkouts', editingWorkout.id), {
        scheduledDate: editDate,
        workout: updatedWorkout,
        updatedAt: new Date(),
      })
      setAssigned(prev => prev.map(w =>
        w.id === editingWorkout.id
          ? { ...w, scheduledDate: editDate, workout: updatedWorkout }
          : w
      ))
      setEditingWorkout(null)
      setSelectedWorkout(null)
    } catch (error) {
      console.error('Error updating workout:', error)
    } finally {
      setIsSavingEdit(false)
    }
  }

  const handleDeleteWorkout = async (workoutId: string) => {
    if (!confirm('Are you sure you want to delete this workout?')) return
    try {
      await deleteDoc(doc(db, 'assignedWorkouts', workoutId))
      setAssigned(prev => prev.filter(w => w.id !== workoutId))
      setSelectedWorkout(null)
    } catch (error) {
      console.error('Error deleting workout:', error)
    }
  }

  // Load assigned workouts for current athlete
  useEffect(() => {
    if (!user?.id) return
    const loadAssigned = async () => {
      try {
        const q = query(
          collection(db, 'assignedWorkouts'),
          where('athleteId', '==', athleteId),
        )
        const snap = await getDocs(q)
        setAssigned(snap.docs.map(mapDocToAssignedWorkout))
      } catch (error) {
        console.error('Error loading assigned workouts:', error)
        setAssigned([])
      }
    }
    loadAssigned()
  }, [athleteId])

  // Load all logs for current athlete
  useEffect(() => {
    if (!user?.id) return
    const loadLogs = async () => {
      try {
        const q = query(collection(db, 'logs'), where('athleteId', '==', athleteId))
        const snapshot = await getDocs(q)
        console.log('LOGS QUERY athleteId:', athleteId, 'found:', snapshot.docs.length)
        const loadedLogs: WorkoutLog[] = snapshot.docs.map(d => mapDocToWorkoutLog(d, athleteId))
        setLogs(loadedLogs)
      } catch (error) {
        console.error('Error loading logs:', error)
        setLogs([])
      }
    }
    loadLogs()
  }, [athleteId])

  const getLogForWorkout = (workoutId: string, date?: string): WorkoutLog | undefined => {
    console.log('LOGS TOTAL:', logs.length, 'log dates:', logs.map(l => l.date), 'looking for date:', date)
    const byId = logs.find(l => l.workoutId === workoutId)
    if (byId) return byId
    if (date) return logs.find(l => l.date === date)
    return undefined
  }

  const navigatePrevious = () => {
    if (viewMode === 'week') {
      setCurrentDate(subWeeks(currentDate, 1))
    } else {
      setCurrentDate(subMonths(currentDate, 1))
    }
  }

  const navigateNext = () => {
    if (viewMode === 'week') {
      setCurrentDate(addWeeks(currentDate, 1))
    } else {
      setCurrentDate(addMonths(currentDate, 1))
    }
  }

  const goToToday = () => {
    setCurrentDate(new Date())
  }

  const getWorkoutsForDate = (date: Date): AssignedWorkout[] => {
    return assigned.filter(w => 
      w.scheduledDate && isSameDay(parseISO(w.scheduledDate), date)
    )
  }

  // Week view dates
  const weekStart = startOfWeek(currentDate, { weekStartsOn: 1 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 1 })
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })

  // Month view dates
  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd })

  // Pad month to start on Monday
  const startPadding = (monthStart.getDay() + 6) % 7
  const paddedMonthDays = [
    ...Array(startPadding).fill(null),
    ...monthDays,
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
            {t.scheduleTitle}
          </h1>
          <p className="text-muted-foreground">
            {t.scheduleSubtitle}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="week">{t.week}</TabsTrigger>
              <TabsTrigger value="month">{t.month}</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={navigatePrevious}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon" onClick={navigateNext}>
            <ChevronRight className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={goToToday}>
            {t.today}
          </Button>
        </div>
        <h2 className="text-lg font-semibold text-navy">
          {viewMode === 'week' 
            ? `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d, yyyy')}`
            : format(currentDate, 'MMMM yyyy')
          }
        </h2>
      </div>

      {/* Week View */}
      {viewMode === 'week' && (
        <div className="grid gap-4">
          {weekDays.map((day) => {
            const workouts = getWorkoutsForDate(day)
            const today = isToday(day)

            return (
              <Card
                key={day.toISOString()}
                className={cn(
                  'transition-luxury',
                  today && 'ring-2 ring-gold/50',
                )}
              >
                <CardContent className="p-4">
                  <div className="flex items-start gap-4">
                    {/* Date */}
                    <div className={cn(
                      'w-14 h-14 rounded-lg flex flex-col items-center justify-center flex-shrink-0',
                      today ? 'bg-gold text-navy' : 'bg-muted'
                    )}>
                      <span className="text-xs font-medium uppercase">
                        {format(day, 'EEE')}
                      </span>
                      <span className="text-lg font-bold">
                        {format(day, 'd')}
                      </span>
                    </div>

                    {/* Workouts */}
                    <div className="flex-1 min-w-0 space-y-3">
                      {workouts.length === 0 ? (
                        <div className="flex items-center text-muted-foreground h-14">
                          <span className="text-sm">{t.noWorkoutScheduled}</span>
                        </div>
                      ) : (
                        workouts.map((workout) => (
                          <div
                            key={workout.id}
                            onClick={() => setSelectedWorkout(workout)}
                            className="cursor-pointer hover:bg-muted/40 rounded-lg p-2 -mx-2 transition-luxury border-b border-border/30 last:border-0 pb-3 last:pb-0"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <h3 className="font-semibold text-navy">
                                    {workout.workout.title}
                                  </h3>
                                  {workout.status === 'completed' && (
                                    <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center">
                                      <Check className="h-3 w-3 text-emerald-600" />
                                    </div>
                                  )}
                                  {workout.status === 'skipped' && (
                                    <div className="w-5 h-5 rounded-full bg-red-100 flex items-center justify-center">
                                      <X className="h-3 w-3 text-red-600" />
                                    </div>
                                  )}
                                  {getLogForWorkout(workout.id, workout.scheduledDate) && (
                                    <div className="w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center" title="Logged">
                                      <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                                    </div>
                                  )}
                                </div>
                                <p className="text-sm text-muted-foreground line-clamp-1 mb-2">
                                  {workout.workout.description}
                                </p>
                                <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                                  {workout.workout.duration && (
                                    <span className="flex items-center gap-1">
                                      <Clock className="h-3.5 w-3.5" />
                                      {workout.workout.duration} {t.min}
                                    </span>
                                  )}
                                  {workout.workout.distance && (
                                    <span className="flex items-center gap-1">
                                      <Activity className="h-3.5 w-3.5" />
                                      {workout.workout.distance} {t.km}
                                    </span>
                                  )}
                                </div>
                                {(() => {
                                  const log = getLogForWorkout(workout.id, workout.scheduledDate)
                                  if (!log) return null
                                  const effortPill =
                                    log.effort <= 3
                                      ? 'bg-emerald-100 text-emerald-700'
                                      : log.effort <= 6
                                      ? 'bg-sky-100 text-sky-700'
                                      : log.effort <= 8
                                      ? 'bg-orange-100 text-orange-700'
                                      : 'bg-red-100 text-red-700'
                                  const isStrava = (log as any).source === 'strava'
                                  return (
                                    <div
                                      className={cn(
                                        'mt-2 rounded-xl border p-2.5 cursor-pointer transition-colors',
                                        isStrava
                                          ? 'bg-orange-50/60 border-orange-200 hover:bg-orange-50'
                                          : 'bg-emerald-50/60 border-emerald-200 hover:bg-emerald-50'
                                      )}
                                      onClick={(e) => { e.stopPropagation(); setSelectedWorkout(workout) }}
                                    >
                                      <div className="flex items-center justify-between mb-1.5">
                                        <div className="flex items-center gap-1.5">
                                          <CheckCircle2 className={cn('h-3 w-3', isStrava ? 'text-[#FC4C02]' : 'text-emerald-500')} />
                                          <span className="text-xs font-semibold text-navy">הושלם</span>
                                          {isStrava && (
                                            <span className="text-[10px] bg-[#FC4C02]/15 text-[#FC4C02] px-1.5 py-0.5 rounded-full font-bold">Strava</span>
                                          )}
                                        </div>
                                        {log.effort != null && (
                                          <span className={cn('text-[10px] px-2 py-0.5 rounded-full font-bold', effortPill)}>
                                            מאמץ {log.effort}/10
                                          </span>
                                        )}
                                      </div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {log.actualDistance && (
                                          <span className="text-[11px] font-medium text-muted-foreground bg-white/70 px-2 py-0.5 rounded-full border border-black/5">{log.actualDistance} ק"מ</span>
                                        )}
                                        {log.actualPace && (
                                          <span className="text-[11px] font-medium text-muted-foreground bg-white/70 px-2 py-0.5 rounded-full border border-black/5">{log.actualPace}/ק"מ</span>
                                        )}
                                        {!log.effort && (
                                          <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">הוסף מאמץ</span>
                                        )}
                                      </div>
                                      {log.comment && (
                                        <p className="mt-1.5 text-[11px] text-muted-foreground italic line-clamp-1">"{log.comment}"</p>
                                      )}
                                    </div>
                                  )
                                })()}
                              </div>
                              <Badge
                                variant="outline"
                                className={cn('flex-shrink-0', workoutTypeColors[workout.workout.type])}
                              >
                                {workoutTypeLabels[workout.workout.type]}
                              </Badge>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* Month View */}
      {viewMode === 'month' && (
        <Card>
          <CardContent className="p-4">
            {/* Day Headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {[t.mon, t.tue, t.wed, t.thu, t.fri, t.sat, t.sun].map((day, i) => (
                <div key={i} className="text-center text-sm font-medium text-muted-foreground py-2">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar Grid */}
            <div className="grid grid-cols-7 gap-1">
              {paddedMonthDays.map((day, index) => {
                if (!day) {
                  return <div key={`pad-${index}`} className="aspect-square" />
                }

                const workouts = getWorkoutsForDate(day)
                const today = isToday(day)

                return (
                  <div
                    key={day.toISOString()}
                    className={cn(
                      'p-1 rounded-lg border border-transparent transition-luxury',
                      today && 'border-gold',
                      workouts.length > 0 && 'cursor-pointer hover:bg-muted/50'
                    )}
                  >
                    <div className="flex flex-col gap-0.5">
                      <span className={cn(
                        'text-xs font-medium mb-1',
                        today ? 'text-gold' : 'text-foreground'
                      )}>
                        {format(day, 'd')}
                      </span>
                      {workouts.map((w) => (
                        <div
                          key={w.id}
                          onClick={() => setSelectedWorkout(w)}
                          className={cn(
                            'rounded p-0.5 text-[10px] leading-tight overflow-hidden cursor-pointer hover:opacity-80 flex items-center gap-0.5',
                            workoutTypeColors[w.workout.type]
                          )}
                        >
                          {w.status === 'completed' && <span className="shrink-0">✓</span>}
                          {w.status === 'skipped' && <span className="shrink-0">✗</span>}
                          <span className="line-clamp-1 font-medium flex-1">
                            {w.workout.title}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Workout Detail Dialog */}
      <Dialog open={!!selectedWorkout} onOpenChange={() => setSelectedWorkout(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          {selectedWorkout && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-2">
                  <Badge className={cn('border', workoutTypeColors[selectedWorkout.workout.type])}>
                    {workoutTypeLabels[selectedWorkout.workout.type]}
                  </Badge>
                  {selectedWorkout.status === 'completed' && (
                    <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">
                      {t.completed}
                    </Badge>
                  )}
                </div>
                <DialogTitle className="text-xl font-serif text-navy">
                  <div className="flex items-center justify-between gap-2">
                    <span>{selectedWorkout.workout.title}</span>
                    {isCoach && (
                      <div className="flex gap-2 ml-4">
                        <button
                          onClick={() => {
                            setEditingWorkout(selectedWorkout)
                            setEditDate(selectedWorkout.scheduledDate)
                            setEditWorkout({ ...selectedWorkout.workout })
                          }}
                          className="text-xs px-3 py-1 rounded-md bg-blue-100 text-blue-600 hover:bg-blue-200 transition-colors font-medium"
                        >
                          ✏️ Edit
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm('Delete this workout?')) {
                              handleDeleteWorkout(selectedWorkout.id)
                            }
                          }}
                          className="text-xs px-3 py-1 rounded-md bg-red-100 text-red-600 hover:bg-red-200 transition-colors font-medium"
                        >
                          🗑 Delete
                        </button>
                      </div>
                    )}
                  </div>
                </DialogTitle>
              </DialogHeader>

              <div className="space-y-4">
                <p className="text-muted-foreground">
                  {selectedWorkout.workout.description}
                </p>

                <div className="flex flex-wrap gap-4 text-sm">
                  <span className="text-muted-foreground">
                    {format(parseISO(selectedWorkout.scheduledDate), 'EEEE, MMMM d, yyyy')}
                  </span>
                  {selectedWorkout.workout.duration && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-4 w-4" />
                      {selectedWorkout.workout.duration} {t.min}
                    </span>
                  )}
                  {selectedWorkout.workout.distance && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Activity className="h-4 w-4" />
                      {selectedWorkout.workout.distance} {t.km}
                    </span>
                  )}
                </div>

                {selectedWorkout.workout.warmup && (
                  <div>
                    <h4 className="font-medium text-navy mb-1">{t.warmupHeading}</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedWorkout.workout.warmup}
                    </p>
                  </div>
                )}

                {selectedWorkout.workout.sets && selectedWorkout.workout.sets.length > 0 && (
                  <div>
                    <h4 className="font-medium text-navy mb-2">{t.workoutHeading}</h4>
                    <div className="space-y-2">
                      {(selectedWorkout.workout.sets as any[]).map((set) => {
                        const hasIntervals = set.intervals && set.intervals.length > 0
                        return (
                          <div key={set.id} className="rounded-lg bg-muted/50 text-sm overflow-hidden mb-2">
                            <div className="px-3 py-2 flex items-center justify-between">
                              <span className="font-semibold text-navy">
                                {set.reps > 1 ? `${set.reps}x ` : ''}{!hasIntervals && (set.distance || set.duration)}{!hasIntervals && set.pace && <span className="text-muted-foreground font-normal ml-1"> @ {set.pace}</span>}
                              </span>
                            </div>
                            {hasIntervals && (
                              <div className="border-t border-border/40 divide-y divide-border/30">
                                {set.intervals.map((iv: any, i: number) => (
                                  <div key={iv.id || i} className="px-3 py-1.5 flex items-center justify-between">
                                    <span className="text-navy font-medium">{iv.distance}{iv.pace && <span className="text-muted-foreground font-normal ml-2"> @ {iv.pace}</span>}</span>
                                    {iv.rest && <span className="text-xs text-muted-foreground">{t.restPrefix} {iv.rest}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                            {set.rest && (
                              <div className="px-3 py-1.5 bg-muted/40 border-t border-border/30 text-center">
                                <span className="text-xs text-muted-foreground">{t.restBetweenSets}: {set.rest}</span>
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {selectedWorkout.workout.cooldown && (
                  <div>
                    <h4 className="font-medium text-navy mb-1">{t.cooldownHeading}</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedWorkout.workout.cooldown}
                    </p>
                  </div>
                )}

                {selectedWorkout.workout.notes && (
                  <div>
                    <h4 className="font-medium text-navy mb-1">{t.notesHeading}</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedWorkout.workout.notes}
                    </p>
                  </div>
                )}

                {selectedWorkout.athleteNotes && (
                  <div className="pt-4 border-t border-border">
                    <h4 className="font-medium text-navy mb-1">{t.yourNotesHeading}</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedWorkout.athleteNotes}
                    </p>
                  </div>
                )}

                {selectedWorkout.coachFeedback && (
                  <div className="p-3 rounded-lg bg-gold/10 border border-gold/20">
                    <h4 className="font-medium text-navy mb-1">{t.coachFeedbackHeading}</h4>
                    <p className="text-sm text-foreground">
                      {selectedWorkout.coachFeedback}
                    </p>
                  </div>
                )}

                {/* Workout Log Form */}
                {!readOnly && user?.id && (
                  <WorkoutLogForm
                    workoutId={selectedWorkout.workoutId}
                    assignedWorkoutId={selectedWorkout.id}
                    athleteId={athleteId}
                    scheduledDate={selectedWorkout.scheduledDate}
                    workout={selectedWorkout.workout}
                  />
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

    {/* Edit Workout Modal */}
    {editingWorkout && (
      <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto">
        <div className="bg-background rounded-xl shadow-xl p-6 w-full max-w-lg mx-auto my-8">
          <h2 className="text-lg font-bold text-navy mb-1 user-content">Edit Workout — {editingWorkout.workout.title}</h2>
          <p className="text-xs text-muted-foreground mb-4">Changes apply only to this athlete's copy</p>

          {/* Date */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              value={editDate}
              onChange={e => setEditDate(e.target.value)}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
            />
          </div>

          {/* Warmup */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Warmup</label>
            <input
              type="text"
              value={editWorkout.warmup || ''}
              onChange={e => setEditWorkout(w => ({ ...w, warmup: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              placeholder="e.g. 3km easy run, dynamic exercises"
            />
          </div>

          {/* Sets */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium">Sets</label>
              <button
                onClick={() => setEditWorkout(w => ({
                  ...w,
                  sets: [...(w.sets || []), { id: Date.now().toString(), reps: 1, distance: '', pace: '', rest: '' }]
                }))}
                className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
              >
                + Add Set
              </button>
            </div>
            <div className="space-y-3">
              {(editWorkout.sets || []).map((set, si) => (
                <div key={set.id} className="border border-border rounded-lg p-3 bg-muted/30">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-muted-foreground">SET {si + 1}</span>
                    <button
                      onClick={() => setEditWorkout(w => ({ ...w, sets: w.sets?.filter((_, i) => i !== si) }))}
                      className="text-xs text-red-500 hover:text-red-700"
                    >✕ Remove</button>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mb-2">
                    <div>
                      <label className="text-xs text-muted-foreground">Reps</label>
                      <input type="number" value={set.reps} min={1}
                        onChange={e => setEditWorkout(w => ({ ...w, sets: w.sets?.map((s, i) => i === si ? { ...s, reps: +e.target.value } : s) }))}
                        className="w-full border border-border rounded px-2 py-1 text-sm bg-background mt-1" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Distance</label>
                      <input type="text" value={set.distance || ''} placeholder="e.g. 400m"
                        onChange={e => setEditWorkout(w => ({ ...w, sets: w.sets?.map((s, i) => i === si ? { ...s, distance: e.target.value } : s) }))}
                        className="w-full border border-border rounded px-2 py-1 text-sm bg-background mt-1" />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground">Pace</label>
                      <input type="text" value={set.pace || ''} placeholder="e.g. 4:30"
                        onChange={e => setEditWorkout(w => ({ ...w, sets: w.sets?.map((s, i) => i === si ? { ...s, pace: e.target.value } : s) }))}
                        className="w-full border border-border rounded px-2 py-1 text-sm bg-background mt-1" />
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground">Rest</label>
                    <input type="text" value={set.rest || ''} placeholder="e.g. 90 sec"
                      onChange={e => setEditWorkout(w => ({ ...w, sets: w.sets?.map((s, i) => i === si ? { ...s, rest: e.target.value } : s) }))}
                      className="w-full border border-border rounded px-2 py-1 text-sm bg-background mt-1" />
                  </div>

                  {/* Intervals */}
                  <div className="mt-3 border-t border-border/40 pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Intervals in this set</span>
                      <button
                        onClick={() => setEditWorkout(w => ({
                          ...w,
                          sets: w.sets?.map((s, i) => i === si ? {
                            ...s,
                            intervals: [...(s.intervals || []), { id: `int-${Date.now()}`, distance: '', pace: '', rest: '' }]
                          } : s)
                        }))}
                        className="text-xs px-2 py-1 rounded bg-muted hover:bg-muted/80 transition-colors"
                      >
                        + Add interval
                      </button>
                    </div>
                    {(set.intervals || []).map((iv: any, ii: number) => (
                      <div key={iv.id || ii} className="grid grid-cols-4 gap-2 items-end bg-muted/20 rounded-lg p-2 mb-1">
                        <div>
                          <label className="text-xs text-muted-foreground">Distance</label>
                          <input type="text" value={iv.distance || ''} placeholder="e.g. 400m"
                            onChange={e => setEditWorkout(w => ({
                              ...w,
                              sets: w.sets?.map((s, i) => i === si ? {
                                ...s,
                                intervals: (s.intervals || []).map((iv2: any, j: number) => j === ii ? { ...iv2, distance: e.target.value } : iv2)
                              } : s)
                            }))}
                            className="w-full border border-border rounded px-2 py-1 text-sm bg-background mt-1" />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Pace</label>
                          <input type="text" value={iv.pace || ''} placeholder="e.g. 4:30"
                            onChange={e => setEditWorkout(w => ({
                              ...w,
                              sets: w.sets?.map((s, i) => i === si ? {
                                ...s,
                                intervals: (s.intervals || []).map((iv2: any, j: number) => j === ii ? { ...iv2, pace: e.target.value } : iv2)
                              } : s)
                            }))}
                            className="w-full border border-border rounded px-2 py-1 text-sm bg-background mt-1" />
                        </div>
                        <div>
                          <label className="text-xs text-muted-foreground">Rest after</label>
                          <input type="text" value={iv.rest || ''} placeholder="e.g. 90 sec"
                            onChange={e => setEditWorkout(w => ({
                              ...w,
                              sets: w.sets?.map((s, i) => i === si ? {
                                ...s,
                                intervals: (s.intervals || []).map((iv2: any, j: number) => j === ii ? { ...iv2, rest: e.target.value } : iv2)
                              } : s)
                            }))}
                            className="w-full border border-border rounded px-2 py-1 text-sm bg-background mt-1" />
                        </div>
                        <button
                          onClick={() => setEditWorkout(w => ({
                            ...w,
                            sets: w.sets?.map((s, i) => i === si ? {
                              ...s,
                              intervals: (s.intervals || []).filter((_: any, j: number) => j !== ii)
                            } : s)
                          }))}
                          className="text-xs text-red-500 hover:text-red-700 pb-1"
                        >✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Cooldown */}
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Cooldown</label>
            <input
              type="text"
              value={editWorkout.cooldown || ''}
              onChange={e => setEditWorkout(w => ({ ...w, cooldown: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background"
              placeholder="e.g. 10 min easy jog"
            />
          </div>

          {/* Notes */}
          <div className="mb-6">
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea
              value={editWorkout.notes || ''}
              onChange={e => setEditWorkout(w => ({ ...w, notes: e.target.value }))}
              className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none user-content"
              rows={2}
              placeholder="Any additional notes..."
            />
          </div>

          <div className="flex gap-2 justify-end">
            <button
              onClick={() => setEditingWorkout(null)}
              className="px-4 py-2 text-sm rounded-lg border border-border hover:bg-muted transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleEditSave}
              disabled={isSavingEdit}
              className="px-4 py-2 text-sm rounded-lg bg-navy text-white hover:bg-navy/90 transition-colors disabled:opacity-50"
            >
              {isSavingEdit ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    )}
    </div>
  )
}
