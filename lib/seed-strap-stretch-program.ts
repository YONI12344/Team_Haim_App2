/**
 * lib/seed-strap-stretch-program.ts
 *
 * One-time importer for a second stretching batch, coach-curated (AI):
 * a dedicated block of stretching-strap/rope-assisted stretches (a strap
 * gives controlled range and reach where the athlete can't hold the limb
 * directly — standard kit for deeper, safer static stretching) plus a few
 * general mobility stretches not covered by the first static-stretch
 * import (lib/seed-runner-stretch-program.ts): thoracic rotation, ankle
 * dorsiflexion, neck, and a cat-cow spinal flow.
 *
 * Same mechanism as the other two importers: creates each stretch in the
 * Exercise Library (category 'stretch', isTimed) and one structured
 * 'stretch' Workout built from them, via the normal saveExercise/workouts
 * writes so it runs as the signed-in coach under existing rules.
 *
 * Requires a stretching strap/rope for the first block — note is on the
 * workout description. Reviewable starting point, not a prescription.
 */

import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { saveExercise } from '@/lib/exercise-library'
import type { StrengthBlock, StrengthBlockExercise } from '@/lib/types'

export const STRAP_STRETCH_WORKOUT_TITLE = 'מתיחות מתקדמות: רצועה וניידות'

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
  // --- Strap/rope-assisted stretches ---
  {
    key: 'hamstring-strap',
    name: 'מתיחת המסטרינג עם רצועה',
    instructions: 'שכיבה על הגב. לולאה של הרצועה סביב כף הרגל הנמתחת. הרמת הרגל ישר כלפי מעלה תוך משיכה עדינה של הרצועה לכיוון הפנים, ברך ישרה אך לא נעולה. הרגל השנייה נשארת שטוחה (או כפופה אם יש מגבלת גב תחתון). מבוצע פעם אחת לכל רגל.',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'calf-strap',
    name: 'מתיחת תאומים עם רצועה',
    instructions: 'ישיבה עם הרגליים ישרות. לולאה של הרצועה סביב כרית כף הרגל. משיכה עדינה כך שהבהונות מתקרבות לכיוון השוק, תוך שמירה על ברך ישרה. מבוצע פעם אחת לכל רגל.',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'quad-strap-side',
    name: 'מתיחת ארבע ראשי עם רצועה (שכיבה על הצד)',
    instructions: 'שכיבה על הצד. לולאה של הרצועה סביב הקרסול העליון. משיכה עדינה של העקב לכיוון הישבן תוך שמירה על הברכיים קרובות זו לזו והאגן יציב (לא מסתובב אחורה). שימושי כשקשה להגיע ישירות לכף הרגל. מבוצע פעם אחת לכל רגל.',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'hip-flexor-strap',
    name: 'מתיחת מכופפי ירך עם רצועה',
    instructions: 'כריעה על ברך אחת (מנח לאנג\'). לולאה של הרצועה סביב הקרסול האחורי, אחיזתה ביד לתמיכה בשמירת הברך כפופה, תוך דחיפה עדינה של האגן קדימה וגב זקוף לאורך כל התרגיל. מבוצע פעם אחת לכל צד.',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'itband-strap-supine',
    name: 'מתיחת IT Band עם רצועה (שכיבה על הגב)',
    instructions: 'שכיבה על הגב. לולאה של הרצועה סביב כף הרגל של רגל ישרה, הנחיית הרגל בעדינות לרוחב הגוף (הצלבה) תוך שמירה על שתי הכתפיים צמודות לרצפה. הרצועה מסייעת בשליטה ובאיזון התנועה. מבוצע פעם אחת לכל רגל.',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'chest-shoulder-strap-overhead',
    name: 'מתיחת חזה וכתפיים עם רצועה (מעל הראש)',
    instructions: 'אחיזת הרצועה בשתי הידיים ברוחב רחב מהכתפיים. הרמת הידיים מעל הראש ולאחור בתנועה מבוקרת ואיטית, מרפקים ישרים, עד תחושת פתיחה בחזה ובחזית הכתפיים. הרחבת האחיזה מקלה על התרגיל, הצרתה מקשה — להתאים לפי גמישות.',
    defaultDurationSec: 30,
    defaultSets: 1,
  },
  // --- Additional general mobility stretches ---
  {
    key: 'thoracic-rotation-seated',
    name: 'סיבוב גב עליון בישיבה',
    instructions: 'ישיבה זקופה על כיסא או על הרצפה. סיבוב פלג הגוף העליון לכיוון אחד תוך שמירה על האגן יציב (הסיבוב מגיע מהגב העליון, לא מהמותניים). ניתן להיעזר בידיים לתמיכה קלה בסיבוב. מבוצע פעם אחת לכל כיוון.',
    defaultDurationSec: 20,
    defaultSets: 2,
  },
  {
    key: 'ankle-dorsiflexion',
    name: 'מתיחת קרסול ושוקית קדמית',
    instructions: 'כריעה עם הישבן על העקבים (או עמידה עם רגל אחת מאחור, גב כף הרגל על הרצפה), הטיית הגוף קלות קדימה עד תחושת מתיחה בחזית הקרסול/שוקית. חשוב לרצים לשמירה על טווח תנועה תקין בקרסול. מבוצע פעם אחת לכל רגל.',
    defaultDurationSec: 30,
    defaultSets: 2,
  },
  {
    key: 'neck-lateral',
    name: 'מתיחת צוואר לצדדים',
    instructions: 'ישיבה או עמידה זקופה. הטיית הראש לצד אחד (אוזן לכיוון הכתף) בעדינות, ניתן להוסיף לחץ עדין וקל עם היד. הימנעות ממשיכה חזקה. מבוצע פעם אחת לכל צד.',
    defaultDurationSec: 20,
    defaultSets: 2,
  },
  {
    key: 'cat-cow',
    name: 'Cat-Cow לגב תחתון וליבה',
    instructions: 'עמידת ארבע (ידיים וברכיים). לסירוגין: קימור הגב כלפי מעלה (חתול) והורדתו כלפי מטה עם הרמת הראש (פרה), בתנועה איטית ומבוקרת בקצב הנשימה. מומלץ במיוחד לאחר ריצות ארוכות לשחרור הגב התחתון.',
    defaultDurationSec: 30,
    defaultSets: 1,
  },
]

const SEED_BLOCKS: SeedBlock[] = [
  {
    label: 'מתיחות עם רצועת מתיחה (נדרשת רצועה/חבל)',
    exercises: [
      { key: 'hamstring-strap' },
      { key: 'calf-strap' },
      { key: 'quad-strap-side' },
      { key: 'hip-flexor-strap' },
      { key: 'itband-strap-supine' },
      { key: 'chest-shoulder-strap-overhead' },
    ],
  },
  {
    label: 'ניידות ומתיחות נוספות',
    exercises: [
      { key: 'thoracic-rotation-seated' },
      { key: 'ankle-dorsiflexion' },
      { key: 'neck-lateral' },
      { key: 'cat-cow' },
    ],
  },
]

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export async function seedStrapStretchProgram(createdBy: string): Promise<{ workoutId: string; exerciseCount: number; alreadyExisted: boolean }> {
  const existing = await getDocs(query(collection(db, 'workouts'), where('title', '==', STRAP_STRETCH_WORKOUT_TITLE)))
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
        targetSets: ex.defaultSets,
        targetReps: '',
        targetDurationSec: ex.defaultDurationSec,
      }
    }),
  }))

  const workoutRef = await addDoc(collection(db, 'workouts'), {
    title: STRAP_STRETCH_WORKOUT_TITLE,
    type: 'stretch',
    description: 'שגרת מתיחות עם רצועת מתיחה (הבלוק הראשון דורש רצועה/חבל מתיחות) בתוספת כמה מתיחות ניידות כלליות — סיבוב גב עליון, קרסול, צוואר ו-Cat-Cow. שגרה כללית, מומלץ לעבור עליה ולהתאים לפי הצורך.',
    strengthBlocks: blocks,
    libraryHidden: false,
    source: 'coach' as const,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  return { workoutId: workoutRef.id, exerciseCount: SEED_STRETCHES.length, alreadyExisted: false }
}
