import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import type { ExerciseLibraryItem, StrengthBlockExercise } from '@/lib/types'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Merges a workout's stored StrengthBlockExercise with the CURRENT
 *  Exercise Library entry it points at (if it still exists), so an edited
 *  video/instructions/name/category shows up everywhere immediately —
 *  "it's the same exercise" — instead of every workout being frozen with
 *  whatever the library looked like when it was added. Only targetSets/
 *  targetReps/targetDurationSec/notes stay as stored, since those really
 *  are workout-specific (how many sets THIS workout wants). Falls back to
 *  the stored snapshot fields if the library entry was since deleted, so a
 *  removed exercise doesn't go blank in workouts already built with it. */
export function resolveExerciseDisplay(
  ex: StrengthBlockExercise,
  libraryById: Map<string, ExerciseLibraryItem>,
): StrengthBlockExercise {
  const live = libraryById.get(ex.exerciseId)
  if (!live) return ex
  return {
    ...ex,
    name: live.name,
    videoUrl: live.videoUrl,
    videoMuted: live.videoMuted,
    instructions: live.instructions,
    category: live.category ?? ex.category,
  }
}

/** Splits an exercise's free-text instructions into separate cue lines for
 *  bulleted display, instead of one dense paragraph. Prefers real newlines
 *  (coach entered one cue per line); falls back to splitting on Hebrew/
 *  English sentence-ending periods for older text saved as one paragraph
 *  (e.g. imported cues like "גב ישר. ברך לא נעולה."). */
export function instructionLines(text?: string | null): string[] {
  if (!text) return []
  const byNewline = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (byNewline.length > 1) return byNewline
  return text
    .split(/(?<=[.!?])\s+/)
    .map((l) => l.trim())
    .filter(Boolean)
}
