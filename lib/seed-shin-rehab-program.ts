/**
 * lib/seed-shin-rehab-program.ts
 *
 * One-time importer for the anterior shin (shin splits) rehab program, in
 * three physical-therapy phases: calm the shin and get the ankle moving,
 * then strength, then load and impact on the way back to running. Each
 * phase is its own 'rehab' workout tagged with Workout.rehabPhase, so the
 * coach can move an injury from phase to phase (lib/rehab.ts setRehabPhase).
 * Exercises the calf program already has are reused from the library.
 */

import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { buildRehabBlocks, type SeedRehabExercise } from '@/lib/seed-rehab-shared'
import { CALF_REHAB_EXERCISES } from '@/lib/seed-calf-rehab-program'
import type { RehabPhaseInfo } from '@/lib/types'

export const SHIN_PROGRAM = 'shin-anterior'
export const SHIN_PROGRAM_TITLE = 'שיקום שוקה קדמית'
const SUBCATEGORY = 'שוק / שוקה קדמית'

const calf = (name: string, target: Pick<SeedRehabExercise, 'sets' | 'reps' | 'durationSec'>): SeedRehabExercise => {
  const ex = CALF_REHAB_EXERCISES.find((e) => e.name === name)
  if (!ex) throw new Error(`Missing calf exercise ${name}`)
  return { ...ex, ...target }
}

const RULE = 'הכאב לא עובר 2 מתוך 10 באף תרגיל, וגם לא בבוקר שאחרי. כואב יותר: חוזרים לגרסה קלה או לשלב הקודם.'
const RED_FLAGS = 'כאב נקודתי על העצם, כאב בלילה או במנוחה, או כאב חד בקפיצה על רגל אחת: עוצרים ונבדקים אצל רופא. זה יכול להיות שבר מאמץ.'

export interface SeedPhase extends Omit<RehabPhaseInfo, 'program' | 'programTitle'> {
  when: string
  exercises: SeedRehabExercise[]
}

export const SHIN_REHAB_PHASES: SeedPhase[] = [
  {
    phase: 1,
    name: 'הרגעה ותנועה',
    when: 'כל יום. שלב ראשון אחרי שהכאב התחיל: בלי ריצה ובלי קפיצות.',
    nextWhen: 'הליכה רגילה בלי כאב, כאב בוקר 0-2 כמה ימים ברצף, ו-3 אימונים ברצף בשלב הזה עם כאב עד 2.',
    exercises: [
      {
        name: 'לחיצה איזומטרית לקדמת השוק',
        instructions: 'יושבים, כפות הרגליים על הרצפה.\nמניחים את כף הרגל השנייה על כף הרגל הפגועה.\nמנסים להרים את הפגועה, והעליונה לא נותנת לה לזוז. שום דבר לא זז.\nלוחצים בחצי כוח ונושמים רגיל. 30 שניות, ו-30 שניות מנוחה.',
        imageUrl: '/rehab/shin-01.png',
        sets: 4,
        reps: '',
        durationSec: 30,
      },
      {
        name: 'הרמת אצבעות בישיבה',
        instructions: 'יושבים, העקבים על הרצפה.\nמרימים את קדמת כף הרגל גבוה ככל שאפשר ומחזיקים שנייה.\nיורדים לאט, 3 שניות. העקבים לא זזים.',
        imageUrl: '/rehab/shin-02.png',
        sets: 2,
        reps: '15',
      },
      {
        name: 'אלפבית בקרסול',
        instructions: 'יושבים ומרימים את הרגל הפגועה ישרה קדימה.\nכותבים באוויר עם הבוהן את האותיות א עד ת.\nתנועה גדולה מהקרסול בלבד, הברך לא זזה.',
        imageUrl: '/rehab/shin-03.png',
        sets: 2,
        reps: 'א עד ת',
      },
      {
        name: 'כיווץ מגבת באצבעות',
        instructions: 'יושבים, מגבת פרושה על הרצפה מתחת לכף הרגל.\nמקפלים את האצבעות ומושכים את המגבת אליכם. העקב נשאר על הרצפה.\nכשכל המגבת אצלכם, פורשים אותה ומתחילים שוב.',
        imageUrl: '/rehab/shin-04.png',
        sets: 2,
        reps: '',
        durationSec: 45,
      },
      calf('עליות תאומים, טווח מלא', { sets: 2, reps: '15' }),
      {
        name: 'מתיחת תאומים וסולאוס בקיר',
        instructions: 'ידיים על הקיר, הרגל הפגועה מאחור, העקב על הרצפה.\nסט 1: הברך האחורית ישרה. מטים את האגן קדימה עד מתיחה בשוק.\nסט 2: מכופפים את הברך האחורית, העקב נשאר למטה, והמתיחה יורדת נמוך יותר.\nמחזיקים בלי להקפיץ.',
        imageUrl: '/rehab/shin-05.png',
        sets: 2,
        reps: '',
        durationSec: 30,
      },
    ],
  },
  {
    phase: 2,
    name: 'חיזוק',
    when: '5-6 ימים בשבוע. עדיין בלי ריצה ובלי קפיצות.',
    nextWhen: '20 עליות תאומים על רגל אחת ו-20 צעדים על העקבים בלי כאב, 10 קפיצות קטנות במקום על שתי רגליים עם כאב 0-1, וכאב בוקר 0-2.',
    exercises: [
      {
        name: 'הרמת אצבעות בעמידה, גב לקיר',
        instructions: 'הגב והישבן על הקיר, העקבים בערך 30 ס״מ ממנו.\nמרימים את קדמת שתי כפות הרגליים לכיוון השוק ומחזיקים שנייה.\nיורדים לאט. העקבים לא זזים.',
        imageUrl: '/rehab/shin-06.png',
        sets: 3,
        reps: '15',
      },
      {
        name: 'משיכת כף רגל עם גומייה',
        instructions: 'יושבים על הרצפה, רגל ישרה.\nגומייה קשורה לרגל של שולחן או מיטה מלפנים ועוטפת את החלק העליון של כף הרגל.\nמושכים את כף הרגל אליכם נגד הגומייה, מחזיקים שנייה וחוזרים לאט.',
        imageUrl: '/rehab/shin-07.png',
        sets: 3,
        reps: '15 לכל רגל',
      },
      calf('עליות תאומים אקסצנטריות', { sets: 2, reps: '10 (סט לכל רגל)' }),
      {
        name: 'עליות תאומים בברך כפופה',
        instructions: 'יד על הקיר. הברכיים כפופות מעט ונשארות כפופות כל התרגיל.\nעולים על האצבעות, מחזיקים שנייה ויורדים לאט.\nזה הסולאוס, השריר שסופג את הנחיתה בריצה.',
        imageUrl: '/rehab/shin-08.png',
        sets: 3,
        reps: '15',
      },
      calf('הליכה על עקבים', { sets: 3, reps: '20 צעדים' }),
      calf('עמידה על רגל אחת', { sets: 2, reps: '', durationSec: 45 }),
      {
        name: 'מתיחת קדמת השוק',
        instructions: 'יורדים על הברכיים, החלק העליון של כפות הרגליים על הרצפה.\nיושבים לאט על העקבים עד מתיחה בקדמת השוק והקרסול.\nלהגביר: ידיים על הרצפה מאחור ונשענים מעט אחורה.\nכואב בברכיים: מגבת מקופלת מתחתיהן.',
        imageUrl: '/rehab/shin-09.png',
        sets: 2,
        reps: '',
        durationSec: 30,
      },
    ],
  },
  {
    phase: 3,
    name: 'עומס וקפיצות',
    when: '4-5 ימים בשבוע. הקפיצות יום כן יום לא, ורק כשהבוקר שאחרי נקי.',
    nextWhen: '30 קפיצות פוגו ו-15 קפיצות על הרגל הפגועה בלי כאב, ובבוקר שאחרי אין כאב. מתחילים בדקה ריצה ודקה הליכה, 10 פעמים, יום כן יום לא.',
    exercises: [
      {
        name: 'הרמת אצבעות על רגל אחת, גב לקיר',
        instructions: 'הגב על הקיר, עומדים על הרגל הפגועה והשנייה באוויר.\nמרימים את קדמת כף הרגל לכיוון השוק, מחזיקים שנייה ויורדים לאט.\nכל המשקל על העקב.',
        imageUrl: '/rehab/shin-10.png',
        sets: 3,
        reps: '12 לכל רגל',
      },
      {
        name: 'עליות תאומים על רגל אחת עם משקולת',
        instructions: 'קדמת כף הרגל על מדרגה, העקב באוויר.\nמשקולת ביד של הצד שעובד, היד השנייה על הקיר.\nיורדים לאט מתחת לגובה המדרגה ועולים עד הסוף.',
        imageUrl: '/rehab/shin-11.png',
        sets: 3,
        reps: '10-12 לכל רגל',
      },
      calf('עליות תאומים בישיבה', { sets: 3, reps: '12' }),
      {
        name: 'קפיצות פוגו',
        instructions: 'קפיצות קטנות ומהירות על כריות כף הרגל, שתי רגליים.\nהברכיים כמעט ישרות, הקרסוליים קפיציים, והנחיתה שקטה.\nמתחילים ב-10 ומעלים. כאב מעל 2: עוצרים להיום.',
        imageUrl: '/rehab/shin-12.png',
        sets: 3,
        reps: '20',
      },
      {
        name: 'קפיצות על רגל אחת במקום',
        instructions: 'קפיצות קטנות במקום על רגל אחת.\nנוחתים רך על כרית כף הרגל, הברך רכה.\nרק אחרי שהפוגו עובר בלי כאב.',
        imageUrl: '/rehab/shin-13.png',
        sets: 2,
        reps: '10 לכל רגל',
      },
      calf('עמידה על רגל אחת', { sets: 2, reps: '', durationSec: 45 }),
    ],
  },
]

export async function seedShinRehabProgram(createdBy: string): Promise<{ workoutIds: string[]; alreadyExisted: boolean }> {
  const existing = await getDocs(query(collection(db, 'workouts'), where('rehabPhase.program', '==', SHIN_PROGRAM)))
  if (!existing.empty) {
    return { workoutIds: existing.docs.map((d) => d.id), alreadyExisted: true }
  }

  const workoutIds: string[] = []
  for (const p of SHIN_REHAB_PHASES) {
    const blocks = await buildRehabBlocks(p.exercises, SUBCATEGORY, createdBy)
    const rehabPhase: RehabPhaseInfo = { program: SHIN_PROGRAM, programTitle: SHIN_PROGRAM_TITLE, phase: p.phase, name: p.name, nextWhen: p.nextWhen }
    const ref = await addDoc(collection(db, 'workouts'), {
      title: `${SHIN_PROGRAM_TITLE}, שלב ${p.phase}: ${p.name}`,
      type: 'rehab',
      description: `כאב בקדמת השוק (שין ספלינטס), שלב ${p.phase} מתוך ${SHIN_REHAB_PHASES.length}. ${p.when}\n${RULE}\n${RED_FLAGS}`,
      strengthBlocks: blocks,
      rehabPhase,
      libraryHidden: false,
      source: 'coach' as const,
      createdBy,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    workoutIds.push(ref.id)
  }
  return { workoutIds, alreadyExisted: false }
}
