'use client'

import { useEffect, useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ChevronLeft, ChevronRight, Copy, Loader2, Plus, X } from 'lucide-react'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, addMonths, subMonths, eachWeekOfInterval } from 'date-fns'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase'
import { collection, getDocs, query, where, addDoc, serverTimestamp } from 'firebase/firestore'
import type { AthleteProfile, AssignedWorkout } from '@/lib/types'
import { listJourneys, computeJourneyProgress } from '@/lib/journey'
import { toast } from 'sonner'

const DAY_KEYS = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'] as const
const DAY_LABELS = ['א','ב','ג','ד','ה','ו','ש']

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

interface AthleteWeekData {
  athlete: AthleteProfile
  assignedWorkouts: AssignedWorkout[]
  journeyStage?: string
  weeklyKmRange?: { min: number; max: number }
}

export function CoachPlanningHub() {
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [athleteData, setAthleteData] = useState<AthleteWeekData[]>([])
  const [loading, setLoading] = useState(true)
  const [copySource, setCopySource] = useState<{ athleteId: string; weekStart: string } | null>(null)

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 })
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })

  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const monthWeeks = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 0 })

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'athlete')))
        const athletes = snap.docs.map(d => ({ ...(d.data() as AthleteProfile), id: d.id }))
        const awSnap = await getDocs(collection(db, 'assignedWorkouts'))
        const allAW = awSnap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id }))
        const result: AthleteWeekData[] = await Promise.all(athletes.map(async (athlete) => {
          const aw = allAW.filter(w => w.athleteId === athlete.id)
          let journeyStage = undefined
          try {
            const journeys = await listJourneys(athlete.id)
            const today = new Date()
            const active = journeys.find(j => new Date(j.startDate) <= today && new Date(j.goalRaceDate) >= today) || journeys[journeys.length - 1]
            if (active) {
              const progress = computeJourneyProgress(active, today)
              if (progress.activeStage) journeyStage = progress.activeStage.name
            }
          } catch {}
          return { athlete, assignedWorkouts: aw, journeyStage, weeklyKmRange: athlete.weeklyKmRange }
        }))
        setAthleteData(result)
      } catch (err) { console.error(err) }
      finally { setLoading(false) }
    }
    load()
  }, [])

  const getWorkoutsForDay = (data: AthleteWeekData, date: Date) =>
    data.assignedWorkouts.filter(w => w.scheduledDate === format(date, 'yyyy-MM-dd'))

  const getWeekKm = (data: AthleteWeekData, days: Date[]) =>
    days.reduce((sum, day) => sum + getWorkoutsForDay(data, day).reduce((s, w) => s + (w.workout?.distance ?? 0), 0), 0)

  const handleDuplicateWeek = async (data: AthleteWeekData, days: Date[], toNextWeek = true) => {
    const targetDays = days.map(d => toNextWeek ? addWeeks(d, 1) : d)
    const workoutsThisWeek = days.flatMap(d => getWorkoutsForDay(data, d))
    if (workoutsThisWeek.length === 0) { toast.error('אין אימונים להעתקה'); return }
    try {
      await Promise.all(workoutsThisWeek.map((w, i) => {
        const targetDate = format(targetDays[days.findIndex(d => format(d,'yyyy-MM-dd') === w.scheduledDate)], 'yyyy-MM-dd')
        return addDoc(collection(db, 'assignedWorkouts'), {
          workoutId: w.workoutId, workout: w.workout,
          athleteId: data.athlete.id, assignedBy: 'coach',
          scheduledDate: targetDate, status: 'scheduled',
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
      }))
      toast.success('שבוע הועתק!')
      // Reload
      const awSnap = await getDocs(collection(db, 'assignedWorkouts'))
      const allAW = awSnap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id }))
      setAthleteData(prev => prev.map(ad => ({
        ...ad, assignedWorkouts: allAW.filter(w => w.athleteId === ad.athlete.id)
      })))
    } catch { toast.error('שגיאה בהעתקה') }
  }

  const handleCopyWeekToAthlete = async (fromData: AthleteWeekData, days: Date[], toAthleteId: string) => {
    const workoutsThisWeek = days.flatMap(d => getWorkoutsForDay(fromData, d))
    if (workoutsThisWeek.length === 0) { toast.error('אין אימונים להעתקה'); return }
    try {
      await Promise.all(workoutsThisWeek.map(w =>
        addDoc(collection(db, 'assignedWorkouts'), {
          workoutId: w.workoutId, workout: w.workout,
          athleteId: toAthleteId, assignedBy: 'coach',
          scheduledDate: w.scheduledDate, status: 'scheduled',
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
      ))
      toast.success('שבוע הועתק לאתלט!')
      const awSnap = await getDocs(collection(db, 'assignedWorkouts'))
      const allAW = awSnap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id }))
      setAthleteData(prev => prev.map(ad => ({
        ...ad, assignedWorkouts: allAW.filter(w => w.athleteId === ad.athlete.id)
      })))
      setCopySource(null)
    } catch { toast.error('שגיאה בהעתקה') }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-bold text-navy">מרכז תכנון</h2>
          <p className="text-sm text-muted-foreground">תצוגת לוח אימונים לכל האתלטים</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View toggle */}
          <div className="flex gap-1 bg-muted rounded-full p-0.5">
            <button onClick={() => setViewMode('week')} className={cn('text-xs px-3 py-1 rounded-full transition-all', viewMode==='week' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>שבוע</button>
            <button onClick={() => setViewMode('month')} className={cn('text-xs px-3 py-1 rounded-full transition-all', viewMode==='month' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>חודש</button>
          </div>
          {/* Nav */}
          <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='week' ? subWeeks(d,1) : subMonths(d,1))}><ChevronRight className="h-4 w-4"/></Button>
          <span className="text-sm font-medium text-navy min-w-[140px] text-center">
            {viewMode==='week'
              ? `${format(weekStart,'d MMM')} – ${format(weekEnd,'d MMM yyyy')}`
              : format(currentDate,'MMMM yyyy')}
          </span>
          <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='week' ? addWeeks(d,1) : addMonths(d,1))}><ChevronLeft className="h-4 w-4"/></Button>
        </div>
      </div>

      {/* Copy mode banner */}
      {copySource && (
        <div className="rounded-xl border-2 border-gold bg-gold/5 px-4 py-3 flex items-center justify-between">
          <p className="text-sm font-medium text-navy">בחר אתלט להעתקת השבוע אליו</p>
          <Button variant="ghost" size="sm" onClick={() => setCopySource(null)}><X className="h-4 w-4"/></Button>
        </div>
      )}

      {/* Athletes */}
      <div className="space-y-4">
        {athleteData.map(data => {
          const weekKm = getWeekKm(data, weekDays)
          const isCopyTarget = copySource && copySource.athleteId !== data.athlete.id
          const isCopySource = copySource?.athleteId === data.athlete.id

          return (
            <div key={data.athlete.id}
              className={cn('rounded-2xl border bg-white overflow-hidden transition-all',
                isCopySource ? 'border-gold ring-2 ring-gold/30' : 'border-border',
                isCopyTarget ? 'border-gold/50 cursor-pointer hover:border-gold hover:shadow-md' : ''
              )}
              onClick={() => {
                if (isCopyTarget && copySource) {
                  const fromData = athleteData.find(d => d.athlete.id === copySource.athleteId)
                  if (fromData) handleCopyWeekToAthlete(fromData, weekDays, data.athlete.id)
                }
              }}
            >
              {/* Athlete header */}
              <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/20">
                <div className="flex items-center gap-3">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={data.athlete.photoURL} />
                    <AvatarFallback className="text-xs bg-navy text-white">{data.athlete.name?.charAt(0)}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="font-semibold text-navy text-sm">{data.athlete.name}</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      {data.journeyStage && <Badge variant="outline" className="text-[10px] bg-navy/5 text-navy border-navy/20">{data.journeyStage}</Badge>}
                      {data.weeklyKmRange && <span className="text-[10px] text-muted-foreground">יעד: {data.weeklyKmRange.min}–{data.weeklyKmRange.max} ק"מ</span>}
                      {weekKm > 0 && <span className={cn('text-[10px] font-medium', data.weeklyKmRange && weekKm >= data.weeklyKmRange.min ? 'text-emerald-600' : 'text-amber-600')}>{weekKm} ק"מ מתוכנן</span>}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground hover:text-gold"
                    onClick={e => { e.stopPropagation(); handleDuplicateWeek(data, weekDays) }}>
                    <Copy className="h-3 w-3 mr-1"/>העתק שבוע
                  </Button>
                  <Button variant="ghost" size="sm" className={cn('h-7 text-xs', isCopySource ? 'text-gold' : 'text-muted-foreground hover:text-gold')}
                    onClick={e => { e.stopPropagation(); setCopySource(isCopySource ? null : { athleteId: data.athlete.id, weekStart: format(weekStart,'yyyy-MM-dd') }) }}>
                    <Copy className="h-3 w-3 mr-1"/>{isCopySource ? 'מבטל...' : 'העתק לאתלט'}
                  </Button>
                </div>
              </div>

              {/* Week grid */}
              {viewMode === 'week' && (
                <div className="grid grid-cols-7 divide-x divide-border/50">
                  {weekDays.map((day, di) => {
                    const dayWorkouts = getWorkoutsForDay(data, day)
                    const isToday = isSameDay(day, new Date())
                    return (
                      <div key={di} className={cn('min-h-[100px] p-2 space-y-1', isToday && 'bg-gold/5')}>
                        <p className={cn('text-xs font-medium mb-1.5 text-center',
                          isToday ? 'text-gold font-bold' : 'text-muted-foreground')}>
                          {DAY_LABELS[di]}<br/>
                          <span className={cn('text-[10px]', isToday ? 'text-gold' : 'text-muted-foreground/70')}>{format(day,'d')}</span>
                        </p>
                        {dayWorkouts.map(w => (
                          <div key={w.id} className={cn('text-[10px] rounded-md px-1.5 py-1 border leading-tight truncate',
                            TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy)}>
                            <p className="font-medium truncate">{w.workout?.title}</p>
                            {w.workout?.distance && <p className="opacity-70">{w.workout.distance}k</p>}
                          </div>
                        ))}
                        {dayWorkouts.length === 0 && (
                          <div className="h-8 rounded-md border border-dashed border-border/40 flex items-center justify-center">
                            <Plus className="h-3 w-3 text-muted-foreground/30"/>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Month grid */}
              {viewMode === 'month' && (
                <div className="p-3 space-y-2">
                  {/* Day headers */}
                  <div className="grid grid-cols-7 gap-1 mb-1">
                    {DAY_LABELS.map(l => <p key={l} className="text-[10px] text-center text-muted-foreground font-medium">{l}</p>)}
                  </div>
                  {monthWeeks.map((weekStartDay, wi) => {
                    const days = eachDayOfInterval({ start: weekStartDay, end: endOfWeek(weekStartDay, { weekStartsOn: 0 }) })
                    const wKm = getWeekKm(data, days)
                    return (
                      <div key={wi} className="grid grid-cols-8 gap-1">
                        {days.map((day, di) => {
                          const inMonth = day >= monthStart && day <= monthEnd
                          const dayWorkouts = getWorkoutsForDay(data, day)
                          return (
                            <div key={di} className={cn('min-h-[60px] rounded-lg p-1 border text-center',
                              !inMonth ? 'opacity-20 border-transparent' : 'border-border/40',
                              isSameDay(day, new Date()) && 'border-gold/50 bg-gold/5')}>
                              <p className="text-[10px] text-muted-foreground mb-1">{format(day,'d')}</p>
                              {dayWorkouts.slice(0,2).map(w => (
                                <div key={w.id} className={cn('text-[9px] rounded px-0.5 py-0.5 mb-0.5 truncate', TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy)}>
                                  {w.workout?.title}
                                </div>
                              ))}
                              {dayWorkouts.length > 2 && <p className="text-[9px] text-muted-foreground">+{dayWorkouts.length-2}</p>}
                            </div>
                          )
                        })}
                        <div className="flex flex-col items-center justify-center rounded-lg bg-muted/30 text-center px-1">
                          {wKm > 0 ? (
                            <>
                              <p className="text-xs font-bold text-navy">{wKm}</p>
                              <p className="text-[9px] text-muted-foreground">ק"מ</p>
                            </>
                          ) : <p className="text-[10px] text-muted-foreground">—</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
