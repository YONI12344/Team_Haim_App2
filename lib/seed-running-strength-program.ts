/**
 * lib/seed-running-strength-program.ts
 *
 * One-time importer for the coach's "חיזוקים לריצה פעמיים/שלוש בשבוע"
 * program (transcribed from a scanned worksheet) — creates each exercise
 * in the shared Exercise Library and one structured strength Workout built
 * from them, using the exact same Firestore writes the manual UI uses
 * (lib/exercise-library.ts saveExercise, workouts collection), so it only
 * ever runs as the signed-in coach and follows normal security rules.
 *
 * No videos are attached — the source worksheet only had reference photos,
 * not filmable clips, so every exercise is created with videoUrl unset;
 * upload a real demo video per exercise from the Exercise Library tab
 * whenever convenient (this doesn't need to happen before assigning the
 * workout — Lift Mode just shows "no demo video" until one exists).
 *
 * Exercises 13–14 (lateral band walk, Nordic hamstring curl) were not on
 * the original worksheet — added as commonly-recommended runner-strength
 * staples, kept in their own clearly-labeled block so they're easy to
 * review/remove separately from the transcribed program.
 */

import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { saveExercise } from '@/lib/exercise-library'
import type { StrengthBlock, StrengthBlockExercise } from '@/lib/types'

export const RUNNING_STRENGTH_WORKOUT_TITLE = 'חיזוקים לריצה (2-3 בשבוע)'

interface SeedExercise {
  key: string
  name: string
  instructions?: string
  isTimed?: boolean
  defaultDurationSec?: number
  defaultSets: number
  defaultReps?: string
}

interface SeedBlockExercise {
  key: string
  notes?: string
}

interface SeedBlock {
  label: string
  exercises: SeedBlockExercise[]
}

const SEED_EXERCISES: SeedExercise[] = [
  {
    key: 'bridge',
    name: 'גשר',
    instructions: 'פיסוק ברוחב כתפיים, ניתן להרים אצבעות (להיות רק על העקבים). גו וירך באותו קו בשיא הגובה. ניתוק ידיים מוסיף קושי.',
    defaultSets: 2,
    defaultReps: '8',
  },
  {
    key: 'single-leg-bridge',
    name: 'גשר רגל אחת',
    instructions: 'כמו גשר רגיל, מבוצע על רגל אחת.',
    defaultSets: 2,
    defaultReps: '6',
  },
  {
    key: 'bridge-ball-pull',
    name: 'גשר עם פיזיו בול גדול ומשיכה',
    defaultSets: 2,
    defaultReps: '6',
  },
  {
    key: 'goblet-squat',
    name: 'גובלט סקוואט',
    instructions: 'כפות רגליים רחבות מרוחב כתפיים. בהונות פונות קלות החוצה. העברת משקל אחורה לעקבים לפני תחילת ירידה. עלייה לגוף ישר וניצב. הקפדה על ברכיים החוצה (למנוע קריסה פנימה). ירידה מבוקרת, עלייה יותר מהירה.',
    defaultSets: 3,
    defaultReps: '12',
  },
  {
    key: 'single-leg-deadlift',
    name: 'דדליפט רגל אחת (One Leg Deadlift)',
    instructions: 'ירידה עם הישבן אחורה (דדליפט). עלייה לגוף ישר וניצב. הקפדה על גב ישר. ירידה מבוקרת, עלייה קצת יותר מהירה.',
    defaultSets: 3,
    defaultReps: '8 כל רגל',
  },
  {
    key: 'single-leg-calf-raise',
    name: 'עליות תאומים רגל אחת',
    instructions: 'תמיכה עם הידיים לצרכי שיווי משקל. עלייה יחסית מהירה, ירידה איטית מאוד! ברך ישרה אך לא נעולה. אגן מסובב לאחור, בטן אסופה.',
    defaultSets: 3,
    defaultReps: '12',
  },
  {
    key: 'bulgarian-split-squat',
    name: 'סקוואט בולגרי',
    instructions: 'ברך לא עוברת קו אצבעות. זווית 90° בשתי הרגליים במנח הלאנג\' (קדמית ואחורית). ירידה איטית ומבוקרת, עלייה מהירה. שמירה על גב זקוף.',
    defaultSets: 3,
    defaultReps: '8',
  },
  {
    key: 'deadlift',
    name: 'דדליפט',
    instructions: 'כפות רגליים ברוחב כתפיים. בהונות קלות החוצה (ER). ראש בהמשך לגוף, מבט קלות קדימה. מרפקים ישרים ונעולים תמידית. אחיזה בגריפ הפוך. שמירה על עמוד שדרה נייטרלי (ללא כיפוף). משקל על העקבים.',
    defaultSets: 3,
    defaultReps: '8',
  },
  {
    key: 'hip-thrust',
    name: 'Hip Thrust',
    instructions: 'ראש בהמשך לגוף (סנטר מטה). ריפוד סביב המוט באזור המגע. בטן אסופה כל הזמן. בסיום התנועה (למעלה) אגן מסובב לאחור (בטן מכווצת). כפות רגליים לפנים ברוחב כתפיים. ירכיים בהמשך ישיר לבהונות.',
    defaultSets: 2,
    defaultReps: '8-12',
  },
  {
    key: 'one-leg-box-jump',
    name: 'קפיצה על מדרגה רגל אחת (One Leg Box Jump)',
    defaultSets: 2,
    defaultReps: '6',
  },
  {
    key: 'plank',
    name: 'בטן סטטי (פלאנק)',
    instructions: 'ראש בהמשך לגוף. אגן מסובב קלות לאחור (בטן מכווצת). ישבנים מכווצים באופן אקטיבי.',
    isTimed: true,
    defaultDurationSec: 30,
    defaultSets: 1,
  },
  {
    key: 'side-plank',
    name: 'פלאנק צידי (Side Plank)',
    instructions: 'ראש בהמשך לגוף. אגן ישר, ישבן קדימה (בטן מכווצת). ישבנים מכווצים באופן אקטיבי.',
    isTimed: true,
    defaultDurationSec: 30,
    defaultSets: 1,
  },
  // --- AI-suggested additions, not on the original worksheet ---
  {
    key: 'lateral-band-walk',
    name: 'הליכת גומייה צידית (Lateral Band Walk)',
    instructions: '(תוספת מומלצת ע"י ה-AI — לבדיקת המאמן) גומייה מעל הברכיים או הקרסוליים. גב זקוף, ברכיים מעט כפופות. צעד צידי מבוקר תוך שמירה על מתח בגומייה לאורך כל התנועה. מטרה: חיזוק שריר הישבן התיכון וייצוב האגן בריצה על רגל אחת.',
    defaultSets: 2,
    defaultReps: '10 כל צד',
  },
  {
    key: 'nordic-hamstring-curl',
    name: 'כפיפת ברך נורדית (Nordic Hamstring Curl)',
    instructions: '(תוספת מומלצת ע"י ה-AI — לבדיקת המאמן, תרגיל מתקדם) קיבוע הקרסוליים (בעזרת שותף/רצועה), ירידה קדימה איטית ומבוקרת תוך שמירה על גוף ישר מהברכיים, בלימה עם הידיים בסוף הטווח. התרגיל בעל התימוכין המדעי החזק ביותר למניעת פציעות המסטרינג אצל רצים — להתחיל במספר חזרות נמוך.',
    defaultSets: 2,
    defaultReps: '6-8',
  },
]

const SEED_BLOCKS: SeedBlock[] = [
  {
    label: 'סופר-סט 1 (2 סטים)',
    exercises: [{ key: 'bridge' }, { key: 'single-leg-bridge' }, { key: 'bridge-ball-pull' }],
  },
  {
    label: 'סופר-סט 2 (3 סטים)',
    exercises: [
      { key: 'goblet-squat', notes: 'משקל מומלץ: 30 ק"ג' },
      { key: 'single-leg-deadlift', notes: 'משקל מומלץ: 24 ק"ג' },
      { key: 'single-leg-calf-raise', notes: 'משקל מומלץ: 8-12 ק"ג' },
    ],
  },
  {
    label: 'סופר-סט 3 — ירוק/כחול (בחרו 2 מתוך 3, 3 סטים)',
    exercises: [
      { key: 'bulgarian-split-squat', notes: 'משקל חופשי לבחירה' },
      { key: 'deadlift', notes: 'משקל חופשי לבחירה' },
      { key: 'hip-thrust', notes: '40 ק"ג · מנוחה 60 שניות בין סטים' },
    ],
  },
  {
    label: 'סט 4',
    exercises: [
      { key: 'one-leg-box-jump' },
      { key: 'plank' },
      { key: 'side-plank', notes: 'צד ימין' },
      { key: 'side-plank', notes: 'צד שמאל' },
    ],
  },
  {
    label: 'תוספות מומלצות (אופציונלי — לבדיקת המאמן)',
    exercises: [{ key: 'lateral-band-walk' }, { key: 'nordic-hamstring-curl' }],
  },
]

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export async function seedRunningStrengthProgram(createdBy: string): Promise<{ workoutId: string; exerciseCount: number; alreadyExisted: boolean }> {
  const existing = await getDocs(query(collection(db, 'workouts'), where('title', '==', RUNNING_STRENGTH_WORKOUT_TITLE)))
  if (!existing.empty) {
    return { workoutId: existing.docs[0].id, exerciseCount: 0, alreadyExisted: true }
  }

  const idByKey = new Map<string, ExerciseLibrarySavedRef>()
  for (const ex of SEED_EXERCISES) {
    const id = await saveExercise({
      name: ex.name,
      instructions: ex.instructions,
      category: 'strength',
      isTimed: ex.isTimed,
      defaultDurationSec: ex.defaultDurationSec,
      defaultSets: ex.defaultSets,
      defaultReps: ex.defaultReps,
      createdBy,
    })
    idByKey.set(ex.key, { id, ex })
  }

  const blocks: StrengthBlock[] = SEED_BLOCKS.map((block) => ({
    id: genId('block'),
    label: block.label,
    exercises: block.exercises.map((be): StrengthBlockExercise => {
      const saved = idByKey.get(be.key)
      if (!saved) throw new Error(`Seed exercise key not found: ${be.key}`)
      const { id, ex } = saved
      return {
        id: genId('ex'),
        exerciseId: id,
        name: ex.name,
        instructions: ex.instructions,
        targetSets: ex.defaultSets,
        targetReps: ex.defaultReps || '',
        targetDurationSec: ex.isTimed ? ex.defaultDurationSec : undefined,
        notes: be.notes,
      }
    }),
  }))

  const workoutRef = await addDoc(collection(db, 'workouts'), {
    title: RUNNING_STRENGTH_WORKOUT_TITLE,
    type: 'strength',
    description: 'תוכנית חיזוקים לריצה, פעמיים עד שלוש בשבוע — 4 בלוקים (סופר-סטים) בנויים על תרגילי כוח ויציבות לרצים.',
    strengthBlocks: blocks,
    libraryHidden: false,
    source: 'coach' as const,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return { workoutId: workoutRef.id, exerciseCount: SEED_EXERCISES.length, alreadyExisted: false }
}

interface ExerciseLibrarySavedRef {
  id: string
  ex: SeedExercise
}
