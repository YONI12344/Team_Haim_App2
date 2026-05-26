'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Loader2, MapPin, Clock, Calendar } from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, eachDayOfInterval, isSameMonth,
  isSameDay, isToday, parseISO,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { AthleteProfile, AssignedWorkout, TrainingDayType } from '@/lib/types'
import { listJourneys, computeJourneyProgress } from '@/lib/journey'
import { useAuth } from '@/contexts/auth-context'
import { WorkoutLogForm } from '@/components/athlete/workout-log-form'

const WEEKDAY_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const

const DAY_BG: Record<string, string> = {
  rest: 'bg-muted/30', off: 'bg-muted/10',
  easy: 'bg-emerald-50', workout: 'bg-blue-50', long_run: 'bg-orange-50',
}
const DAY_DOT: Record<string, string> = {
  rest: 'bg-gray-300', off: 'bg-gray-200',
  easy: 'bg-emerald-400', workout: 'bg-blue-400', long_run: 'bg-orange-400',
}
const DAY_BADGE: Record<string, string> = {
  rest: 'bg-muted text-muted-foreground', off: 'bg-muted/50 text-muted-foreground',
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

const DAY_TYPE_HE: Record<string, string> = {
  long_run: 'ריצה ארוכה', workout: 'יום אימון',
  easy: 'ריצה קלה', rest: 'מנוחה', off: 'יום חופשי',
}

interface JourneySummary {
  stageName: string; weekInStage: number; totalWeeksInStage: number
  isOffWeek: boolean; goalRaceDate: string; goalRaceEvent: string
}

export function AthletePlannerView() {
  const { user } = useAuth()
  const athleteId = user?.id || ''
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  const [journey, setJourney] = useState<JourneySummary | null>(null)
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [loading, setLoading] = useState(true)
  const [currentMonth, setCurrentMonth] = useState(new Date())
  const [viewMode, setViewMode] = useState<'month' | 'week'>('month')
  const [selectedDate, setSelectedDate] = useState<Date | null>(new Date())

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
              const cur   = Math.max(1, Math.ceil((today.getTime()-s.getTime())/(7*86400000)))
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
    if (!athleteId ) return
    getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId)))
      .then(snap => setAssignedWorkouts(snap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id }))))
      .catch(err => console.error('Error loading workouts:', err))
  }, [athleteId])

  const calendarWeeks = useMemo(() => {
    const days = eachDayOfInterval({
      start: startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 0 }),
      end:   endOfWeek(endOfMonth(currentMonth),     { weekStartsOn: 0 }),
    })
    const weeks: Date[][] = []
    for (let i = 0; i < days.length; i += 7) weeks.push(days.slice(i, i+7))
    return weeks
  }, [currentMonth])

  const currentWeekDays = useMemo(() => {
    const anchor = selectedDate || new Date()
    return eachDayOfInterval({
      start: startOfWeek(anchor, { weekStartsOn: 0 }),
      end: endOfWeek(anchor, { weekStartsOn: 0 }),
    })
  }, [selectedDate])

  const monthWorkouts = useMemo(() => {
    const from = format(startOfMonth(currentMonth), 'yyyy-MM-dd')
    const to   = format(endOfMonth(currentMonth),   'yyyy-MM-dd')
    return assignedWorkouts.filter(w => w.scheduledDate >= from && w.scheduledDate <= to)
  }, [assignedWorkouts, currentMonth])

  const getWorkoutsForDay = useCallback((date: Date) =>
    monthWorkouts.filter(w => w.scheduledDate === format(date, 'yyyy-MM-dd'))
  , [monthWorkouts])

  const getWeekKm = useCallback((week: Date[]) =>
    week.reduce((sum, day) => sum + getWorkoutsForDay(day).reduce((s,w) => s+(w.workout?.distance??0),0), 0)
  , [getWorkoutsForDay])

  const getDayType = useCallback((date: Date): TrainingDayType => {
    if (!athlete?.weekSchedule) return 'rest'
    return (athlete.weekSchedule[WEEKDAY_KEYS[date.getDay()]] as TrainingDayType) || 'rest'
  }, [athlete])

  const thisWeekKm = useMemo(() => {
    const from = format(startOfWeek(new Date(),{weekStartsOn:1}), 'yyyy-MM-dd')
    const to   = format(endOfWeek(new Date(),  {weekStartsOn:1}), 'yyyy-MM-dd')
    return assignedWorkouts.filter(w => w.scheduledDate>=from && w.scheduledDate<=to)
      .reduce((s,w) => s+(w.workout?.distance??0), 0)
  }, [assignedWorkouts])

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )

  const selectedDayWorkouts = selectedDate ? getWorkoutsForDay(selectedDate) : []
  const selectedDayType     = selectedDate ? getDayType(selectedDate) : 'rest'

  return (
    <div className="space-y-4">
      {/* Info Banner */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Card className="border-navy/20">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">שלב נוכחי</p>
            {journey ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-navy/10 text-navy border-navy/20">{journey.stageName}</Badge>
                  <span className="text-sm font-semibold text-navy">שבוע {journey.weekInStage}/{journey.totalWeeksInStage}</span>
                  <Badge variant="outline" className={cn('text-xs', journey.isOffWeek
                    ? 'bg-amber-100 text-amber-700 border-amber-200'
                    : 'bg-emerald-100 text-emerald-700 border-emerald-200')}>
                    {journey.isOffWeek ? 'שבוע מנוחה' : 'שבוע אימון'}
                  </Badge>
                </div>
                {journey.goalRaceEvent && (
                  <p className="text-xs text-muted-foreground">{journey.goalRaceEvent} · {format(parseISO(journey.goalRaceDate),'MMM d, yyyy')}</p>
                )}
              </div>
            ) : <p className="text-sm text-muted-foreground">אין תוכנית אימונים עדיין</p>}
          </CardContent>
        </Card>

        <Card className="border-gold/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">ק"מ השבוע</p>
            {athlete?.weeklyKmRange ? (
              <div className="space-y-1.5">
                <div className="flex items-end gap-2">
                  <span className="text-2xl font-bold text-navy">{thisWeekKm}</span>
                  <span className="text-sm text-muted-foreground mb-0.5">/ {athlete.weeklyKmRange.min}–{athlete.weeklyKmRange.max} ק"מ</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className={cn('h-2 rounded-full transition-all', thisWeekKm >= athlete.weeklyKmRange.min ? 'bg-emerald-500' : 'bg-gold')}
                    style={{width:`${Math.min(100,(thisWeekKm/athlete.weeklyKmRange.max)*100)}%`}} />
                </div>
                <p className="text-xs text-muted-foreground">
                  {thisWeekKm >= athlete.weeklyKmRange.min ? 'יעד השבוע הושג!' : `נותרו ${athlete.weeklyKmRange.min-thisWeekKm}–${athlete.weeklyKmRange.max-thisWeekKm} ק"מ`}
                </p>
              </div>
            ) : <p className="text-sm text-muted-foreground">לא הוגדר יעד ק"מ</p>}
          </CardContent>
        </Card>


      </div>

      {/* Calendar + Day Panel */}
      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2">
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center justify-between mb-4">
                <Button variant="ghost" size="sm" onClick={() => {
                  if (viewMode === 'month') setCurrentMonth(m => subMonths(m,1))
                  else setSelectedDate(d => subWeeks(d || new Date(), 1))
                }}><ChevronLeft className="h-4 w-4"/></Button>
                <div className="flex flex-col items-center gap-1">
                  <h2 className="font-semibold text-navy text-lg">
                    {viewMode === 'month'
                      ? format(currentMonth,'MMMM yyyy')
                      : `${format(currentWeekDays[0],'MMM d')} – ${format(currentWeekDays[6],'MMM d, yyyy')}`}
                  </h2>
                  <div className="flex gap-1 bg-muted rounded-full p-0.5">
                    <button onClick={() => setViewMode('month')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='month' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>חודש</button>
                    <button onClick={() => setViewMode('week')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='week' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>שבוע</button>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={() => {
                  if (viewMode === 'month') setCurrentMonth(m => addMonths(m,1))
                  else setSelectedDate(d => addWeeks(d || new Date(), 1))
                }}><ChevronRight className="h-4 w-4"/></Button>
              </div>
              {viewMode === 'week' ? (
                <div className="space-y-2">
                  {currentWeekDays.map((day, di) => {
                    const dayWorkouts = getWorkoutsForDay(day)
                    const dayType = getDayType(day)
                    const isSelected = selectedDate ? isSameDay(day, selectedDate) : false
                    const todayFlag = isToday(day)
                    return (
                      <button key={di} onClick={() => setSelectedDate(day)}
                        className={cn('w-full text-left rounded-xl border p-3 transition-all', DAY_BG[dayType],
                          isSelected ? 'ring-2 ring-gold border-gold' : 'border-border hover:border-gold/50',
                          todayFlag && !isSelected && 'border-gold/40'
                        )}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={cn('text-sm font-bold', todayFlag ? 'w-6 h-6 flex items-center justify-center bg-gold text-white rounded-full text-xs' : 'text-navy')}>
                              {format(day,'d')}
                            </span>
                            <span className="text-sm font-medium text-navy">{format(day,'EEEE')}</span>
                            <Badge variant="outline" className={cn('text-[10px]', DAY_BADGE[dayType])}>
                              {DAY_TYPE_HE[dayType] || dayType}
                            </Badge>
                          </div>
                          {dayWorkouts.length > 0 && (
                            <span className="text-xs text-muted-foreground">{dayWorkouts.length} אימון</span>
                          )}
                        </div>
                        {dayWorkouts.length > 0 && (
                          <div className="mt-2 space-y-1">
                            {dayWorkouts.map(w => (
                              <div key={w.id} className={cn('text-xs rounded-lg px-2 py-1.5 flex items-center justify-between',
                                w.status==='completed'?'bg-emerald-100 text-emerald-700':
                                w.status==='skipped'?'bg-red-50 text-red-500 line-through':'bg-white/80 text-navy border border-border/50'
                              )}>
                                <span className="font-medium">{w.workout.title}</span>
                                <span className="text-muted-foreground">{w.workout.distance ? `${w.workout.distance} ק"מ` : w.workout.duration ? `${w.workout.duration} דק'` : ''}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </button>
                    )
                  })}
                </div>
              ) : (
                <>
              <div className="grid grid-cols-8 gap-1 mb-1">
                {['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳'].map(d => (
                  <div key={d} className="text-center text-xs font-medium text-muted-foreground py-1">{d}</div>
                ))}
                <div className="text-center text-xs font-medium text-muted-foreground py-1">ק"מ</div>
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
                        const hasCompleted = dayWorkouts.some(w => w.status==='completed')
                        return (
                          <button key={di} onClick={() => setSelectedDate(day)}
                            className={cn(
                              'min-h-[72px] rounded-lg p-1.5 text-left border transition-all',
                              !inMonth && 'opacity-25 pointer-events-none',
                              inMonth && DAY_BG[dayType],
                              isSelected ? 'ring-2 ring-gold border-gold' : 'border-border hover:border-gold/50',
                              todayFlag && !isSelected && 'border-gold/40',
                            )}>
                            <div className="flex items-center justify-between mb-1">
                              <span className={cn('text-xs font-semibold', todayFlag
                                ? 'w-5 h-5 flex items-center justify-center bg-gold text-white rounded-full text-[10px]'
                                : 'text-navy')}>
                                {format(day,'d')}
                              </span>
                              {hasCompleted && <span className="text-emerald-500 text-[10px]">✓</span>}
                              {!hasCompleted && inMonth && dayType!=='rest' && dayType!=='off' && (
                                <span className={cn('w-1.5 h-1.5 rounded-full', DAY_DOT[dayType])} />
                              )}
                            </div>
                            <div className="space-y-0.5">
                              {dayWorkouts.slice(0,2).map(w => (
                                <div key={w.id} className={cn(
                                  'text-[10px] leading-tight rounded px-1 py-0.5 truncate',
                                  w.status==='completed'?'bg-emerald-100 text-emerald-700':
                                  w.status==='skipped'?'bg-red-50 text-red-500 line-through':'bg-white/80 text-navy'
                                )}>
                                  {w.workout.title}{w.workout.distance?` ${w.workout.distance}k`:''}
                                </div>
                              ))}
                              {dayWorkouts.length>2 && <p className="text-[10px] text-muted-foreground">+{dayWorkouts.length-2}</p>}
                            </div>
                          </button>
                        )
                      })}
                      <div className="flex flex-col items-center justify-center rounded-lg bg-muted/30 px-1">
                        {weekKm>0 ? (
                          <>
                            <p className="text-sm font-bold text-navy">{weekKm}</p>
                            <p className="text-[10px] text-muted-foreground">ק"מ</p>
                            {athlete?.weeklyKmRange && (
                              <p className={cn('text-[9px] mt-0.5', weekKm>=athlete.weeklyKmRange.min?'text-emerald-600':'text-amber-600')}>
                                {weekKm>=athlete.weeklyKmRange.min?'✓':`↑${athlete.weeklyKmRange.min-weekKm}`}
                              </p>
                            )}
                          </>
                        ) : <p className="text-[10px] text-muted-foreground">—</p>}
                      </div>
                    </div>
                  )
                })}
              </div>
              <div className="flex gap-4 mt-3 flex-wrap border-t pt-3">
                {[['easy','bg-emerald-400','קל'],['workout','bg-blue-400','אימון'],['long_run','bg-orange-400','ארוך']].map(([,dot,label]) => (
                  <div key={label} className="flex items-center gap-1.5">
                    <span className={cn('w-2.5 h-2.5 rounded-full', dot)} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                ))}
                <div className="flex items-center gap-1.5">
                  <span className="text-emerald-500 text-sm">✓</span>
                  <span className="text-xs text-muted-foreground">הושלם</span>
                </div>
              </div>
              </>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Day Panel */}
        <div>
          <Card className="sticky top-4">
            <CardContent className="pt-4">
              {selectedDate ? (
                <div className="space-y-4 max-h-[80vh] overflow-y-auto pr-1">
                  <div className="border-b pb-3">
                    <h3 className="font-bold text-navy text-lg">{format(selectedDate,'EEEE')}</h3>
                    <p className="text-sm text-muted-foreground">{format(selectedDate,'MMMM d, yyyy')}</p>
                    <Badge variant="outline" className={cn('mt-1.5 text-xs', DAY_BADGE[selectedDayType])}>
                      {DAY_TYPE_HE[selectedDayType] || selectedDayType}
                    </Badge>
                  </div>

                  {selectedDayWorkouts.length===0 ? (
                    <div className="text-center py-6 text-muted-foreground">
                      <p className="text-sm">אין אימון מתוכנן ליום זה</p>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {selectedDayWorkouts.map(w => (
                        <div key={w.id} className="space-y-3 rounded-xl border border-border p-3">

                          {/* Header */}
                          <div>
                            <div className="flex items-start justify-between gap-2">
                              <p className="font-semibold text-navy">{w.workout.title}</p>
                              <Badge variant="outline" className={cn('text-xs flex-shrink-0', STATUS_STYLES[w.status])}>
                                {w.status==='completed'?'הושלם':w.status==='skipped'?'דולג':w.status==='scheduled'?'מתוכנן':w.status}
                              </Badge>
                            </div>
                            <div className="flex gap-3 mt-1 text-xs text-muted-foreground">
                              {w.workout.distance && <span className="flex items-center gap-1"><MapPin className="h-3 w-3"/>{w.workout.distance} ק"מ</span>}
                              {w.workout.duration && <span className="flex items-center gap-1"><Clock className="h-3 w-3"/>{w.workout.duration} דק'</span>}
                            </div>
                            {w.workout.description && (
                              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{w.workout.description}</p>
                            )}
                          </div>

                          {/* Warmup */}
                          {w.workout.warmup && (
                            <div className="bg-emerald-50 rounded-lg p-2.5 border border-emerald-100">
                              <p className="text-xs font-semibold text-emerald-700 mb-1">חימום</p>
                              <p className="text-xs text-emerald-800">{w.workout.warmup}</p>
                            </div>
                          )}

                          {/* Sets */}
                          {w.workout.sets && w.workout.sets.length>0 && (
                            <div className="space-y-2">
                              <p className="text-xs font-semibold text-navy uppercase tracking-wide border-b pb-1 mb-2">סטים</p>
                              {w.workout.sets.map((set, si) => {
                                const hasIntervals = set.intervals && set.intervals.length > 0
                                return (
                                  <div key={set.id||si} className="rounded-lg border border-border overflow-hidden">
                                    <div className="bg-navy/5 px-3 py-2 flex items-center justify-between">
                                      <span className="text-xs font-bold text-navy">
                                        סט {si+1}{set.reps > 1 ? ` · ${set.reps} חזרות` : ''}
                                        {!hasIntervals && (set.distance||set.duration) && (
                                          <span className="font-semibold"> · {set.distance||set.duration}</span>
                                        )}
                                        {!hasIntervals && set.pace && (
                                          <span className="font-normal text-muted-foreground"> @ {set.pace}</span>
                                        )}
                                      </span>
                                      {set.rest && (
                                        <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">מנוחה: {set.rest}</span>
                                      )}
                                    </div>
                                    {hasIntervals ? (
                                      <div className="px-3 py-2 space-y-1.5">
                                        {(set.intervals as any[]).map((interval: any, ii: number) => (
                                          <div key={interval.id||ii} className="flex items-center gap-2 text-xs bg-white/70 rounded-lg px-2.5 py-2 border border-border/50">
                                            <span className="w-5 h-5 rounded-full bg-navy text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0">{ii+1}</span>
                                            <span className="font-bold text-navy text-sm">{interval.distance}</span>
                                            {interval.pace && <span className="text-muted-foreground">@ {interval.pace}</span>}
                                            {interval.rest && <span className="text-muted-foreground ml-auto">מנוחה: {interval.rest}</span>}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      set.notes && <p className="px-3 py-1.5 text-xs text-muted-foreground">{set.notes}</p>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}

                          {/* Cooldown */}
                          {w.workout.cooldown && (
                            <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
                              <p className="text-xs font-semibold text-blue-700 mb-1">שחרור</p>
                              <p className="text-xs text-blue-800">{w.workout.cooldown}</p>
                            </div>
                          )}

                          {/* Coach Notes */}
                          {w.workout.notes && (
                            <div className="bg-muted/30 rounded-lg p-2.5">
                              <p className="text-xs font-semibold text-muted-foreground mb-1">הערות מאמן</p>
                              <p className="text-xs text-navy">{w.workout.notes}</p>
                            </div>
                          )}

                          {/* Coach Feedback */}
                          {w.coachFeedback && (
                            <div className="bg-gold/5 rounded-lg p-2.5 border border-gold/20">
                              <p className="text-xs font-semibold text-gold mb-1">משוב מאמן</p>
                              <p className="text-xs text-navy">{w.coachFeedback}</p>
                            </div>
                          )}

                          {/* Log Form */}
                          <WorkoutLogForm
                            workoutId={w.workoutId}
                            assignedWorkoutId={w.id}
                            athleteId={athleteId}
                            scheduledDate={w.scheduledDate}
                            workout={w.workout}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-10 text-muted-foreground">
                  <Calendar className="h-10 w-10 mx-auto mb-3 opacity-30"/>
                  <p className="text-sm font-medium">לחץ על יום בלוח</p>
                  <p className="text-xs mt-1">לצפייה באימון</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
