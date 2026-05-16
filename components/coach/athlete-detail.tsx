'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { format, parseISO, startOfWeek } from 'date-fns'
import { 
  ArrowLeft, 
  Trophy,
  Target,
  Clock,
  Calendar,
  MapPin,
  Award,
  Activity,
  MessageCircle,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts'
import type { AssignedWorkout, AthleteProfile, Workout, WorkoutType, WorkoutLog } from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import { 
  collection, doc, getDoc, getDocs, query, where, DocumentData, QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TrainingZonesCard } from '@/components/athlete/training-zones-card'

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
    createdAt: data.createdAt?.toDate?.() || new Date(),
  }
}

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

const workoutTypeColors: Record<WorkoutType, string> = {
  easy: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  long_run: 'bg-blue-100 text-blue-700 border-blue-200',
  tempo: 'bg-amber-100 text-amber-700 border-amber-200',
  intervals: 'bg-red-100 text-red-700 border-red-200',
  hill_repeats: 'bg-orange-100 text-orange-700 border-orange-200',
  fartlek: 'bg-purple-100 text-purple-700 border-purple-200',
  recovery: 'bg-teal-100 text-teal-700 border-teal-200',
  strength: 'bg-slate-100 text-slate-700 border-slate-200',
  cross_training: 'bg-cyan-100 text-cyan-700 border-cyan-200',
  rest: 'bg-gray-100 text-gray-600 border-gray-200',
  race: 'bg-gold/20 text-gold border-gold/30',
  time_trial: 'bg-rose-100 text-rose-700 border-rose-200',
}

const workoutTypeLabels: Record<WorkoutType, string> = {
  easy: 'Easy',
  long_run: 'Long Run',
  tempo: 'Tempo',
  intervals: 'Intervals',
  hill_repeats: 'Hills',
  fartlek: 'Fartlek',
  recovery: 'Recovery',
  strength: 'Strength',
  cross_training: 'Cross Train',
  rest: 'Rest',
  race: 'Race',
  time_trial: 'Time Trial',
}

interface AthleteDetailProps {
  athleteId: string
}

export function AthleteDetail({ athleteId }: AthleteDetailProps) {
  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  const [athleteWorkouts, setAthleteWorkouts] = useState<AssignedWorkout[]>([])
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const profileSnap = await getDoc(doc(db, 'users', athleteId))
        if (profileSnap.exists()) {
          const data = profileSnap.data()
          setAthlete({
            id: profileSnap.id,
            userId: data.userId || profileSnap.id,
            name: data.name || data.email || 'Athlete',
            email: data.email || '',
            photoURL: data.photoURL,
            dateOfBirth: data.dateOfBirth,
            gender: data.gender,
            height: data.height,
            weight: data.weight,
            events: Array.isArray(data.events) ? data.events : [],
            discipline: Array.isArray(data.discipline) ? data.discipline : undefined,
            experienceLevel: data.experienceLevel,
            weeklyMileage: data.weeklyMileage,
            restingHR: data.restingHR,
            maxHR: data.maxHR,
            goalRaceEvent: data.goalRaceEvent,
            goalRaceDate: data.goalRaceDate,
            goalRaceTarget: data.goalRaceTarget,
            personalRecords: Array.isArray(data.personalRecords) ? data.personalRecords : [],
            seasonBests: Array.isArray(data.seasonBests) ? data.seasonBests : [],
            trainingPaces: Array.isArray(data.trainingPaces) ? data.trainingPaces : [],
            goals: Array.isArray(data.goals) ? data.goals : [],
            coachId: data.coachId,
            createdAt: data.createdAt?.toDate?.() || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || new Date(),
          })
        } else {
          setAthlete(null)
        }
      } catch (err) {
        console.error('Error loading athlete:', err)
        setAthlete(null)
      }

      try {
        const aw = await getDocs(
          query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId)),
        )
        setAthleteWorkouts(aw.docs.map(mapDocToAssignedWorkout))
      } catch (err) {
        console.error('Error loading assigned workouts:', err)
        setAthleteWorkouts([])
      }

      try {
        const q = query(collection(db, 'logs'), where('athleteId', '==', athleteId))
        const snapshot = await getDocs(q)
        setLogs(snapshot.docs.map((d) => mapDocToWorkoutLog(d, athleteId)))
      } catch (error) {
        console.error('Error loading athlete logs:', error)
        setLogs([])
      }

      setLoading(false)
    }
    load()
  }, [athleteId])

  const getLogForWorkout = (workoutId: string): WorkoutLog | undefined => {
    return logs.find(l => l.workoutId === workoutId)
  }

  // Aggregate weekly distance from logs for the progress chart
  const weeklyStats = (() => {
    const map = new Map<string, { week: string; totalDistance: number }>()
    for (const log of logs) {
      if (!log.date) continue
      const start = startOfWeek(parseISO(log.date), { weekStartsOn: 1 })
      const key = start.toISOString().slice(0, 10)
      const cur = map.get(key) || { week: format(start, 'MMM d'), totalDistance: 0 }
      cur.totalDistance += log.actualDistance || 0
      map.set(key, cur)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v)
  })()

  const getInitials = (name: string | undefined | null) => {
    const safeName = name || '?'
    return safeName
      .split(' ')
      .map((n) => n[0] || '')
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  if (!athlete) {
    return (
      <div className="space-y-6">
        <Link href="/coach/athletes">
          <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Athletes
          </Button>
        </Link>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">Athlete not found.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link href="/coach/athletes">
        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Athletes
        </Button>
      </Link>

      {/* Profile Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-start gap-6">
            <Avatar className="w-24 h-24 border-4 border-gold/20">
              <AvatarImage src={athlete.photoURL} alt={athlete.name} />
              <AvatarFallback className="bg-gold/10 text-gold text-2xl font-serif">
                {getInitials(athlete.name)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-serif font-bold text-navy">
                    {athlete.name}
                  </h1>
                  <p className="text-muted-foreground">{athlete.email}</p>
                </div>
                <div className="flex gap-2">
                  <Link href={`/coach/athletes/${athleteId}/journey`}>
                    <Button variant="outline" className="border-coral/40 text-coral hover:bg-coral-light">
                      Journey
                    </Button>
                  </Link>
                  <Link href={`/coach/athletes/${athleteId}/assign`}>
                    <Button className="bg-gold hover:bg-gold/90 text-navy">
                      Assign Workout
                    </Button>
                  </Link>
                  <Link href={`/coach/chat?athlete=${athleteId}`}>
                    <Button variant="outline">
                      Message
                    </Button>
                  </Link>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {athlete.events.map((event) => (
                  <Badge key={event} variant="secondary" className="bg-navy/10 text-navy">
                    {event}
                  </Badge>
                ))}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Trophy className="h-4 w-4 text-gold" />
                  <span className="text-muted-foreground">
                    {athlete.personalRecords.length} PRs
                  </span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Target className="h-4 w-4 text-gold" />
                  <span className="text-muted-foreground">
                    {athlete.goals.filter(g => g.status === 'active').length} Active Goals
                  </span>
                </div>
                {athlete.height && (
                  <div className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{athlete.height} cm</span>
                  </div>
                )}
                {athlete.weight && (
                  <div className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{athlete.weight} kg</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Training zones (coach view shows formula) */}
      <TrainingZonesCard
        personalRecords={athlete.personalRecords}
        restingHR={athlete.restingHR}
        maxHR={athlete.maxHR}
        showFormula
      />

      {/* Tabs */}
      <Tabs defaultValue="schedule" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="schedule">Schedule</TabsTrigger>
          <TabsTrigger value="prs">PRs</TabsTrigger>
          <TabsTrigger value="paces">Paces</TabsTrigger>
          <TabsTrigger value="progress">Progress</TabsTrigger>
        </TabsList>

        {/* Schedule Tab */}
        <TabsContent value="schedule" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Upcoming Workouts</CardTitle>
              <Link href={`/coach/athletes/${athleteId}/assign`}>
                <Button size="sm" className="bg-gold hover:bg-gold/90 text-navy">
                  Assign New
                </Button>
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {athleteWorkouts.slice(0, 7).map((workout) => {
                  const log = getLogForWorkout(workout.id)
                  return (
                    <div
                      key={workout.id}
                      className="rounded-lg border border-border overflow-hidden"
                    >
                      <div className="flex items-center justify-between p-4">
                        <div className="flex items-center gap-4">
                          <div className="w-12 h-12 rounded-lg bg-muted flex flex-col items-center justify-center">
                            <span className="text-xs text-muted-foreground">
                              {format(parseISO(workout.scheduledDate), 'EEE')}
                            </span>
                            <span className="text-lg font-bold text-navy">
                              {format(parseISO(workout.scheduledDate), 'd')}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-navy">{workout.workout.title}</p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              {workout.workout.duration && (
                                <span className="flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  {workout.workout.duration} min
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-3">
                          <Badge className={cn('border', workoutTypeColors[workout.workout.type])}>
                            {workoutTypeLabels[workout.workout.type]}
                          </Badge>
                          {workout.status === 'completed' && (
                            <Badge variant="outline" className="bg-emerald-100 text-emerald-700">
                              Done
                            </Badge>
                          )}
                          {log && (
                            <Badge variant="outline" className={cn(
                              log.effort <= 3 ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                              : log.effort <= 6 ? 'bg-amber-100 text-amber-700 border-amber-200'
                              : log.effort <= 8 ? 'bg-orange-100 text-orange-700 border-orange-200'
                              : 'bg-red-100 text-red-700 border-red-200'
                            )}>
                              Effort {log.effort}/10
                            </Badge>
                          )}
                        </div>
                      </div>
                      {/* Athlete log comment (visible to coach) */}
                      {log && (log.comment || log.actualDistance || log.actualPace) && (
                        <div className="px-4 pb-4 pt-0 border-t border-border/50 bg-muted/30">
                          <div className="flex items-center gap-1 mb-1">
                            <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-xs font-medium text-muted-foreground">Athlete Log</span>
                          </div>
                          <div className="text-xs text-muted-foreground space-y-0.5">
                            {(log.actualDistance || log.actualPace) && (
                              <p>
                                {log.actualDistance && <span>{log.actualDistance}km</span>}
                                {log.actualPace && <span className="ml-1">@ {log.actualPace}/km</span>}
                              </p>
                            )}
                            {log.comment && <p className="italic">&ldquo;{log.comment}&rdquo;</p>}
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })}
                {athleteWorkouts.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">
                    No workouts assigned yet
                  </p>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* PRs Tab */}
        <TabsContent value="prs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-gold" />
                Personal Records
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {athlete.personalRecords.map((pr) => (
                  <div
                    key={pr.id}
                    className="p-4 rounded-lg border border-border bg-gradient-to-br from-gold/5 to-transparent"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <Badge className="bg-gold/20 text-gold border-gold/30">
                        {pr.event}
                      </Badge>
                      <Award className="h-5 w-5 text-gold" />
                    </div>
                    <p className="text-3xl font-bold text-navy font-mono">
                      {pr.time}
                    </p>
                    <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(pr.date), 'MMM d, yyyy')}
                      </div>
                      {pr.location && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5" />
                          {pr.location}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Paces Tab */}
        <TabsContent value="paces" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-gold" />
                Training Paces
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {athlete.trainingPaces.map((pace) => (
                  <div
                    key={pace.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-4">
                      <Badge className="capitalize bg-navy/10 text-navy">
                        {pace.type}
                      </Badge>
                      <div>
                        <p className="font-mono font-semibold text-navy">
                          {pace.pace}
                        </p>
                        {pace.description && (
                          <p className="text-sm text-muted-foreground">
                            {pace.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Progress Tab */}
        <TabsContent value="progress" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Weekly Distance (km)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeklyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis 
                      dataKey="week" 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                      }}
                    />
                    <Area 
                      type="monotone" 
                      dataKey="totalDistance" 
                      stroke="oklch(0.75 0.12 85)"
                      fill="oklch(0.75 0.12 85 / 0.2)"
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Goals */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-gold" />
                Active Goals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {athlete.goals
                  .filter(g => g.status === 'active')
                  .map((goal) => (
                    <div
                      key={goal.id}
                      className="p-4 rounded-lg border border-gold/30 bg-gold/5"
                    >
                      <h4 className="font-semibold text-navy">{goal.title}</h4>
                      <div className="flex flex-wrap gap-4 mt-2 text-sm text-muted-foreground">
                        {goal.targetEvent && <span>Event: {goal.targetEvent}</span>}
                        {goal.targetTime && <span className="font-mono">Target: {goal.targetTime}</span>}
                        {goal.targetDate && (
                          <span>By: {format(new Date(goal.targetDate), 'MMM d, yyyy')}</span>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
