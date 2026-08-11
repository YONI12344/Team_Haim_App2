'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Loader2 } from 'lucide-react'
import { instructionLines } from '@/lib/utils'
import type { Workout } from '@/lib/types'

/**
 * Read-only viewer for a linked warm-up/pre-workout routine
 * (Workout.warmupWorkoutId) — shown inline on a workout's detail card in
 * components/athlete/athlete-planner-view.tsx. Purely informational: no
 * set checkboxes, no weight/timer logging, no "finish" button. An athlete
 * who already knows the warm-up can skip opening this; it's just here for
 * whoever wants a reminder of what's in it, and it has no effect on
 * completing the actual (running/lift) workout it's attached to.
 */
export function WarmupViewer({ workoutId }: { workoutId: string }) {
  const [workout, setWorkout] = useState<Workout | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getDoc(doc(db, 'workouts', workoutId))
      .then((snap) => {
        if (cancelled) return
        if (!snap.exists()) { setError(true); return }
        setWorkout({ ...(snap.data() as Workout), id: snap.id })
      })
      .catch((err) => {
        console.error('Error loading warm-up:', err)
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
    return <p className="text-sm text-muted-foreground text-center py-6">שגרת החימום לא נמצאה</p>
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
              return (
                <div key={ex.id} className="rounded-md border border-border/60 overflow-hidden">
                  {ex.videoUrl && (
                    <details>
                      <summary className="text-xs text-muted-foreground p-2 cursor-pointer">הצג סרטון הדגמה</summary>
                      <video src={ex.videoUrl} muted={ex.videoMuted} className="w-full aspect-video bg-black" controls playsInline preload="metadata" />
                    </details>
                  )}
                  <div className="p-2.5 space-y-1">
                    <p className="text-sm font-semibold">{ex.name}</p>
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
    </div>
  )
}
