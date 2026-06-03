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
import { useLanguage } from '@/contexts/language-context'
import { WorkoutLogForm } from '@/components/athlete/workout-log-form'

const WEEKDAY_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const
const DAY_HE = ['ראשון','שני','שלישי','רביעי','חמישי','שישי','שבת']
const DAY_HE_SHORT = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']
const DAY_EN = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']
const DAY_HE_LABELS = ['א׳','ב׳','ג׳','ד׳','ה׳','ו׳','ש׳']

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

export function AthletePlannerView({ overrideAthleteId }: { overrideAthleteId?: string } = {}) {
  const { user } = useAuth()
  const { language, t } = useLanguage()
  const athleteId = overrideAthleteId || user?.id || ''
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  const [journey, setJourney] = useState<JourneySummary | null>(null)
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [weekLogs, setWeekLogs] = useState<{actualDistance?: number, date: string}[]>([])
  const [loading, setLoading] = useState(true)
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('week')
  const [selectedWorkoutId, setSelectedWorkoutId] = useState<string | null>(null)
  const [openLogForms, setOpenLogForms] = useState<Set<string>>(new Set())
  const [expandedToday, setExpandedToday] = useState(false)

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
    <div className="border border-border rounded-xl overflow-hidden bg-white">
      {/* Warmup */}
      {w.workout.warmup && (
        <div className="px-4 py-3 border-b border-border">
          <p className="text-sm text-muted-foreground text-right">{t.warmupLabel}: {w.workout.warmup}</p>
        </div>
      )}
      {/* Sets */}
      {w.workout.sets && w.workout.sets.length > 0 && w.workout.sets.map((set: any, si: number) => {
        const hasIntervals = set.intervals && set.intervals.length > 0
        return (
          <div key={set.id||si}>
            {/* Rest between sets separator */}
            {si > 0 && (
              <div className="flex items-center gap-3 px-4" style={{height:'28px'}}>
                <div className="flex-1 h-px bg-border"/>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {set.rest ? `${t.restBetweenSets}: ${set.rest}` : t.continueToNext}
                </span>
                <div className="flex-1 h-px bg-border"/>
              </div>
            )}
            {/* Set header */}
            <div className="px-4 py-3 border-t border-border">
              <p className="text-sm font-bold text-navy text-right">
                סט {si+1}
                {set.reps > 1 && !hasIntervals
                  ? <span className="font-normal"> · {set.reps}× {set.distance||set.duration||''}{set.pace ? ` @ ${set.pace}` : ''}</span>
                  : <>
                    {!hasIntervals && (set.distance||set.duration) && <span className="font-normal"> · {set.distance||set.duration}</span>}
                    {!hasIntervals && set.pace && <span className="font-normal text-muted-foreground"> @ {set.pace}</span>}
                  </>
                }
                {hasIntervals && set.reps > 1 && <span className="font-normal text-muted-foreground"> · {set.reps}×</span>}
              </p>
              {!hasIntervals && set.rest && (
                <p className="text-xs text-muted-foreground text-right mt-1">מנוחה: {set.rest}</p>
              )}
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
                    <p className="text-xs text-muted-foreground text-right">מנוחה: {iv.rest}</p>
                  </div>
                )}
              </div>
            ))}
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
      {/* Log form */}
      <div className="border-t border-border">
        {(w.status === 'completed' || openLogForms.has(w.id)) ? (
          <div className="px-4 py-4">
            <WorkoutLogForm
              workoutId={w.workoutId}
              assignedWorkoutId={w.id}
              athleteId={athleteId}
              scheduledDate={w.scheduledDate}
              workout={w.workout}
            />
          </div>
        ) : (
          <button
            onClick={() => setOpenLogForms(prev => new Set([...prev, w.id]))}
            className="w-full px-4 py-3 text-sm font-medium text-navy hover:bg-muted/30 transition-colors text-right">
            + תעד אימון
          </button>
        )}
      </div>
    </div>
  )


  return (
    <div className="space-y-4 pb-8">

      {/* Today's Workout */}
      {todayWorkouts.length > 0 && (
        <div className="space-y-2">
          {todayWorkouts.map(w => (
            <div key={w.id} className="rounded-2xl border border-border overflow-hidden transition-all bg-white">
              <button className="w-full text-right px-4 py-3 flex items-center justify-between"
                onClick={() => setExpandedToday(e => !e)}>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0',
                    w.status==='completed' ? 'bg-emerald-500' : w.status==='skipped' ? 'bg-red-400' : 'bg-amber-400'
                  )}/>
                  <span className="text-xs text-muted-foreground">
                    {w.status==='completed'?t.completedBadge:w.status==='skipped'?t.skippedBadge:t.scheduledBadge}
                  </span>
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
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='day' ? new Date(d.getTime()-86400000) : viewMode==='week' ? subWeeks(d,1) : subMonths(d,1))}>
              <ChevronRight className="h-4 w-4"/>
            </Button>
            <div className="flex flex-col items-center gap-1.5">
              <p className="font-semibold text-navy text-base">
                {viewMode==='day'
                  ? format(currentDate,'EEEE, d MMM yyyy')
                  : viewMode==='week'
                  ? `${format(weekStart,'d MMM')} – ${format(weekEnd,'d MMM yyyy')}`
                  : format(currentDate,'MMMM yyyy')}
              </p>
              <div className="flex gap-1 bg-muted rounded-full p-0.5">
                <button onClick={() => setViewMode('day')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='day' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>{t.dayView}</button>
                <button onClick={() => setViewMode('week')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='week' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>{t.weekView}</button>
                <button onClick={() => setViewMode('month')} className={cn('text-[11px] px-3 py-0.5 rounded-full transition-all', viewMode==='month' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>{t.monthView}</button>
              </div>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='day' ? new Date(d.getTime()+86400000) : viewMode==='week' ? addWeeks(d,1) : addMonths(d,1))}>
              <ChevronLeft className="h-4 w-4"/>
            </Button>
          </div>

          {/* Day View - same as week view single column */}
          {viewMode === 'day' && (
            <div className="space-y-3">
              <div className={cn('rounded-xl border-2 min-h-[100px] p-3',
                isToday(currentDate) ? 'border-gold bg-gold/5' : 'border-border'
              )}>
                <p className={cn('text-xs font-bold mb-2 text-right', isToday(currentDate) ? 'text-gold' : 'text-muted-foreground')}>
                  {format(currentDate,'EEEE, d MMMM')}
                </p>
                {(() => {
                  const dayWorkouts = getWorkoutsForDay(currentDate)
                  return dayWorkouts.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">אין אימון מתוכנן</p>
                  ) : (
                    <div className="space-y-1.5">
                      {dayWorkouts.map(w => (
                        <button key={w.id}
                          onClick={() => setSelectedWorkoutId(prev => prev === w.id ? null : w.id)}
                          className={cn('w-full text-right rounded-lg px-2.5 py-2 border transition-all hover:opacity-80',
                            TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                            selectedWorkoutId === w.id ? 'ring-2 ring-navy' : '',
                            w.status==='completed' ? 'opacity-60' : ''
                          )}>
                          <div className="flex items-start justify-between gap-1">
                            <p className="font-semibold text-sm leading-snug flex-1">{w.workout.title}</p>
                            {w.status==='completed' && <span className="text-emerald-500 font-bold text-sm flex-shrink-0">✓</span>}
                          </div>
                          <p className="text-xs opacity-70 mt-0.5">
                            {w.workout.distance && `${w.workout.distance}k`}
                            {w.workout.duration && ` · ${w.workout.duration}'`}
                          </p>
                        </button>
                      ))}
                    </div>
                  )
                })()}
              </div>
              {selectedWorkoutId && (() => {
                const w = getWorkoutsForDay(currentDate).find(x => x.id === selectedWorkoutId)
                if (!w) return null
                return (
                  <div>
                    <p className="font-bold text-navy text-base px-1 mb-1 text-right">{w.workout.title}</p>
                    <div className="flex gap-3 text-sm text-muted-foreground px-1 mb-2 justify-end">
                      {w.workout.distance && <span>{w.workout.distance} ק"מ</span>}
                      {w.workout.duration && <span>{w.workout.duration} דק'</span>}
                    </div>
                    {renderWorkoutDetail(w)}
                  </div>
                )
              })()}
            </div>
          )}

          {/* Week View */}
          {viewMode === 'week' && (
            <div>
              {/* Week grid - always horizontal, scrollable on mobile */}
              <div className="overflow-x-auto pb-2">
                <div style={{minWidth:'600px'}}>
                  <div className="grid grid-cols-8 gap-1.5 mb-1.5">
                    {weekDays.map((_,i) => (
                      <div key={i} className="text-center text-xs font-bold text-navy py-1">
                        {language === 'he' ? DAY_HE_LABELS[i] : DAY_EN[i]}
                      </div>
                    ))}
                    <div className="text-center text-xs font-bold text-navy py-1">ק"מ</div>
                  </div>
                  <div className="grid grid-cols-8 gap-1.5">
                    {weekDays.map((day, di) => {
                      const dayWorkouts = getWorkoutsForDay(day)
                      const todayFlag = isToday(day)
                      const hasCompleted = dayWorkouts.some(w => w.status==='completed')
                      return (
                        <div key={di} className={cn('min-h-[150px] rounded-xl border transition-all',
                          todayFlag ? 'border-gold bg-gold/5' : 'border-border',
                        )}>
                          <div className="p-1.5 border-b border-border/40 text-center">
                            <p className={cn('text-xs font-bold', todayFlag ? 'text-gold' : 'text-navy/70')}>{format(day,'d')}</p>
                            {hasCompleted && <span className="text-[9px] text-emerald-500">✓</span>}
                          </div>
                          <div className="p-1.5 space-y-1">
                            {dayWorkouts.map(w => (
                              <button key={w.id}
                                onClick={() => setSelectedWorkoutId(prev => prev === w.id ? null : w.id)}
                                className={cn('w-full text-left text-[11px] rounded-lg px-2 py-2 border leading-snug transition-all hover:opacity-80',
                                  TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                  w.status==='completed' ? 'opacity-60' : '',
                                  selectedWorkoutId === w.id ? 'ring-2 ring-navy' : ''
                                )}>
                                <p className="font-semibold leading-snug text-xs break-words">{w.workout?.title}</p>
                                {w.workout?.distance && <p className="opacity-70 text-[10px] mt-0.5">{w.workout.distance}k</p>}
                                {w.workout?.duration && !w.workout?.distance && <p className="opacity-70">{w.workout.duration}'</p>}
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                    {/* KM column */}
                    <div className="flex flex-col items-center justify-center rounded-xl bg-muted/30 border border-border/30 min-h-[130px] gap-1">
                      <div className="text-center">
                        <p className="text-lg font-bold text-navy">{getWeekKm(weekDays)}</p>
                        <p className="text-[10px] text-muted-foreground">מתוכנן</p>
                      </div>
                      {thisWeekKmActual > 0 && <>
                        <div className="w-8 h-px bg-border"/>
                        <div className="text-center">
                          <p className="text-base font-bold text-emerald-600">{thisWeekKmActual}</p>
                          <p className="text-[10px] text-emerald-600">בוצע</p>
                        </div>
                      </>}
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
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={cn('w-2.5 h-2.5 rounded-full',
                        selectedWorkout.status==='completed' ? 'bg-emerald-500' : selectedWorkout.status==='skipped' ? 'bg-red-400' : 'bg-amber-400'
                      )}/>
                      <span className="text-xs text-muted-foreground">
                        {selectedWorkout.status==='completed'?t.completedBadge:selectedWorkout.status==='skipped'?t.skippedBadge:t.scheduledBadge}
                      </span>
                    </div>
                  </div>
                  {renderWorkoutDetail(selectedWorkout)}
                </div>
              )}
            </div>
          )}

          {/* Month View */}
          {viewMode === 'month' && (
            <div>
              <div className="overflow-x-auto pb-2">
                <div style={{minWidth:'360px'}}>
                  <div className="grid grid-cols-8 gap-1 mb-1">
                    {(language === 'he' ? DAY_HE_LABELS : DAY_EN).map((d,i) => (
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
                              <div key={di}
                                className={cn('min-h-[80px] rounded-lg p-1 text-left border transition-all',
                                  !inMonth ? 'opacity-20 border-transparent pointer-events-none' : 'border-border',
                                  todayFlag ? 'border-gold/60 bg-gold/5' : '',
                                  selectedInDay ? 'ring-2 ring-gold border-gold' : '',
                                )}>
                                <div className="flex items-center justify-between mb-1">
                                  <span className={cn('text-[10px] font-semibold', todayFlag ? 'text-gold' : 'text-navy')}>{format(day,'d')}</span>
                                  {hasCompleted && <span className="text-emerald-500 text-[9px]">✓</span>}
                                </div>
                                <div className="space-y-0.5">
                                  {dayWorkouts.slice(0,2).map(w => (
                                    <button key={w.id}
                                      onClick={() => inMonth && setSelectedWorkoutId(prev => prev === w.id ? null : w.id)}
                                      className={cn('w-full text-left text-[8px] rounded px-0.5 py-1 truncate border transition-all hover:opacity-75',
                                        TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                        selectedWorkoutId === w.id ? 'ring-1 ring-navy font-bold' : ''
                                      )}>
                                      {w.workout?.title}
                                    </button>
                                  ))}
                                  {dayWorkouts.length > 2 && <p className="text-[8px] text-muted-foreground">+{dayWorkouts.length-2}</p>}
                                </div>
                              </div>
                            )
                          })}
                          {(() => {
                            const wDone = days.reduce((s,d) => {
                              const dStr = format(d,'yyyy-MM-dd')
                              return s + weekLogs.filter(l=>l.date===dStr).reduce((a,l)=>a+(l.actualDistance||0),0)
                            },0)
                            return (
                              <div className="flex flex-col items-center justify-center rounded-lg bg-muted/30 p-1 gap-0.5">
                                {wKm > 0 ? (
                                  <div className="text-center">
                                    <p className="text-[10px] font-bold text-navy">{wKm}</p>
                                    <p className="text-[8px] text-muted-foreground">plan</p>
                                  </div>
                                ) : <p className="text-[9px] text-muted-foreground">—</p>}
                                {wDone > 0 && (
                                  <div className="text-center border-t border-border/40 pt-0.5 w-full">
                                    <p className="text-[10px] font-bold text-emerald-600">{wDone}</p>
                                    <p className="text-[8px] text-emerald-600">done</p>
                                  </div>
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

              {/* Selected workout detail */}
              {selectedWorkout && (
                <div className="mt-4 rounded-xl border border-gold/30 bg-gold/5 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-navy text-base">{selectedWorkout.workout.title}</p>
                      <p className="text-xs text-muted-foreground">{format(parseISO(selectedWorkout.scheduledDate),'EEEE, d MMMM')}</p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <span className={cn('w-2.5 h-2.5 rounded-full',
                        selectedWorkout.status==='completed' ? 'bg-emerald-500' : selectedWorkout.status==='skipped' ? 'bg-red-400' : 'bg-amber-400'
                      )}/>
                      <span className="text-xs text-muted-foreground">
                        {selectedWorkout.status==='completed'?t.completedBadge:selectedWorkout.status==='skipped'?t.skippedBadge:t.scheduledBadge}
                      </span>
                    </div>
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
        {journey && <Card className="border-navy/20">
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
            ) : null}
          </CardContent>
        </Card>}

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
