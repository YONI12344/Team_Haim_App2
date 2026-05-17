'use client'

import { useEffect, useState } from 'react'
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
import { ArrowLeft, Plus, Trash2, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import type { Workout, WorkoutType, WorkoutSet } from '@/lib/types'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { isCoachEmail } from '@/lib/constants'
import { useWorkoutTypeLabels } from '@/lib/workout-labels'
import { useLanguage } from '@/contexts/language-context'

const workoutTypeOrder: WorkoutType[] = [
  'easy',
  'long_run',
  'tempo',
  'intervals',
  'hill_repeats',
  'fartlek',
  'recovery',
  'strength',
  'cross_training',
  'rest',
  'race',
  'time_trial',
]

interface WorkoutBuilderProps {
  workoutId?: string
}

export function WorkoutBuilder({ workoutId }: WorkoutBuilderProps) {
  const { t } = useLanguage()
  const router = useRouter()
  const { user } = useAuth()
  const workoutTypeLabels = useWorkoutTypeLabels()
  const workoutTypes = workoutTypeOrder.map((value) => ({
    value,
    label: workoutTypeLabels[value],
  }))
  const isCoach = isCoachEmail(user?.email)

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
  const [loading, setLoading] = useState(!!workoutId)

  // Load existing workout when editing
  useEffect(() => {
    if (!workoutId) return
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'workouts', workoutId))
        if (snap.exists()) {
          const data = snap.data() as Workout
          setTitle(data.title || '')
          setType((data.type as WorkoutType) || 'easy')
          setDescription(data.description || '')
          setDuration(data.duration ? String(data.duration) : '')
          setDistance(data.distance ? String(data.distance) : '')
          setWarmup(data.warmup || '')
          setCooldown(data.cooldown || '')
          setNotes(data.notes || '')
          setSets(Array.isArray(data.sets) ? data.sets : [])
        } else {
          toast.error('Workout not found')
          router.push('/coach/workouts')
        }
      } catch (err) {
        console.error('Error loading workout:', err)
        toast.error('Failed to load workout')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [workoutId, router])

  const addSet = () => {
    setSets([
      ...sets,
      {
        id: `set-${Date.now()}`,
        reps: 1,
        distance: '',
        pace: '',
        rest: '',
      },
    ])
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

    if (!isCoach) {
      toast.error('Only the coach account can save workouts')
      return
    }

    setIsSubmitting(true)
    try {
      const payload = {
        title: title.trim(),
        type,
        description: description.trim(),
        duration: duration ? Number(duration) : null,
        distance: distance ? Number(distance) : null,
        warmup: warmup.trim() || null,
        cooldown: cooldown.trim() || null,
        notes: notes.trim() || null,
        sets: sets.map((s, i) => ({
          id: s.id || `set-${i}`,
          reps: s.reps || 1,
          distance: s.distance || '',
          duration: s.duration || '',
          pace: s.pace || '',
          rest: s.rest || '',
        })),
        updatedAt: serverTimestamp(),
        updatedBy: user?.id || null,
      }

      if (workoutId) {
        await updateDoc(doc(db, 'workouts', workoutId), payload)
        toast.success('Workout updated!')
      } else {
        await addDoc(collection(db, 'workouts'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: user?.id || null,
        })
        toast.success('Workout created!')
      }
      router.push('/coach/workouts')
    } catch (err) {
      console.error('Error saving workout:', err)
      toast.error('Failed to save workout')
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
      {/* Back Button */}
      <Link href="/coach/workouts">
        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t.backToLibrary}
        </Button>
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
          {workoutId ? t.editWorkoutTitle : t.createWorkoutTitle}
        </h1>
        <p className="text-muted-foreground">
          {workoutId
            ? t.updateWorkoutTemplate
            : t.buildNewWorkoutTemplate}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle>{t.basicInformation}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="title">{t.workoutTitleLabel} *</Label>
                <Input
                  id="title"
                  placeholder={t.workoutTitlePh}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">{t.workoutTypeLabel} *</Label>
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
              <Label htmlFor="description">{t.descriptionLabel}</Label>
              <Textarea
                id="description"
                placeholder={t.describeWorkoutPh}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="duration">{t.durationMinutesLabel}</Label>
                <Input
                  id="duration"
                  type="number"
                  placeholder="60"
                  value={duration}
                  onChange={(e) => setDuration(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="distance">{t.distanceKmLabel}</Label>
                <Input
                  id="distance"
                  type="number"
                  step="0.1"
                  placeholder="10"
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
            <CardTitle>{t.warmupCooldownTitle}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="warmup">{t.warmupLabel}</Label>
              <Textarea
                id="warmup"
                placeholder={t.warmupPh}
                value={warmup}
                onChange={(e) => setWarmup(e.target.value)}
                rows={2}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cooldown">{t.cooldownLabel}</Label>
              <Textarea
                id="cooldown"
                placeholder={t.cooldownPh}
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
            <CardTitle>{t.workoutSetsTitle}</CardTitle>
            <Button type="button" variant="outline" size="sm" onClick={addSet}>
              <Plus className="h-4 w-4 mr-2" />
              {t.addSetBtn}
            </Button>
          </CardHeader>
          <CardContent>
            {sets.length === 0 ? (
              <p className="text-muted-foreground text-center py-8">
                {t.noSetsAdded}
              </p>
            ) : (
              <div className="space-y-4">
                {sets.map((set, index) => (
                  <div
                    key={set.id || index}
                    className="p-4 rounded-lg border border-border space-y-4"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-navy">{t.setLabel} {index + 1}</span>
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
                        <Label>{t.repsLabel}</Label>
                        <Input
                          type="number"
                          min="1"
                          value={set.reps || ''}
                          onChange={(e) =>
                            updateSet(index, 'reps', parseInt(e.target.value) || 1)
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t.distanceDurationLabel}</Label>
                        <Input
                          placeholder={t.distanceDurationPh}
                          value={set.distance || ''}
                          onChange={(e) => updateSet(index, 'distance', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t.paceEffortLabel}</Label>
                        <Input
                          placeholder={t.paceEffortPh}
                          value={set.pace || ''}
                          onChange={(e) => updateSet(index, 'pace', e.target.value)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>{t.restLabel}</Label>
                        <Input
                          placeholder={t.restPh}
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
            <CardTitle>{t.additionalNotesTitle}</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder={t.additionalNotesPh}
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
            disabled={isSubmitting || !isCoach}
            className="bg-gold hover:bg-gold/90 text-navy"
          >
            {isSubmitting
              ? workoutId
                ? t.updatingDots
                : t.creatingDots
              : workoutId
              ? t.updateWorkoutBtn
              : t.createWorkoutAction}
          </Button>
          <Link href="/coach/workouts">
            <Button type="button" variant="outline">
              {t.cancel}
            </Button>
          </Link>
        </div>
        {!isCoach && (
          <p className="text-sm text-destructive">
            {t.onlyCoachCanSave}
          </p>
        )}
      </form>
    </div>
  )
}
