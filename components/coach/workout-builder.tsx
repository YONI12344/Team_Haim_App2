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
import { useWorkoutTypeLabels, autoWorkoutTitle } from '@/lib/workout-labels'
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
  'swim',
  'bike',
  'rest',
  'race',
  'time_trial',
]

interface WorkoutBuilderProps {
  workoutId?: string
  onDone?: (workout?: any) => void
  hideBackButton?: boolean
}

export function WorkoutBuilder({ workoutId, onDone, hideBackButton }: WorkoutBuilderProps) {
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
          setSets(Array.isArray(data.sets) ? data.sets.map((s: any) => ({ ...s, intervals: s.intervals || [] })) : [])
        } else {
          toast.error('Workout not found')
          if (onDone) onDone(); else router.push('/coach/workouts')
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
        intervals: [],
      } as any,
    ])
  }

  const updateSet = (index: number, field: string, value: string | number) => {
    const newSets = [...sets] as any[]
    newSets[index] = { ...newSets[index], [field]: value }
    setSets(newSets)
  }

  const removeSet = (index: number) => {
    setSets(sets.filter((_, i) => i !== index))
  }

  const addInterval = (setIndex: number) => {
    const newSets = [...sets] as any[]
    const intervals = newSets[setIndex].intervals || []
    newSets[setIndex] = {
      ...newSets[setIndex],
      intervals: [...intervals, { id: `int-${Date.now()}`, distance: '', pace: '', rest: '' }],
    }
    setSets(newSets)
  }

  const updateInterval = (setIndex: number, intIndex: number, field: string, value: string) => {
    const newSets = [...sets] as any[]
    const intervals = [...(newSets[setIndex].intervals || [])]
    intervals[intIndex] = { ...intervals[intIndex], [field]: value }
    newSets[setIndex] = { ...newSets[setIndex], intervals }
    setSets(newSets)
  }

  const removeInterval = (setIndex: number, intIndex: number) => {
    const newSets = [...sets] as any[]
    newSets[setIndex] = {
      ...newSets[setIndex],
      intervals: (newSets[setIndex].intervals || []).filter((_: any, i: number) => i !== intIndex),
    }
    setSets(newSets)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    // Empty title → auto-generate one from the type + sets/distance/duration
    const finalTitle = title.trim() ||
      autoWorkoutTitle(workoutTypeLabels, type, { distance, duration, sets: sets as any[] })

    if (!isCoach) {
      toast.error('Only the coach account can save workouts')
      return
    }

    setIsSubmitting(true)
    try {
      const payload = {
        title: finalTitle,
        type,
        description: description.trim(),
        duration: duration ? Number(duration) : null,
        distance: distance ? Number(distance) : null,
        warmup: warmup.trim() || null,
        cooldown: cooldown.trim() || null,
        notes: notes.trim() || null,
        sets: (sets as any[]).map((s, i) => ({
          id: s.id || `set-${i}`,
          reps: s.reps || 1,
          distance: s.distance || '',
          duration: s.duration || '',
          pace: s.pace || '',
          rest: s.rest || '',
          intervals: (s.intervals || []).map((iv: any, j: number) => ({
            id: iv.id || `int-${i}-${j}`,
            distance: iv.distance || '',
            pace: iv.pace || '',
            rest: iv.rest || '',
          })),
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
      if (onDone) onDone(); else router.push('/coach/workouts')
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
    <div className="space-y-6 pb-28 md:pb-6">
      {/* Back Button */}
      {!hideBackButton && (
        <Link href="/coach/workouts">
          <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />
            {t.backToLibrary}
          </Button>
        </Link>
      )}

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
                  dir="auto"
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
                dir="auto"
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
                {(sets as any[]).map((set, index) => {
                  const hasIntervals = set.intervals && set.intervals.length > 0
                  return (
                    <div key={set.id || index} className="rounded-lg border border-border overflow-hidden">
                      {/* Set header */}
                      <div className="flex items-center justify-between bg-muted/40 px-4 py-2">
                        <span className="font-semibold text-navy text-sm">{t.setLabel} {index + 1}</span>
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeSet(index)} className="text-destructive hover:text-destructive h-7 w-7 p-0">
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      <div className="p-4 space-y-3">
                        {/* Reps + rest between sets */}
                        <div className="grid gap-3 grid-cols-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Repeat (reps)</Label>
                            <Input
                              type="number" min="1"
                              placeholder="e.g. 3"
                              value={set.reps || ''}
                              onChange={(e) => updateSet(index, 'reps', parseInt(e.target.value) || 1)}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Rest between sets</Label>
                            <Input
                              placeholder="e.g. 5 min jog"
                              value={set.rest || ''}
                              onChange={(e) => updateSet(index, 'rest', e.target.value)}
                            />
                          </div>
                        </div>

                        {/* Simple mode: single distance/pace */}
                        {!hasIntervals && (
                          <div className="grid gap-3 grid-cols-2">
                            <div className="space-y-1">
                              <Label className="text-xs">Distance / Duration</Label>
                              <Input
                                placeholder="e.g. 1000m or 5 min"
                                value={set.distance || ''}
                                onChange={(e) => updateSet(index, 'distance', e.target.value)}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">Pace / Effort</Label>
                              <Input
                                placeholder="e.g. 4:00/km or Z4"
                                value={set.pace || ''}
                                onChange={(e) => updateSet(index, 'pace', e.target.value)}
                              />
                            </div>
                          </div>
                        )}

                        {/* Complex mode: multiple intervals */}
                        {hasIntervals && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Intervals in this set</p>
                            {set.intervals.map((interval: any, intIndex: number) => (
                              <div key={interval.id || intIndex} className="grid gap-2 grid-cols-4 items-end bg-muted/20 rounded-lg p-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Distance</Label>
                                  <Input
                                    placeholder="800m"
                                    value={interval.distance || ''}
                                    onChange={(e) => updateInterval(index, intIndex, 'distance', e.target.value)}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Pace</Label>
                                  <Input
                                    placeholder="3:45/km"
                                    value={interval.pace || ''}
                                    onChange={(e) => updateInterval(index, intIndex, 'pace', e.target.value)}
                                  />
                                </div>
                                <div className="space-y-1">
                                  <Label className="text-xs">Rest after</Label>
                                  <Input
                                    placeholder="2 min"
                                    value={interval.rest || ''}
                                    onChange={(e) => updateInterval(index, intIndex, 'rest', e.target.value)}
                                  />
                                </div>
                                <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removeInterval(index, intIndex)}>
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex gap-2 pt-1">
                          <Button
                            type="button" variant="outline" size="sm"
                            onClick={() => addInterval(index)}
                            className="text-xs h-7"
                          >
                            <Plus className="h-3 w-3 mr-1" />
                            {hasIntervals ? 'Add interval' : 'Make complex (add intervals)'}
                          </Button>
                          {hasIntervals && (
                            <Button
                              type="button" variant="ghost" size="sm"
                              className="text-xs h-7 text-muted-foreground"
                              onClick={() => {
                                const newSets = [...sets] as any[]
                                newSets[index] = { ...newSets[index], intervals: [] }
                                setSets(newSets)
                              }}
                            >
                              Switch to simple
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
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
              dir="auto"
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
