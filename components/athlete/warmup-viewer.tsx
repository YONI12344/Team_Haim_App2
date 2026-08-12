'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Loader2, Check, Pencil } from 'lucide-react'
import { instructionLines } from '@/lib/utils'
import { useAuth } from '@/contexts/auth-context'
import { isCoachEmail } from '@/lib/constants'
import { ExerciseEditDialog } from '@/components/coach/exercise-edit-dialog'
import type { Workout } from '@/lib/types'

/**
 * Popup content for a linked warm-up/cooldown routine (Workout.
 * warmupWorkoutId / cooldownWorkoutId) — opened from a button next to the
 * workout's warmup/cooldown text in components/athlete/athlete-planner-
 * view.tsx. Shows each exercise with video + instructions, and a "done"
 * toggle per exercise so an athlete can follow along and check things off
 * — but this is local component state only, not saved anywhere. It resets
 * every time the popup reopens and has no effect on completing the actual
 * workout; it's just a following-along aid for someone who forgot the
 * routine, not something an athlete who already knows it needs to touch.
 */
export function WarmupViewer({ workoutId }: { workoutId: string }) {
  const { user } = useAuth()
  const isCoachViewer = isCoachEmail(user?.email)
  const [workout, setWorkout] = useState<Workout | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [done, setDone] = useState<Record<string, boolean>>({})
  // Coach can fix a video/instructions right from this popup — updates the
  // shared Exercise Library only, doesn't rewrite this workout's own saved
  // strengthBlocks copy (see components/coach/exercise-edit-dialog.tsx).
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    setDone({})
    getDoc(doc(db, 'workouts', workoutId))
      .then((snap) => {
        if (cancelled) return
        if (!snap.exists()) { setError(true); return }
        setWorkout({ ...(snap.data() as Workout), id: snap.id })
      })
      .catch((err) => {
        console.error('Error loading routine:', err)
        if (!cancelled) setError(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [workoutId])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error || !workout || !workout.strengthBlocks?.length) {
    return <p className="text-sm text-muted-foreground text-center py-6">השגרה לא נמצאה</p>
  }

  return (
    <div className="space-y-3">
      {workout.description && <p className="text-xs text-muted-foreground">{workout.description}</p>}
      {workout.strengthBlocks.map((block) => (
        <div key={block.id} className="rounded-lg border border-border overflow-hidden">
          <div className="bg-muted/40 px-3 py-1.5">
            <p className="text-xs font-bold">{block.label}</p>
          </div>
          <div className="p-2.5 space-y-2.5">
            {block.exercises.map((ex) => {
              const lines = instructionLines(ex.instructions)
              const target = ex.targetDurationSec != null
                ? `${ex.targetSets} סטים × ${ex.targetDurationSec} שניות`
                : `${ex.targetSets} סטים × ${ex.targetReps}`
              const isDone = !!done[ex.id]
              return (
                <div key={ex.id} className={`rounded-md border overflow-hidden ${isDone ? 'border-emerald-300' : 'border-border/60'}`}>
                  {ex.videoUrl ? (
                    <video src={ex.videoUrl} muted={ex.videoMuted} className="w-full aspect-video bg-black" controls playsInline preload="metadata" />
                  ) : (
                    <div className="w-full aspect-video bg-muted flex items-center justify-center text-muted-foreground text-xs">אין סרטון הדגמה</div>
                  )}
                  <div className="p-2.5 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <p className="text-sm font-semibold truncate">{ex.name}</p>
                        {isCoachViewer && (
                          <button type="button" onClick={() => setEditingExerciseId(ex.exerciseId)} className="text-muted-foreground hover:text-foreground shrink-0" title="ערוך בספריית התרגילים">
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => setDone((prev) => ({ ...prev, [ex.id]: !prev[ex.id] }))}
                        className={`flex h-7 shrink-0 items-center gap-1 rounded-md border px-2 text-[11px] font-semibold transition-colors ${
                          isDone ? 'bg-emerald-600 border-emerald-600 text-white' : 'border-input text-muted-foreground'
                        }`}
                      >
                        {isDone ? <Check className="h-3.5 w-3.5" /> : <span className="h-3.5 w-3.5 rounded-full border-2 border-current" />}
                        בוצע
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">{target}</p>
                    {!!lines.length && (
                      <ul className="text-xs text-muted-foreground space-y-0.5">
                        {lines.map((line, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <span className="text-[#c9a84c] shrink-0">•</span>
                            <span>{line}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
      {isCoachViewer && (
        <ExerciseEditDialog
          exerciseId={editingExerciseId}
          open={!!editingExerciseId}
          onOpenChange={(open) => { if (!open) setEditingExerciseId(null) }}
        />
      )}
    </div>
  )
}
