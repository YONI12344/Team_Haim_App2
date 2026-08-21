/**
 * lib/seed-upper-body-alon.ts
 *
 * One-time importer for a coach-specified upper body strength workout,
 * transcribed exactly from a physio-provided training sheet (Ronny
 * Gorodzinsky, "Upper" session): Pull Ups, Dips/Ring Dips, Push Ups/Ring
 * Push Ups, BB Rows, Press, Hanging Leg Raises/TTB — sets/reps and the
 * "weighted only if bodyweight reps exceed N" notes kept exactly as
 * written on the sheet. Exercise names are kept in English, as printed.
 *
 * Instructions are AI-authored standard technique cues (not transcribed
 * from the sheet, which only had sets/reps/target muscle), same pattern
 * as the other lib/seed-*.ts importers.
 */

import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { saveExercise } from '@/lib/exercise-library'
import type { StrengthBlock, StrengthBlockExercise } from '@/lib/types'

export const UPPER_BODY_ALON_WORKOUT_TITLE = 'Upper Body Alon'

interface SeedExercise {
  key: string
  name: string
  instructions: string
}

const NEW_EXERCISES: SeedExercise[] = [
  {
    key: 'pull-ups',
    name: 'Pull Ups',
    instructions: 'אחיזה עליונה ברוחב הכתפיים, תלייה מלאה בתחילת התנועה. משיכה עד שהסנטר עובר את המוט, ירידה מבוקרת עד יישור מלא של המרפקים. גוף יציב ללא נדנוד.',
  },
  {
    key: 'dips-ring-dips',
    name: 'Dips/ Ring Dips',
    instructions: 'אחיזה על המקבילים/טבעות, גוף זקוף מעט קדימה. ירידה מבוקרת עד זווית 90 מעלות במרפק, דחיפה חזרה ליישור מלא. כתפיים למטה ואחורה לאורך התנועה.',
  },
  {
    key: 'push-ups-ring-push-ups',
    name: 'Push Ups/ Ring Push Ups',
    instructions: 'ידיים ברוחב הכתפיים (או על הטבעות), גוף ישר מהראש עד העקבים. ירידה עד שהחזה כמעט נוגע ברצפה, דחיפה חזרה ליישור מלא של המרפקים.',
  },
  {
    key: 'bb-rows',
    name: 'BB Rows',
    instructions: 'רגליים ברוחב האגן, רכינה קדימה עם גב ישר ואחיזה במוט. משיכה לכיוון הבטן התחתונה תוך כיווץ השכמות, ירידה מבוקרת ליישור מלא.',
  },
  {
    key: 'press',
    name: 'Press',
    instructions: 'עמידה או ישיבה, אחיזה ברוחב הכתפיים. דחיפה מעלה עד יישור מלא של המרפקים מעל הראש, ירידה מבוקרת עד גובה הכתפיים.',
  },
  {
    key: 'hanging-leg-raises-ttb',
    name: 'Hanging Leg Raises/ TTB',
    instructions: 'תלייה מלאה על המוט, ליבה מהודקת. הרמת רגליים ישרות (או כפופות) עד גובה המוט (Toes to Bar) תוך שליטה, ירידה מבוקרת ללא נדנוד.',
  },
]

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

async function createWorkoutIfMissing(
  title: string,
  description: string,
  blocks: StrengthBlock[],
  createdBy: string,
): Promise<{ workoutId: string; created: boolean }> {
  const existing = await getDocs(query(collection(db, 'workouts'), where('title', '==', title)))
  if (!existing.empty) return { workoutId: existing.docs[0].id, created: false }
  const ref = await addDoc(collection(db, 'workouts'), {
    title,
    type: 'strength',
    description,
    strengthBlocks: blocks,
    libraryHidden: false,
    source: 'coach' as const,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { workoutId: ref.id, created: true }
}

function ex(
  id: Map<string, string>,
  key: string,
  targetSets: number,
  targetReps: string,
  notes?: string,
): StrengthBlockExercise {
  const exerciseId = id.get(key)
  if (!exerciseId) throw new Error(`Seed exercise key not found: ${key}`)
  const seed = NEW_EXERCISES.find((e) => e.key === key)
  return {
    id: genId('ex'),
    exerciseId,
    name: seed?.name || key,
    category: 'strength',
    targetSets,
    targetReps,
    ...(notes ? { notes } : {}),
  }
}

export async function seedUpperBodyAlon(createdBy: string): Promise<{
  exerciseCount: number
  workoutsCreated: string[]
  alreadyExisted: boolean
}> {
  const anchor = await getDocs(query(collection(db, 'workouts'), where('title', '==', UPPER_BODY_ALON_WORKOUT_TITLE)))
  if (!anchor.empty) {
    return { exerciseCount: 0, workoutsCreated: [], alreadyExisted: true }
  }

  const idByKey = new Map<string, string>()
  for (const e of NEW_EXERCISES) {
    const id = await saveExercise({
      name: e.name,
      instructions: e.instructions,
      category: 'strength',
      subcategory: 'Upper Body',
      createdBy,
    })
    idByKey.set(e.key, id)
  }

  const blocks: StrengthBlock[] = [
    { id: genId('block'), label: 'סט 1', exercises: [ex(idByKey, 'pull-ups', 5, 'Max*', 'Lats — משקל נוסף רק אם מבצע מעל 20 חזרות משקל גוף')] },
    { id: genId('block'), label: 'סט 2', exercises: [ex(idByKey, 'dips-ring-dips', 4, '12', 'Triceps — משקל נוסף רק אם מבצע מעל 12 חזרות משקל גוף')] },
    { id: genId('block'), label: 'סט 3', exercises: [ex(idByKey, 'push-ups-ring-push-ups', 3, 'Max*', 'Chest/Triceps — משקל נוסף רק אם מבצע מעל 25 חזרות משקל גוף')] },
    { id: genId('block'), label: 'סט 4', exercises: [ex(idByKey, 'bb-rows', 4, '8-10', 'Back')] },
    { id: genId('block'), label: 'סט 5', exercises: [ex(idByKey, 'press', 4, '6-8', 'Shoulders, Triceps')] },
    { id: genId('block'), label: 'סט 6', exercises: [ex(idByKey, 'hanging-leg-raises-ttb', 3, '10-12', 'Core')] },
  ]

  const workout = await createWorkoutIfMissing(
    UPPER_BODY_ALON_WORKOUT_TITLE,
    'Pull Ups, Dips/Ring Dips, Push Ups/Ring Push Ups, BB Rows, Press, Hanging Leg Raises/TTB.',
    blocks,
    createdBy,
  )

  return {
    exerciseCount: NEW_EXERCISES.length,
    workoutsCreated: workout.created ? [UPPER_BODY_ALON_WORKOUT_TITLE] : [],
    alreadyExisted: false,
  }
}
