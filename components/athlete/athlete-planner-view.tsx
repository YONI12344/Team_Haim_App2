'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import {
  ChevronLeft, ChevronRight, Loader2, MapPin,
  Clock, Calendar, CheckCircle2, SkipForward, MessageSquare,
} from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, eachDayOfInterval, isSameMonth,
  isSameDay, isToday, parseISO,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase'
import {
  collection, doc, getDoc, getDocs, query,
  where, updateDoc, serverTimestamp,
} from 'firebase/firestore'
import type { AthleteProfile, Workout, AssignedWorkout, TrainingDayType } from '@/lib/types'
import { listJourneys, computeJourneyProgress } from '@/lib/journey'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'

const WEEKDAY_KEYS = [
  'sunday','monday','tuesday','wednesday','thursday','friday','saturday',
] as const

const DAY_BG: Record<string, string> = {
  rest: 'bg-muted/30', off: 'bg-muted/10',
  easy: 'bg-emerald-50', workout: 'bg-blue-50', long_run: 'bg-orange-50',
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

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  skipped:   'bg-red-100 text-red-600 border-red-200',
  scheduled: 'bg-amber-100 text-amber-700 border-amber-200',
  modified:  'bg-blue-100 text-blue-700 border-blue-200',
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

export function AthletePlannerView({ athleteId }: Props) {
  const { loading: authLoading } = useAuth()

  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  const [journey, setJourney] = useState<JourneySummary | null>(null)
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [loading, setLoading] = useState(true)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date())

  // Comment / status editing state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [commentDraft, setCommentDraft] = useState('')
  const [saving, setSaving] = useState(false)

  // ── Load profile + journey ────────────────────────────────────────────────
  useEffect(() => {
    if (!athleteId) return
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
            personalRecords: [],
            seasonBests: [],
            trainingPaces: [],
            goals: [],
            weekSchedule: d.weekSchedule,
            weeklyKmRange: d.weeklyKmRange,
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
      } catch (err) {
        console.error('Error loading athlete planner:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [athleteId])

  // ── Load ALL workouts for athlete (simple query, no composite index needed) ──
  useEffect(() => {
    if (!athleteId || authLoading) return
    const loadAll = async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'assignedWorkouts'),
          where('athleteId', '==', athleteId),
        ))
        setAssignedWorkouts(snap.docs.map(d => ({
          ...(d.data() as AssignedWorkout), id: d.id,
        })))
      } catch (err) {
        console.error('Error loading workouts:', err)
      }
    }
    loadAll()
  }, [athleteId, authLoading])

  // ── Calendar helpers ──────────────────────────────────────────────────────
  const calendarWeeks = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 })
    const end   = endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 0 })
    const days  = eachDayOfInterval({ start, end })
    const weeks: Date[][] = []
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i + 7))
    return weeks
  }, [currentMonth])

  const monthWorkouts = useMemo(() => {
    const from = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
    const to   = format(endOfMonth(currentMonth),   'yyyy-MM-dd')
    return assignedWorkouts.filter(w => w.scheduledDate >= from && w.scheduledDate <= to)
  }, [assignedWorkouts, currentMonth])

  const getWorkoutsForDay = useCallback((date: Date) => {
    const s = format(date, 'yyyy-MM-dd')
    return monthWorkouts.filter(w => w.scheduledDate === s)
  }, [monthWorkouts])

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

  // ── Save comment ──────────────────────────────────────────────────────────
  const saveComment = async (workoutDocId: string) => {
    setSaving(true)
    try {
      await updateDoc(doc(db, 'assignedWorkouts', workoutDocId), {
        athleteNotes: commentDraft,
        updatedAt: serverTimestamp(),
      })
      setAssignedWorkouts(prev => prev.map(w =>
        w.id === workoutDocId ? { ...w, athleteNotes: commentDraft } : w
      ))
      setEditingId(null)
      toast.success('Comment saved!')
    } catch {
      toast.error('Failed to save comment')
    } finally {
      setSaving(false)
    }
  }

  // ── Update status ─────────────────────────────────────────────────────────
  const updateStatus = async (workoutDocId: string, status: AssignedWorkout['status']) => {
    try {
      await updateDoc(doc(db, 'assignedWorkouts', workoutDocId), {
        status,
        updatedAt: serverTimestamp(),
      })
      setAssignedWorkouts(prev => prev.map(w =>
        w.id === workoutDocId ? { ...w, status } : w
      ))
      toast.success(`Marked as ${status}`)
    } catch {
      toast.error('Failed to update status')
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )

  const selectedDayWorkouts = selectedDate ? getWorkoutsForDay(selectedDate) : []
  const selectedDayType     = selectedDate ? getDayType(selectedDate) : 'rest'

  return (
    <div className="space-y-4">

      {/* ── Info Banner ── */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

        {/* Stage */}
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
              <p className="text-sm text-muted-foreground">No training plan yet</p>
            )}
          </CardContent>
        </Card>

        {/* KM */}
        <Card className="border-gold/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">This Week KM</p>
            {athlete?.weeklyKmRange ? (
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
                    ? '✓ Weekly target reached!'
                    : `${athlete.weeklyKmRange.min - thisWeekKm}–${athlete.weeklyKmRange.max - thisWeekKm} km to go`}
                </p>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No km target set yet</p>
            )}
          </CardContent>
        </Card>

        {/* Schedule template */}
        <Card>
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">Weekly Template</p>
            {athlete?.weekSchedule ? (
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
              <p className="text-sm text-muted-foreground">No template set yet</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Calendar + Day Panel ── */}
      <div className="grid lg:grid-cols-3 gap-4">

        {/* Calendar */}
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-4">
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(m => subMonths(m, 1))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <h2 className="font-semibold text-navy text-lg">{format(currentMonth, 'MMMM yyyy')}</h2>
                <Button variant="ghost" size="sm" onClick={() => setCurrentMonth(m => addMonths(m, 1))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>

              <div className="grid grid-cols-8 gap-1 mb-1">
                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d => (
                  <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
                ))}
                <div className="text-center text-xs font-medium text-muted-foreground py-1">KM</div>
              </div>

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
                        const hasCompleted = dayWorkouts.some(w => w.status === 'completed')
                        return (
                          <button
                            key={di}
                            onClick={() => {
                              setSelectedDate(day)
                              setEditingId(null)
                              setCommentDraft('')
                            }}
                            className={cn(
                              'min-h-[72px] rounded-lg p-1.5 text-left border transition-all',
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
                              {hasCompleted && <span className="text-emerald-500 text-[10px]">✓</span>}
                              {!hasCompleted && inMonth && dayType !== 'rest' && dayType !== 'off' && (
                                <span className={cn('w-1.5 h-1.5 rounded-full', DAY_DOT[dayType])} />
                              )}
                            </div>
                            <div className="space-y-0.5">
                              {dayWorkouts.slice(0,2).map(w => (
                                <div key={w.id} className={cn(
                                  'text-[10px] leading-tight rounded px-1 py-0.5 truncate',
                                  w.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                                  w.status === 'skipped'   ? 'bg-red-50 text-red-500 line-through' :
                                  'bg-white/80 text-navy'
                                )}>
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
                            {athlete?.weeklyKmRange && (
                              <p className={cn('text-[9px] mt-0.5',
                                weekKm >= athlete.weeklyKmRange.min ? 'text-emerald-600' : 'text-amber-600')}>
                                {weekKm >= athlete.weeklyKmRange.min ? '✓' : `↑${athlete.weeklyKmRange.min - weekKm}`}
                              </p>
                            )}
                          </>
                        ) : <p className="text-[10px] text-muted-foreground">—</p>}
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
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-500 text-sm">✓</span>
                  <span className="text-xs text-muted-foreground">Completed</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Day Panel ── */}
        <div>
          <Card className="sticky top-4">
            <CardContent className="pt-4">
              {selectedDate ? (
                <div className="space-y-4">
                  <div className="border-b pb-3">
                    <h3 className="font-bold text-navy text-lg">{format(selectedDate, 'EEEE')}</h3>
                    <p className="text-sm text-muted-foreground">{format(selectedDate, 'MMMM d, yyyy')}</p>
                    <Badge variant="outline" className={cn('mt-1.5 text-xs capitalize', DAY_BADGE[selectedDayType])}>
                      {selectedDayType.replace('_',' ')} day
                    </Badge>
                  </div>

                  {selectedDayWorkouts.length === 0 ? (
                    <div className="text-center py-6 text-muted-foreground">
                      <p className="text-sm">No workout assigned for this day</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {selectedDayWorkouts.map(w => (
                        <div key={w.id} className="space-y-3 rounded-xl border border-border p-3">

                          {/* Workout info */}
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-navy">{w.workout.title}</p>
                              <Badge variant="outline" className={cn('text-xs capitalize flex-shrink-0', STATUS_STYLES[w.status])}>
                                {w.status}
                              </Badge>
                            </div>
                            <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                              {w.workout.distance && (
                                <span className="flex items-center gap-1">
                                  <MapPin className="h-3 w-3" />{w.workout.distance} km
                                </span>
                              )}
                              {w.workout.duration && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3 w-3" />{w.workout.duration} min
                                </span>
                              )}
                            </div>
                            {w.workout.description && (
                              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                                {w.workout.description}
                              </p>
                            )}
                          </div>

                          {/* Status buttons */}
                          {w.status !== 'completed' && (
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50 text-xs h-8"
                                onClick={() => updateStatus(w.id, 'completed')}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                                Done
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="flex-1 border-red-200 text-red-600 hover:bg-red-50 text-xs h-8"
                                onClick={() => updateStatus(w.id, 'skipped')}
                              >
                                <SkipForward className="h-3.5 w-3.5 mr-1" />
                                Skip
                              </Button>
                            </div>
                          )}
                          {w.status === 'completed' && (
                            <Button
                              size="sm" variant="outline"
                              className="w-full text-xs h-8 text-muted-foreground"
                              onClick={() => updateStatus(w.id, 'scheduled')}
                            >
                              Undo completion
                            </Button>
                          )}

                          {/* Comment */}
                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
                              <MessageSquare className="h-3 w-3" />My Note
                            </p>
                            {editingId === w.id ? (
                              <div className="space-y-2">
                                <Textarea
                                  value={commentDraft}
                                  onChange={e => setCommentDraft(e.target.value)}
                                  placeholder="How did it go? Any notes for your coach..."
                                  className="text-sm min-h-[80px] resize-none"
                                  autoFocus
                                />
                                <div className="flex gap-2">
                                  <Button
                                    size="sm"
                                    className="flex-1 bg-gold hover:bg-gold/90 text-navy text-xs h-8"
                                    onClick={() => saveComment(w.id)}
                                    disabled={saving}
                                  >
                                    {saving ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                                    Save
                                  </Button>
                                  <Button
                                    size="sm" variant="outline"
                                    className="text-xs h-8"
                                    onClick={() => setEditingId(null)}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <button
                                className="w-full text-left"
                                onClick={() => {
                                  setEditingId(w.id)
                                  setCommentDraft(w.athleteNotes || '')
                                }}
                              >
                                {w.athleteNotes ? (
                                  <p className="text-sm text-navy bg-muted/50 rounded-lg p-2 border border-border hover:border-gold/50 transition-colors">
                                    {w.athleteNotes}
                                  </p>
                                ) : (
                                  <p className="text-sm text-muted-foreground italic bg-muted/30 rounded-lg p-2 border border-dashed border-border hover:border-gold/50 transition-colors">
                                    Tap to add a note…
                                  </p>
                                )}
                              </button>
                            )}
                          </div>

                          {/* Coach feedback */}
                          {w.coachFeedback && (
                            <div className="space-y-1 border-t pt-2">
                              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                                Coach Feedback
                              </p>
                              <p className="text-sm text-navy bg-gold/5 rounded-lg p-2 border border-gold/20">
                                {w.coachFeedback}
                              </p>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-10 text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm font-medium">Click any day</p>
                  <p className="text-xs mt-1">to see your workout</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
