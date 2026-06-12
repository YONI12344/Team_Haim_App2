/**
 * lib/workout-labels.ts
 *
 * Shared helpers for displaying workout types in the UI.
 * `workoutTypeColors` is a static map of Tailwind classes per workout type.
 * `useWorkoutTypeLabels()` returns a `Record<WorkoutType, string>` whose
 * strings follow the currently selected language (English or Hebrew).
 */

'use client'

import { useLanguage } from '@/contexts/language-context'
import type { WorkoutType } from '@/lib/types'

export const workoutTypeColors: Record<WorkoutType, string> = {
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

/**
 * Returns localized workout-type labels based on the active language.
 */
export function useWorkoutTypeLabels(): Record<WorkoutType, string> {
  const { t } = useLanguage()
  return {
    easy: t.easy,
    long_run: t.longRun,
    tempo: t.tempo,
    intervals: t.intervals,
    hill_repeats: t.hillRepeats,
    fartlek: t.fartlek,
    recovery: t.recovery,
    strength: t.strength,
    cross_training: t.crossTraining,
    rest: t.rest,
    race: t.race,
    time_trial: t.timeTrial,
  }
}
