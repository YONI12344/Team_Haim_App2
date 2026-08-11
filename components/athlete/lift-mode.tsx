'use client'

import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ChevronLeft, ChevronRight, Check, X, TrendingUp, Play, Square } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { isCoachEmail } from '@/lib/constants'
import { instructionLines } from '@/lib/utils'
import type { AssignedWorkout, StrengthBlockExercise } from '@/lib/types'

type SetProgress = { completed: boolean; weightKg?: number | null; durationSec?: number | null }
type Progress = Record<string, SetProgress[]>

const LIFT_MODE_TYPES = ['strength', 'stretch'] as const

function emptyProgressFor(exercise: StrengthBlockExercise): SetProgress[] {
  return Array.from({ length: Math.max(1, exercise.targetSets) }, () => ({ completed: false, weightKg: null, durationSec: null }))
}

// Self-contained start/stop countdown for a timed set (a stretch hold, a
// plank) — used instead of the weight input when the exercise has a
// targetDurationSec. Keeps its own running/remaining state locally since
// only the current block's exercises are ever mounted at once.
function SetTimer({ targetSec, savedSec, completed, onDone }: {
  targetSec: number
  savedSec?: number | null
  completed: boolean
  onDone: (sec: number) => void
}) {
  const [running, setRunning] = useState(false)
  const [remaining, setRemaining] = useState(targetSec)

  useEffect(() => {
    if (!running) return
    if (remaining <= 0) {
      setRunning(false)
      onDone(targetSec)
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(250)
      return
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, remaining])

  const start = () => { setRemaining(targetSec); setRunning(true) }
  const stop = () => { setRunning(false); onDone(targetSec - remaining) }

  if (running) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-base font-semibold text-[#0a1628] w-10 text-center">{remaining}</span>
        <Button type="button" size="sm" variant="outline" onClick={stop} className="h-9 text-xs">
          <Square className="h-3.5 w-3.5 mr-1" />עצור
        </Button>
      </div>
    )
  }

  return (
    <Button type="button" size="sm" variant={completed ? 'outline' : 'default'} onClick={start} className="h-9 text-xs">
      <Play className="h-3.5 w-3.5 mr-1" />
      {completed ? `שוב · בוצע ${savedSec ?? targetSec} שניות` : `התחל · ${targetSec} שניות`}
    </Button>
  )
}

// One set's control row — a checkbox+weight for reps-based exercises, or a
// SetTimer for timed ones. Shared between the single-exercise block layout
// and the superset round layout below, since both just need "control for
// exercise X's set N."
function SetControl({ ex, setIdx, set, onToggle, onWeight, onDuration }: {
  ex: StrengthBlockExercise
  setIdx: number
  set: SetProgress
  onToggle: () => void
  onWeight: (weight: string) => void
  onDuration: (sec: number) => void
}) {
  if (ex.targetDurationSec != null) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-10 shrink-0">סט {setIdx + 1}</span>
        <SetTimer targetSec={ex.targetDurationSec} savedSec={set.durationSec} completed={set.completed} onDone={onDuration} />
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={set.completed}
        className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
          set.completed
            ? 'bg-emerald-600 border-emerald-600 text-white'
            : 'border-input text-muted-foreground bg-muted/40'
        }`}
      >
        {set.completed ? <Check className="h-4 w-4" /> : <span className="h-4 w-4 rounded-full border-2 border-current" />}
        סט {setIdx + 1}
        {set.completed && ' · בוצע'}
      </button>
      <Input
        type="number"
        inputMode="decimal"
        placeholder='משקל ק"ג'
        value={set.weightKg ?? ''}
        onChange={(e) => onWeight(e.target.value)}
        className="h-9 text-sm max-w-[110px]"
      />
    </div>
  )
}

// Renders an exercise's instructions as bullet points instead of one dense
// paragraph — splits on real newlines if the coach entered one cue per
// line, else falls back to sentence-splitting (see lib/utils.ts).
function InstructionList({ text, className }: { text?: string | null; className?: string }) {
  const lines = instructionLines(text)
  if (!lines.length) return null
  return (
    <ul className={className}>
      {lines.map((line, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className="text-[#c9a84c] shrink-0">•</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

export function LiftMode({ assignedWorkoutId }: { assignedWorkoutId: string }) {
  const router = useRouter()
  const { user } = useAuth()
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
        if (!LIFT_MODE_TYPES.includes(data.workout?.type as typeof LIFT_MODE_TYPES[number]) || !data.workout.strengthBlocks?.length) {
          setError('לאימון הזה אין תרגילים מובנים למצב אימון')
          return
        }
        // Feature still in testing — coach turns it on per athlete
        // (users.strengthToolsVisibleToAthlete). Checked here directly, not
        // just used to hide the entry button, so a direct URL visit before
        // the coach enables it stays blocked too. The coach account itself
        // always passes, so testing/building this doesn't get locked out.
        if (!isCoachEmail(user?.email)) {
          const athleteSnap = await getDoc(doc(db, 'users', data.athleteId))
          if (!athleteSnap.exists() || athleteSnap.data().strengthToolsVisibleToAthlete !== true) {
            setError('התכונה הזו עדיין לא זמינה עבורך — דבר עם המאמן שלך')
            return
          }
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
  const isSuperset = (block?.exercises.length || 0) > 1
  const maxSetsInBlock = block ? Math.max(1, ...block.exercises.map((ex) => ex.targetSets)) : 1
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

  const setDuration = (exerciseId: string, setIdx: number, durationSec: number) => {
    setProgress((prev) => {
      const next = { ...prev, [exerciseId]: prev[exerciseId].map((s, i) => (i === setIdx ? { ...s, durationSec, completed: true } : s)) }
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
          const durations = sets.map((s) => s.durationSec).filter((d): d is number => typeof d === 'number')
          const logId = `${assignedWorkoutId}_${ex.exerciseId}`
          batch.set(doc(db, 'exerciseLogs', logId), {
            id: logId,
            athleteId: assigned?.athleteId,
            exerciseId: ex.exerciseId,
            exerciseName: ex.name,
            assignedWorkoutId,
            workoutDate: assigned?.scheduledDate,
            sets: sets.map((s) => ({ weightKg: s.weightKg ?? null, durationSec: s.durationSec ?? null, completed: s.completed })),
            maxWeightKg: weights.length ? Math.max(...weights) : null,
            maxDurationSec: durations.length ? Math.max(...durations) : null,
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
        <p className="text-xs text-muted-foreground">
          {assigned.workout.type === 'stretch' ? '🧘' : '💪'} {assigned.workout.title}
        </p>
        <h1 className="text-lg font-semibold">{block.label}</h1>
        <p className="text-xs text-muted-foreground">בלוק {blockIndex + 1} מתוך {blocks.length}</p>
      </div>

      {isSuperset ? (
        // Superset block: grouped by ROUND, not by exercise — each round is
        // exercise A's set N, then B's, then C's, back to back with no rest,
        // then rest before the next round. This is the order it's actually
        // meant to be performed in; listing "all of A's sets, then all of
        // B's" (the old layout) didn't communicate that at all.
        <div className="space-y-4">
          {Array.from({ length: maxSetsInBlock }).map((_, roundIdx) => (
            <div key={roundIdx} className="rounded-xl border-2 border-[#0a1628]/15 overflow-hidden">
              <div className="bg-[#0a1628]/5 px-3 py-2">
                <p className="text-sm font-bold text-[#0a1628]">סבב {roundIdx + 1} מתוך {maxSetsInBlock}</p>
              </div>
              <div className="p-3 space-y-3">
                {block.exercises.map((ex, exIdx) => {
                  const set = progress[ex.id]?.[roundIdx]
                  if (!set) return null
                  return (
                    <div key={ex.id}>
                      <div className="rounded-lg border border-border overflow-hidden">
                        {roundIdx === 0 ? (
                          ex.videoUrl ? (
                            <video src={ex.videoUrl} muted={ex.videoMuted} className="w-full aspect-video bg-black" controls playsInline preload="metadata" />
                          ) : (
                            <div className="w-full aspect-video bg-muted flex items-center justify-center text-muted-foreground text-sm">אין סרטון הדגמה</div>
                          )
                        ) : ex.videoUrl && (
                          <details>
                            <summary className="text-xs text-muted-foreground p-2 cursor-pointer">הצג סרטון הדגמה</summary>
                            <video src={ex.videoUrl} muted={ex.videoMuted} className="w-full aspect-video bg-black" controls playsInline preload="metadata" />
                          </details>
                        )}
                        <div className="p-2.5 space-y-1.5">
                          <p className="text-sm font-semibold">{ex.name}</p>
                          {roundIdx === 0 && <InstructionList text={ex.instructions} className="text-xs text-muted-foreground space-y-0.5" />}
                          {ex.notes && <p className="text-xs text-primary">{ex.notes}</p>}
                          <SetControl
                            ex={ex}
                            setIdx={roundIdx}
                            set={set}
                            onToggle={() => toggleSet(ex.id, roundIdx)}
                            onWeight={(w) => setWeight(ex.id, roundIdx, w)}
                            onDuration={(sec) => setDuration(ex.id, roundIdx, sec)}
                          />
                        </div>
                      </div>
                      {exIdx < block.exercises.length - 1 && (
                        <p className="text-[11px] text-center text-muted-foreground py-1.5">↓ ישר לתרגיל הבא, ללא מנוחה</p>
                      )}
                    </div>
                  )
                })}
              </div>
              {roundIdx < maxSetsInBlock - 1 && (
                <div className="bg-amber-50 px-3 py-2 text-center border-t border-amber-100">
                  <p className="text-xs font-semibold text-amber-700">מנוחה, ואז הסבב הבא</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {block.exercises.map((ex) => (
            <div key={ex.id} className="rounded-xl border border-border overflow-hidden">
              {ex.videoUrl ? (
                <video src={ex.videoUrl} muted={ex.videoMuted} className="w-full aspect-video bg-black" controls playsInline preload="metadata" />
              ) : (
                <div className="w-full aspect-video bg-muted flex items-center justify-center text-muted-foreground text-sm">אין סרטון הדגמה</div>
              )}
              <div className="p-3 space-y-2">
                <h2 className="font-semibold">{ex.name}</h2>
                <InstructionList text={ex.instructions} className="text-xs text-muted-foreground space-y-0.5" />
                {ex.notes && <p className="text-xs text-primary">{ex.notes}</p>}
                <p className="text-xs text-muted-foreground">
                  {ex.targetDurationSec != null
                    ? `יעד: ${ex.targetSets} סטים × ${ex.targetDurationSec} שניות`
                    : `יעד: ${ex.targetSets} סטים × ${ex.targetReps} חזרות`}
                </p>
                <div className="space-y-1.5 pt-1">
                  {(progress[ex.id] || []).map((set, i) => (
                    <SetControl
                      key={i}
                      ex={ex}
                      setIdx={i}
                      set={set}
                      onToggle={() => toggleSet(ex.id, i)}
                      onWeight={(w) => setWeight(ex.id, i, w)}
                      onDuration={(sec) => setDuration(ex.id, i, sec)}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground pt-0.5">
                  {ex.targetDurationSec != null ? 'לחצו התחל להפעלת הטיימר לכל סט' : 'לחצו על "סט X" לסימון שהסט בוצע'}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

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
