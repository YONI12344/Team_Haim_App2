'use client'

import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ChevronLeft, ChevronRight, Check, X, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import type { AssignedWorkout, StrengthBlockExercise } from '@/lib/types'

type SetProgress = { completed: boolean; weightKg?: number | null }
type Progress = Record<string, SetProgress[]>

function emptyProgressFor(exercise: StrengthBlockExercise): SetProgress[] {
  return Array.from({ length: Math.max(1, exercise.targetSets) }, () => ({ completed: false, weightKg: null }))
}

export function LiftMode({ assignedWorkoutId }: { assignedWorkoutId: string }) {
  const router = useRouter()
  const [assigned, setAssigned] = useState<AssignedWorkout | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress>({})
  const [blockIndex, setBlockIndex] = useState(0)
  const [finishing, setFinishing] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'assignedWorkouts', assignedWorkoutId))
        if (!snap.exists()) { setError('האימון לא נמצא'); return }
        const data = { id: snap.id, ...snap.data() } as AssignedWorkout
        if (data.workout?.type !== 'strength' || !data.workout.strengthBlocks?.length) {
          setError('לאימון הזה אין תרגילים מובנים למצב אימון')
          return
        }
        setAssigned(data)
        const initial: Progress = {}
        for (const block of data.workout.strengthBlocks) {
          for (const ex of block.exercises) {
            initial[ex.id] = data.strengthProgress?.[ex.id] || emptyProgressFor(ex)
          }
        }
        setProgress(initial)
      } catch (err) {
        console.error('Error loading lift workout:', err)
        setError('טעינת האימון נכשלה')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [assignedWorkoutId])

  const blocks = assigned?.workout.strengthBlocks || []
  const block = blocks[blockIndex]
  const isLastBlock = blockIndex === blocks.length - 1
  const totalSets = useMemo(() => Object.values(progress).reduce((s, sets) => s + sets.length, 0), [progress])
  const doneSets = useMemo(() => Object.values(progress).reduce((s, sets) => s + sets.filter((x) => x.completed).length, 0), [progress])

  const persistProgress = async (next: Progress) => {
    try {
      await updateDoc(doc(db, 'assignedWorkouts', assignedWorkoutId), { strengthProgress: next, updatedAt: serverTimestamp() })
    } catch (err) {
      console.error('Error saving lift progress:', err)
    }
  }

  const toggleSet = (exerciseId: string, setIdx: number) => {
    setProgress((prev) => {
      const next = { ...prev, [exerciseId]: prev[exerciseId].map((s, i) => (i === setIdx ? { ...s, completed: !s.completed } : s)) }
      persistProgress(next)
      return next
    })
  }

  const setWeight = (exerciseId: string, setIdx: number, weight: string) => {
    setProgress((prev) => {
      const next = { ...prev, [exerciseId]: prev[exerciseId].map((s, i) => (i === setIdx ? { ...s, weightKg: weight === '' ? null : Number(weight) } : s)) }
      persistProgress(next)
      return next
    })
  }

  const finishWorkout = async () => {
    setFinishing(true)
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'assignedWorkouts', assignedWorkoutId), {
        strengthProgress: progress,
        status: 'completed',
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      // Durable per-exercise history for the progress chart — separate from
      // strengthProgress above, which gets overwritten if this workout is
      // ever reopened. See ExerciseLogEntry in lib/types.ts.
      for (const block of blocks) {
        for (const ex of block.exercises) {
          const sets = progress[ex.id] || []
          if (!sets.length) continue
          const weights = sets.map((s) => s.weightKg).filter((w): w is number => typeof w === 'number')
          const logId = `${assignedWorkoutId}_${ex.exerciseId}`
          batch.set(doc(db, 'exerciseLogs', logId), {
            id: logId,
            athleteId: assigned?.athleteId,
            exerciseId: ex.exerciseId,
            exerciseName: ex.name,
            assignedWorkoutId,
            workoutDate: assigned?.scheduledDate,
            sets: sets.map((s) => ({ weightKg: s.weightKg ?? null, completed: s.completed })),
            maxWeightKg: weights.length ? Math.max(...weights) : null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true })
        }
      }
      await batch.commit()
      toast.success('כל הכבוד! האימון הושלם 💪')
      router.push('/athlete/schedule')
    } catch (err) {
      console.error('Error finishing lift workout:', err)
      toast.error('שמירת סיום האימון נכשלה')
    } finally {
      setFinishing(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )

  if (error || !assigned || !block) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-center px-4">
      <p className="text-muted-foreground">{error}</p>
      <Button variant="outline" onClick={() => router.back()}>חזרה</Button>
    </div>
  )

  return (
    <div dir="rtl" className="max-w-lg mx-auto px-4 py-4 space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.back()}><X className="h-4 w-4 mr-1" />יציאה</Button>
        <p className="text-xs text-muted-foreground">{doneSets}/{totalSets} סטים הושלמו</p>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/athlete/progress"><TrendingUp className="h-4 w-4 mr-1" />התקדמות</Link>
        </Button>
      </div>

      <div>
        <p className="text-xs text-muted-foreground">{assigned.workout.title}</p>
        <h1 className="text-lg font-semibold">{block.label}</h1>
        <p className="text-xs text-muted-foreground">בלוק {blockIndex + 1} מתוך {blocks.length}</p>
      </div>

      <div className="space-y-4">
        {block.exercises.map((ex) => (
          <div key={ex.id} className="rounded-xl border border-border overflow-hidden">
            {ex.videoUrl ? (
              <video src={ex.videoUrl} className="w-full aspect-video bg-black" controls playsInline preload="metadata" />
            ) : (
              <div className="w-full aspect-video bg-muted flex items-center justify-center text-muted-foreground text-sm">אין סרטון הדגמה</div>
            )}
            <div className="p-3 space-y-2">
              <h2 className="font-semibold">{ex.name}</h2>
              {ex.instructions && <p className="text-xs text-muted-foreground">{ex.instructions}</p>}
              {ex.notes && <p className="text-xs text-primary">{ex.notes}</p>}
              <p className="text-xs text-muted-foreground">יעד: {ex.targetSets} סטים × {ex.targetReps} חזרות</p>
              <div className="space-y-1.5 pt-1">
                {(progress[ex.id] || []).map((set, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => toggleSet(ex.id, i)}
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-sm font-medium transition-colors ${
                        set.completed ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-input text-muted-foreground'
                      }`}
                    >
                      {set.completed ? <Check className="h-4 w-4" /> : i + 1}
                    </button>
                    <span className="text-xs text-muted-foreground w-10">סט {i + 1}</span>
                    <Input
                      type="number"
                      inputMode="decimal"
                      placeholder='משקל ק"ג'
                      value={set.weightKg ?? ''}
                      onChange={(e) => setWeight(ex.id, i, e.target.value)}
                      className="h-8 text-sm max-w-[110px]"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 pt-2">
        <Button variant="outline" disabled={blockIndex === 0} onClick={() => setBlockIndex((i) => Math.max(0, i - 1))} className="flex-1">
          <ChevronRight className="h-4 w-4 mr-1" />הקודם
        </Button>
        {isLastBlock ? (
          <Button onClick={finishWorkout} disabled={finishing} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
            {finishing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            סיים אימון
          </Button>
        ) : (
          <Button onClick={() => setBlockIndex((i) => Math.min(blocks.length - 1, i + 1))} className="flex-1">
            הבא<ChevronLeft className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>
    </div>
  )
}
