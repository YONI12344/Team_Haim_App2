'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { mockAssignedWorkouts } from '@/lib/mock-data'
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
import { ChevronLeft, ChevronRight, Clock, Activity, Check, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { AssignedWorkout, WorkoutType } from '@/lib/types'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

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

type ViewMode = 'week' | 'month'

export function AthleteSchedule() {
  const [currentDate, setCurrentDate] = useState(new Date())
  const [viewMode, setViewMode] = useState<ViewMode>('week')
  const [selectedWorkout, setSelectedWorkout] = useState<AssignedWorkout | null>(null)

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

  const getWorkoutForDate = (date: Date): AssignedWorkout | undefined => {
    return mockAssignedWorkouts.find(w => 
      isSameDay(parseISO(w.scheduledDate), date)
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
            Schedule
          </h1>
          <p className="text-muted-foreground">
            View and track your training plan
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)}>
            <TabsList>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
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
            Today
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
            const workout = getWorkoutForDate(day)
            const today = isToday(day)

            return (
              <Card 
                key={day.toISOString()} 
                className={cn(
                  'transition-luxury cursor-pointer hover:shadow-md',
                  today && 'ring-2 ring-gold/50',
                  workout?.status === 'completed' && 'bg-muted/30'
                )}
                onClick={() => workout && setSelectedWorkout(workout)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-4">
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

                      {/* Workout Info */}
                      {workout ? (
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
                          </div>
                          <p className="text-sm text-muted-foreground line-clamp-1 mb-2">
                            {workout.workout.description}
                          </p>
                          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                            {workout.workout.duration && (
                              <span className="flex items-center gap-1">
                                <Clock className="h-3.5 w-3.5" />
                                {workout.workout.duration} min
                              </span>
                            )}
                            {workout.workout.distance && (
                              <span className="flex items-center gap-1">
                                <Activity className="h-3.5 w-3.5" />
                                {workout.workout.distance} km
                              </span>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center text-muted-foreground">
                          <span className="text-sm">No workout scheduled</span>
                        </div>
                      )}
                    </div>

                    {/* Badge */}
                    {workout && (
                      <Badge 
                        variant="outline" 
                        className={cn('flex-shrink-0', workoutTypeColors[workout.workout.type])}
                      >
                        {workoutTypeLabels[workout.workout.type]}
                      </Badge>
                    )}
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
              {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                <div key={day} className="text-center text-sm font-medium text-muted-foreground py-2">
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

                const workout = getWorkoutForDate(day)
                const today = isToday(day)

                return (
                  <div
                    key={day.toISOString()}
                    onClick={() => workout && setSelectedWorkout(workout)}
                    className={cn(
                      'aspect-square p-1 rounded-lg border border-transparent transition-luxury',
                      today && 'border-gold',
                      workout && 'cursor-pointer hover:bg-muted/50'
                    )}
                  >
                    <div className="h-full flex flex-col">
                      <span className={cn(
                        'text-xs font-medium mb-1',
                        today ? 'text-gold' : 'text-foreground'
                      )}>
                        {format(day, 'd')}
                      </span>
                      {workout && (
                        <div 
                          className={cn(
                            'flex-1 rounded p-0.5 text-[10px] leading-tight overflow-hidden',
                            workoutTypeColors[workout.workout.type]
                          )}
                        >
                          <span className="line-clamp-2 font-medium">
                            {workout.workout.title}
                          </span>
                        </div>
                      )}
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
        <DialogContent className="max-w-lg">
          {selectedWorkout && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-2 mb-2">
                  <Badge className={cn('border', workoutTypeColors[selectedWorkout.workout.type])}>
                    {workoutTypeLabels[selectedWorkout.workout.type]}
                  </Badge>
                  {selectedWorkout.status === 'completed' && (
                    <Badge variant="outline" className="bg-emerald-100 text-emerald-700 border-emerald-200">
                      Completed
                    </Badge>
                  )}
                </div>
                <DialogTitle className="text-xl font-serif text-navy">
                  {selectedWorkout.workout.title}
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
                      {selectedWorkout.workout.duration} min
                    </span>
                  )}
                  {selectedWorkout.workout.distance && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <Activity className="h-4 w-4" />
                      {selectedWorkout.workout.distance} km
                    </span>
                  )}
                </div>

                {selectedWorkout.workout.warmup && (
                  <div>
                    <h4 className="font-medium text-navy mb-1">Warmup</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedWorkout.workout.warmup}
                    </p>
                  </div>
                )}

                {selectedWorkout.workout.sets && selectedWorkout.workout.sets.length > 0 && (
                  <div>
                    <h4 className="font-medium text-navy mb-2">Workout</h4>
                    <div className="space-y-2">
                      {selectedWorkout.workout.sets.map((set) => (
                        <div 
                          key={set.id} 
                          className="p-3 rounded-lg bg-muted/50 text-sm"
                        >
                          <span className="font-medium text-navy">
                            {set.reps}x {set.distance || set.duration}
                          </span>
                          {set.pace && (
                            <span className="text-muted-foreground ml-2">
                              @ {set.pace}
                            </span>
                          )}
                          {set.rest && (
                            <p className="text-muted-foreground mt-1">
                              Rest: {set.rest}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedWorkout.workout.cooldown && (
                  <div>
                    <h4 className="font-medium text-navy mb-1">Cooldown</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedWorkout.workout.cooldown}
                    </p>
                  </div>
                )}

                {selectedWorkout.workout.notes && (
                  <div>
                    <h4 className="font-medium text-navy mb-1">Notes</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedWorkout.workout.notes}
                    </p>
                  </div>
                )}

                {selectedWorkout.athleteNotes && (
                  <div className="pt-4 border-t border-border">
                    <h4 className="font-medium text-navy mb-1">Your Notes</h4>
                    <p className="text-sm text-muted-foreground">
                      {selectedWorkout.athleteNotes}
                    </p>
                  </div>
                )}

                {selectedWorkout.coachFeedback && (
                  <div className="p-3 rounded-lg bg-gold/10 border border-gold/20">
                    <h4 className="font-medium text-navy mb-1">Coach Feedback</h4>
                    <p className="text-sm text-foreground">
                      {selectedWorkout.coachFeedback}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
