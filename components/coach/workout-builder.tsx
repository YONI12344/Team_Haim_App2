'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ArrowLeft, Plus, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { WorkoutType, WorkoutSet } from '@/lib/types'

const workoutTypes: { value: WorkoutType; label: string }[] = [
  { value: 'easy', label: 'Easy Run' },
  { value: 'long_run', label: 'Long Run' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'intervals', label: 'Intervals' },
  { value: 'hill_repeats', label: 'Hill Repeats' },
  { value: 'fartlek', label: 'Fartlek' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'strength', label: 'Strength' },
  { value: 'cross_training', label: 'Cross Training' },
  { value: 'rest', label: 'Rest Day' },
  { value: 'race', label: 'Race' },
  { value: 'time_trial', label: 'Time Trial' },
]

export function WorkoutBuilder() {
  const router = useRouter()
  const [title, setTitle] = useState('')
  const [type, setType] = useState<WorkoutType>('easy')
  const [description, setDescription] = useState('')
  const [duration, setDuration] = useState('')
  const [distance, setDistance] = useState('')
  const [warmup, setWarmup] = useState('')
  const [cooldown, setCooldown] = useState('')
  const [notes, setNotes] = useState('')
  const [sets, setSets] = useState<Partial<WorkoutSet>[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const addSet = () => {
    setSets([...sets, { 
      id: `set-${Date.now()}`,
      reps: 1, 
      distance: '', 
      pace: '', 
      rest: '' 
    }])
  }

  const updateSet = (index: number, field: keyof WorkoutSet, value: string | number) => {
    const newSets = [...sets]
    newSets[index] = { ...newSets[index], [field]: value }
    setSets(newSets)
  }

  const removeSet = (index: number) => {
    setSets(sets.filter((_, i) => i !== index))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!title.trim()) {
      toast.error('Please enter a workout title')
      return
    }

    setIsSubmitting(true)
    
    // In a real app, this would save to Firebase
    // For now, we'll just show a success message
    setTimeout(() => {
      toast.success('Workout created successfully!')
      router.push('/coach/workouts')
    }, 500)
  }

  return (
    <div className="space-y-6">
      {/* Back Button */}
      <Link href="/coach/workouts">
        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Library
        </Button>
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
          Create Workout
        </h1>
        <p className="text-muted-foreground">
          Build a new workout template for your athletes
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>Basic Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="title">Workout Title *</Label>
                <Input
                  id="title"
                  placeholder="e.g., 800m Intervals"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Workout Type *</Label>
                <Select value={type} onValueChange={(v) => setType(v as WorkoutType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {workoutTypes.map((wt) => (
                      <SelectItem key={wt.value} value={wt.value}>
                        {wt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                placeholder="Describe the workout objective and focus..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="duration">Duration (minutes)</Label>
                <Input
                  id="duration"
                  type="number"
                  placeholder="e.g., 60"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="distance">Distance (km)</Label>
                <Input
                  id="distance"
                  type="number"
                  step="0.1"
                  placeholder="e.g., 10"
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Warmup & Cooldown */}
        <Card>
          <CardHeader>
            <CardTitle>Warmup & Cooldown</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="warmup">Warmup</Label>
              <Textarea
                id="warmup"
                placeholder="e.g., 2 mile easy jog, dynamic stretching, 4x100m strides"
                value={warmup}
                onChange={(e) => setWarmup(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cooldown">Cooldown</Label>
              <Textarea
                id="cooldown"
                placeholder="e.g., 1.5 mile easy jog, stretching"
                value={cooldown}
                onChange={(e) => setCooldown(e.target.value)}
                rows={2}
              />
            </div>
          </CardContent>
        </Card>

        {/* Workout Sets */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>Workout Sets</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addSet}>
              <Plus className="h-4 w-4 mr-2" />
              Add Set
            </Button>
          </CardHeader>
          <CardContent>
            {sets.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                No sets added. Click &quot;Add Set&quot; to build interval or structured workouts.
              </p>
            ) : (
              <div className="space-y-4">
                {sets.map((set, index) => (
                  <div
                    key={set.id || index}
                    className="p-4 rounded-lg border border-border space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-navy">Set {index + 1}</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => removeSet(index)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <Label>Reps</Label>
                        <Input
                          type="number"
                          min="1"
                          value={set.reps || ''}
                          onChange={(e) => updateSet(index, 'reps', parseInt(e.target.value) || 1)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Distance/Duration</Label>
                        <Input
                          placeholder="e.g., 400m or 2:00"
                          value={set.distance || ''}
                          onChange={(e) => updateSet(index, 'distance', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Pace/Effort</Label>
                        <Input
                          placeholder="e.g., 68-70 sec"
                          value={set.pace || ''}
                          onChange={(e) => updateSet(index, 'pace', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Rest</Label>
                        <Input
                          placeholder="e.g., 90 sec jog"
                          value={set.rest || ''}
                          onChange={(e) => updateSet(index, 'rest', e.target.value)}
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Notes */}
        <Card>
          <CardHeader>
            <CardTitle>Additional Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Any additional instructions or notes for the athlete..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
            />
          </CardContent>
        </Card>

        {/* Submit */}
        <div className="flex gap-4">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="bg-gold hover:bg-gold/90 text-navy"
          >
            {isSubmitting ? 'Creating...' : 'Create Workout'}
          </Button>
          <Link href="/coach/workouts">
            <Button type="button" variant="outline">
              Cancel
            </Button>
          </Link>
        </div>
      </form>
    </div>
  )
}
