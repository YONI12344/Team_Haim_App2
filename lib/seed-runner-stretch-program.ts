/**
 * lib/seed-runner-stretch-program.ts
 *
 * One-time importer for a standard post-run static stretching routine —
 * unlike the strength program (transcribed from the coach's own
 * worksheet), this one is AI-assembled from well-established sports
 * science practice: static holds for the major muscle groups loaded by
 * running (calves, hamstrings, quads, hip flexors, glutes, IT band, lower
 * back, groin). Meant as a reviewable starting point, not a diagnosis —
 * the coach should look it over (and ideally film real demo videos) before
 * relying on it with athletes.
 *
 * Same mechanism as lib/seed-running-strength-program.ts: creates each
 * stretch in the shared Exercise Library (category 'stretch', isTimed) and
 * one structured stretch Workout built from them, via the normal
 * saveExercise/workouts writes so it runs as the signed-in coach under
 * existing rules.
 */

import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { saveExercise } from '@/lib/exercise-library'
import type { StrengthBlock, StrengthBlockExercise } from '@/lib/types'

export const RUNNER_STRETCH_WORKOUT_TITLE = 'מתיחות סטטיות לרצים'

interface SeedStretch {
  key: string
  name: string
  instructions: string
  defaultDurationSec: number
  defaultSets: number
}

interface SeedBlock {
  label: string
  exercises: { key: string }[]
}

const SEED_STRETCHES: SeedStretch[] = [
  {
    key: 'calf-wall',
    name: 'מתיחת תאומים בקיר (Wall Calf Stretch)',
    instructions: 'עמידה מול קיר, ידיים נשענות עליו. רגל אחורית ישרה עם העקב על הרצפה, רגל קדמית כפופה. הטיית האגן קדימה לכיוון הקיר עד תחושת מתיחה בשוק האחורית. כפות הרגליים פונות קדימה. מבוצע פעם אחת לכל רגל (2 סטים = ימין ואז שמאל).',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'soleus-wall',
    name: 'מתיחת סוליאוס (Bent-Knee Calf Stretch)',
    instructions: 'אותה עמידה כמו מתיחת תאומים, אך הברך האחורית כפופה מעט והעקב נשאר על הרצפה. המתיחה מורגשת נמוך יותר בשוק. מבוצע פעם אחת לכל רגל (2 סטים = ימין ואז שמאל).',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'hamstring-standing',
    name: 'מתיחת המסטרינג בעמידה',
    instructions: 'רגל אחת מושטת קדימה עם העקב על הרצפה והבהונות למעלה, כפיפה קלה בברך האחורית, הטיה קדימה מהאגן תוך שמירה על גב ישר עד תחושת מתיחה בירך האחורית של הרגל המושטת. מבוצע פעם אחת לכל רגל (2 סטים = ימין ואז שמאל).',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'quad-standing',
    name: 'מתיחת ארבע ראשי בעמידה',
    instructions: 'עמידה על רגל אחת (ניתן להיעזר בקיר לשיווי משקל), אחיזת הקרסול האחורי ומשיכתו לכיוון הישבן, ברכיים קרובות זו לזו, אגן קלות קדימה. מבוצע פעם אחת לכל רגל (2 סטים = ימין ואז שמאל).',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'hip-flexor-kneeling',
    name: 'מתיחת מכופפי ירך בכריעה',
    instructions: 'כריעה על ברך אחת במנח לאנג\', גב זקוף, דחיפה עדינה של האגן קדימה עד תחושת מתיחה בחזית הירך של הרגל הכורעת. מבוצע פעם אחת לכל צד (2 סטים = ימין ואז שמאל).',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'glute-figure4',
    name: 'מתיחת ישבן / פיריפורמיס (Figure-4)',
    instructions: 'שכיבה על הגב, הצלבת קרסול אחד מעל הברך הנגדית, משיכת הירך של הרגל הלא-מוצלבת לכיוון החזה עד תחושת מתיחה בישבן של הרגל המוצלבת. מבוצע פעם אחת לכל צד (2 סטים = ימין ואז שמאל).',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'itband-standing',
    name: 'מתיחת IT Band בעמידה',
    instructions: 'הצלבת רגל אחת מאחורי השנייה, הטיית הגו הצידה (רחוק מהרגל האחורית) עם יד מושטת מעל הראש, עד תחושת מתיחה לאורך הירך החיצונית. מבוצע פעם אחת לכל צד (2 סטים = ימין ואז שמאל).',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'lower-back-knee-to-chest',
    name: 'מתיחת גב תחתון (ברך לחזה)',
    instructions: 'שכיבה על הגב, משיכת שתי הברכיים לכיוון החזה עד תחושת מתיחה עדינה בגב התחתון.',
    defaultDurationSec: 30,
    defaultSets: 1,
  },
  {
    key: 'groin-butterfly',
    name: 'מתיחת מפשעה (פרפר)',
    instructions: 'ישיבה עם כפות הרגליים מחוברות זו לזו, הברכיים פתוחות הצידה, לחיצה עדינה על הברכיים כלפי מטה עם המרפקים תוך שמירה על גב ישר.',
    defaultDurationSec: 30,
    defaultSets: 1,
  },
  {
    key: 'chest-shoulders',
    name: 'מתיחת חזה וכתפיים',
    instructions: 'שילוב הידיים מאחורי הגב, יישור המרפקים והרמת החזה קלות כלפי מעלה עד תחושת מתיחה בחזה ובחזית הכתפיים.',
    defaultDurationSec: 30,
    defaultSets: 1,
  },
]

const SEED_BLOCKS: SeedBlock[] = [
  {
    label: 'פלג גוף תחתון',
    exercises: [
      { key: 'calf-wall' },
      { key: 'soleus-wall' },
      { key: 'hamstring-standing' },
      { key: 'quad-standing' },
      { key: 'hip-flexor-kneeling' },
      { key: 'glute-figure4' },
      { key: 'itband-standing' },
    ],
  },
  {
    label: 'גב, בטן ופלג גוף עליון',
    exercises: [
      { key: 'lower-back-knee-to-chest' },
      { key: 'groin-butterfly' },
      { key: 'chest-shoulders' },
    ],
  },
]

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export async function seedRunnerStretchProgram(createdBy: string): Promise<{ workoutId: string; exerciseCount: number; alreadyExisted: boolean }> {
  const existing = await getDocs(query(collection(db, 'workouts'), where('title', '==', RUNNER_STRETCH_WORKOUT_TITLE)))
  if (!existing.empty) {
    return { workoutId: existing.docs[0].id, exerciseCount: 0, alreadyExisted: true }
  }

  const idByKey = new Map<string, { id: string; ex: SeedStretch }>()
  for (const ex of SEED_STRETCHES) {
    const id = await saveExercise({
      name: ex.name,
      instructions: ex.instructions,
      category: 'stretch',
      isTimed: true,
      defaultDurationSec: ex.defaultDurationSec,
      defaultSets: ex.defaultSets,
      createdBy,
    })
    idByKey.set(ex.key, { id, ex })
  }

  const blocks: StrengthBlock[] = SEED_BLOCKS.map((block) => ({
    id: genId('block'),
    label: block.label,
    exercises: block.exercises.map((be): StrengthBlockExercise => {
      const saved = idByKey.get(be.key)
      if (!saved) throw new Error(`Seed stretch key not found: ${be.key}`)
      const { id, ex } = saved
      return {
        id: genId('ex'),
        exerciseId: id,
        name: ex.name,
        instructions: ex.instructions,
        category: 'stretch',
        targetSets: ex.defaultSets,
        targetReps: '',
        targetDurationSec: ex.defaultDurationSec,
      }
    }),
  }))

  const workoutRef = await addDoc(collection(db, 'workouts'), {
    title: RUNNER_STRETCH_WORKOUT_TITLE,
    type: 'stretch',
    description: 'שגרת מתיחות סטטיות לאחר ריצה — כיסוי שרירי הרגליים, הגב והליבה שנטענים בריצה. שגרה כללית, מומלץ לעבור עליה ולהתאים לפי הצורך.',
    strengthBlocks: blocks,
    libraryHidden: false,
    source: 'coach' as const,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return { workoutId: workoutRef.id, exerciseCount: SEED_STRETCHES.length, alreadyExisted: false }
}
