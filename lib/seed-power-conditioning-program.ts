/**
 * lib/seed-power-conditioning-program.ts
 *
 * One-time importer for two coach-specified power/kettlebell workouts:
 *  - "כוח: RDL, בולגרי, נורדיקס וקפיצות" — Romanian deadlift, Bulgarian
 *    split squat, Nordic hamstring curl, a box-jump/step-up either/or
 *    slot, farmer's walk.
 *  - "קונדישן: קלינים, סווינגים ובורפי" — kettlebell clean, kettlebell
 *    swing, a burpee/weighted-vest-burpee either/or slot, kettlebell
 *    rack carry, farmer's walk.
 *
 * Bulgarian split squat and Nordic hamstring curl already exist in the
 * library (lib/seed-running-strength-program.ts) — reused by exact name
 * lookup instead of duplicated. Every other exercise here is new;
 * instructions are AI-authored standard technique cues (not transcribed
 * from the coach), same as the Nordic curl note already in that file.
 *
 * The box-jump/step-up and burpee/weighted-vest-burpee pairs use
 * StrengthBlockExercise.alternateExerciseId — the athlete picks which one
 * they're actually doing each session in Lift Mode, instead of the coach
 * needing two near-identical workouts.
 */

import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { saveExercise } from '@/lib/exercise-library'
import type { StrengthBlock, StrengthBlockExercise } from '@/lib/types'

export const POWER_WORKOUT_TITLE = 'כוח: RDL, בולגרי, נורדיקס וקפיצות'
export const CONDITIONING_WORKOUT_TITLE = 'קונדישן: קלינים, סווינגים ובורפי'

const EXISTING_BULGARIAN_NAME = 'סקוואט בולגרי'
const EXISTING_NORDIC_NAME = 'כפיפת ברך נורדית (Nordic Hamstring Curl)'

interface SeedExercise {
  key: string
  name: string
  instructions: string
}

const NEW_EXERCISES: SeedExercise[] = [
  {
    key: 'romanian-deadlift',
    name: 'דדליפט רומני (Romanian Deadlift)',
    instructions: 'רגליים ברוחב האגן, כפיפת ברך קלה קבועה לאורך התנועה. ירידה על ידי דחיפת האגן אחורה (לא כפיפת גב), המשקל צמוד לרגליים, גב ישר. יורדים עד תחושת מתיחה בהמסטרינג (בערך גובה השוק), עולים בדחיפת האגן קדימה עם כיווץ ישבן בסיום.',
  },
  {
    key: 'box-jump',
    name: 'קפיצה לתיבה (Box Jump)',
    instructions: 'עמידה מול הקופסה ברוחב הכתפיים. תנופת ידיים אחורה ואז קפיצה מתפרצת, נחיתה רכה עם שתי הרגליים על הקופסה בכפיפת ברך קלה, יישור מלא בעמידה על הקופסה. יורדים בצעד, לא בקפיצה.',
  },
  {
    key: 'step-up',
    name: 'עליית מדרגה (Step Up)',
    instructions: 'כף רגל אחת מונחת בשלמותה על הקופסה/מדרגה. דחיפה דרך העקב לעלייה, ללא דחיפה מהרגל האחורית. ירידה מבוקרת, מחליפים רגליים.',
  },
  {
    key: 'farmers-walk',
    name: 'הליכת איכר (Farmer\'s Walk)',
    instructions: 'אחיזת משקולת/קטלבל כבד בכל יד לצד הגוף, כתפיים אחורה ולמטה, בטן אסופה. הליכה בצעדים קצרים ומבוקרים, גו זקוף, ללא נדנוד של המשקולות.',
  },
  {
    key: 'kettlebell-clean',
    name: 'קלין קטלבל (Kettlebell Clean)',
    instructions: 'הנפה אחורה בין הרגליים כמו בסווינג, ואז דחיפת אגן קדימה בעוצמה ומשיכת הקטלבל קרוב לגוף עד למנח "מנוחה" על האמה בגובה החזה. אחיזה רפויה בסיום — "מעיפים" את הקטלבל, לא מרימים אותו בכוח זרוע.',
  },
  {
    key: 'kettlebell-swing',
    name: 'סווינג קטלבל (Kettlebell Swing)',
    instructions: 'הנפת הקטלבל אחורה בין הרגליים, ואז דחיפת האגן (לא הרמה בידיים) לשיגור הקטלבל קדימה עד גובה החזה בערך. משאירים אותו "לרחף" בירידה וחוזרים. הכוח מגיע מכיפוף האגן, לא מהכתפיים.',
  },
  {
    key: 'burpee',
    name: 'בורפי (Burpee)',
    instructions: 'מעמידה, ירידה לסקוואט, הנחת ידיים על הרצפה, בעיטת רגליים אחורה למצב פלאנק, שכיבת סמיכה (או הורדת חזה לרצפה), קפיצת רגליים בחזרה לסקוואט, ואז קפיצה מתפרצת למעלה עם ידיים באוויר.',
  },
  {
    key: 'burpee-vest',
    name: 'בורפי עם משקולת (Burpee with Weighted Vest)',
    instructions: 'אותה תנועה בדיוק כמו בורפי רגיל, עם משקולת על הגוף. לצפות לקצב איטי יותר וטווח קפיצה קצר יותר, נחיתה רכה.',
  },
  {
    key: 'kettlebell-rack-carry',
    name: 'הליכת קטלבל בעמדת מד"ר (Kettlebell Rack Carry)',
    instructions: '"קליין" של הקטלבל/ים למנח מד"ר (מונח על האמה בגובה הכתף), מרפק צמוד לגוף ובטן אסופה. הליכה בצעדים מבוקרים, גו זקוף ללא נטייה אחורה.',
  },
]

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

async function findExerciseIdByName(name: string): Promise<string | null> {
  const snap = await getDocs(query(collection(db, 'exerciseLibrary'), where('name', '==', name)))
  return snap.empty ? null : snap.docs[0].id
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
  alternateKey?: string,
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
    ...(alternateKey ? { alternateExerciseId: id.get(alternateKey) } : {}),
  }
}

export async function seedPowerConditioningProgram(createdBy: string): Promise<{
  exerciseCount: number
  workoutsCreated: string[]
  alreadyExisted: boolean
}> {
  const anchor = await getDocs(query(collection(db, 'workouts'), where('title', '==', POWER_WORKOUT_TITLE)))
  if (!anchor.empty) {
    return { exerciseCount: 0, workoutsCreated: [], alreadyExisted: true }
  }

  const idByKey = new Map<string, string>()
  for (const e of NEW_EXERCISES) {
    const id = await saveExercise({
      name: e.name,
      instructions: e.instructions,
      category: 'strength',
      createdBy,
    })
    idByKey.set(e.key, id)
  }

  const bulgarianId = await findExerciseIdByName(EXISTING_BULGARIAN_NAME)
  const nordicId = await findExerciseIdByName(EXISTING_NORDIC_NAME)
  if (bulgarianId) idByKey.set('bulgarian-split-squat', bulgarianId)
  if (nordicId) idByKey.set('nordic-hamstring-curl', nordicId)

  const workoutsCreated: string[] = []

  const powerBlocks: StrengthBlock[] = [
    { id: genId('block'), label: 'סט 1', exercises: [ex(idByKey, 'romanian-deadlift', 3, '8-10')] },
    ...(bulgarianId ? [{ id: genId('block'), label: 'סט 2', exercises: [{
      id: genId('ex'), exerciseId: bulgarianId, name: EXISTING_BULGARIAN_NAME, category: 'strength' as const, targetSets: 3, targetReps: '8 לכל רגל',
    }] }] : []),
    ...(nordicId ? [{ id: genId('block'), label: 'סט 3', exercises: [{
      id: genId('ex'), exerciseId: nordicId, name: EXISTING_NORDIC_NAME, category: 'strength' as const, targetSets: 3, targetReps: '6-8',
    }] }] : []),
    { id: genId('block'), label: 'סט 4', exercises: [ex(idByKey, 'box-jump', 3, '5', 'step-up')] },
    { id: genId('block'), label: 'סט 5', exercises: [ex(idByKey, 'farmers-walk', 3, '30 מטר')] },
  ]

  const power = await createWorkoutIfMissing(
    POWER_WORKOUT_TITLE,
    'RDL, סקוואט בולגרי, כפיפת ברך נורדית, קפיצה לתיבה או עליית מדרגה (לבחירה כל אימון), והליכת איכר לסיום.',
    powerBlocks,
    createdBy,
  )
  if (power.created) workoutsCreated.push(POWER_WORKOUT_TITLE)

  const conditioningBlocks: StrengthBlock[] = [
    { id: genId('block'), label: 'סט 1', exercises: [ex(idByKey, 'kettlebell-clean', 3, '6 לכל צד')] },
    { id: genId('block'), label: 'סט 2', exercises: [ex(idByKey, 'kettlebell-swing', 3, '15')] },
    { id: genId('block'), label: 'סט 3', exercises: [ex(idByKey, 'burpee', 3, '10', 'burpee-vest')] },
    { id: genId('block'), label: 'סט 4', exercises: [ex(idByKey, 'kettlebell-rack-carry', 3, '30 מטר')] },
    { id: genId('block'), label: 'סט 5', exercises: [ex(idByKey, 'farmers-walk', 3, '30 מטר')] },
  ]

  const conditioning = await createWorkoutIfMissing(
    CONDITIONING_WORKOUT_TITLE,
    'קלין קטלבל, סווינג קטלבל, בורפי או בורפי עם משקולת (לבחירה כל אימון), הליכת קטלבל בעמדת מד"ר, והליכת איכר לסיום.',
    conditioningBlocks,
    createdBy,
  )
  if (conditioning.created) workoutsCreated.push(CONDITIONING_WORKOUT_TITLE)

  return { exerciseCount: NEW_EXERCISES.length, workoutsCreated, alreadyExisted: false }
}
