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
  getDocs,
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
  'threshold',
]

interface WorkoutBuilderProps {
  workoutId?: string
  onDone?: (workout?: any) => void
  hideBackButton?: boolean
}

// ---------------------------------------------------------------------------
// Explicit distance/duration picker — replaces the old ambiguous free-text
// "מרחק / משך" input. Writes BOTH the new unambiguous numeric fields
// (distanceMeters / durationSec) and the legacy display strings
// (distance / duration), and always clears the opposite side so a stale
// value from the other mode can never leak into lap matching.
// ---------------------------------------------------------------------------

interface DistDurItem {
  distance?: string
  duration?: string
  distanceMeters?: number
  durationSec?: number
}

type DistDurMode = 'distance' | 'duration'
type DistDurUnit = 'm' | 'km' | 'sec' | 'min'

interface DistDurState {
  mode: DistDurMode
  value: string
  unit: DistDurUnit
}

function parseLeadingNumber(s?: string): number | null {
  if (!s) return null
  const m = s.match(/\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : null
}

const KM_RE = /ק["״]?מ|km/i // matches ק"מ / ק״מ / קמ / km, but NOT דק' / דקות
const MIN_RE = /דק|min/i
const SEC_RE = /שנ|sec/i

// Derive the picker's initial mode/value/unit from the row's data.
// Prefers the new numeric fields; falls back to best-effort parsing of the
// legacy free-text strings for pre-migration workouts.
function deriveDistDurState(item: DistDurItem): DistDurState {
  if (item.durationSec != null) {
    const sec = item.durationSec
    const fromStr = parseLeadingNumber(item.duration)
    const isMin = item.duration
      ? MIN_RE.test(item.duration) || !SEC_RE.test(item.duration)
      : sec > 0 && sec % 60 === 0
    const value = fromStr != null ? fromStr : isMin ? sec / 60 : sec
    return { mode: 'duration', value: value ? String(value) : '', unit: isMin ? 'min' : 'sec' }
  }
  if (item.distanceMeters != null) {
    const meters = item.distanceMeters
    const isKm = item.distance ? KM_RE.test(item.distance) : false
    const fromStr = parseLeadingNumber(item.distance)
    const value = fromStr != null ? fromStr : isKm ? meters / 1000 : meters
    return { mode: 'distance', value: value ? String(value) : '', unit: isKm ? 'km' : 'm' }
  }
  // Legacy row (no numeric fields yet) — best-effort prefill from free-text.
  if (item.duration && item.duration.trim()) {
    const n = parseLeadingNumber(item.duration)
    const isMin = MIN_RE.test(item.duration) || !SEC_RE.test(item.duration)
    return { mode: 'duration', value: n != null ? String(n) : '', unit: isMin ? 'min' : 'sec' }
  }
  const n = parseLeadingNumber(item.distance)
  const isKm = item.distance ? KM_RE.test(item.distance) : false
  return { mode: 'distance', value: n != null ? String(n) : '', unit: isKm ? 'km' : 'm' }
}

function DistanceDurationPicker({
  item,
  onChange,
}: {
  item: DistDurItem
  onChange: (field: string, value: string | number | undefined) => void
}) {
  const [state, setState] = useState<DistDurState>(() => deriveDistDurState(item))

  const commit = (next: DistDurState) => {
    setState(next)
    const num = parseFloat(next.value)
    const valid = !isNaN(num) && num > 0
    if (next.mode === 'distance') {
      const isKm = next.unit === 'km'
      if (valid) {
        onChange('distanceMeters', isKm ? Math.round(num * 1000) : num)
        onChange('distance', `${next.value} ${isKm ? 'ק"מ' : "מ'"}`)
      } else {
        onChange('distanceMeters', undefined)
        onChange('distance', '')
      }
      onChange('durationSec', undefined)
      onChange('duration', '')
    } else {
      const isMin = next.unit === 'min'
      if (valid) {
        onChange('durationSec', isMin ? Math.round(num * 60) : num)
        onChange('duration', `${next.value} ${isMin ? "דק'" : "שנ'"}`)
      } else {
        onChange('durationSec', undefined)
        onChange('duration', '')
      }
      onChange('distanceMeters', undefined)
      onChange('distance', '')
    }
  }

  const setMode = (mode: DistDurMode) => {
    if (mode === state.mode) return
    commit({ mode, value: state.value, unit: mode === 'distance' ? 'm' : 'min' })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex gap-1">
        {([
          ['distance', 'מרחק'],
          ['duration', 'זמן'],
        ] as const).map(([mode, label]) => (
          <Button
            key={mode}
            type="button"
            variant={state.mode === mode ? 'default' : 'outline'}
            size="sm"
            className={state.mode === mode ? 'bg-navy text-white' : ''}
            onClick={() => setMode(mode)}
          >
            {label}
          </Button>
        ))}
      </div>
      <Input
        type="number"
        min="0"
        step="any"
        className="w-24"
        placeholder={state.mode === 'distance' ? '1000' : '5'}
        value={state.value}
        onChange={(e) => commit({ ...state, value: e.target.value })}
      />
      <Select
        value={state.unit}
        onValueChange={(unit) => commit({ ...state, unit: unit as DistDurUnit })}
      >
        <SelectTrigger className="w-24">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {state.mode === 'distance' ? (
            <>
              <SelectItem value="m">מ'</SelectItem>
              <SelectItem value="km">ק"מ</SelectItem>
            </>
          ) : (
            <>
              <SelectItem value="sec">שניות</SelectItem>
              <SelectItem value="min">דקות</SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
    </div>
  )
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
  const [targetLactate, setTargetLactate] = useState('')
  const [targetThresholdLevel, setTargetThresholdLevel] = useState<'T1' | 'T2' | 'T3' | ''>('')
  const [targetMetrics, setTargetMetrics] = useState<Set<'pace' | 'hr' | 'lactate'>>(new Set(['pace', 'hr', 'lactate']))
  const [thresholdDistance, setThresholdDistance] = useState<number | ''>('')
  const [comparisonGroup, setComparisonGroup] = useState('')
  const [existingGroups, setExistingGroups] = useState<string[]>([])
  const [sets, setSets] = useState<Partial<WorkoutSet>[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [loading, setLoading] = useState(!!workoutId)

  // Existing comparisonGroup names across every workout template, so the
  // coach can reuse "Fartlek A" exactly (autocomplete) instead of retyping
  // it slightly differently each time and accidentally splitting the group.
  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(collection(db, 'workouts'))
        const names = new Set<string>()
        snap.docs.forEach(d => {
          const g = (d.data() as Workout).comparisonGroup
          if (g) names.add(g)
        })
        setExistingGroups(Array.from(names).sort())
      } catch (err) { console.error('Error loading comparison groups:', err) }
    }
    load()
  }, [])

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
          setTargetLactate(data.targetLactate != null ? String(data.targetLactate) : '')
          setTargetThresholdLevel(data.targetThresholdLevel || '')
          setTargetMetrics(new Set(data.targetMetrics && data.targetMetrics.length ? data.targetMetrics : ['pace', 'hr', 'lactate']))
          setThresholdDistance(data.thresholdDistance || '')
          setComparisonGroup(data.comparisonGroup || '')
          setSets(Array.isArray(data.sets) ? data.sets.map((s: any) => ({
            ...s,
            // Migrate the old ambiguous "rest" field: it was only ever shown
            // as the gap before the NEXT set, so that's what it means here.
            restAfterSet: s.restAfterSet || s.rest || '',
            restBetweenReps: s.restBetweenReps || '',
            intervals: s.intervals || [],
          })) : [])
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
        restBetweenReps: '',
        restAfterSet: '',
        intervals: [],
      } as any,
    ])
  }

  const updateSet = (index: number, field: string, value: string | number | undefined) => {
    // Functional update so several updateSet calls in the same event handler
    // (e.g. the distance/duration picker writing 4 fields at once) all land
    // instead of the later calls clobbering the earlier ones.
    setSets(prev => {
      const newSets = [...prev] as any[]
      newSets[index] = { ...newSets[index], [field]: value }
      return newSets
    })
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

  const updateInterval = (setIndex: number, intIndex: number, field: string, value: string | number | undefined) => {
    // Functional update — see updateSet above.
    setSets(prev => {
      const newSets = [...prev] as any[]
      const intervals = [...(newSets[setIndex].intervals || [])]
      intervals[intIndex] = { ...intervals[intIndex], [field]: value }
      newSets[setIndex] = { ...newSets[setIndex], intervals }
      return newSets
    })
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
        targetLactate: targetLactate ? Number(targetLactate) : null,
        targetThresholdLevel: type === 'threshold' && targetThresholdLevel ? targetThresholdLevel : null,
        targetMetrics: type === 'threshold' && targetThresholdLevel ? Array.from(targetMetrics) : null,
        thresholdDistance: type === 'threshold' && thresholdDistance ? Number(thresholdDistance) : null,
        comparisonGroup: comparisonGroup.trim() || null,
        sets: (sets as any[]).map((s, i) => ({
          id: s.id || `set-${i}`,
          reps: s.reps || 1,
          distance: s.distance || '',
          duration: s.duration || '',
          distanceMeters: s.distanceMeters ?? null,
          durationSec: s.durationSec ?? null,
          pace: s.pace || '',
          restBetweenReps: s.restBetweenReps || '',
          restAfterSet: s.restAfterSet || '',
          intervals: (s.intervals || []).map((iv: any, j: number) => ({
            id: iv.id || `int-${i}-${j}`,
            distance: iv.distance || '',
            duration: iv.duration || '',
            distanceMeters: iv.distanceMeters ?? null,
            durationSec: iv.durationSec ?? null,
            pace: iv.pace || '',
            rest: iv.rest || '',
          })),
        })),
        updatedAt: serverTimestamp(),
        updatedBy: user?.id || null,
        // Editing a copied (hidden) workout makes it a real library workout —
        // "minor edits are saved as an additional workout in the library"
        libraryHidden: false,
      }

      let savedId = workoutId
      if (workoutId) {
        await updateDoc(doc(db, 'workouts', workoutId), payload)
        toast.success('Workout updated!')
      } else {
        const ref = await addDoc(collection(db, 'workouts'), {
          ...payload,
          createdAt: serverTimestamp(),
          createdBy: user?.id || null,
        })
        savedId = ref.id
        toast.success('Workout created!')
      }
      // Pass the saved workout back so callers can auto-assign it to a date
      if (onDone) onDone({ id: savedId, ...payload }); else router.push('/coach/workouts')
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

            {type === 'threshold' && (
              <div className="space-y-3 rounded-lg border border-border p-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">מרחק חזרות (לאיסוף T1/T2/T3 יחד עם אימונים אחרים באותו מרחק)</Label>
                  <div className="flex flex-wrap gap-2">
                    {[200, 400, 600, 800, 1000, 1600, 2000, 3000].map((d) => (
                      <Button key={d} type="button"
                        variant={thresholdDistance === d ? 'default' : 'outline'}
                        size="sm"
                        className={thresholdDistance === d ? 'bg-navy text-white' : ''}
                        onClick={() => setThresholdDistance(d)}>
                        {d}מ׳
                      </Button>
                    ))}
                    {thresholdDistance !== '' && (
                      <Button type="button" variant="ghost" size="sm" className="text-muted-foreground"
                        onClick={() => setThresholdDistance('')}>
                        {t.cancel}
                      </Button>
                    )}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">{t.targetLevelLabel}</Label>
                  <div className="flex gap-2">
                    {(['T1', 'T2', 'T3'] as const).map((level) => (
                      <Button key={level} type="button"
                        variant={targetThresholdLevel === level ? 'default' : 'outline'}
                        size="sm"
                        className={targetThresholdLevel === level ? 'bg-navy text-white' : ''}
                        onClick={() => setTargetThresholdLevel(level)}>
                        {level}
                      </Button>
                    ))}
                    {targetThresholdLevel && (
                      <Button type="button" variant="ghost" size="sm" className="text-muted-foreground"
                        onClick={() => setTargetThresholdLevel('')}>
                        {t.cancel}
                      </Button>
                    )}
                  </div>
                </div>
                {targetThresholdLevel && (
                  <div className="space-y-1.5">
                    <Label className="text-xs">{t.targetMetricsLabel}</Label>
                    <div className="flex gap-4">
                      {([
                        ['pace', t.metricPace],
                        ['hr', t.metricHr],
                        ['lactate', t.metricLactate],
                      ] as const).map(([key, label]) => (
                        <label key={key} className="flex items-center gap-1.5 text-sm cursor-pointer">
                          <input type="checkbox" checked={targetMetrics.has(key)}
                            onChange={(e) => setTargetMetrics(prev => {
                              const next = new Set(prev)
                              e.target.checked ? next.add(key) : next.delete(key)
                              return next
                            })} />
                          {label}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="comparisonGroup" className="text-xs">{t.labComparisonGroupLabel}</Label>
              <Input
                id="comparisonGroup"
                dir="auto"
                list="comparison-group-options"
                placeholder={t.labComparisonGroupPh}
                value={comparisonGroup}
                onChange={(e) => setComparisonGroup(e.target.value)}
              />
              <datalist id="comparison-group-options">
                {existingGroups.map(g => <option key={g} value={g} />)}
              </datalist>
              <p className="text-[11px] text-muted-foreground">{t.labComparisonGroupHint}</p>
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
                        {/* Reps + rest-between-reps (only relevant when reps > 1) */}
                        <div className="grid gap-3 grid-cols-2">
                          <div className="space-y-1">
                            <Label className="text-xs">חזרות (כמה פעמים)</Label>
                            <Input
                              type="number" min="1"
                              placeholder="לדוגמה: 3"
                              value={set.reps || ''}
                              onChange={(e) => updateSet(index, 'reps', parseInt(e.target.value) || 1)}
                            />
                          </div>
                          {(set.reps || 1) > 1 && (
                            <div className="space-y-1">
                              <Label className="text-xs">מנוחה בין חזרות</Label>
                              <Input
                                placeholder="לדוגמה: 90 שנ׳"
                                value={set.restBetweenReps || ''}
                                onChange={(e) => updateSet(index, 'restBetweenReps', e.target.value)}
                              />
                            </div>
                          )}
                        </div>

                        {/* Simple mode: single distance-or-duration + pace */}
                        {!hasIntervals && (
                          <div className="space-y-3">
                            <div className="space-y-1">
                              <Label className="text-xs">מרחק / זמן</Label>
                              <DistanceDurationPicker
                                item={set}
                                onChange={(field, value) => updateSet(index, field, value)}
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-xs">קצב / מאמץ</Label>
                              <Input
                                placeholder="לדוגמה: 4:00/ק״מ או Z4"
                                value={set.pace || ''}
                                onChange={(e) => updateSet(index, 'pace', e.target.value)}
                              />
                            </div>
                          </div>
                        )}

                        {/* Rest before moving to the next set — always relevant,
                            distinct from rest-between-reps above (which repeats
                            within this same set). */}
                        <div className="space-y-1">
                          <Label className="text-xs">מנוחה לפני הסט הבא</Label>
                          <Input
                            placeholder="לדוגמה: 5 דק' ריצה קלה"
                            value={set.restAfterSet || ''}
                            onChange={(e) => updateSet(index, 'restAfterSet', e.target.value)}
                          />
                        </div>

                        {/* Complex mode: multiple intervals */}
                        {hasIntervals && (
                          <div className="space-y-2">
                            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Intervals in this set</p>
                            {set.intervals.map((interval: any, intIndex: number) => (
                              <div key={interval.id || intIndex} className="space-y-2 bg-muted/20 rounded-lg p-2">
                                <div className="flex items-end gap-2">
                                  <div className="space-y-1 flex-1">
                                    <Label className="text-xs">מרחק / זמן</Label>
                                    <DistanceDurationPicker
                                      item={interval}
                                      onChange={(field, value) => updateInterval(index, intIndex, field, value)}
                                    />
                                  </div>
                                  <Button type="button" variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removeInterval(index, intIndex)}>
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                                <div className="grid gap-2 grid-cols-2">
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
                                </div>
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
