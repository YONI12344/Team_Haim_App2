/**
 * lib/seed-calf-rehab-program.ts
 *
 * One-time importer for the coach's calf / soleus strain protocol (the same
 * seven exercises as the printed handout): creates each exercise in the
 * Exercise Library (category 'rehab', with the line drawing from
 * public/rehab/) and one 'rehab' workout built from them, one exercise per
 * block, in the protocol's order. Same mechanism as the other seed-*.ts
 * importers: normal saveExercise/workouts writes as the signed-in coach.
 */

import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { saveExercise } from '@/lib/exercise-library'
import type { StrengthBlock, StrengthBlockExercise } from '@/lib/types'

export const CALF_REHAB_WORKOUT_TITLE = 'שיקום תאומים וסולאוס'

interface SeedExercise {
  name: string
  instructions: string
  imageUrl: string
  sets: number
  reps: string
  durationSec?: number
}

// Two sets on a one-leg exercise = right leg, then left leg (same convention
// as the stretch seeds).
const SEED: SeedExercise[] = [
  {
    name: 'הליכה על אצבעות',
    instructions: 'עולים גבוה על כריות כף הרגל, הגוף זקוף.\nהולכים 20 צעדים קצרים. העקבים לא יורדים לרצפה עד הסוף.\nכשמתעייפים העקבים נוטים לשקוע: עדיף לעצור לפני.',
    imageUrl: '/rehab/calf-01.png',
    sets: 1,
    reps: '20 צעדים',
  },
  {
    name: 'הליכה על עקבים',
    instructions: 'מרימים את קדמת כף הרגל ועומדים רק על העקבים.\nהולכים 20 צעדים קצרים, ברכיים כמעט ישרות.\nלא לשבור את האגן אחורה.',
    imageUrl: '/rehab/calf-02.png',
    sets: 1,
    reps: '20 צעדים',
  },
  {
    name: 'עליות תאומים אקסצנטריות',
    instructions: 'יד על הקיר. עולים על האצבעות עם שתי הרגליים.\nמרימים את הרגל הבריאה. כל המשקל על הפגועה.\nיורדים לאט, 3-4 שניות, עד שהעקב על הרצפה.\nכשזה עובר בלי כאב, מוסיפים משקולת ביד.',
    imageUrl: '/rehab/calf-03.png',
    sets: 2,
    reps: '10 (סט לכל רגל)',
  },
  {
    name: 'עמידה על רגל אחת',
    instructions: 'עומדים יחפים על רגל אחת, ברך רכה. מחליפים רגל.\nמבט לנקודה קבועה, וקיר או כיסא בהישג יד.\nכשזה קל: על בוסו או פיטה, או בעיניים עצומות.',
    imageUrl: '/rehab/calf-04.png',
    sets: 2,
    reps: '',
    durationSec: 30,
  },
  {
    name: 'עליות תאומים, טווח מלא',
    instructions: 'עומדים זקוף, רגליים ברוחב האגן.\nעולים עד הסוף, מחזיקים שנייה, ויורדים לאט עד הסוף.\nהמשקל על הבוהן הגדולה, לא על הצד החיצוני של כף הרגל.',
    imageUrl: '/rehab/calf-05.png',
    sets: 1,
    reps: '15',
  },
  {
    name: 'עליות תאומים בישיבה',
    instructions: 'יושבים, ברכיים בזווית ישרה, משקולת על הברכיים.\nמרימים עקבים גבוה, מחזיקים שנייה ויורדים לאט.\nמתחילים במשקל קל. אפשר גם במכונת עליות תאומים בישיבה.',
    imageUrl: '/rehab/calf-06.png',
    sets: 1,
    reps: '10',
  },
  {
    name: 'עליות תאומים בסמית׳ משין',
    instructions: 'המוט על הגב העליון. קדמת כף הרגל על משטח, העקבים באוויר.\nעולים עד הסוף ויורדים לאט, מעט מתחת לגובה המשטח.\nרק כשתרגילים 3, 5 ו-6 עוברים בלי כאב. מתחילים במשקל קל.',
    imageUrl: '/rehab/calf-07.png',
    sets: 1,
    reps: '10-12',
  },
]

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export async function seedCalfRehabProgram(createdBy: string): Promise<{ workoutId: string; exerciseCount: number; alreadyExisted: boolean }> {
  const existing = await getDocs(query(collection(db, 'workouts'), where('title', '==', CALF_REHAB_WORKOUT_TITLE)))
  if (!existing.empty) {
    return { workoutId: existing.docs[0].id, exerciseCount: 0, alreadyExisted: true }
  }

  const blocks: StrengthBlock[] = []
  for (const [i, ex] of SEED.entries()) {
    const id = await saveExercise({
      name: ex.name,
      instructions: ex.instructions,
      imageUrl: ex.imageUrl,
      category: 'rehab',
      subcategory: 'שוק / תאומים',
      isTimed: ex.durationSec != null,
      defaultDurationSec: ex.durationSec,
      defaultSets: ex.sets,
      defaultReps: ex.reps || undefined,
      createdBy,
    })
    const blockExercise: StrengthBlockExercise = {
      id: genId('ex'),
      exerciseId: id,
      name: ex.name,
      instructions: ex.instructions,
      imageUrl: ex.imageUrl,
      category: 'rehab',
      targetSets: ex.sets,
      targetReps: ex.reps,
      ...(ex.durationSec != null ? { targetDurationSec: ex.durationSec } : {}),
    }
    blocks.push({ id: genId('block'), label: `תרגיל ${i + 1}`, exercises: [blockExercise] })
  }

  const workoutRef = await addDoc(collection(db, 'workouts'), {
    title: CALF_REHAB_WORKOUT_TITLE,
    type: 'rehab',
    description: 'שיקום מתיחה או קרע קטן בתאומים או בסולאוס. פעם ביום לפחות, 5-6 ימים בשבוע. הכאב לא עובר 2 מתוך 10 באף תרגיל: כואב יותר, חוזרים שלב אחורה.',
    strengthBlocks: blocks,
    libraryHidden: false,
    source: 'coach' as const,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return { workoutId: workoutRef.id, exerciseCount: SEED.length, alreadyExisted: false }
}
