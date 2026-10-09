/**
 * lib/seed-rehab-shared.ts
 *
 * What the rehab program importers (seed-calf-rehab-program.ts,
 * seed-shin-rehab-program.ts) share: one exercise definition shape, and a
 * find-or-create so an exercise both programs use (heel walks, single-leg
 * balance...) lives in the Exercise Library once, whichever program the
 * coach imports first.
 */

import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { saveExercise } from '@/lib/exercise-library'
import type { StrengthBlock, StrengthBlockExercise } from '@/lib/types'

export interface SeedRehabExercise {
  name: string
  instructions: string
  imageUrl: string
  sets: number
  reps: string
  durationSec?: number
}

export function genSeedId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/** The library id of a rehab exercise with this exact name, creating it if there isn't one. */
export async function findOrCreateRehabExercise(ex: SeedRehabExercise, subcategory: string, createdBy: string): Promise<string> {
  const same = await getDocs(query(collection(db, 'exerciseLibrary'), where('name', '==', ex.name)))
  const existing = same.docs.find((d) => d.data().category === 'rehab')
  if (existing) return existing.id
  return saveExercise({
    name: ex.name,
    instructions: ex.instructions,
    imageUrl: ex.imageUrl,
    category: 'rehab',
    subcategory,
    isTimed: ex.durationSec != null,
    defaultDurationSec: ex.durationSec,
    defaultSets: ex.sets,
    defaultReps: ex.reps || undefined,
    createdBy,
  })
}

/** One block per exercise, in order: "תרגיל 1", "תרגיל 2"... */
export async function buildRehabBlocks(exercises: SeedRehabExercise[], subcategory: string, createdBy: string): Promise<StrengthBlock[]> {
  const blocks: StrengthBlock[] = []
  for (const [i, ex] of exercises.entries()) {
    const id = await findOrCreateRehabExercise(ex, subcategory, createdBy)
    const blockExercise: StrengthBlockExercise = {
      id: genSeedId('ex'),
      exerciseId: id,
      name: ex.name,
      instructions: ex.instructions,
      imageUrl: ex.imageUrl,
      category: 'rehab',
      targetSets: ex.sets,
      targetReps: ex.reps,
      ...(ex.durationSec != null ? { targetDurationSec: ex.durationSec } : {}),
    }
    blocks.push({ id: genSeedId('block'), label: `תרגיל ${i + 1}`, exercises: [blockExercise] })
  }
  return blocks
}
