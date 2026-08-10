'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Calendar } from '@/components/ui/calendar'
import { ArrowLeft, Clock, Check, Loader2, MapPin, TrendingUp } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { format, startOfWeek, endOfWeek, addDays } from 'date-fns'
import { cn } from '@/lib/utils'
import type { AthleteProfile, Workout, WorkoutType, WeekSchedule, JourneyDoc, ExperienceLevel } from '@/lib/types'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { isCoachEmail } from '@/lib/constants'
import { workoutTypeColors, useWorkoutTypeLabels } from '@/lib/workout-labels'
import { useLanguage } from '@/contexts/language-context'
import { listJourneys, computeJourneyProgress } from '@/lib/journey'

type RepeatFrequency = 'none' | 'weekly' | 'biweekly'
// Hard safety cap on how many occurrences a single "assign" click can
// write, regardless of the chosen end date — matches the same
// reasoning as the Bakken generator's MAX_BLOCKS: bounded cost/time per
// click, coach can always click again to extend further.
const MAX_OCCURRENCES = 52

function occurrenceDates(start: Date, frequency: RepeatFrequency, until: Date | undefined): Date[] {
  if (frequency === 'none' || !until) return [start]
  const dates: Date[] = []
  let cursor = start
  const stepDays = frequency === 'weekly' ? 7 : 14
  while (cursor <= until && dates.length < MAX_OCCURRENCES) {
    dates.push(cursor)
    cursor = addDays(cursor, stepDays)
  }
  return dates
}

/** Same "is this week an off/down week for this athlete" computation as
 *  loadAthleteSummaryFor below, generalized to an arbitrary date instead
 *  of always "today" — lets the recurrence generator skip an occurrence
 *  that would land on a future down week, not just detect today's. */
async function isDownWeekFor(athlete: AthleteProfile, journeys: JourneyDoc[], date: Date): Promise<boolean> {
  const activeJourney = journeys.find((j) => new Date(j.startDate) <= date && new Date(j.goalRaceDate) >= date)
    || journeys[journeys.length - 1]
  if (!activeJourney) return false
  const progress = computeJourneyProgress(activeJourney, date)
  const stage = progress.activeStage
  if (!stage) return false
  const stageStart = new Date(stage.startDate)
  const weekInStage = Math.max(1, Math.ceil((date.getTime() - stageStart.getTime()) / (7 * 86400000)))
  const offInterval = athlete.offWeekInterval ?? 4
  return weekInStage % offInterval === 0
}

interface WorkoutAssignProps {
  workoutId?: string
  athleteId?: string
}

interface AthleteWeekSummary {
  stageName: string
  stageType: string
  weekInStage: number
  totalWeeksInStage: number
  isOffWeek: boolean
  kmTarget: { min: number; max: number } | null
  kmAssignedThisWeek: number
  weekSchedule: WeekSchedule | null
}

const DAY_COLORS: Record<string, string> = {
  rest:     'bg-muted text-muted-foreground',
  off:      'bg-muted text-muted-foreground',
  easy:     'bg-emerald-100 text-emerald-700',
  workout:  'bg-blue-100 text-blue-700',
  long_run: 'bg-orange-100 text-orange-700',
}

const DAYS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const

export function WorkoutAssign({ workoutId, athleteId }: WorkoutAssignProps) {
  const { t } = useLanguage()
  const router = useRouter()
  const { user } = useAuth()
  const workoutTypeLabels = useWorkoutTypeLabels()
  const isCoach = isCoachEmail(user?.email)

  const [athletes, setAthletes] = useState<AthleteProfile[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)

  const [selectedWorkout, setSelectedWorkout] = useState<Workout | null>(null)
  const [selectedAthletes, setSelectedAthletes] = useState<string[]>(
    athleteId ? [athleteId] : [],
  )
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())
  const [repeatFrequency, setRepeatFrequency] = useState<RepeatFrequency>('none')
  const [repeatUntil, setRepeatUntil] = useState<Date | undefined>(() => addDays(new Date(), 12 * 7))
  const [skipDownWeeks, setSkipDownWeeks] = useState(true)
  const [isSubmitting, setIsSubmitting] = useState(false)

  const [athleteSummaries, setAthleteSummaries] = useState<Record<string, AthleteWeekSummary>>({})
  const [loadingSummary, setLoadingSummary] = useState<Record<string, boolean>>({})

  // Filters the workout list down to the selected athlete's own Bank
  // level — auto-set once exactly one athlete is picked (with a real
  // bankLevel on their profile), but always manually overridable since a
  // coach might deliberately want to assign a session from a different
  // level, or browse the full library.
  const [workoutLevelFilter, setWorkoutLevelFilter] = useState<ExperienceLevel | 'all'>('all')
  const [levelFilterAutoSet, setLevelFilterAutoSet] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [aSnap, wSnap] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('role', '==', 'athlete'))),
          getDocs(collection(db, 'workouts')),
        ])

        const loadedAthletes: AthleteProfile[] = aSnap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            userId: data.userId || d.id,
            name: data.name || data.email || 'Athlete',
            email: data.email || '',
            photoURL: data.photoURL,
            dateOfBirth: data.dateOfBirth,
            gender: data.gender,
            height: data.height,
            weight: data.weight,
            events: Array.isArray(data.events) ? data.events : [],
            personalRecords: Array.isArray(data.personalRecords) ? data.personalRecords : [],
            seasonBests: Array.isArray(data.seasonBests) ? data.seasonBests : [],
            trainingPaces: Array.isArray(data.trainingPaces) ? data.trainingPaces : [],
            goals: Array.isArray(data.goals) ? data.goals : [],
            coachId: data.coachId,
            experienceLevel: data.experienceLevel,
            weekSchedule: data.weekSchedule,
            weeklyKmRange: data.weeklyKmRange,
            offWeekInterval: data.offWeekInterval,
            createdAt: data.createdAt?.toDate?.() || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || new Date(),
          }
        })
        setAthletes(loadedAthletes)

        const loadedWorkouts: Workout[] = wSnap.docs
          .filter((d) => !d.data().libraryHidden)
          .map((d) => ({
            ...(d.data() as Workout),
            id: d.id,
          }))
        setWorkouts(loadedWorkouts)

        if (workoutId) {
          const found = loadedWorkouts.find((w) => w.id === workoutId)
          if (found) {
            setSelectedWorkout(found)
          } else {
            const wDoc = await getDoc(doc(db, 'workouts', workoutId))
            if (wDoc.exists()) {
              setSelectedWorkout({ ...(wDoc.data() as Workout), id: wDoc.id })
            }
          }
        }
      } catch (err) {
        console.error('Error loading data for assign:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [workoutId])

  const loadAthleteSummaryFor = useCallback(async (athlete: AthleteProfile) => {
    setLoadingSummary(prev => ({ ...prev, [athlete.id]: true }))
    try {
      const today = new Date()
      let stageName = '—'
      let stageType = ''
      let weekInStage = 0
      let totalWeeksInStage = 0
      let isOffWeek = false

      const journeys = await listJourneys(athlete.id)
      const activeJourney = journeys.find(j =>
        new Date(j.startDate) <= today && new Date(j.goalRaceDate) >= today
      ) || journeys[journeys.length - 1]

      if (activeJourney) {
        const progress = computeJourneyProgress(activeJourney, today)
        const stage = progress.activeStage
        if (stage) {
          stageName = stage.name
          stageType = stage.type
          const stageStart = new Date(stage.startDate)
          const stageEnd   = new Date(stage.endDate)
          totalWeeksInStage = Math.max(1, Math.ceil(
            (stageEnd.getTime() - stageStart.getTime()) / (7 * 86400000)
          ))
          weekInStage = Math.max(1, Math.ceil(
            (today.getTime() - stageStart.getTime()) / (7 * 86400000)
          ))
          const offInterval = athlete.offWeekInterval ?? 4
          isOffWeek = weekInStage % offInterval === 0
        }
      }

      const weekStart = format(startOfWeek(today, { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const weekEnd   = format(endOfWeek(today,   { weekStartsOn: 1 }), 'yyyy-MM-dd')
      const assignedSnap = await getDocs(
        query(
          collection(db, 'assignedWorkouts'),
          where('athleteId', '==', athlete.id),
          where('scheduledDate', '>=', weekStart),
          where('scheduledDate', '<=', weekEnd),
        )
      )
      const kmAssignedThisWeek = assignedSnap.docs.reduce((sum, d) => {
        return sum + (d.data().workout?.distance ?? 0)
      }, 0)

      setAthleteSummaries(prev => ({
        ...prev,
        [athlete.id]: {
          stageName,
          stageType,
          weekInStage,
          totalWeeksInStage,
          isOffWeek,
          kmTarget: athlete.weeklyKmRange ?? null,
          kmAssignedThisWeek,
          weekSchedule: athlete.weekSchedule ?? null,
        },
      }))
    } catch (err) {
      console.error('Error loading athlete summary:', err)
    } finally {
      setLoadingSummary(prev => ({ ...prev, [athlete.id]: false }))
    }
  }, [])

  const getInitials = (name: string) =>
    name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?'

  const toggleAthlete = (athlete: AthleteProfile) => {
    const isCurrentlySelected = selectedAthletes.includes(athlete.id)
    const next = isCurrentlySelected
      ? selectedAthletes.filter((a) => a !== athlete.id)
      : [...selectedAthletes, athlete.id]
    setSelectedAthletes(next)
    if (!isCurrentlySelected && !athleteSummaries[athlete.id]) {
      loadAthleteSummaryFor(athlete)
    }
    // Auto-filter the workout list to this athlete's own Bank level —
    // only when exactly one athlete ends up selected (an unambiguous
    // case) and only until the coach manually touches the filter
    // themselves, so it doesn't fight a deliberate override.
    if (next.length === 1 && !levelFilterAutoSet) {
      const only = athletes.find((a) => a.id === next[0])
      if (only?.experienceLevel) {
        setWorkoutLevelFilter(only.experienceLevel)
        setLevelFilterAutoSet(true)
      }
    } else if (next.length !== 1) {
      setLevelFilterAutoSet(false)
    }
  }

  const handleAssign = async () => {
    if (!isCoach) { toast.error('Only the coach account can assign workouts'); return }
    if (!selectedWorkout) { toast.error('Please select a workout'); return }
    if (selectedAthletes.length === 0) { toast.error('Please select at least one athlete'); return }
    if (!selectedDate) { toast.error('Please select a date'); return }
    if (repeatFrequency !== 'none' && !repeatUntil) { toast.error('Please pick an end date for the repeat'); return }

    setIsSubmitting(true)
    try {
      const dates = occurrenceDates(selectedDate, repeatFrequency, repeatUntil)
      // Firestore batches cap at 500 writes — a big recurrence × many
      // athletes can exceed that, so collect every write first and commit
      // in chunks rather than assuming one batch is always enough.
      const pending: Array<{ ref: ReturnType<typeof doc>; data: Record<string, unknown> }> = []
      for (const aid of selectedAthletes) {
        const athlete = athletes.find((a) => a.id === aid)
        // Only fetched when actually needed (repeat + skip both on) —
        // avoids an extra read per athlete on the common single-date path.
        const journeys = repeatFrequency !== 'none' && skipDownWeeks && athlete
          ? await listJourneys(aid)
          : []
        for (const occDate of dates) {
          if (repeatFrequency !== 'none' && skipDownWeeks && athlete && await isDownWeekFor(athlete, journeys, occDate)) {
            continue
          }
          pending.push({
            ref: doc(collection(db, 'assignedWorkouts')),
            data: {
              workoutId: selectedWorkout.id,
              workout: selectedWorkout,
              athleteId: aid,
              assignedBy: user?.id || null,
              scheduledDate: format(occDate, 'yyyy-MM-dd'),
              status: 'scheduled',
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
          })
        }
      }
      for (let i = 0; i < pending.length; i += 450) {
        const batch = writeBatch(db)
        for (const { ref, data } of pending.slice(i, i + 450)) batch.set(ref, data)
        await batch.commit()
      }
      const written = pending.length
      toast.success(
        repeatFrequency === 'none'
          ? `Workout assigned to ${selectedAthletes.length} athlete(s)!`
          : `${written} workouts scheduled across ${selectedAthletes.length} athlete(s)!`,
      )
      router.push('/coach/athletes')
    } catch (err) {
      console.error('Error assigning workout:', err)
      toast.error('Failed to assign workout')
    } finally {
      setIsSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href="/coach/workouts">
        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t.backBtn}
        </Button>
      </Link>

      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
          {t.assignWorkoutTitle}
        </h1>
        <p className="text-muted-foreground">{t.assignWorkoutSubtitle}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Select Workout */}
        <Card>
          <CardHeader>
            <CardTitle>{t.selectWorkoutTitle}</CardTitle>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {([
                { key: 'all' as const, label: 'כל האימונים' },
                { key: 'beginner' as const, label: 'מתחילים' },
                { key: 'intermediate' as const, label: 'בינוני' },
                { key: 'advanced' as const, label: 'מתקדם' },
                { key: 'professional' as const, label: 'עילית' },
              ]).map((opt) => (
                <Button key={opt.key} type="button" size="sm" variant="outline"
                  onClick={() => { setWorkoutLevelFilter(opt.key); setLevelFilterAutoSet(true) }}
                  className={cn('h-7 text-xs', opt.key === workoutLevelFilter && 'bg-gold/10 border-gold text-gold')}>
                  {opt.label}
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            {workouts.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t.noWorkoutsInLibrary}</p>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
                {(workoutLevelFilter === 'all' ? workouts : workouts.filter((w) => w.bankLevel === workoutLevelFilter)).length === 0 && (
                  <p className="text-xs text-muted-foreground py-4 text-center">אין אימוני בנק ברמה הזו — נסו "כל האימונים" או שייכו אימונים לבנק בלשונית "בנק אימונים".</p>
                )}
                {(workoutLevelFilter === 'all' ? workouts : workouts.filter((w) => w.bankLevel === workoutLevelFilter)).map((workout) => (
                  <button
                    key={workout.id}
                    onClick={() => setSelectedWorkout(workout)}
                    className={cn(
                      'w-full p-4 rounded-lg border text-left transition-luxury',
                      selectedWorkout?.id === workout.id
                        ? 'border-gold bg-gold/5'
                        : 'border-border hover:bg-muted/50',
                    )}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-medium text-navy">{workout.title}</span>
                          {selectedWorkout?.id === workout.id && (
                            <Check className="h-4 w-4 text-gold" />
                          )}
                        </div>
                        <Badge variant="outline" className={cn('text-xs', workoutTypeColors[workout.type])}>
                          {workoutTypeLabels[workout.type]}
                        </Badge>
                      </div>
                      <div className="text-right text-sm text-muted-foreground">
                        {workout.duration && (
                          <span className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            {workout.duration} {t.min}
                          </span>
                        )}
                        {workout.distance && (
                          <span className="flex items-center gap-1 mt-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {workout.distance} km
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Select Athletes */}
        <Card>
          <CardHeader>
            <CardTitle>{t.selectAthletesTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            {athletes.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">{t.noAthletesSignedUp}</p>
            ) : (
              <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                {athletes.map((athlete) => {
                  const isSelected = selectedAthletes.includes(athlete.id)
                  const summary = athleteSummaries[athlete.id]
                  const isSummaryLoading = loadingSummary[athlete.id]

                  return (
                    <div key={athlete.id}>
                      <button
                        onClick={() => toggleAthlete(athlete)}
                        className={cn(
                          'w-full p-4 rounded-lg border text-left transition-luxury',
                          isSelected
                            ? 'border-gold bg-gold/5 rounded-b-none border-b-0'
                            : 'border-border hover:bg-muted/50',
                        )}
                      >
                        <div className="flex items-center gap-3">
                          <Avatar className="h-10 w-10">
                            <AvatarImage src={athlete.photoURL} alt={athlete.name} />
                            <AvatarFallback className="bg-gold/10 text-gold">
                              {getInitials(athlete.name)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="flex-1">
                            <p className="font-medium text-navy">{athlete.name}</p>
                            <p className="text-sm text-muted-foreground">
                              {athlete.events.slice(0, 2).join(', ') || athlete.email}
                            </p>
                          </div>
                          {isSelected && <Check className="h-5 w-5 text-gold" />}
                        </div>
                      </button>

                      {/* Week Summary Panel */}
                      {isSelected && (
                        <div className="border border-gold border-t-0 rounded-b-lg bg-gold/5 px-4 py-3 space-y-2">
                          {isSummaryLoading ? (
                            <div className="flex items-center gap-2 text-xs text-muted-foreground">
                              <Loader2 className="h-3 w-3 animate-spin" />
                              Loading week info…
                            </div>
                          ) : summary ? (
                            <>
                              {summary.stageName !== '—' && (
                                <div className="flex items-center gap-2 flex-wrap">
                                  <Badge variant="outline" className="text-xs capitalize bg-navy/10 text-navy border-navy/20">
                                    {summary.stageName}
                                  </Badge>
                                  <span className="text-xs text-muted-foreground">
                                    Week {summary.weekInStage}/{summary.totalWeeksInStage}
                                  </span>
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      'text-xs',
                                      summary.isOffWeek
                                        ? 'bg-amber-100 text-amber-700 border-amber-200'
                                        : 'bg-emerald-100 text-emerald-700 border-emerald-200',
                                    )}
                                  >
                                    {summary.isOffWeek ? 'Off week' : 'On week'}
                                  </Badge>
                                </div>
                              )}

                              {summary.kmTarget && (
                                <div className="flex items-center gap-2 flex-wrap text-xs">
                                  <TrendingUp className="h-3.5 w-3.5 text-gold" />
                                  <span className="text-muted-foreground">This week:</span>
                                  <span className="font-semibold text-navy">
                                    {summary.kmAssignedThisWeek} km assigned
                                  </span>
                                  <span className="text-muted-foreground">
                                    / target {summary.kmTarget.min}–{summary.kmTarget.max} km
                                  </span>
                                  {summary.kmAssignedThisWeek < summary.kmTarget.min ? (
                                    <Badge variant="outline" className="text-xs bg-blue-50 text-blue-700 border-blue-200">
                                      +{summary.kmTarget.min - summary.kmAssignedThisWeek}–{summary.kmTarget.max - summary.kmAssignedThisWeek} km left
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="text-xs bg-emerald-100 text-emerald-700 border-emerald-200">
                                      ✓ Target reached
                                    </Badge>
                                  )}
                                </div>
                              )}

                              {summary.weekSchedule && (
                                <div className="flex gap-1 flex-wrap">
                                  {DAYS.map(day => {
                                    const type = summary.weekSchedule![day]
                                    if (type === 'off' || type === 'rest') return null
                                    return (
                                      <span
                                        key={day}
                                        className={cn(
                                          'text-xs px-1.5 py-0.5 rounded-full capitalize',
                                          DAY_COLORS[type] || 'bg-muted text-muted-foreground',
                                        )}
                                      >
                                        {day.slice(0,3)}: {type.replace('_',' ')}
                                      </span>
                                    )
                                  })}
                                </div>
                              )}
                            </>
                          ) : (
                            <p className="text-xs text-muted-foreground">No journey data yet</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Select Date */}
        <Card>
          <CardHeader>
            <CardTitle>{t.selectDateTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-center">
              <Calendar
                mode="single"
                selected={selectedDate}
                onSelect={setSelectedDate}
                className="rounded-md border"
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">חזרה</p>
              <div className="flex flex-wrap gap-1.5">
                {([
                  { key: 'none' as const, label: 'ללא חזרה' },
                  { key: 'weekly' as const, label: 'כל שבוע' },
                  { key: 'biweekly' as const, label: 'כל שבועיים' },
                ]).map((opt) => (
                  <Button key={opt.key} type="button" size="sm" variant="outline"
                    onClick={() => setRepeatFrequency(opt.key)}
                    className={cn(opt.key === repeatFrequency && 'bg-gold/10 border-gold text-gold')}>
                    {opt.label}
                  </Button>
                ))}
              </div>
              {repeatFrequency !== 'none' && (
                <div className="space-y-2 pt-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground shrink-0">עד תאריך:</span>
                    <input type="date"
                      value={repeatUntil ? format(repeatUntil, 'yyyy-MM-dd') : ''}
                      onChange={(e) => setRepeatUntil(e.target.value ? new Date(e.target.value + 'T00:00:00') : undefined)}
                      className="rounded-md border border-input bg-background px-2 py-1 text-xs" />
                  </div>
                  <label className="flex items-start gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={skipDownWeeks} onChange={(e) => setSkipDownWeeks(e.target.checked)} className="mt-0.5" />
                    לדלג על שבועות הפחתת עומסים של הספורטאי (לפי offWeekInterval)
                  </label>
                  <p className="text-[11px] text-muted-foreground">
                    {selectedDate && repeatUntil
                      ? `עד ${occurrenceDates(selectedDate, repeatFrequency, repeatUntil).length} מופעים${MAX_OCCURRENCES === occurrenceDates(selectedDate, repeatFrequency, repeatUntil).length ? ` (הגבלה של ${MAX_OCCURRENCES})` : ''} לכל ספורטאי שנבחר.`
                      : ''}
                  </p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader>
            <CardTitle>{t.assignmentSummaryTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <span className="text-sm text-muted-foreground">{t.workoutColon}</span>
              <p className="font-medium text-navy">
                {selectedWorkout
                  ? `${selectedWorkout.title}${selectedWorkout.distance ? ` · ${selectedWorkout.distance} km` : ''}`
                  : t.notSelected}
              </p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">{t.athletesColon}</span>
              <p className="font-medium text-navy">
                {selectedAthletes.length > 0
                  ? `${selectedAthletes.length} ${t.athletesSelectedSuffix}`
                  : t.noneSelected}
              </p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">{t.dateColon}</span>
              <p className="font-medium text-navy">
                {selectedDate ? format(selectedDate, 'EEEE, MMMM d, yyyy') : t.notSelected}
                {repeatFrequency !== 'none' && repeatUntil && (
                  <span className="text-xs text-muted-foreground font-normal">
                    {' '}· {repeatFrequency === 'weekly' ? 'כל שבוע' : 'כל שבועיים'} עד {format(repeatUntil, 'd/M/yyyy')}
                  </span>
                )}
              </p>
            </div>

            {selectedWorkout?.distance && selectedAthletes.length > 0 && (
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-1">
                <p className="text-xs font-medium text-blue-800">
                  After assigning (+{selectedWorkout.distance} km):
                </p>
                {selectedAthletes.map(aid => {
                  const summary = athleteSummaries[aid]
                  const athlete = athletes.find(a => a.id === aid)
                  if (!summary?.kmTarget) return null
                  const newTotal = summary.kmAssignedThisWeek + (selectedWorkout.distance || 0)
                  const remaining = summary.kmTarget.max - newTotal
                  return (
                    <p key={aid} className="text-xs text-blue-700">
                      {athlete?.name}: {newTotal} km total
                      {remaining > 0
                        ? ` · ${remaining} km to max`
                        : ' · ✓ At or above target'}
                    </p>
                  )
                })}
              </div>
            )}

            <Button
              onClick={handleAssign}
              disabled={isSubmitting || !isCoach || !selectedWorkout || selectedAthletes.length === 0 || !selectedDate || (repeatFrequency !== 'none' && !repeatUntil)}
              className="w-full bg-gold hover:bg-gold/90 text-navy mt-4"
            >
              {isSubmitting ? t.assigningDots : t.assignWorkoutBtn}
            </Button>
            {!isCoach && (
              <p className="text-xs text-destructive text-center">{t.onlyCoachCanAssign}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
