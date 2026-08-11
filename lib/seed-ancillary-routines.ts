/**
 * lib/seed-ancillary-routines.ts
 *
 * One-time importer for the coach's own "GW Ancillary Routines" file
 * (/Users/yehonatanhaim/Desktop/ancillary_routines_fixed.json) — a
 * bilingual pre-run/pre-workout drill system. Transcribed, not AI-authored
 * (unlike the two static-stretch imports).
 *
 * Several drills repeat verbatim across the source's own sections (e.g.
 * "Straight leg hamstring" appears in Rope/Mobility, the Rope Stretch
 * Routine, and Ankle Weights) — those are created once and reused across
 * every routine that calls for them, instead of duplicating library
 * entries.
 *
 * Four workouts come out of this (all type 'stretch', category 'stretch'
 * per the coach's own "warm up and stretch place" framing — no new
 * taxonomy):
 *  - קל: the source's "Pre-Run Drills" section alone (4 blocks) — the
 *    every-run default.
 *  - מלא: the same 4 blocks PLUS "Pre-Workout/Race Drills" (2 more
 *    blocks) — for hard/quality/race days, per the coach's request for
 *    "more exercises on hard days, less on easy days."
 *  - Rope Stretch Routine and Ankle Weights stand alone — the source
 *    doesn't group them into either warm-up, so they're separate
 *    assignable routines rather than folded into the two above.
 *
 * Two spots had no rep/set count in the source (Floor and Upright, under
 * Pre-Workout/Race Drills) — filled in with a reasonable standard
 * (10/side for floor mobility, 2×20m for the running-form drills) and
 * flagged in each exercise's instructions as an estimate to confirm.
 */

import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { saveExercise } from '@/lib/exercise-library'
import type { StrengthBlock, StrengthBlockExercise } from '@/lib/types'

export const EASY_WARMUP_TITLE = 'חימום קל לפני ריצה'
export const FULL_WARMUP_TITLE = 'חימום מלא - לפני אימון איכות/מרוץ'
export const ROPE_STRETCH_TITLE = 'שגרת מתיחות עם חבל (GW)'
export const ANKLE_WEIGHTS_TITLE = 'משקולות קרסול (GW)'

interface SeedDrill {
  key: string
  name: string
  defaultReps: string
  defaultSets: number
}

interface SeedBlock {
  label: string
  exercises: { key: string }[]
}

const D: SeedDrill[] = [
  { key: 'straight-leg-hamstring', name: 'מתיחת המסטרינג ברגל ישרה (Straight Leg Hamstring)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'quadriceps-pull', name: 'מתיחת ארבע ראשי בהליכה/דינמית (Quadriceps)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'tspine-rotations', name: 'סיבובי עמוד שדרה גבי (T-Spine Rotations)', defaultReps: '10 לכל צד', defaultSets: 1 },
  { key: 'hands-knees-rotations', name: 'סיבובי ברכיים/ידיים (Hands/Knees Rotations)', defaultReps: '10', defaultSets: 1 },
  { key: 'hip-flexor-raise-band', name: 'הרמת כופפי ירך עם גומייה (Hip Flexor Raise)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'glute-bridges', name: 'גשר עכוז (Glute Bridges)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'clamshells', name: 'צדפות (Clamshells)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'fire-hydrants', name: 'פייר היידרנט (Fire Hydrants)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'donkey-kicks', name: 'בעיטות חמור (Donkey Kicks)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'lateral-leg-raise', name: 'הרמת רגל לצד (Lateral Leg Raise)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'monster-walk-band', name: 'הליכת מפלצת עם גומייה - קדימה ואחורה (Monster Walks)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'knee-pull', name: 'משיכת ברך לחזה בהליכה (Knee Pull)', defaultReps: '10 סך הכל', defaultSets: 1 },
  { key: 'quad-pull', name: 'משיכת ארבע ראשי בהליכה (Quad Pull)', defaultReps: '10 סך הכל', defaultSets: 1 },
  { key: 'monster-walk', name: 'הליכת מפלצת (Monster Walks)', defaultReps: '10 סך הכל', defaultSets: 1 },
  { key: 'walking-rdls', name: 'RDL בהליכה (Walking RDLs)', defaultReps: '10 סך הכל', defaultSets: 1 },
  { key: 'heel-to-toe-walks', name: 'הליכת עקב-בוהן (Heel-to-Toe Walks)', defaultReps: '10 סך הכל', defaultSets: 1 },
  { key: 'hops-double-leg', name: 'ניתורים ברגליים צמודות - קדימה ואחורה (Hops)', defaultReps: '20', defaultSets: 1 },
  // Pre-Workout/Race Drills — source gave no rep count, estimate flagged in name/notes below
  { key: 'leg-swings', name: 'הנפות רגליים - קדימה ולצדדים (Leg Swings)', defaultReps: '10 לכל צד (הערכה)', defaultSets: 1 },
  { key: 'iron-crosses', name: 'איירון קרוס (Iron Crosses)', defaultReps: '10 לכל צד (הערכה)', defaultSets: 1 },
  { key: 'scorpions', name: 'עקרבים (Scorpions)', defaultReps: '10 לכל צד (הערכה)', defaultSets: 1 },
  { key: 'rockers', name: 'רוקרס (Rockers)', defaultReps: '10 (הערכה)', defaultSets: 1 },
  { key: 'lateral-arm-swings', name: 'הנפות ידיים לצדדים (Lateral Arm Swings)', defaultReps: '10 (הערכה)', defaultSets: 1 },
  { key: 'a-skips', name: 'A-Skips', defaultReps: '20 מ׳ (הערכה)', defaultSets: 2 },
  { key: 'b-skips', name: 'B-Skips', defaultReps: '20 מ׳ (הערכה)', defaultSets: 2 },
  { key: 'c-skips', name: 'C-Skips', defaultReps: '20 מ׳ (הערכה)', defaultSets: 2 },
  // Rope Stretch Routine extras
  { key: 'hip-adductors', name: 'מקרבי ירך (Hip Adductors)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'hip-abductors', name: 'מרחיקי ירך (Hip Abductors)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'calf-stretch-rope', name: 'מתיחת תאומים עם חבל - עליון/תחתון (Calf, upper/lower)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'gluteals-rope', name: 'מתיחת ישבן עם חבל (Gluteals)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  { key: 'trunk-extensors', name: 'מתיחת פושטי גב עם חבל (Trunk Extensors)', defaultReps: '10 לכל רגל', defaultSets: 1 },
  // Ankle Weights extras
  { key: 'hip-flexors-ankle-weight', name: 'כופפי ירך עם משקולת קרסול (Hip Flexors)', defaultReps: '10-15', defaultSets: 2 },
  { key: 'hamstring-curls-ankle-weight', name: 'כפיפת ברך עם משקולת קרסול - המסטרינג (Hamstring Curls)', defaultReps: '10-15', defaultSets: 2 },
]

const PRE_RUN_BLOCKS: SeedBlock[] = [
  { label: 'חבל / ניידות', exercises: [{ key: 'straight-leg-hamstring' }, { key: 'quadriceps-pull' }, { key: 'tspine-rotations' }, { key: 'hands-knees-rotations' }] },
  { label: 'גומיות התנגדות (Bands)', exercises: [{ key: 'hip-flexor-raise-band' }, { key: 'glute-bridges' }, { key: 'clamshells' }, { key: 'fire-hydrants' }, { key: 'donkey-kicks' }, { key: 'lateral-leg-raise' }, { key: 'monster-walk-band' }] },
  { label: 'תרגילי הליכה', exercises: [{ key: 'knee-pull' }, { key: 'quad-pull' }, { key: 'monster-walk' }, { key: 'walking-rdls' }, { key: 'heel-to-toe-walks' }] },
  { label: 'ניתורים', exercises: [{ key: 'hops-double-leg' }] },
]

const PRE_WORKOUT_BLOCKS: SeedBlock[] = [
  { label: 'על הרצפה', exercises: [{ key: 'leg-swings' }, { key: 'iron-crosses' }, { key: 'scorpions' }, { key: 'rockers' }] },
  { label: 'בעמידה', exercises: [{ key: 'lateral-arm-swings' }, { key: 'a-skips' }, { key: 'b-skips' }, { key: 'c-skips' }] },
]

const ROPE_STRETCH_BLOCKS: SeedBlock[] = [
  { label: 'שגרת מתיחות עם חבל', exercises: [{ key: 'straight-leg-hamstring' }, { key: 'hip-adductors' }, { key: 'hip-abductors' }, { key: 'calf-stretch-rope' }, { key: 'quadriceps-pull' }, { key: 'gluteals-rope' }, { key: 'trunk-extensors' }] },
]

const ANKLE_WEIGHTS_BLOCKS: SeedBlock[] = [
  { label: 'משקולות קרסול (2 סבבים)', exercises: [{ key: 'hip-flexors-ankle-weight' }, { key: 'hip-abductors' }, { key: 'hip-adductors' }, { key: 'donkey-kicks' }, { key: 'hamstring-curls-ankle-weight' }, { key: 'straight-leg-hamstring' }] },
]

function genId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

function buildBlocks(seedBlocks: SeedBlock[], idByKey: Map<string, string>): StrengthBlock[] {
  const drillByKey = new Map(D.map((d) => [d.key, d]))
  return seedBlocks.map((sb) => ({
    id: genId('block'),
    label: sb.label,
    exercises: sb.exercises.map((be): StrengthBlockExercise => {
      const drill = drillByKey.get(be.key)
      const id = idByKey.get(be.key)
      if (!drill || !id) throw new Error(`Seed drill key not found: ${be.key}`)
      return {
        id: genId('ex'),
        exerciseId: id,
        name: drill.name,
        targetSets: drill.defaultSets,
        targetReps: drill.defaultReps,
      }
    }),
  }))
}

async function createWorkoutIfMissing(
  title: string,
  description: string,
  blocks: StrengthBlock[],
  createdBy: string,
  isWarmup: boolean,
): Promise<{ workoutId: string; created: boolean }> {
  const existing = await getDocs(query(collection(db, 'workouts'), where('title', '==', title)))
  if (!existing.empty) return { workoutId: existing.docs[0].id, created: false }
  const ref = await addDoc(collection(db, 'workouts'), {
    title,
    type: 'stretch',
    description,
    strengthBlocks: blocks,
    isWarmup,
    libraryHidden: false,
    source: 'coach' as const,
    createdBy,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
  return { workoutId: ref.id, created: true }
}

export async function seedAncillaryRoutines(createdBy: string): Promise<{
  exerciseCount: number
  workoutsCreated: string[]
  alreadyExisted: boolean
}> {
  // Treat the easy warm-up as the anchor — if it's already there, assume
  // the whole batch was already imported and skip re-creating exercises.
  const anchor = await getDocs(query(collection(db, 'workouts'), where('title', '==', EASY_WARMUP_TITLE)))
  if (!anchor.empty) {
    return { exerciseCount: 0, workoutsCreated: [], alreadyExisted: true }
  }

  const idByKey = new Map<string, string>()
  for (const drill of D) {
    const id = await saveExercise({
      name: drill.name,
      category: 'warmup',
      defaultSets: drill.defaultSets,
      defaultReps: drill.defaultReps,
      createdBy,
    })
    idByKey.set(drill.key, id)
  }

  const workoutsCreated: string[] = []

  const easy = await createWorkoutIfMissing(
    EASY_WARMUP_TITLE,
    'חימום סטנדרטי לפני כל ריצה — ניידות, הפעלת עכוז/ירך עם גומיות, תרגילי הליכה וניתורים.',
    buildBlocks(PRE_RUN_BLOCKS, idByKey),
    createdBy,
    true,
  )
  if (easy.created) workoutsCreated.push(EASY_WARMUP_TITLE)

  const full = await createWorkoutIfMissing(
    FULL_WARMUP_TITLE,
    'חימום מלא לפני אימון איכות או מרוץ — כל תרגילי החימום הקל, בתוספת תרגילי הכנה ספציפיים (רצפה + תרגילי ריצה בעמידה כמו A/B/C-skips). כמות החזרות בבלוקים "על הרצפה" ו"בעמידה" היא הערכה — לא צוינה במקור, מומלץ לאמת.',
    [...buildBlocks(PRE_RUN_BLOCKS, idByKey), ...buildBlocks(PRE_WORKOUT_BLOCKS, idByKey)],
    createdBy,
    true,
  )
  if (full.created) workoutsCreated.push(FULL_WARMUP_TITLE)

  const rope = await createWorkoutIfMissing(
    ROPE_STRETCH_TITLE,
    'שגרת מתיחות עם חבל מתיחות — עצמאית, לא חלק מהחימום הקל/מלא.',
    buildBlocks(ROPE_STRETCH_BLOCKS, idByKey),
    createdBy,
    false,
  )
  if (rope.created) workoutsCreated.push(ROPE_STRETCH_TITLE)

  const ankle = await createWorkoutIfMissing(
    ANKLE_WEIGHTS_TITLE,
    'שגרת הפעלה עם משקולות קרסול, 2 סבבים — עצמאית, לא חלק מהחימום הקל/מלא. כמות החזרות היא הערכה (המקור ציין רק "2 סבבים").',
    buildBlocks(ANKLE_WEIGHTS_BLOCKS, idByKey),
    createdBy,
    false,
  )
  if (ankle.created) workoutsCreated.push(ANKLE_WEIGHTS_TITLE)

  return { exerciseCount: D.length, workoutsCreated, alreadyExisted: false }
}
