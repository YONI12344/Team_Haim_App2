'use client'

import { useEffect, useState, useMemo, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ChevronLeft, ChevronRight, Loader2, MapPin, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import {
  format, startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  addMonths, subMonths, addWeeks, subWeeks, eachDayOfInterval, isSameMonth,
  isSameDay, isToday, parseISO, eachWeekOfInterval,
} from 'date-fns'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import type { AthleteProfile, AssignedWorkout, TrainingDayType } from '@/lib/types'
import { listJourneys, computeJourneyProgress } from '@/lib/journey'
import { useAuth } from '@/contexts/auth-context'
import { WorkoutLogForm } from '@/components/athlete/workout-log-form'

const WEEKDAY_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const
const DAY_HE = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת']
const DAY_HE_SHORT = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']

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
}

const STATUS_STYLES: Record<string, string> = {
  completed: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  skipped: 'bg-red-100 text-red-600 border-red-200',
  scheduled: 'bg-amber-100 text-amber-700 border-amber-200',
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
  const [weekLogs, setWeekLogs] = useState<{actualDistance?: number, date: string}[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week')
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null)
  const [expandedToday, setExpandedToday] = useState(true)

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

  useEffect(() => {
    if (!athleteId) return
    getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId)))
      .then(async snap => {
        setAssignedWorkouts(snap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id })))
        const { getDocs: gd, query: q, collection: col, where: wh } = await import('firebase/firestore')
        const from = format(startOfWeek(new Date(),{weekStartsOn:1}), 'yyyy-MM-dd')
        const to = format(endOfWeek(new Date(),{weekStartsOn:1}), 'yyyy-MM-dd')
        const logsSnap = await gd(q(col(db, 'logs'), wh('athleteId', '==', athleteId)))
        setWeekLogs(logsSnap.docs.map(d => ({ actualDistance: d.data().actualDistance, date: d.data().date || '' })).filter(l => l.date >= from && l.date <= to))
      })
      .catch(err => console.error(err))
  }, [athleteId])

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 })
  const weekDays = useMemo(() => eachDayOfInterval({ start: weekStart, end: weekEnd }), [currentDate])

  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const monthWeeks = useMemo(() => eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 0 }), [currentDate])

  const getWorkoutsForDate = useCallback((dateStr: string) =>
    assignedWorkouts.filter(w => w.scheduledDate === dateStr)
  , [assignedWorkouts])

  const getWorkoutsForDay = useCallback((date: Date) =>
    getWorkoutsForDate(format(date, 'yyyy-MM-dd'))
  , [getWorkoutsForDate])

  const getWeekKm = useCallback((days: Date[]) =>
    days.reduce((sum, day) => sum + getWorkoutsForDay(day).reduce((s,w) => s+(w.workout?.distance??0),0), 0)
  , [getWorkoutsForDay])

  const todayWorkouts = useMemo(() => getWorkoutsForDay(new Date()), [getWorkoutsForDay])

  const thisWeekKmActual = weekLogs.reduce((s, l) => s + (l.actualDistance || 0), 0)
  const thisWeekKmPlanned = useMemo(() => {
    const from = format(startOfWeek(new Date(),{weekStartsOn:1}), 'yyyy-MM-dd')
    const to = format(endOfWeek(new Date(),{weekStartsOn:1}), 'yyyy-MM-dd')
    return assignedWorkouts.filter(w => w.scheduledDate>=from && w.scheduledDate<=to)
      .reduce((s,w) => s+(w.workout?.distance??0), 0)
  }, [assignedWorkouts])

  const selectedWorkout = useMemo(() =>
    assignedWorkouts.find(w => w.id === selectedWorkoutId) || null
  , [assignedWorkouts, selectedWorkoutId])

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )

  const renderWorkoutDetail = (w: AssignedWorkout) => (
    <div className="space-y-3 pt-3 border-t mt-3">
      <div className="flex gap-3 text-xs text-muted-foreground flex-wrap">
        {w.workout.distance && <span className="flex items-center gap-1"><MapPin className="h-3 w-3"/>{w.workout.distance} ק"מ</span>}
        {w.workout.duration && <span className="flex items-center gap-1"><Clock className="h-3 w-3"/>{w.workout.duration} דק'</span>}
      </div>
      {w.workout.description && <p className="text-xs text-muted-foreground leading-relaxed">{w.workout.description}</p>}
      {w.workout.warmup && (
        <div className="bg-emerald-50 rounded-lg p-2.5 border border-emerald-100">
          <p className="text-xs font-semibold text-emerald-700 mb-1">חימום</p>
          <p className="text-xs text-emerald-800">{w.workout.warmup}</p>
        </div>
      )}
      {w.workout.sets && w.workout.sets.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-navy border-b pb-1">סטים</p>
          {w.workout.sets.map((set, si) => {
            const hasIntervals = (set as any).intervals && (set as any).intervals.length > 0
            return (
              <div key={set.id||si} className="rounded-lg border overflow-hidden">
                <div className="bg-navy/5 px-3 py-2 flex items-center justify-between">
                  <span className="text-xs font-bold text-navy">
                    סט {si+1}{set.reps > 1 ? ` · ${set.reps} חזרות` : ''}
                    {!hasIntervals && (set.distance||set.duration) && <span> · {set.distance||set.duration}</span>}
                    {!hasIntervals && set.pace && <span className="font-normal text-muted-foreground"> @ {set.pace}</span>}
                  </span>
                  {set.rest && <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">מנוחה: {set.rest}</span>}
                </div>
                {hasIntervals && (
                  <div className="px-3 py-2 space-y-1.5">
                    {((set as any).intervals as any[]).map((iv: any, ii: number) => (
                      <div key={iv.id||ii} className="flex items-center gap-2 text-xs bg-white/70 rounded-lg px-2.5 py-2 border border-border/50">
                        <span className="w-5 h-5 rounded-full bg-navy text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0">{ii+1}</span>
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
      {w.workout.cooldown && (
        <div className="bg-blue-50 rounded-lg p-2.5 border border-blue-100">
          <p className="text-xs font-semibold text-blue-700 mb-1">שחרור</p>
          <p className="text-xs text-blue-800">{w.workout.cooldown}</p>
        </div>
      )}
      {w.workout.notes && (
        <div className="bg-muted/30 rounded-lg p-2.5">
          <p className="text-xs font-semibold text-muted-foreground mb-1">הערות מאמן</p>
          <p className="text-xs text-navy">{w.workout.notes}</p>
        </div>
      )}
      {w.coachFeedback && (
        <div className="bg-gold/5 rounded-lg p-2.5 border border-gold/20">
          <p className="text-xs font-semibold text-gold mb-1">משוב מאמן</p>
          <p className="text-xs text-navy">{w.coachFeedback}</p>
        </div>
      )}
      <WorkoutLogForm
        workoutId={w.workoutId}
        assignedWorkoutId={w.id}
        athleteId={athleteId}
        scheduledDate={w.scheduledDate}
        workout={w.workout}
      />
    </div>
  )

  return (
    <div className="space-y-4 pb-8">

      {/* Today's Workout */}
      {todayWorkouts.length > 0 && (
        <div className="space-y-2">
          {todayWorkouts.map(w => (
            <div key={w.id} className={cn('rounded-2xl border-2 overflow-hidden transition-all',
              w.status==='completed' ? 'border-emerald-200 bg-emerald-50' : 'border-gold/40 bg-gold/5'
            )}>
              <button className="w-full text-right px-4 py-3 flex items-center justify-between"
                onClick={() => setExpandedToday(e => !e)}>
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge variant="outline" className={cn('text-xs', STATUS_STYLES[w.status] || STATUS_STYLES.scheduled)}>
                    {w.status==='completed'?'הושלם':w.status==='skipped'?'דולג':'מתוכנן'}
                  </Badge>
                  {w.workout.distance && <span className="text-xs text-muted-foreground">{w.workout.distance} ק"מ</span>}
                  {w.workout.duration && <span className="text-xs text-muted-foreground">{w.workout.duration} דק'</span>}
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="text-xs text-muted-foreground">אימון היום</p>
                    <p className="font-bold text-navy">{w.workout.title}</p>
                  </div>
                  {expandedToday ? <ChevronUp className="h-4 w-4 text-muted-foreground"/> : <ChevronDown className="h-4 w-4 text-muted-foreground"/>}
                </div>
              </button>
              {expandedToday && (
                <div className="px-4 pb-4">
                  {renderWorkoutDetail(w)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Calendar */}
      <Card>
        <CardContent className="pt-4">
          {/* Nav + Toggle */}
          <div className="flex items-center justify-between mb-4">
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='week' ? subWeeks(d,1) : subMonths(d,1))}>
              <ChevronLeft className="h-4 w-4"/>
            </Button>
            <div className="flex flex-col items-center gap-1.5">
              <p className="font-semibold text-navy text-base">
                {viewMode==='week'
                  ? `${format(weekStart,'d MMM')} – ${format(weekEnd,'d MMM yyyy')}`
                  : format(currentDate,'MMMM yyyy')}
              </p>
              <div className="flex gap-1 bg-muted rounded-full p-0.5">
                <button onClick={() => setViewMode('week')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='week' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>שבוע</button>
                <button onClick={() => setViewMode('month')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='month' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>חודש</button>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='week' ? addWeeks(d,1) : addMonths(d,1))}>
              <ChevronRight className="h-4 w-4"/>
            </Button>
          </div>

          {/* Week View */}
          {viewMode === 'week' && (
            <div>
              <div className="overflow-x-auto -mx-1">
                <div style={{minWidth:'480px'}}>
                  {/* Day headers */}
                  <div className="grid grid-cols-8 gap-1 mb-1 px-1">
                    {DAY_HE_SHORT.map((d,i) => (
                      <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
                    ))}
                    <div className="text-center text-[10px] font-medium text-muted-foreground py-1">ק"מ</div>
                  </div>
                  {/* Day cells */}
                  <div className="grid grid-cols-8 gap-1 px-1">
                    {weekDays.map((day, di) => {
                      const dayWorkouts = getWorkoutsForDay(day)
                      const todayFlag = isToday(day)
                      const hasCompleted = dayWorkouts.some(w => w.status==='completed')
                      const selectedInDay = dayWorkouts.some(w => w.id === selectedWorkoutId)
                      return (
                        <div key={di}
                          onClick={() => {
                            if (dayWorkouts.length === 1) setSelectedWorkoutId(prev => prev === dayWorkouts[0].id ? null : dayWorkouts[0].id)
                            else if (dayWorkouts.length > 1) setSelectedWorkoutId(prev => prev === dayWorkouts[0].id ? null : dayWorkouts[0].id)
                          }}
                          className={cn('min-h-[80px] rounded-xl p-1.5 border transition-all cursor-pointer',
                            todayFlag ? 'border-gold/60 bg-gold/5' : 'border-border hover:border-gold/40',
                            selectedInDay ? 'ring-2 ring-gold border-gold' : '',
                            dayWorkouts.length > 0 ? 'cursor-pointer' : 'cursor-default'
                          )}>
                          <p className={cn('text-[10px] font-bold text-center mb-1',
                            todayFlag ? 'text-gold' : 'text-navy/60')}>
                            {format(day,'d')}
                          </p>
                          {hasCompleted && <p className="text-[9px] text-emerald-500 text-center">✓</p>}
                          <div className="space-y-0.5">
                            {dayWorkouts.slice(0,2).map(w => (
                              <div key={w.id} className={cn('text-[9px] rounded px-1 py-0.5 border leading-tight truncate',
                                TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                w.status==='completed' ? 'opacity-70' : ''
                              )}>
                                <p className="font-medium truncate">{w.workout?.title}</p>
                                {w.workout?.distance && <p>{w.workout.distance}k</p>}
                              </div>
                            ))}
                            {dayWorkouts.length > 2 && <p className="text-[9px] text-muted-foreground text-center">+{dayWorkouts.length-2}</p>}
                          </div>
                        </div>
                      )
                    })}
                    {/* KM column */}
                    <div className="flex flex-col items-center justify-center rounded-xl bg-muted/30 border border-border/30">
                      <p className="text-sm font-bold text-navy">{getWeekKm(weekDays)}</p>
                      <p className="text-[9px] text-muted-foreground">ק"מ</p>
                      {thisWeekKmActual > 0 && (
                        <p className="text-[9px] text-emerald-600 mt-0.5">{thisWeekKmActual} ✓</p>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Selected workout detail */}
              {selectedWorkout && (
                <div className="mt-4 rounded-xl border border-gold/30 bg-gold/5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-navy text-base">{selectedWorkout.workout.title}</p>
                      <p className="text-xs text-muted-foreground">{format(parseISO(selectedWorkout.scheduledDate),'EEEE, d MMMM')}</p>
                    </div>
                    <Badge variant="outline" className={cn('text-xs flex-shrink-0', STATUS_STYLES[selectedWorkout.status] || STATUS_STYLES.scheduled)}>
                      {selectedWorkout.status==='completed'?'הושלם':selectedWorkout.status==='skipped'?'דולג':'מתוכנן'}
                    </Badge>
                  </div>
                  {renderWorkoutDetail(selectedWorkout)}
                </div>
              )}
            </div>
          )}

          {/* Month View */}
          {viewMode === 'month' && (
            <div>
              <div className="overflow-x-auto -mx-1">
                <div style={{minWidth:'400px'}} className="px-1">
                  <div className="grid grid-cols-8 gap-1 mb-1">
                    {DAY_HE_SHORT.map((d,i) => (
                      <div key={i} className="text-center text-[10px] font-medium text-muted-foreground py-1">{d}</div>
                    ))}
                    <div className="text-center text-[10px] font-medium text-muted-foreground py-1">ק"מ</div>
                  </div>
                  <div className="space-y-1">
                    {monthWeeks.map((weekStartDay, wi) => {
                      const days = eachDayOfInterval({ start: weekStartDay, end: endOfWeek(weekStartDay,{weekStartsOn:0}) })
                      const wKm = getWeekKm(days)
                      return (
                        <div key={wi} className="grid grid-cols-8 gap-1">
                          {days.map((day, di) => {
                            const inMonth = isSameMonth(day, currentDate)
                            const dayWorkouts = getWorkoutsForDay(day)
                            const todayFlag = isToday(day)
                            const hasCompleted = dayWorkouts.some(w => w.status==='completed')
                            const selectedInDay = dayWorkouts.some(w => w.id === selectedWorkoutId)
                            return (
                              <button key={di}
                                onClick={() => {
                                  if (!inMonth || dayWorkouts.length === 0) return
                                  setSelectedWorkoutId(prev => prev === dayWorkouts[0].id ? null : dayWorkouts[0].id)
                                }}
                                className={cn('min-h-[64px] rounded-lg p-1 text-left border transition-all',
                                  !inMonth ? 'opacity-20 border-transparent pointer-events-none' : 'border-border',
                                  todayFlag ? 'border-gold/60 bg-gold/5' : '',
                                  selectedInDay ? 'ring-2 ring-gold border-gold' : inMonth ? 'hover:border-gold/40' : '',
                                )}>
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className={cn('text-[10px] font-semibold', todayFlag ? 'text-gold' : 'text-navy')}>{format(day,'d')}</span>
                                  {hasCompleted && <span className="text-emerald-500 text-[9px]">✓</span>}
                                </div>
                                <div className="space-y-0.5">
                                  {dayWorkouts.slice(0,2).map(w => (
                                    <div key={w.id} className={cn('text-[8px] rounded px-0.5 py-0.5 truncate border',
                                      TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy)}>
                                      {w.workout?.title}
                                    </div>
                                  ))}
                                  {dayWorkouts.length > 2 && <p className="text-[8px] text-muted-foreground">+{dayWorkouts.length-2}</p>}
                                </div>
                              </button>
                            )
                          })}
                          <div className="flex flex-col items-center justify-center rounded-lg bg-muted/30">
                            {wKm > 0 ? (
                              <>
                                <p className="text-xs font-bold text-navy">{wKm}</p>
                                <p className="text-[9px] text-muted-foreground">ק"מ</p>
                              </>
                            ) : <p className="text-[9px] text-muted-foreground">—</p>}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>

              {/* Selected workout detail */}
              {selectedWorkout && (
                <div className="mt-4 rounded-xl border border-gold/30 bg-gold/5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-navy text-base">{selectedWorkout.workout.title}</p>
                      <p className="text-xs text-muted-foreground">{format(parseISO(selectedWorkout.scheduledDate),'EEEE, d MMMM')}</p>
                    </div>
                    <Badge variant="outline" className={cn('text-xs flex-shrink-0', STATUS_STYLES[selectedWorkout.status] || STATUS_STYLES.scheduled)}>
                      {selectedWorkout.status==='completed'?'הושלם':selectedWorkout.status==='skipped'?'דולג':'מתוכנן'}
                    </Badge>
                  </div>
                  {renderWorkoutDetail(selectedWorkout)}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Bottom Info Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {/* שלב העונה */}
        <Card className="border-navy/20">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">שלב העונה</p>
            {journey ? (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <Badge className="bg-navy/10 text-navy border-navy/20">{journey.stageName}</Badge>
                  <span className="text-sm font-semibold text-navy">שבוע {journey.weekInStage}/{journey.totalWeeksInStage}</span>
                  <Badge variant="outline" className={cn('text-xs', journey.isOffWeek ? 'bg-amber-100 text-amber-700 border-amber-200' : 'bg-emerald-100 text-emerald-700 border-emerald-200')}>
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

        {/* ק"מ השבוע */}
        <Card className="border-gold/30">
          <CardContent className="pt-4 pb-3">
            <p className="text-xs text-muted-foreground uppercase tracking-wide mb-2">ק"מ השבוע</p>
            {athlete?.weeklyKmRange ? (
              <div className="space-y-2">
                <div className="flex items-end gap-2 flex-wrap">
                  <span className="text-2xl font-bold text-navy">{thisWeekKmActual}</span>
                  <span className="text-sm text-muted-foreground mb-0.5">/ {athlete.weeklyKmRange.min}–{athlete.weeklyKmRange.max} ק"מ</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className={cn('h-2 rounded-full transition-all', thisWeekKmActual >= athlete.weeklyKmRange.min ? 'bg-emerald-500' : 'bg-gold')}
                    style={{width:`${Math.min(100,(thisWeekKmActual/athlete.weeklyKmRange.max)*100)}%`}}/>
                </div>
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>{thisWeekKmActual >= athlete.weeklyKmRange.min ? 'יעד השבוע הושג!' : `נותרו ${Math.max(0,athlete.weeklyKmRange.min-thisWeekKmActual)} ק"מ`}</span>
                  <span className="text-navy/60">מתוכנן: {thisWeekKmPlanned} ק"מ</span>
                </div>
              </div>
            ) : <p className="text-sm text-muted-foreground">לא הוגדר יעד ק"מ</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
