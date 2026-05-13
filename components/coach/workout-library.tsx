'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { mockWorkouts } from '@/lib/mock-data'
import { 
  Search, 
  Plus, 
  Clock,
  Activity,
  ChevronRight,
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

export function WorkoutLibrary() {
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<WorkoutType | 'all'>('all')
  const workouts = mockWorkouts

  const filteredWorkouts = workouts.filter(workout => {
    const matchesSearch = workout.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      workout.description.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesType = typeFilter === 'all' || workout.type === typeFilter
    return matchesSearch && matchesType
  })

  const workoutTypes: (WorkoutType | 'all')[] = ['all', 'easy', 'long_run', 'tempo', 'intervals', 'hill_repeats', 'fartlek', 'rest']

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
            Workout Library
          </h1>
          <p className="text-muted-foreground">
            Create and manage your workout templates
          </p>
        </div>
        <Link href="/coach/workouts/new">
          <Button className="bg-gold hover:bg-gold/90 text-navy">
            <Plus className="h-4 w-4 mr-2" />
            Create Workout
          </Button>
        </Link>
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search workouts..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {workoutTypes.map((type) => (
            <Button
              key={type}
              variant="outline"
              size="sm"
              onClick={() => setTypeFilter(type)}
              className={cn(
                type === typeFilter && 'bg-gold/10 border-gold text-gold'
              )}
            >
              {type === 'all' ? 'All' : workoutTypeLabels[type]}
            </Button>
          ))}
        </div>
      </div>

      {/* Workouts Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredWorkouts.map((workout) => (
          <Card key={workout.id} className="hover:shadow-md transition-luxury">
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between">
                <Badge className={cn('border', workoutTypeColors[workout.type])}>
                  {workoutTypeLabels[workout.type]}
                </Badge>
              </div>
              <CardTitle className="text-lg font-semibold text-navy mt-2">
                {workout.title}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                {workout.description}
              </p>
              
              <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mb-4">
                {workout.duration && (
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {workout.duration} min
                  </span>
                )}
                {workout.distance && (
                  <span className="flex items-center gap-1">
                    <Activity className="h-4 w-4" />
                    {workout.distance} km
                  </span>
                )}
              </div>

              {workout.sets && workout.sets.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-muted/50 text-sm">
                  <span className="font-medium text-navy">
                    {workout.sets[0].reps}x {workout.sets[0].distance || workout.sets[0].duration}
                  </span>
                  {workout.sets[0].pace && (
                    <span className="text-muted-foreground ml-2">@ {workout.sets[0].pace}</span>
                  )}
                </div>
              )}

              <Link href={`/coach/workouts/${workout.id}/assign`}>
                <Button variant="outline" className="w-full text-gold hover:text-gold/80">
                  Assign to Athlete
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredWorkouts.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No workouts found matching your search.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
