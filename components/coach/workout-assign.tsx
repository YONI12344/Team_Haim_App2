'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Calendar } from '@/components/ui/calendar'
import { mockAthletes, mockWorkouts } from '@/lib/mock-data'
import { ArrowLeft, Clock, Activity, Check } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { format } from 'date-fns'
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

interface WorkoutAssignProps {
  workoutId?: string
  athleteId?: string
}

export function WorkoutAssign({ workoutId, athleteId }: WorkoutAssignProps) {
  const router = useRouter()
  const athletes = mockAthletes
  const workouts = mockWorkouts
  
  const [selectedWorkout, setSelectedWorkout] = useState(
    workoutId ? workouts.find(w => w.id === workoutId) : null
  )
  const [selectedAthletes, setSelectedAthletes] = useState<string[]>(
    athleteId ? [athleteId] : []
  )
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(new Date())
  const [isSubmitting, setIsSubmitting] = useState(false)

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  const toggleAthlete = (id: string) => {
    setSelectedAthletes(prev =>
      prev.includes(id)
        ? prev.filter(a => a !== id)
        : [...prev, id]
    )
  }

  const handleAssign = async () => {
    if (!selectedWorkout) {
      toast.error('Please select a workout')
      return
    }
    if (selectedAthletes.length === 0) {
      toast.error('Please select at least one athlete')
      return
    }
    if (!selectedDate) {
      toast.error('Please select a date')
      return
    }

    setIsSubmitting(true)
    
    // In a real app, this would save to Firebase
    setTimeout(() => {
      toast.success(`Workout assigned to ${selectedAthletes.length} athlete(s)!`)
      router.push('/coach/athletes')
    }, 500)
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link href="/coach/workouts">
        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
          Assign Workout
        </h1>
        <p className="text-muted-foreground">
          Select a workout, athletes, and date to schedule
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Select Workout */}
        <Card>
          <CardHeader>
            <CardTitle>Select Workout</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {workouts.map((workout) => (
                <button
                  key={workout.id}
                  onClick={() => setSelectedWorkout(workout)}
                  className={cn(
                    'w-full p-4 rounded-lg border text-left transition-luxury',
                    selectedWorkout?.id === workout.id
                      ? 'border-gold bg-gold/5'
                      : 'border-border hover:bg-muted/50'
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
                      <Badge 
                        variant="outline" 
                        className={cn('text-xs', workoutTypeColors[workout.type])}
                      >
                        {workoutTypeLabels[workout.type]}
                      </Badge>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      {workout.duration && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3.5 w-3.5" />
                          {workout.duration} min
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Select Athletes */}
        <Card>
          <CardHeader>
            <CardTitle>Select Athletes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {athletes.map((athlete) => (
                <button
                  key={athlete.id}
                  onClick={() => toggleAthlete(athlete.id)}
                  className={cn(
                    'w-full p-4 rounded-lg border text-left transition-luxury',
                    selectedAthletes.includes(athlete.id)
                      ? 'border-gold bg-gold/5'
                      : 'border-border hover:bg-muted/50'
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
                        {athlete.events.slice(0, 2).join(', ')}
                      </p>
                    </div>
                    {selectedAthletes.includes(athlete.id) && (
                      <Check className="h-5 w-5 text-gold" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Select Date */}
        <Card>
          <CardHeader>
            <CardTitle>Select Date</CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Calendar
              mode="single"
              selected={selectedDate}
              onSelect={setSelectedDate}
              className="rounded-md border"
            />
          </CardContent>
        </Card>

        {/* Summary */}
        <Card>
          <CardHeader>
            <CardTitle>Assignment Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <span className="text-sm text-muted-foreground">Workout:</span>
              <p className="font-medium text-navy">
                {selectedWorkout?.title || 'Not selected'}
              </p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Athletes:</span>
              <p className="font-medium text-navy">
                {selectedAthletes.length > 0
                  ? `${selectedAthletes.length} athlete(s) selected`
                  : 'None selected'}
              </p>
            </div>
            <div>
              <span className="text-sm text-muted-foreground">Date:</span>
              <p className="font-medium text-navy">
                {selectedDate ? format(selectedDate, 'EEEE, MMMM d, yyyy') : 'Not selected'}
              </p>
            </div>

            <Button
              onClick={handleAssign}
              disabled={isSubmitting || !selectedWorkout || selectedAthletes.length === 0 || !selectedDate}
              className="w-full bg-gold hover:bg-gold/90 text-navy mt-4"
            >
              {isSubmitting ? 'Assigning...' : 'Assign Workout'}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
