'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { mockAthleteProfile, mockAssignedWorkouts, mockWeeklyStats } from '@/lib/mock-data'
import { format, isToday, isTomorrow, parseISO } from 'date-fns'
import { 
  Calendar, 
  Clock, 
  Target, 
  TrendingUp, 
  Flame,
  ChevronRight,
  Activity
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { WorkoutType } from '@/lib/types'

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

export function AthleteDashboard() {
  const profile = mockAthleteProfile
  const upcomingWorkouts = mockAssignedWorkouts
    .filter(w => w.status === 'scheduled')
    .slice(0, 5)
  
  const todayWorkout = mockAssignedWorkouts.find(
    w => isToday(parseISO(w.scheduledDate))
  )

  const completedThisWeek = mockAssignedWorkouts.filter(
    w => w.status === 'completed'
  ).length

  const totalThisWeek = 7
  const weeklyProgress = (completedThisWeek / totalThisWeek) * 100

  const currentWeekStats = mockWeeklyStats[mockWeeklyStats.length - 1]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
          Welcome back, {(profile.name || 'Athlete').split(' ')[0]}
        </h1>
        <p className="text-muted-foreground">
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </p>
      </div>

      {/* Today's Workout - Hero Card */}
      {todayWorkout && (
        <Card className="border-gold/20 bg-gradient-to-br from-gold/5 to-transparent">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg font-medium text-muted-foreground">
                {"Today's Workout"}
              </CardTitle>
              <Badge className={cn('border', workoutTypeColors[todayWorkout.workout.type])}>
                {workoutTypeLabels[todayWorkout.workout.type]}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <h2 className="text-xl md:text-2xl font-serif font-semibold text-navy mb-3">
              {todayWorkout.workout.title}
            </h2>
            <p className="text-muted-foreground mb-4">
              {todayWorkout.workout.description}
            </p>
            <div className="flex flex-wrap gap-4 text-sm">
              {todayWorkout.workout.duration && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Clock className="h-4 w-4 text-gold" />
                  <span>{todayWorkout.workout.duration} min</span>
                </div>
              )}
              {todayWorkout.workout.distance && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Activity className="h-4 w-4 text-gold" />
                  <span>{todayWorkout.workout.distance} km</span>
                </div>
              )}
            </div>
            <Link
              href={`/athlete/schedule?date=${todayWorkout.scheduledDate}`}
              className="inline-flex items-center gap-1 mt-4 text-sm font-medium text-gold hover:text-gold/80 transition-colors"
            >
              View full details
              <ChevronRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Calendar className="h-4 w-4" />
                <span className="text-sm">This Week</span>
              </div>
              <span className="text-2xl font-bold text-navy">{completedThisWeek}/{totalThisWeek}</span>
              <span className="text-xs text-muted-foreground">workouts completed</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Activity className="h-4 w-4" />
                <span className="text-sm">Distance</span>
              </div>
              <span className="text-2xl font-bold text-navy">{currentWeekStats.totalDistance}</span>
              <span className="text-xs text-muted-foreground">km this week</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <TrendingUp className="h-4 w-4" />
                <span className="text-sm">PRs</span>
              </div>
              <span className="text-2xl font-bold text-navy">{profile.personalRecords.length}</span>
              <span className="text-xs text-muted-foreground">personal records</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex flex-col">
              <div className="flex items-center gap-2 text-muted-foreground mb-1">
                <Target className="h-4 w-4" />
                <span className="text-sm">Goals</span>
              </div>
              <span className="text-2xl font-bold text-navy">{profile.goals.filter(g => g.status === 'active').length}</span>
              <span className="text-xs text-muted-foreground">active goals</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two Column Layout */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Upcoming Schedule */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-medium">Upcoming Workouts</CardTitle>
            <Link
              href="/athlete/schedule"
              className="text-sm text-gold hover:text-gold/80 transition-colors"
            >
              View all
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {upcomingWorkouts.map((workout) => {
                const date = parseISO(workout.scheduledDate)
                const dateLabel = isToday(date)
                  ? 'Today'
                  : isTomorrow(date)
                  ? 'Tomorrow'
                  : format(date, 'EEE, MMM d')

                return (
                  <div
                    key={workout.id}
                    className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-12 text-center">
                        <span className="text-xs text-muted-foreground block">
                          {dateLabel.split(',')[0]}
                        </span>
                        {!isToday(date) && !isTomorrow(date) && (
                          <span className="text-sm font-medium text-navy">
                            {format(date, 'd')}
                          </span>
                        )}
                      </div>
                      <div>
                        <p className="font-medium text-navy text-sm">
                          {workout.workout.title}
                        </p>
                        {workout.workout.duration && (
                          <p className="text-xs text-muted-foreground">
                            {workout.workout.duration} min
                          </p>
                        )}
                      </div>
                    </div>
                    <Badge
                      variant="outline"
                      className={cn('text-xs', workoutTypeColors[workout.workout.type])}
                    >
                      {workoutTypeLabels[workout.workout.type]}
                    </Badge>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Weekly Progress & Goals */}
        <div className="space-y-6">
          {/* Weekly Progress */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg font-medium">Weekly Progress</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div>
                  <div className="flex justify-between text-sm mb-2">
                    <span className="text-muted-foreground">Workouts Completed</span>
                    <span className="font-medium text-navy">{completedThisWeek} of {totalThisWeek}</span>
                  </div>
                  <Progress value={weeklyProgress} className="h-2" />
                </div>
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center">
                      <Flame className="h-4 w-4 text-gold" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-navy">{currentWeekStats.averageEffort.toFixed(1)}</p>
                      <p className="text-xs text-muted-foreground">Avg Effort</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center">
                      <Clock className="h-4 w-4 text-gold" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-navy">{Math.round(currentWeekStats.totalDuration / 60)}h</p>
                      <p className="text-xs text-muted-foreground">Total Time</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Active Goals */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg font-medium">Active Goals</CardTitle>
              <Link
                href="/athlete/profile#goals"
                className="text-sm text-gold hover:text-gold/80 transition-colors"
              >
                View all
              </Link>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {profile.goals
                  .filter((g) => g.status === 'active')
                  .slice(0, 3)
                  .map((goal) => (
                    <div
                      key={goal.id}
                      className="flex items-center gap-3 p-3 rounded-lg bg-muted/50"
                    >
                      <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center flex-shrink-0">
                        <Target className="h-4 w-4 text-gold" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-navy text-sm truncate">
                          {goal.title}
                        </p>
                        {goal.targetDate && (
                          <p className="text-xs text-muted-foreground">
                            Target: {format(new Date(goal.targetDate), 'MMM d, yyyy')}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
