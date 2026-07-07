'use client'

import { useEffect, useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChevronLeft, ChevronRight, Copy, Loader2, Plus, X, Search, Check, ClipboardPaste, Pencil, Trash2, Eye } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { WorkoutBuilder } from '@/components/coach/workout-builder'
import { WorkoutDetailCard } from '@/components/shared/workout-detail-card'
import { deleteDoc, doc, updateDoc } from 'firebase/firestore'
import { format, startOfWeek, endOfWeek, addWeeks, subWeeks, eachDayOfInterval, isSameDay, startOfMonth, endOfMonth, addMonths, subMonths, eachWeekOfInterval } from 'date-fns'
import { cn } from '@/lib/utils'
import { db } from '@/lib/firebase'
import { collection, getDocs, query, where, addDoc, serverTimestamp } from 'firebase/firestore'
import type { AthleteProfile, AssignedWorkout, Workout } from '@/lib/types'
import { listJourneys, computeJourneyProgress } from '@/lib/journey'
import { toast } from 'sonner'
import { workoutTypeColors } from '@/lib/workout-labels'

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
}

interface CopiedWeek {
  fromAthleteName: string
  fromAthleteId: string
  workouts: AssignedWorkout[]
  weekLabel: string
}

// Module-level cache - persists between page navigations
let _cachedAthletes: any[] | null = null
let _cachedLibrary: any[] | null = null
let _cachedAssigned: any[] | null = null
let _cacheTime = 0
const CACHE_TTL = 60000 // 1 minute

export function CoachPlanningHub() {
  const [viewMode, setViewMode] = useState<'week' | 'month'>('week')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [athleteData, setAthleteData] = useState<AthleteWeekData[]>([])
  const [workoutLibrary, setWorkoutLibrary] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedWeek, setCopiedWeek] = useState<CopiedWeek | null>(null)
  const [pasting, setPasting] = useState<string | null>(null)
  const [librarySearch, setLibrarySearch] = useState('')
  const [selectedLibraryWorkout, setSelectedLibraryWorkout] = useState<Workout | null>(null)
  const [showAthleteView, setShowAthleteView] = useState(false)
  const [selectedAssignedWorkout, setSelectedAssignedWorkout] = useState<AssignedWorkout | null>(null)
  const [copiedWorkout, setCopiedWorkout] = useState<AssignedWorkout | null>(null)
  const [editingWorkoutId, setEditingWorkoutId] = useState<string | null>(null)
  const [editingAthleteId, setEditingAthleteId] = useState<string | null>(null)
  const [selectedAthletes, setSelectedAthletes] = useState<string[]>([])

  const weekStart = startOfWeek(currentDate, { weekStartsOn: 0 })
  const weekEnd = endOfWeek(currentDate, { weekStartsOn: 0 })
  const weekDays = eachDayOfInterval({ start: weekStart, end: weekEnd })
  const monthStart = startOfMonth(currentDate)
  const monthEnd = endOfMonth(currentDate)
  const monthWeeks = eachWeekOfInterval({ start: monthStart, end: monthEnd }, { weekStartsOn: 0 })

  useEffect(() => {
    const load = async () => {
      // Use cache if fresh
      const now = Date.now()
      if (_cachedAthletes && _cachedLibrary && _cachedAssigned && (now - _cacheTime < CACHE_TTL)) {
        setAthletes(_cachedAthletes)
        setWorkoutLibrary(_cachedLibrary)
        setAssignedWorkouts(_cachedAssigned)
        setLoading(false)
        return
      }
      setLoading(true)
      try {
        const [usersSnap, awSnap, wSnap] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('role', '==', 'athlete'))),
          getDocs(collection(db, 'assignedWorkouts')),
          getDocs(collection(db, 'workouts')),
        ])
        const athletes = usersSnap.docs.map(d => ({ ...(d.data() as AthleteProfile), id: d.id }))
        const allAW = awSnap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id }))
        setWorkoutLibrary(wSnap.docs.filter(d => !d.data().libraryHidden).map(d => ({ ...(d.data() as Workout), id: d.id })))
        const result: AthleteWeekData[] = await Promise.all(athletes.map(async (athlete) => {
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
          return { athlete, assignedWorkouts: allAW.filter(w => w.athleteId === athlete.id), journeyStage }
        }))
        setAthleteData(result)
        setSelectedAthletes(result.map(d => d.athlete.id))
      } catch (err) { console.error(err) }
      finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleOpenEdit = async (assignedWorkout: AssignedWorkout) => {
    try {
      // Duplicate the workout so edits don't affect other assignments
      const { getDoc } = await import('firebase/firestore')
      const origSnap = await getDoc(doc(db, 'workouts', assignedWorkout.workoutId))
      if (!origSnap.exists()) { toast.error('אימון לא נמצא'); return }
      const origData = origSnap.data()
      // Create a new workout document (copy)
      const newRef = await addDoc(collection(db, 'workouts'), {
        ...origData,
        title: origData.title,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      // Update the assigned workout to point to the new copy
      await updateDoc(doc(db, 'assignedWorkouts', assignedWorkout.id), {
        workoutId: newRef.id,
        workout: { ...origData, id: newRef.id },
      })
      // Update local state
      setAthleteData(prev => prev.map(ad => ({
        ...ad,
        assignedWorkouts: ad.assignedWorkouts.map(w =>
          w.id === assignedWorkout.id
            ? { ...w, workoutId: newRef.id, workout: { ...w.workout, id: newRef.id } }
            : w
        )
      })))
      setEditingWorkoutId(newRef.id)
      setEditingAthleteId(assignedWorkout.athleteId)
    } catch (e) { console.error(e); toast.error('שגיאה') }
  }

  const handleDeleteWorkout = async (assignedWorkout: AssignedWorkout) => {
    try {
      await deleteDoc(doc(db, 'assignedWorkouts', assignedWorkout.id))
      setAthleteData(prev => prev.map(ad => ({
        ...ad,
        assignedWorkouts: ad.assignedWorkouts.filter(w => w.id !== assignedWorkout.id)
      })))
      setSelectedAssignedWorkout(null)
      toast.success('אימון נמחק')
    } catch { toast.error('שגיאה במחיקה') }
  }

  const reloadWorkouts = async () => {
    const awSnap = await getDocs(collection(db, 'assignedWorkouts'))
    const allAW = awSnap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id }))
    setAthleteData(prev => prev.map(ad => ({ ...ad, assignedWorkouts: allAW.filter(w => w.athleteId === ad.athlete.id) })))
  }

  const getWorkoutsForDay = (data: AthleteWeekData, date: Date) =>
    data.assignedWorkouts.filter(w => w.scheduledDate === format(date, 'yyyy-MM-dd'))

  const getWeekKm = (data: AthleteWeekData, days: Date[]) =>
    days.reduce((sum, day) => sum + getWorkoutsForDay(data, day).reduce((s, w) => s + (w.workout?.distance ?? 0), 0), 0)

  const handleCopyWeek = (data: AthleteWeekData) => {
    const workouts = weekDays.flatMap(d => getWorkoutsForDay(data, d))
    if (workouts.length === 0) { toast.error('אין אימונים בשבוע זה'); return }
    setCopiedWeek({
      fromAthleteName: data.athlete.name,
      fromAthleteId: data.athlete.id,
      workouts,
      weekLabel: `${format(weekStart,'d MMM')} – ${format(weekEnd,'d MMM')}`,
    })
    toast.success(`שבוע של ${data.athlete.name} הועתק — בחר אתלט ושבוע להדבקה`)
  }

  const handlePasteWeek = async (toAthleteId: string, toWeekStart: Date) => {
    if (!copiedWeek) return
    setPasting(toAthleteId)
    try {
      const toWeekDays = eachDayOfInterval({ start: toWeekStart, end: endOfWeek(toWeekStart, { weekStartsOn: 0 }) })
      await Promise.all(copiedWeek.workouts.map(w => {
        // Map by day of week (0=Sun, 6=Sat)
        const srcDate = new Date(w.scheduledDate)
        const dayOfWeek = srcDate.getDay()
        const targetDate = format(toWeekDays[dayOfWeek], 'yyyy-MM-dd')
        return addDoc(collection(db, 'assignedWorkouts'), {
          workoutId: w.workoutId, workout: w.workout,
          athleteId: toAthleteId, assignedBy: 'coach',
          scheduledDate: targetDate, status: 'scheduled',
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
      }))
      toast.success('שבוע הודבק!')
      await reloadWorkouts()
    } catch { toast.error('שגיאה בהדבקה') }
    finally { setPasting(null) }
  }

  const handleAssignWorkout = async (workout: Workout, athleteId: string, date: string) => {
    try {
      await addDoc(collection(db, 'assignedWorkouts'), {
        workoutId: workout.id, workout,
        athleteId, assignedBy: 'coach',
        scheduledDate: date, status: 'scheduled',
        createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
      })
      toast.success('אימון שובץ!')
      await reloadWorkouts()
    } catch { toast.error('שגיאה בשיבוץ') }
  }

  const filteredLibrary = workoutLibrary.filter(w =>
    w.title?.toLowerCase().includes(librarySearch.toLowerCase())
  )

  const visibleAthletes = athleteData.filter(d => selectedAthletes.includes(d.athlete.id))

  if (loading) return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )

  return (
    <div className="flex flex-col lg:flex-row gap-4" dir="rtl">
      {/* Main area */}
      <div className="flex-1 min-w-0 space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-2">
            <div className="flex gap-1 bg-muted rounded-full p-0.5">
              <button onClick={() => setViewMode('week')} className={cn('text-xs px-3 py-1 rounded-full transition-all', viewMode==='week' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>שבוע</button>
              <button onClick={() => setViewMode('month')} className={cn('text-xs px-3 py-1 rounded-full transition-all', viewMode==='month' ? 'bg-white text-navy font-semibold shadow-sm' : 'text-muted-foreground')}>חודש</button>
            </div>
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='week' ? subWeeks(d,1) : subMonths(d,1))}><ChevronRight className="h-4 w-4"/></Button>
            <span className="text-sm font-semibold text-navy">
              {viewMode==='week'
                ? `${format(weekStart,'d MMM')} – ${format(weekEnd,'d MMM yyyy')}`
                : format(currentDate,'MMMM yyyy')}
            </span>
            <Button variant="ghost" size="icon" onClick={() => setCurrentDate(d => viewMode==='week' ? addWeeks(d,1) : addMonths(d,1))}><ChevronLeft className="h-4 w-4"/></Button>
          </div>
        </div>

        {/* Copied week banner */}
        {copiedWeek && (
          <div className="rounded-xl border-2 border-gold bg-gold/5 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardPaste className="h-4 w-4 text-gold"/>
              <p className="text-sm font-medium text-navy">
                שבוע של <span className="text-gold">{copiedWeek.fromAthleteName}</span> ({copiedWeek.weekLabel}) — {copiedWeek.workouts.length} אימונים
              </p>
            </div>
            <div className="flex items-center gap-2">
              <p className="text-xs text-muted-foreground">לחץ "הדבק" באתלט הרצוי</p>
              <Button variant="ghost" size="sm" onClick={() => setCopiedWeek(null)}><X className="h-3.5 w-3.5"/></Button>
            </div>
          </div>
        )}

        {/* Copied single workout banner */}
        {copiedWorkout && (
          <div className="rounded-xl border-2 border-blue-200 bg-blue-50 px-4 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ClipboardPaste className="h-4 w-4 text-blue-500"/>
              <p className="text-sm font-medium text-navy">
                אימון מועתק: <span className="text-blue-600 font-bold">{copiedWorkout.workout?.title}</span> — לחץ על יום לשיבוץ
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCopiedWorkout(null)}><X className="h-3.5 w-3.5"/></Button>
          </div>
        )}

        {/* Athlete filter */}
        <div className="flex flex-wrap gap-2">
          <p className="text-xs text-muted-foreground self-center">הצג:</p>
          {athleteData.map(d => (
            <button key={d.athlete.id}
              onClick={() => setSelectedAthletes(prev =>
                prev.includes(d.athlete.id) ? prev.filter(id => id !== d.athlete.id) : [...prev, d.athlete.id]
              )}
              className={cn('flex items-center gap-1.5 rounded-full px-3 py-1 text-xs border transition-all',
                selectedAthletes.includes(d.athlete.id)
                  ? 'bg-navy text-white border-navy'
                  : 'bg-white text-muted-foreground border-border hover:border-navy/40'
              )}>
              <Avatar className="h-4 w-4">
                <AvatarImage src={d.athlete.photoURL}/>
                <AvatarFallback className="text-[8px]">{d.athlete.name?.charAt(0)}</AvatarFallback>
              </Avatar>
              {d.athlete.name?.split(' ')[0]}
            </button>
          ))}
        </div>

        {/* Athletes */}
        <div className="space-y-4">
          {visibleAthletes.map(data => {
            const weekKm = getWeekKm(data, weekDays)
            return (
              <div key={data.athlete.id} className="rounded-2xl border border-border bg-white overflow-hidden">
                {/* Athlete header */}
                <div className="flex items-center justify-between px-4 py-2.5 border-b bg-muted/20">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-7 w-7">
                      <AvatarImage src={data.athlete.photoURL}/>
                      <AvatarFallback className="text-xs bg-navy text-white">{data.athlete.name?.charAt(0)}</AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-semibold text-navy text-sm">{data.athlete.name}</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        {data.journeyStage && <Badge variant="outline" className="text-[10px] bg-navy/5 text-navy border-navy/20">{data.journeyStage}</Badge>}
                        {data.athlete.weeklyKmRange && <span className="text-[10px] text-muted-foreground">יעד: {data.athlete.weeklyKmRange.min}–{data.athlete.weeklyKmRange.max} ק"מ</span>}
                        {weekKm > 0 && <span className={cn('text-[10px] font-medium', data.athlete.weeklyKmRange && weekKm >= data.athlete.weeklyKmRange.min ? 'text-emerald-600' : 'text-amber-600')}>{weekKm} ק"מ</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="outline" size="sm" className="h-7 text-xs"
                      onClick={() => handleCopyWeek(data)}>
                      <Copy className="h-3 w-3 mr-1"/>העתק שבוע
                    </Button>
                    {copiedWeek && (
                      <Button size="sm" className="h-7 text-xs bg-gold hover:bg-gold/90 text-navy"
                        disabled={pasting === data.athlete.id}
                        onClick={() => handlePasteWeek(data.athlete.id, weekStart)}>
                        {pasting === data.athlete.id ? <Loader2 className="h-3 w-3 animate-spin mr-1"/> : <ClipboardPaste className="h-3 w-3 mr-1"/>}
                        הדבק כאן
                      </Button>
                    )}
                  </div>
                </div>

                {/* Week grid */}
                {viewMode === 'week' && (
                  <div className="overflow-x-auto -mx-1"><div style={{minWidth:"700px"}} className="grid grid-cols-7 divide-x divide-border/50">
                    {weekDays.map((day, di) => {
                      const dayWorkouts = getWorkoutsForDay(data, day)
                      const isToday = isSameDay(day, new Date())
                      const dateStr = format(day, 'yyyy-MM-dd')
                      const isAssignTarget = !!selectedLibraryWorkout
                      return (
                        <div key={di}
                          onClick={() => {
                          if (selectedLibraryWorkout) { handleAssignWorkout(selectedLibraryWorkout, data.athlete.id, dateStr); setSelectedLibraryWorkout(null) }
                          else if (copiedWorkout) {
                            handleAssignWorkout(copiedWorkout.workout, data.athlete.id, dateStr)
                            setCopiedWorkout(null)
                          }
                        }}
                          className={cn('min-h-[140px] p-2 transition-all',
                            isToday && 'bg-gold/5',
                            isAssignTarget && 'cursor-pointer hover:bg-gold/10 hover:border-gold/30'
                          )}>
                          <p className={cn('text-xs font-medium text-center mb-1', isToday ? 'text-gold font-bold' : 'text-muted-foreground')}>
                            {DAY_LABELS[di]} {format(day,'d')}
                          </p>
                          {isAssignTarget && dayWorkouts.length === 0 && (
                            <div className="h-8 rounded border-2 border-dashed border-gold/40 flex items-center justify-center">
                              <Plus className="h-3 w-3 text-gold/50"/>
                            </div>
                          )}
                          <div className="space-y-0.5">
                            {dayWorkouts.map(w => (
                              <div key={w.id}
                                onClick={e => { e.stopPropagation(); setSelectedAssignedWorkout(selectedAssignedWorkout?.id === w.id ? null : w) }}
                                className={cn('text-[11px] rounded px-1.5 py-1 border leading-tight cursor-pointer transition-all',
                                  TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy,
                                  selectedAssignedWorkout?.id === w.id ? 'ring-1 ring-navy' : 'hover:opacity-80',
                                  copiedWorkout?.workoutId === w.workoutId ? 'ring-1 ring-gold' : ''
                                )}>
                                <p className="font-medium truncate">{w.workout?.title}</p>
                                {w.workout?.distance && <p className="opacity-70">{w.workout.distance}k</p>}

                              </div>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div></div>
                )}



                {/* Workout detail - same as athlete view */}
                {selectedAssignedWorkout && (
                  <div className="mx-2 mb-3 space-y-2">
                    <div className="flex items-center justify-between px-1">
                      <div className="flex items-center gap-1.5">
                        <button onClick={() => { setCopiedWorkout(selectedAssignedWorkout); setSelectedAssignedWorkout(null); toast.success('הועתק') }} className="flex items-center gap-1 bg-muted/40 hover:bg-muted rounded px-2 py-1 text-xs font-medium text-navy"><Copy className="h-3 w-3"/>העתק</button>
                        <button onClick={() => { handleOpenEdit(selectedAssignedWorkout); setSelectedAssignedWorkout(null) }} className="flex items-center gap-1 bg-muted/40 hover:bg-muted rounded px-2 py-1 text-xs font-medium text-navy"><Pencil className="h-3 w-3"/>ערוך</button>
                        <button onClick={() => { handleDeleteWorkout(selectedAssignedWorkout); setSelectedAssignedWorkout(null) }} className="flex items-center gap-1 bg-red-50 hover:bg-red-100 rounded px-2 py-1 text-xs font-medium text-red-600"><Trash2 className="h-3 w-3"/>מחק</button>
                        <button onClick={(e) => { e.stopPropagation(); setShowAthleteView(true) }} className="flex items-center gap-1 bg-blue-50 hover:bg-blue-100 rounded px-2 py-1 text-xs font-medium text-blue-600"><Eye className="h-3 w-3"/>תצוגת אתלט</button>
                      </div>
                      <div className="flex items-center gap-2">
                        <p className="text-xs font-semibold text-navy">{selectedAssignedWorkout.workout?.title}</p>
                        <button onClick={() => setSelectedAssignedWorkout(null)}><X className="h-3.5 w-3.5 text-muted-foreground"/></button>
                      </div>
                    </div>

                  </div>
                )}

                {/* Month grid */}
                {viewMode === 'month' && (
                  <div className="p-2 space-y-1">
                    <div className="grid grid-cols-8 gap-0.5 mb-1">
                      {DAY_LABELS.map(l => <p key={l} className="text-[9px] text-center text-muted-foreground">{l}</p>)}
                      <p className="text-[9px] text-center text-muted-foreground">ק"מ</p>
                    </div>
                    {monthWeeks.map((weekStartDay, wi) => {
                      const days = eachDayOfInterval({ start: weekStartDay, end: endOfWeek(weekStartDay, { weekStartsOn: 0 }) })
                      const wKm = getWeekKm(data, days)
                      return (
                        <div key={wi} className="grid grid-cols-8 gap-0.5">
                          {days.map((day, di) => {
                            const inMonth = day >= monthStart && day <= monthEnd
                            const dayWorkouts = getWorkoutsForDay(data, day)
                            return (
                              <div key={di} className={cn('min-h-[50px] rounded p-0.5 border text-center',
                                !inMonth ? 'opacity-20 border-transparent' : 'border-border/40',
                                isSameDay(day, new Date()) && 'border-gold/50 bg-gold/5')}>
                                <p className="text-[9px] text-muted-foreground">{format(day,'d')}</p>
                                {dayWorkouts.slice(0,2).map(w => (
                                  <div key={w.id} className={cn('text-[8px] rounded px-0.5 mb-0.5 truncate', TYPE_COLORS[w.workout?.type] || TYPE_COLORS.easy)}>
                                    {w.workout?.title}
                                  </div>
                                ))}
                                {dayWorkouts.length > 2 && <p className="text-[8px] text-muted-foreground">+{dayWorkouts.length-2}</p>}
                              </div>
                            )
                          })}
                          <div className="flex flex-col items-center justify-center rounded bg-muted/30">
                            {wKm > 0 ? (
                              <>
                                <p className="text-[10px] font-bold text-navy">{wKm}</p>
                                <p className="text-[8px] text-muted-foreground">ק"מ</p>
                              </>
                            ) : <p className="text-[9px] text-muted-foreground">—</p>}
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

      {/* Workout Library Sidebar */}
      <div className="w-full lg:w-64 lg:flex-shrink-0">
        <Card className="sticky top-4">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">ספריית אימונים</CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground"/>
              <Input value={librarySearch} onChange={e => setLibrarySearch(e.target.value)}
                placeholder="חיפוש..." className="pl-7 h-7 text-xs" dir="auto"/>
            </div>
          </CardHeader>
          <CardContent className="px-3 pb-3">
            <div className="space-y-1 max-h-48 lg:max-h-[calc(100vh-200px)] overflow-y-auto">
              {selectedLibraryWorkout && (
                <div className="mb-2 p-2 rounded-lg bg-gold/10 border border-gold text-xs text-navy">
                  <p className="font-bold">{selectedLibraryWorkout.title}</p>
                  <p className="text-muted-foreground">לחץ על יום באתלט לשיבוץ</p>
                  <Button size="sm" variant="ghost" className="h-6 text-xs mt-1 w-full" onClick={() => setSelectedLibraryWorkout(null)}>ביטול</Button>
                </div>
              )}
              {filteredLibrary.map(workout => (
                <div key={workout.id}
                  onClick={() => setSelectedLibraryWorkout(selectedLibraryWorkout?.id === workout.id ? null : workout)}
                  className={cn('rounded-lg border p-2 text-xs cursor-pointer transition-all', workoutTypeColors[workout.type],
                    selectedLibraryWorkout?.id === workout.id ? 'ring-2 ring-gold border-gold' : 'hover:border-gold/50 hover:bg-gold/5'
                  )}>
                  <p className="font-semibold truncate">{workout.title}</p>
                  <div className="flex gap-2 text-muted-foreground mt-0.5">
                    {workout.distance && <span>{workout.distance}k</span>}
                    {workout.duration && <span>{workout.duration}'</span>}
                  </div>
                  {selectedLibraryWorkout?.id !== workout.id && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">לחץ לבחירה</p>
                  )}
                </div>
              ))}
              {filteredLibrary.length === 0 && (
                <p className="text-xs text-muted-foreground text-center py-4">לא נמצאו אימונים</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
      {/* Edit Workout Dialog */}
      <Dialog open={!!editingWorkoutId} onOpenChange={(open) => { if (!open) { setEditingWorkoutId(null); setEditingAthleteId(null) } }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>ערוך אימון</DialogTitle>
          </DialogHeader>
          {editingWorkoutId && (
            <WorkoutBuilder
              workoutId={editingWorkoutId}
              hideBackButton
              onDone={async () => {
                const wid = editingWorkoutId
                setEditingWorkoutId(null)
                setEditingAthleteId(null)
                // Reload just this workout and update its assignment snapshot
                if (wid) {
                  const { getDoc } = await import('firebase/firestore')
                  const snap = await getDoc(doc(db, 'workouts', wid))
                  if (snap.exists()) {
                    const freshWorkout = { ...snap.data(), id: snap.id } as Workout
                    // Update only the assigned workouts pointing to this specific workout copy
                    const awSnap = await getDocs(query(collection(db, 'assignedWorkouts'), where('workoutId', '==', wid)))
                    await Promise.all(awSnap.docs.map(d => updateDoc(doc(db, 'assignedWorkouts', d.id), { workout: freshWorkout })))
                  }
                }
                await reloadWorkouts()
              }}
            />
          )}
        </DialogContent>
      </Dialog>
      {/* Athlete View Popup */}
      {showAthleteView && selectedAssignedWorkout && (
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAthleteView(false)}>
          <div className="bg-white rounded-2xl w-full max-w-md max-h-[85vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()} dir="rtl">
            <div className="flex items-center justify-between px-4 py-3 border-b sticky top-0 bg-white">
              <button onClick={() => setShowAthleteView(false)}><X className="h-5 w-5 text-muted-foreground"/></button>
              <p className="font-bold text-navy">{selectedAssignedWorkout.workout?.title}</p>
            </div>
            <div className="p-4">
              <WorkoutDetailCard w={selectedAssignedWorkout} showLog={false} log={null} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
