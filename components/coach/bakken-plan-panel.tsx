'use client'

import { useState, useEffect } from 'react'
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { format, addDays, parseISO, startOfWeek } from 'date-fns'
import { toast } from 'sonner'
import { Loader2, Sparkles, X } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { useLatestStepTest } from '@/hooks/useLatestStepTest'
import { saveJourney, getJourney, stageDisplayName } from '@/lib/journey'
import { interpolateAtLactate, stepsFromPhysiologySummary } from '@/lib/physiology'
import type { WorkoutType, JourneyDoc, JourneyStage } from '@/lib/types'
import type { PlanAthleteContext, BlockStageInfo, SkeletonRequest, SkeletonOut } from '@/lib/bakken/plan-prompt'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

interface BlockWorkoutOut {
  date: string
  session?: 'am' | 'pm' | 'other'
  type: string
  title: string
  description: string
  warmup?: string | null
  cooldown?: string | null
  notes?: string | null
  duration?: number | null
  distance?: number | null
  targetThresholdLevel?: 'T1' | 'T2' | 'T3' | null
  bakkenLactateMin?: number | null
  bakkenLactateMax?: number | null
  comparisonGroup?: string | null
  thresholdDistance?: number | null
  sets?: Array<{
    reps: number
    distanceMeters?: number | null
    durationSec?: number | null
    restBetweenReps?: string | null
    restAfterSet?: string | null
    notes?: string | null
    intervals?: Array<{
      distanceMeters?: number | null
      durationSec?: number | null
      notes?: string | null
    }>
  }>
}

interface BlockPlanOut {
  blockSummary: string
  workouts: BlockWorkoutOut[]
}

interface WeekAgg {
  totalPlanned: number
  totalActual: number
  completed: number
  skipped: number
  avgEffort: number | null
}

const BLOCK_DAYS = 14
const MAX_BLOCKS = 10 // safety cap: 20 weeks of upfront generation per click

// Coach-selectable cap on how many blocks to generate per click — quick
// presets, plus a free number input for exact control (see
// GENERATION_BLOCK_PRESETS usage below). Always clamped to MAX_BLOCKS,
// which stays the hard safety ceiling no matter what the coach types.
const GENERATION_BLOCK_PRESETS = [1, 4, MAX_BLOCKS]

type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
type DayType = 'workout' | 'rest' | 'off'
const DAY_ORDER: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_TYPES: DayType[] = ['workout', 'rest', 'off']
const DAY_LABELS: Record<'en' | 'he', Record<DayKey, string>> = {
  en: { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' },
  he: { sunday: 'א׳', monday: 'ב׳', tuesday: 'ג׳', wednesday: 'ד׳', thursday: 'ה׳', friday: 'ו׳', saturday: 'ש׳' },
}
const DAY_TYPE_LABELS: Record<'en' | 'he', Record<DayType, string>> = {
  en: { workout: 'Available', rest: 'Rest day', off: "Can't run" },
  he: { workout: 'זמין', rest: 'יום מנוחה', off: 'לא זמין' },
}
const DEFAULT_WEEK_SCHEDULE: Record<DayKey, DayType> = {
  sunday: 'workout', monday: 'workout', tuesday: 'workout', wednesday: 'workout',
  thursday: 'workout', friday: 'rest', saturday: 'workout',
}

type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'professional'
type RaceDistance = '1500m' | 'mile' | '3000m' | '5k' | '10k' | '15k' | 'half_marathon' | 'marathon'
type CurrentShape = 'just_starting' | 'returning' | 'consistent' | 'peak_fitness'
const EXPERIENCE_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'professional']
const MILEAGE_PRESETS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 120, 150]
const RACE_DISTANCES: RaceDistance[] = ['1500m', 'mile', '3000m', '5k', '10k', '15k', 'half_marathon', 'marathon']
const RACE_DISTANCE_LABELS: Record<RaceDistance, string> = {
  '1500m': '1500m', mile: 'Mile', '3000m': '3000m', '5k': '5K', '10k': '10K', '15k': '15K', half_marathon: 'Half Marathon', marathon: 'Marathon',
}
// Presets are quick-fill suggestions only — goalRaceTarget is a free text
// field so a precise/competitive time isn't forced onto a round number.
const GOAL_TIME_PRESETS: Record<RaceDistance, string[]> = {
  '1500m': ['3:30', '3:45', '4:00', '4:15', '4:30', '4:45', '5:00'],
  mile: ['4:00', '4:15', '4:30', '4:45', '5:00', '5:15', '5:30'],
  '3000m': ['8:00', '8:30', '9:00', '9:30', '10:00', '11:00', '12:00'],
  '5k': ['16:00', '18:00', '20:00', '22:00', '25:00', '28:00', '32:00'],
  '10k': ['34:00', '38:00', '42:00', '46:00', '50:00', '55:00', '60:00'],
  '15k': ['50:00', '55:00', '1:00:00', '1:05:00', '1:10:00', '1:15:00', '1:20:00'],
  half_marathon: ['1:15:00', '1:25:00', '1:35:00', '1:45:00', '1:55:00', '2:10:00', '2:30:00'],
  marathon: ['2:45:00', '3:00:00', '3:15:00', '3:30:00', '3:45:00', '4:00:00', '4:30:00', '5:00:00'],
}
const CURRENT_SHAPES: CurrentShape[] = ['just_starting', 'returning', 'consistent', 'peak_fitness']
const CURRENT_SHAPE_LABELS: Record<CurrentShape, string> = {
  just_starting: 'Just starting out', returning: 'Returning after a break', consistent: 'Training consistently', peak_fitness: 'Peak fitness / just raced',
}
// Coach-set preference for how long the long run should be, in minutes —
// passed to the brain as a constraint rather than left entirely to it.
const LONG_RUN_MINUTES_PRESETS = [45, 60, 75, 90, 105, 120, 150, 180]

// This panel's OWN UI chrome (headings, buttons, hints) — follows the
// coach's actual app language (useLanguage() below), which is a SEPARATE
// setting from "Plan language" (summary.language), the language the
// GENERATED workouts get written in for the athlete. Coaching this app in
// Hebrew while this panel stayed hardcoded English was the bug.
const UI = {
  en: {
    cardTitle: 'Bakken AI Coach',
    cardDesc: "Builds the athlete's full season upfront — phase skeleton from their goal race, day-by-day workouts from the Bakken/Almgren brain, lab-derived pace/HR targets. Writes directly to the planner. The athlete only sees the first 2 weeks; the rest reveals automatically every Saturday.",
    knowsAbout: (name: string) => `Everything Bakken AI knows about ${name} — edit here before generating if it changed`,
    planLanguage: 'Plan language (workout text, warmup/cooldown, notes)',
    experienceLevel: 'Experience level',
    weeklyMileage: 'Starting weekly mileage (km) — what the season ramps up FROM',
    weeklyMileageHint: "Your number here always wins as the season's starting point, even if recent logged runs were lower (e.g. the athlete was injured/traveling and you know their real base). Leave it blank to let real logged history from the last 3 weeks set it automatically instead.",
    injuryHistory: 'Injury history',
    injuryPlaceholder: 'Any current or recurring injuries?',
    currentShapeLabel: 'Current shape',
    goalTimePlaceholder: 'e.g. 3:30:00',
    longRunLabel: 'Long run cap (minutes)',
    longRunNone: 'No cap',
    longRunDayLabel: 'Long run day (hard rule — every week)',
    longRunDayNone: "AI decides",
    goalDistance: 'Goal race distance',
    raceName: 'Race name (optional)',
    raceNamePlaceholder: 'e.g. Tel Aviv Marathon',
    raceDate: 'Race date',
    goalTime: 'Goal time',
    pickDistanceFirst: 'Pick a goal distance first',
    recentPRs: 'Recent PRs: ',
    labTestYes: '✓ Lab step test on file — Bakken AI will compute exact lab-derived pace/HR targets for every quality session.',
    labTestNoBase: 'No lab step test on file. Not required — Bakken AI will fall back to HR% / talk test / RPE (per the brain\'s intensity_triangulation)',
    labTestNoPRs: ', anchored to the recent PRs above.',
    labTestNoPlain: ' and coarse pace bands.',
    labTestNoSuffix: " A lactate step test (Lab tab) would sharpen every target once you're ready for one.",
    coachNotesLabel: 'Coach notes for Bakken AI (private, never shown to athlete)',
    save: 'Save',
    coachNotesPlaceholder: 'Anything the brain should know for this athlete specifically — e.g. recovering from IT band issue, prefers mornings, has a 10K tune-up race in week 6...',
    availability: 'Availability (edit before generating if needed)',
    availabilityLoaded: 'Loaded from athlete onboarding — adjust here if it changed.',
    loading: 'Loading...',
    generateBtn: 'Generate',
    generationScopeLabel: 'How many blocks to generate this click (1 block ≈ 2 weeks)',
    generationBlocksCustomPlaceholder: 'Or type exact number of blocks',
    fullSeasonBtn: (n: number) => `Full season (${n})`,
    testRaceTitle: 'Test race / time trial (optional)',
    testRaceHint: "A tune-up race mid-season — I'll add a short light taper before it and get straight back to the normal plan after, no full peak taper.",
    testRaceEventLabel: 'Event name',
    testRaceDateLabel: 'Date',
    testRaceDistanceLabel: 'Distance',
    notesSaved: 'Notes saved',
    notesFailed: 'Failed to save notes',
    profileNotFound: 'Athlete profile not found',
    clearingPrevious: 'Clearing previous Bakken-generated season...',
    continuingSeason: (from: string) => `Continuing existing season from ${from}...`,
    seasonAlreadyComplete: 'This season is already fully generated through the goal race — nothing left to add.',
    forceRestartLabel: 'Start over from scratch (wipes and rebuilds the whole season instead of continuing it)',
    setGoalRaceFirst: "Set a Goal Race Date for this athlete first — go to their profile page → Profile tab → Edit Profile → Goal Race Date — then generate the Bakken season plan.",
    designingSkeleton: 'Designing season skeleton...',
    skeletonFailed: (err: string) => `Skeleton generation failed: ${err}. Try again.`,
    blockFailed: (n: number, err: string, written: number) => `Block ${n} failed: ${err}. ${written} workouts from earlier blocks are already saved.`,
    generatingBlock: (from: string, to: string, i: number, total: number) => `Generating ${from} → ${to} (block ${i}/${total})...`,
    seasonWritten: (n: number) => `Bakken season plan written: ${n} workouts`,
    generateFailed: 'Failed to generate Bakken AI plan',
    weekBreakdownTitle: 'Week-by-week breakdown',
    weekBreakdownHint: 'Week 1 starts on the season start date shown below, whatever weekday that is — not the calendar week.',
    weekCol: 'Week',
    datesCol: 'Dates',
    phaseCol: 'Phase',
    targetKmCol: 'Target km',
    seasonStarts: (d: string) => `Season starts ${d}`,
    mileageCustomPlaceholder: 'Or type exact km/week',
    addPrTitle: 'Add a race result',
    prDistanceLabel: 'Distance',
    prTimeLabel: 'Finish time',
    prHours: 'hours', prMinutes: 'minutes', prSeconds: 'seconds',
    prDateLabel: 'Date',
    addBtn: 'Add',
    removeBtn: 'Remove',
    noPRsYet: 'No race results yet.',
  },
  he: {
    cardTitle: 'מאמן AI בקן',
    cardDesc: 'בונה מראש את כל העונה של הספורטאי — שלד שלבים לפי מירוץ היעד, אימונים יום-אחר-יום מהמוח של בקן/אלמגרן, יעדי קצב/דופק מבוססי מעבדה. כותב ישירות ללוח האימונים. הספורטאי רואה רק את השבועיים הראשונים; השאר נחשף אוטומטית כל שבת.',
    knowsAbout: (name: string) => `כל מה שמאמן ה-AI של בקן יודע על ${name} — ניתן לערוך כאן לפני היצירה אם משהו השתנה`,
    planLanguage: 'שפת התוכנית (טקסט האימון, חימום/שחרור, הערות)',
    experienceLevel: 'רמת ניסיון',
    weeklyMileage: 'ק"מ שבועי התחלתי — ממנו התוכנית בונה עלייה',
    weeklyMileageHint: 'המספר שתזינו כאן תמיד יקבע את נקודת ההתחלה של העונה, גם אם הריצות האחרונות שנרשמו היו נמוכות יותר (למשל אם הספורטאי היה פצוע/בנסיעה ואתם יודעים מה הבסיס האמיתי שלו). השאירו ריק כדי לתת להיסטוריית הריצות האמיתית מ-3 השבועות האחרונים לקבוע זאת אוטומטית.',
    injuryHistory: 'היסטוריית פציעות',
    injuryPlaceholder: 'פציעות נוכחיות או חוזרות?',
    currentShapeLabel: 'כושר נוכחי',
    goalTimePlaceholder: 'לדוגמה: 3:30:00',
    longRunLabel: 'תקרת ריצה ארוכה (דקות)',
    longRunNone: 'ללא תקרה',
    longRunDayLabel: 'יום הריצה הארוכה (כלל קבוע — כל שבוע)',
    longRunDayNone: 'ה-AI מחליט',
    goalDistance: 'מרחק היעד',
    raceName: 'שם המירוץ (לא חובה)',
    raceNamePlaceholder: 'לדוגמה: מרתון תל אביב',
    raceDate: 'תאריך המירוץ',
    goalTime: 'זמן יעד',
    pickDistanceFirst: 'בחר/י מרחק יעד קודם',
    recentPRs: 'שיאים אחרונים: ',
    labTestYes: '✓ בדיקת מדרגות מעבדה קיימת — מאמן ה-AI יחשב יעדי קצב/דופק מדויקים מבוססי מעבדה לכל אימון איכות.',
    labTestNoBase: 'אין בדיקת מדרגות מעבדה. לא חובה — מאמן ה-AI ייעזר בדופק%/מבחן שיחה/RPE (לפי המוח, intensity_triangulation)',
    labTestNoPRs: ', מעוגן לשיאים האחרונים למעלה.',
    labTestNoPlain: ' ורצועות קצב גסות.',
    labTestNoSuffix: ' בדיקת מדרגות לקטט (לשונית מעבדה) תחדד כל יעד כשתהיו מוכנים.',
    coachNotesLabel: 'הערות מאמן למאמן ה-AI (פרטי, לא מוצג לספורטאי)',
    save: 'שמור',
    coachNotesPlaceholder: 'כל דבר שהמוח צריך לדעת על הספורטאי הזה ספציפית — למשל: מחלים מפציעת IT band, מעדיף בקרים, יש לו מירוץ הכנה של 10 ק"מ בשבוע 6...',
    availability: 'זמינות (ניתן לערוך לפני היצירה)',
    availabilityLoaded: 'נטען מהאונבורדינג של הספורטאי — התאם כאן אם השתנה.',
    loading: 'טוען...',
    generateBtn: 'צור',
    generationScopeLabel: 'כמה בלוקים ליצור בלחיצה הזו (בלוק אחד ≈ שבועיים)',
    generationBlocksCustomPlaceholder: 'או הקלד/י מספר בלוקים מדויק',
    fullSeasonBtn: (n: number) => `עונה מלאה (${n})`,
    testRaceTitle: 'מירוץ הכנה / מבחן זמן (לא חובה)',
    testRaceHint: 'מירוץ הכנה באמצע העונה — אוסיף טייפר קל וקצר לפניו ואחזור מיד לתוכנית הרגילה אחריו, בלי טייפר מלא כמו לפני מירוץ היעד.',
    testRaceEventLabel: 'שם האירוע',
    testRaceDateLabel: 'תאריך',
    testRaceDistanceLabel: 'מרחק',
    notesSaved: 'ההערות נשמרו',
    notesFailed: 'שמירת ההערות נכשלה',
    profileNotFound: 'פרופיל הספורטאי לא נמצא',
    clearingPrevious: 'מנקה עונה קודמת שנוצרה על ידי בקן...',
    continuingSeason: (from: string) => `ממשיך את העונה הקיימת מ-${from}...`,
    seasonAlreadyComplete: 'העונה הזו כבר נוצרה במלואה עד מירוץ היעד — אין מה להוסיף.',
    forceRestartLabel: 'להתחיל מחדש לגמרי (מוחק ובונה את כל העונה מחדש במקום להמשיך)',
    setGoalRaceFirst: 'קבע/י תאריך מירוץ יעד לספורטאי קודם — לך/י לעמוד הפרופיל שלו ← לשונית פרופיל ← עריכת פרופיל ← תאריך מירוץ יעד — ואז צור/י את תוכנית העונה של בקן.',
    designingSkeleton: 'מתכנן שלד עונה...',
    skeletonFailed: (err: string) => `יצירת השלד נכשלה: ${err}. נסה/י שוב.`,
    blockFailed: (n: number, err: string, written: number) => `בלוק ${n} נכשל: ${err}. ${written} אימונים מבלוקים קודמים כבר נשמרו.`,
    generatingBlock: (from: string, to: string, i: number, total: number) => `יוצר ${from} → ${to} (בלוק ${i}/${total})...`,
    seasonWritten: (n: number) => `תוכנית העונה של בקן נכתבה: ${n} אימונים`,
    generateFailed: 'יצירת תוכנית ה-AI של בקן נכשלה',
    weekBreakdownTitle: 'פירוט שבועי',
    weekBreakdownHint: 'שבוע 1 מתחיל בתאריך תחילת העונה המוצג למטה, יהיה אשר יהיה יום השבוע — לא בשבוע הקלנדרי.',
    weekCol: 'שבוע',
    datesCol: 'תאריכים',
    phaseCol: 'שלב',
    mileageCustomPlaceholder: 'או הקלד/י ק"מ מדויק',
    addPrTitle: 'הוספת תוצאת מירוץ',
    prDistanceLabel: 'מרחק',
    prTimeLabel: 'זמן סיום',
    prHours: 'שעות', prMinutes: 'דקות', prSeconds: 'שניות',
    prDateLabel: 'תאריך',
    addBtn: 'הוסף',
    removeBtn: 'הסר',
    noPRsYet: 'עדיין אין תוצאות מירוץ.',
    targetKmCol: 'ק"מ יעד',
    seasonStarts: (d: string) => `העונה מתחילה ב-${d}`,
  },
} as const

// The athlete's own view (components/athlete/athlete-planner-view.tsx) reads
// the LEGACY STRING fields on sets/intervals (set.distance, set.duration,
// set.pace, iv.distance, iv.duration, iv.pace) to render the "5× 1000m"
// style line — it does NOT read distanceMeters/durationSec directly for
// display, only for pace calculations elsewhere. Without these, every
// generated set/interval rendered blank to the athlete. Formatted here
// (not by the model) so unit words stay correctly in the athlete's language
// without depending on the model getting it right every time.
const formatMetersStr = (m: number, lang: 'en' | 'he') => (lang === 'he' ? `${m} מ׳` : `${m}m`)
const formatSecondsStr = (sec: number, lang: 'en' | 'he') => {
  if (sec >= 60 && sec % 60 === 0) {
    const min = sec / 60
    return lang === 'he' ? `${min} דק׳` : `${min} min`
  }
  return lang === 'he' ? `${sec} שנ׳` : `${sec}s`
}

const addDaysStr = (dateStr: string, n: number) => format(addDays(parseISO(dateStr), n), 'yyyy-MM-dd')
const dateMin = (a: string, b: string) => (a < b ? a : b)
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart
const localId = (prefix: string) =>
  `${prefix}_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random()}`

// The model asking it to "check the weekly sum" in the prompt (see rule 3 in
// plan-prompt.ts) isn't reliable enough on its own — weekly totals kept
// drifting well off the stage's weeklyVolumeKm target in practice. This is
// the deterministic backstop: after generation, actually sum each calendar
// week's distance and rescale if it's off by more than 15%, instead of
// trusting the model's arithmetic. Only touches flexible-distance sessions
// (easy/long_run/recovery) — never the rep structure (sets/intervals) on a
// structured session, so "5x6min" stays "5x6min". Rescales `duration`
// alongside `distance` by the same factor so pace stays what it was —
// distance-only rescaling used to silently turn a normal-paced long run
// into an impossibly fast one once its distance got stretched.
// Every Nth week within a base/build/peak stage gets its flexible-volume
// target cut by 25% — a standard cutback/deload week so fatigue can
// actually absorb into fitness instead of accumulating in one uninterrupted
// ramp for the whole stage. Nothing in the brain or the prompt handled this
// at all before (verified: no "cutback"/"deload"/"recovery week" mention
// anywhere in brain.json or plan-prompt.ts) — this is a genuine gap, not a
// prompt-reliability issue, so it's implemented directly here rather than
// left to the model to remember across every block-generation call.
// Beginners/recreational athletes cut back more often (every 3rd week,
// less fatigue tolerance) than everyone else (every 4th).
const CUTBACK_STAGE_TYPES = new Set(['base', 'build', 'peak'])
const CUTBACK_VOLUME_MULTIPLIER = 0.75
const isCutbackWeek = (
  weekStart: string,
  stage: BlockStageInfo,
  experienceLevel: string | undefined,
): boolean => {
  if (!CUTBACK_STAGE_TYPES.has(stage.type)) return false
  const interval = experienceLevel === 'beginner' ? 3 : 4
  const weeksSinceStageStart = Math.floor(
    (parseISO(weekStart).getTime() - parseISO(stage.startDate).getTime()) / (7 * 86400000),
  )
  const weekNumber = weeksSinceStageStart + 1 // 1-indexed
  return weekNumber > 0 && weekNumber % interval === 0
}

const normalizeWeeklyVolume = (
  workouts: BlockWorkoutOut[],
  stagesForBlock: BlockStageInfo[],
  seasonStartDate: string,
  goalRaceDate: string,
  longRunMinutesCap?: number,
  experienceLevel?: string,
): BlockWorkoutOut[] => {
  // Weeks are standard Sunday-Saturday calendar weeks — matching the km-per-
  // week widgets and week view everywhere else in the app (they all default
  // to weekStartsOn: 0). A season that doesn't start on a Sunday still gets
  // a short first calendar week (and block boundaries in generate() are
  // aligned to Sunday too, so that short week is never split across two
  // separate block-generation calls) — its target here is prorated by how
  // many of its 7 days actually fall within the season, not the full
  // 7-day target, so a 4-day stub week isn't held to a whole week's km.
  const weekKeyOf = (dateStr: string) => format(startOfWeek(parseISO(dateStr), { weekStartsOn: 0 }), 'yyyy-MM-dd')
  const weeks = new Map<string, BlockWorkoutOut[]>()
  for (const w of workouts) {
    const key = weekKeyOf(w.date)
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key)!.push(w)
  }
  // Only "easy"/"long_run"/"recovery" days have a genuinely flexible
  // distance — run a bit longer or shorter and the session is still
  // exactly what it says. tempo/threshold/intervals/hill_repeats/fartlek
  // are the OPPOSITE: their distance is a fixed consequence of a specific
  // rep count at a specific pace (e.g. 5x6min at threshold pace is
  // whatever km that comes out to, not a number you can freely dial up or
  // down without changing the actual structure). Rescaling those distances
  // to hit a weekly total produced physically impossible sessions in
  // practice — verified: a 5x6min threshold session and an 8x(1min/1min)
  // fartlek both got inflated to ~19km, nothing close to what those reps
  // actually cover. So the weekly-volume gap is only ever closed by
  // adjusting the flexible-distance days; structured session distances are
  // never touched here (they should already be realistic from the prompt
  // — see rule 12b in plan-prompt.ts — and if the model gets one wrong,
  // that's a prompt-accuracy problem, not something to paper over by
  // silently stretching an interval session into an impossible distance).
  const FLEXIBLE_DISTANCE_TYPES = new Set(['easy', 'long_run', 'recovery'])
  for (const [weekStart, items] of weeks) {
    const midweek = addDaysStr(weekStart, 3)
    const stage = stagesForBlock.find((s) => midweek >= s.startDate && midweek <= s.endDate)
    if (!stage?.weeklyVolumeKm) continue
    const weekEnd = addDaysStr(weekStart, 6)
    const rangeStart = weekStart < seasonStartDate ? seasonStartDate : weekStart
    const rangeEnd = dateMin(weekEnd, goalRaceDate)
    const daysInSeason = Math.max(0, Math.min(7,
      Math.floor((parseISO(rangeEnd).getTime() - parseISO(rangeStart).getTime()) / 86400000) + 1))
    const cutback = isCutbackWeek(weekStart, stage, experienceLevel)
    const target = stage.weeklyVolumeKm * (daysInSeason / 7) * (cutback ? CUTBACK_VOLUME_MULTIPLIER : 1)
    if (target <= 0) continue

    const flexibleItems = items.filter((w) => FLEXIBLE_DISTANCE_TYPES.has(w.type))
    const fixedTotal = items
      .filter((w) => !FLEXIBLE_DISTANCE_TYPES.has(w.type))
      .reduce((sum, w) => sum + (w.distance || 0), 0)
    const flexibleTarget = target - fixedTotal
    if (flexibleTarget <= 0) continue // fixed-structure sessions alone already meet/exceed target — nothing to add via easy days

    const flexibleActual = flexibleItems.reduce((sum, w) => sum + (w.distance || 0), 0)
    if (flexibleActual <= 0) continue
    const ratio = flexibleActual / flexibleTarget
    if (ratio > 1.15 || ratio < 0.85) {
      const scale = flexibleTarget / flexibleActual
      for (const w of flexibleItems) {
        if (w.distance == null) continue
        // Scale duration by the SAME factor as distance so the implied pace
        // stays what it was — scaling distance alone (the old behavior)
        // left duration untouched, which silently turned a normal ~5:00/km
        // long run into something like 3:34/km once its distance got
        // stretched to close a weekly-volume gap. Verified in production:
        // a 100min long run scaled to 28km this way, an impossible pace for
        // a session described as "very relaxed".
        const originalDistance = w.distance
        const originalDuration = w.duration
        w.distance = Math.max(1, Math.round(originalDistance * scale))
        if (originalDuration != null) {
          w.duration = Math.max(5, Math.round((originalDuration * scale) / 5) * 5)
          // The long run duration cap (athlete_context.longRunMinutes, rule
          // 12) is a hard ceiling the model is supposed to respect on its
          // own, but this rescale can push it past that after the fact —
          // clamp duration back to the cap and recompute distance to match
          // the ORIGINAL pace at that shorter duration, rather than leaving
          // an over-cap duration or a now-inconsistent pace.
          if (w.type === 'long_run' && longRunMinutesCap && w.duration > longRunMinutesCap && originalDuration > 0) {
            w.duration = longRunMinutesCap
            w.distance = Math.max(1, Math.round(originalDistance * (longRunMinutesCap / originalDuration)))
          }
        }
      }
    }
  }
  return workouts
}

const DAY_INDEX: Record<DayKey, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}

// The prompt tells the model 'rest'/'off' days in weekSchedule are a hard
// rule (see rule 2 in plan-prompt.ts), but verified in practice it still
// trains on them anyway — same unreliability as longRunDay below.
// Deterministic backstop: find every day where the model put real
// training on a rest/off day, and every day where it left a *workout* day
// empty (typed "rest" when weekSchedule said the athlete could train) —
// pair them up and swap dates, so the actual training content just moves
// to the correct day instead of being lost. Only forces an outright
// conversion to "rest" (nulling out the session) when there are more
// misplaced-training days than empty-workout-days to swap with, which
// shouldn't normally happen since both counts are driven by the same
// 7-day week.
const enforceWeekSchedule = (workouts: BlockWorkoutOut[], weekSchedule: Record<DayKey, DayType> | undefined, language: 'en' | 'he'): BlockWorkoutOut[] => {
  if (!weekSchedule) return workouts
  const dayTypeOf = (dateStr: string): DayType => weekSchedule[DAY_ORDER[parseISO(dateStr).getDay()]]
  const isRestDay = (dateStr: string) => dayTypeOf(dateStr) !== 'workout'

  const misplacedTraining = workouts.filter((w) => w.type !== 'rest' && isRestDay(w.date))
  const emptyWorkoutDays = workouts.filter((w) => w.type === 'rest' && !isRestDay(w.date))

  const swapCount = Math.min(misplacedTraining.length, emptyWorkoutDays.length)
  for (let i = 0; i < swapCount; i++) {
    const a = misplacedTraining[i]
    const b = emptyWorkoutDays[i]
    const aDate = a.date
    a.date = b.date
    b.date = aDate
  }

  for (let i = swapCount; i < misplacedTraining.length; i++) {
    const w = misplacedTraining[i]
    w.type = 'rest'
    w.title = language === 'he' ? 'יום מנוחה' : 'Rest Day'
    w.description = ''
    w.duration = null
    w.distance = null
    w.sets = []
    w.bakkenLactateMin = null
    w.bakkenLactateMax = null
    w.targetThresholdLevel = null
    w.comparisonGroup = null
    w.thresholdDistance = null
  }

  return workouts
}

// The prompt tells the model longRunDay is a hard rule (see rule 2 in
// plan-prompt.ts), but in practice it still occasionally misses a week —
// same story as weekly volume. Deterministic backstop: for each Sun-Sat
// week, exactly one long_run should exist, on longRunDay.
//   - 2+ long_run entries in the same week (a real bug seen in practice —
//     the model duplicated it onto a second day): keep whichever one is
//     already on longRunDay (or the first one if none is), demote every
//     other long_run that week to a plain easy day instead of leaving two
//     long runs in the same week.
//   - exactly 1 long_run, wrong day: swap dates with whatever's currently
//     on longRunDay (full session content moves with it, only the two
//     dates trade places).
//   - 0 long_run: nothing safe to do, skip (can't invent a session).
// Skips the date-swap step if the target weekday isn't present in this
// block's data at all (only happens at a season/goal-race boundary).
// Rule 11 says AM is always the easier, T1-anchored half of a double-
// threshold day and PM is the harder one (T1-ish early season, sharpening
// toward T2 later) — this is the hard invariant the coach actually cares
// about (confirmed explicitly: "keep the AM easier T1 and PM can be T1 or
// faster around T2"). Verified in testing that duration is NOT a safe proxy
// for this — the model sometimes picks a PM rep-format that happens to run
// a few minutes longer than AM's even though the ZONE (T1 vs T2) was
// already correct; swapping on duration in that case would flip a correct
// T1-AM/T2-PM pairing into a wrong T2-AM/T1-PM one, which is worse, not
// better. Swap on LACTATE instead — the actual thing that must stay
// correct: if AM's assigned lactate ends up higher than PM's (i.e. AM
// somehow became the harder session), swap which full session sits in
// which slot so AM always ends up the lower-lactate (easier) one.
const enforceAmPmOrder = (workouts: BlockWorkoutOut[]): BlockWorkoutOut[] => {
  const byDate = new Map<string, { am?: BlockWorkoutOut; pm?: BlockWorkoutOut }>()
  for (const w of workouts) {
    if (w.session !== 'am' && w.session !== 'pm') continue
    if (!byDate.has(w.date)) byDate.set(w.date, {})
    byDate.get(w.date)![w.session] = w
  }
  for (const { am, pm } of byDate.values()) {
    if (!am || !pm) continue
    if (am.bakkenLactateMin == null || pm.bakkenLactateMin == null) continue
    if (am.bakkenLactateMin <= pm.bakkenLactateMin) continue
    const amDate = am.date
    const pmDate = pm.date
    const amCopy: BlockWorkoutOut = { ...am }
    const pmCopy: BlockWorkoutOut = { ...pm }
    Object.assign(am, pmCopy, { date: amDate, session: 'am' as const })
    Object.assign(pm, amCopy, { date: pmDate, session: 'pm' as const })
  }
  return workouts
}

const enforceLongRunDay = (workouts: BlockWorkoutOut[], longRunDay: DayKey | undefined, language: 'en' | 'he'): BlockWorkoutOut[] => {
  if (!longRunDay) return workouts
  const weekKeyOf = (dateStr: string) => format(startOfWeek(parseISO(dateStr), { weekStartsOn: 0 }), 'yyyy-MM-dd')
  const weeks = new Map<string, BlockWorkoutOut[]>()
  for (const w of workouts) {
    const key = weekKeyOf(w.date)
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key)!.push(w)
  }
  for (const [weekStart, items] of weeks) {
    const longRuns = items.filter((w) => w.type === 'long_run')
    if (longRuns.length === 0) continue
    if (longRuns.length > 1) {
      const targetDate = addDaysStr(weekStart, DAY_INDEX[longRunDay])
      const keeper = longRuns.find((w) => w.date === targetDate) ?? longRuns[0]
      for (const extra of longRuns) {
        if (extra === keeper) continue
        extra.type = 'easy'
        extra.title = language === 'he' ? 'ריצה קלה' : 'Easy Run'
        extra.description = language === 'he'
          ? 'ריצה קלה ורגועה, מתחת לסף T1.'
          : 'Easy, relaxed running, below your T1 threshold.'
        extra.sets = []
        extra.bakkenLactateMin = 1.0
        extra.bakkenLactateMax = 1.2
        extra.targetThresholdLevel = null
        extra.comparisonGroup = null
        extra.thresholdDistance = null
      }
    }
    const lr = longRuns.find((w) => w.type === 'long_run') // re-check after any demotions above
    if (!lr) continue
    const targetDate = addDaysStr(weekStart, DAY_INDEX[longRunDay])
    if (lr.date === targetDate) continue
    const targetItem = items.find((w) => w.date === targetDate && w !== lr)
    if (!targetItem) continue
    const lrDate = lr.date
    lr.date = targetItem.date
    targetItem.date = lrDate
  }
  return workouts
}

// Same Sun-Sat calendar-week convention as normalizeWeeklyVolume and the
// block-splitting in generate() — week 1 is a short stub (journey.startDate
// through that week's Saturday) when the season doesn't start on a Sunday,
// every week after that is a full Sun-Sat week.
const computeWeekBreakdown = (journey: JourneyDoc) => {
  const weeks: { weekNum: number; start: string; end: string; stage: JourneyStage | undefined }[] = []
  let cursor = journey.startDate
  let weekNum = 1
  const firstDow = parseISO(cursor).getDay() // 0=Sun..6=Sat
  if (firstDow !== 0 && cursor <= journey.goalRaceDate) {
    const stubEnd = dateMin(addDaysStr(cursor, 6 - firstDow), journey.goalRaceDate)
    const midweek = dateMin(addDaysStr(cursor, 3), journey.goalRaceDate)
    const stage = journey.stages.find((s) => midweek >= s.startDate && midweek <= s.endDate)
    weeks.push({ weekNum, start: cursor, end: stubEnd, stage })
    cursor = addDaysStr(stubEnd, 1)
    weekNum++
  }
  while (cursor <= journey.goalRaceDate && weeks.length < 200) {
    const end = dateMin(addDaysStr(cursor, 6), journey.goalRaceDate)
    const midweek = dateMin(addDaysStr(cursor, 3), journey.goalRaceDate)
    const stage = journey.stages.find((s) => midweek >= s.startDate && midweek <= s.endDate)
    weeks.push({ weekNum, start: cursor, end, stage })
    cursor = addDaysStr(end, 1)
    weekNum++
  }
  return weeks
}

/**
 * Full-season Bakken/Almgren plan generator. ONE brain (lib/bakken/brain.json)
 * drives everything: a one-shot call decides the season's periodization
 * skeleton (phase lengths, volume ramp, key workout types — see
 * buildSkeletonSystemPrompt in lib/bakken/plan-prompt.ts), saved as the
 * athlete's normal JourneyDoc so the rest of the app (season view, rest-week
 * cadence, etc.) sees it exactly like any coach-built journey. Only the
 * calendar-date arithmetic (turning "8 weeks" into real yyyy-MM-dd ranges)
 * happens in code — that's not a coaching decision. Day-by-day workout
 * content is then filled in by calling the same brain once per ~14-day
 * block, writing directly to workouts/assignedWorkouts — no coach review
 * step. The app's existing visibleWeeksAhead mechanism (rolls forward every
 * Saturday) is what keeps the athlete from seeing past the first 2 weeks;
 * nothing new was built for that part.
 */
interface AthleteSummary {
  name: string
  language: 'en' | 'he'
  experienceLevel: ExperienceLevel | ''
  weeklyMileage?: number
  injuryHistory: string
  currentShape: CurrentShape | ''
  longRunMinutes?: number
  longRunDay?: DayKey
  goalRaceEvent: string
  goalRaceDistance: RaceDistance | ''
  goalRaceDate: string
  goalRaceTarget: string
  testRaceEvent: string
  testRaceDistance: RaceDistance | ''
  testRaceDate: string
  physiology?: {
    lt1PaceSec?: number | null; lt1Hr?: number | null
    lt2PaceSec?: number | null; lt2Hr?: number | null
    lt3PaceSec?: number | null; lt3Hr?: number | null
    testDate?: string
  }
  personalRecords: Array<{ event: string; time: string; date: string }>
}

const formatPace = (sec?: number | null) => {
  if (!sec) return null
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

export function BakkenPlanPanel({ athleteId }: { athleteId: string }) {
  const { user } = useAuth()
  const { language: uiLang } = useLanguage()
  const t = UI[uiLang]
  const { steps: labSteps } = useLatestStepTest(athleteId)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [lastSummary, setLastSummary] = useState<string | null>(null)
  const [weekSchedule, setWeekSchedule] = useState<Record<DayKey, DayType>>(DEFAULT_WEEK_SCHEDULE)
  const [generationBlocks, setGenerationBlocks] = useState<number>(MAX_BLOCKS)
  const [forceRestart, setForceRestart] = useState(false)
  const [scheduleLoaded, setScheduleLoaded] = useState(false)
  const [summary, setSummary] = useState<AthleteSummary | null>(null)
  const [coachNotes, setCoachNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  const [journeyPreview, setJourneyPreview] = useState<JourneyDoc | null>(null)
  const [prDistance, setPrDistance] = useState<RaceDistance | ''>('')
  const [prHours, setPrHours] = useState(0)
  const [prMinutes, setPrMinutes] = useState<number | ''>('')
  const [prSeconds, setPrSeconds] = useState<number | ''>('')
  const [prDate, setPrDate] = useState(new Date().toISOString().slice(0, 10))

  const addPersonalRecord = () => {
    if (!summary || !prDistance) return
    const m = prMinutes === '' ? 0 : prMinutes
    const s = prSeconds === '' ? 0 : prSeconds
    if (prHours === 0 && m === 0 && s === 0) return
    const pad = (n: number) => String(n).padStart(2, '0')
    const time = prHours > 0 ? `${prHours}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
    setSummary({
      ...summary,
      personalRecords: [{ event: RACE_DISTANCE_LABELS[prDistance], time, date: prDate }, ...summary.personalRecords],
    })
    setPrDistance(''); setPrHours(0); setPrMinutes(''); setPrSeconds('')
  }
  const removePersonalRecord = (idx: number) => {
    if (!summary) return
    setSummary({ ...summary, personalRecords: summary.personalRecords.filter((_, i) => i !== idx) })
  }

  // Let the coach review/adjust the athlete's availability — and see
  // everything else the brain will actually use — right before
  // generating, instead of only being able to change it via the athlete's
  // own onboarding flow or having to guess what data exists.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const snap = await getDoc(doc(db, 'users', athleteId))
      if (cancelled || !snap.exists()) return
      const d = snap.data() as any
      if (d.weekSchedule && DAY_ORDER.every((day) => d.weekSchedule[day])) {
        const collapsed = Object.fromEntries(
          DAY_ORDER.map((day) => [day, d.weekSchedule[day] === 'off' ? 'off' : d.weekSchedule[day] === 'rest' ? 'rest' : 'workout']),
        ) as Record<DayKey, DayType>
        setWeekSchedule(collapsed)
      }
      if (typeof d.bakkenGenerationBlocks === 'number') setGenerationBlocks(Math.min(Math.max(1, d.bakkenGenerationBlocks), MAX_BLOCKS))
      setSummary({
        name: d.name || 'Athlete',
        language: d.preferredLanguage === 'en' ? 'en' : 'he',
        experienceLevel: EXPERIENCE_LEVELS.includes(d.experienceLevel) ? d.experienceLevel : '',
        weeklyMileage: d.weeklyMileage,
        injuryHistory: d.injuryHistory || '',
        currentShape: CURRENT_SHAPES.includes(d.currentShape) ? d.currentShape : '',
        longRunMinutes: d.longRunMinutes,
        longRunDay: DAY_ORDER.includes(d.longRunDay) ? d.longRunDay : undefined,
        goalRaceEvent: d.goalRaceEvent || '',
        goalRaceDistance: RACE_DISTANCES.includes(d.goalRaceDistance) ? d.goalRaceDistance : '',
        goalRaceDate: d.goalRaceDate || '',
        goalRaceTarget: d.goalRaceTarget || '',
        testRaceEvent: d.testRaceEvent || '',
        testRaceDistance: RACE_DISTANCES.includes(d.testRaceDistance) ? d.testRaceDistance : '',
        testRaceDate: d.testRaceDate || '',
        physiology: d.physiology,
        personalRecords: Array.isArray(d.personalRecords)
          ? d.personalRecords.slice(0, 5).map((p: any) => ({ event: p.event, time: p.time, date: p.date }))
          : [],
      })
      setCoachNotes(d.coachPrivateNotes || '')
      setScheduleLoaded(true)
    }
    load()
    getJourney(athleteId, 'bakken_season').then((j) => { if (!cancelled) setJourneyPreview(j) })
    return () => { cancelled = true }
  }, [athleteId])

  const setDayType = (day: DayKey, type: DayType) => setWeekSchedule((s) => ({ ...s, [day]: type }))
  const setAthleteField = <K extends keyof AthleteSummary>(key: K, value: AthleteSummary[K]) =>
    setSummary((s) => (s ? { ...s, [key]: value } : s))

  const saveCoachNotes = async () => {
    setSavingNotes(true)
    try {
      await updateDoc(doc(db, 'users', athleteId), { coachPrivateNotes: coachNotes })
      toast.success(t.notesSaved)
    } catch {
      toast.error(t.notesFailed)
    } finally {
      setSavingNotes(false)
    }
  }

  // A full multi-point step test is the gold standard, but a coach's own
  // manually-entered T1/T2/T3 estimate (athlete-physiology.tsx's "manual"
  // save path, source:'manual') is also a real, usable basis for computing
  // personalized pace/HR targets — same interpolation math (rule 6b in
  // plan-prompt.ts), just a shorter curve. Treat either as "has real data".
  const manualPhysiologySteps = stepsFromPhysiologySummary(summary?.physiology)
  const effectiveLabSteps = labSteps && labSteps.length >= 2 ? labSteps : manualPhysiologySteps
  const hasLabTest = !!effectiveLabSteps && effectiveLabSteps.length >= 2

  const buildWeekSummary = (
    recentAssigned: any[],
    logs: any[],
    today: Date,
    weekOffset: number,
  ): WeekAgg | null => {
    const from = format(addDays(today, -7 * (weekOffset + 1)), 'yyyy-MM-dd')
    const to = format(addDays(today, -7 * weekOffset), 'yyyy-MM-dd')
    const slice = recentAssigned.filter((w) => w.scheduledDate >= from && w.scheduledDate < to)
    if (slice.length === 0) return null
    const totalPlanned = slice.reduce((s, w) => s + (w.workout?.distance || 0), 0)
    let totalActual = 0
    let completed = 0
    let skipped = 0
    let effortSum = 0
    let effortCount = 0
    for (const w of slice) {
      const log = logs.find((l: any) => l.assignedWorkoutId === w.id)
      if (w.status === 'completed') completed++
      if (w.status === 'skipped') skipped++
      if (log?.actualDistance) totalActual += log.actualDistance
      if (log?.effort != null) {
        effortSum += log.effort
        effortCount++
      }
    }
    return {
      totalPlanned,
      totalActual,
      completed,
      skipped,
      avgEffort: effortCount ? Math.round((effortSum / effortCount) * 10) / 10 : null,
    }
  }

  const writeWorkout = async (w: BlockWorkoutOut, lang: 'en' | 'he') => {
    let targetOverride:
      | { paceMinSec: number; paceMaxSec: number; hrMin?: number; hrMax?: number }
      | undefined
    if (effectiveLabSteps && effectiveLabSteps.length >= 2 && w.bakkenLactateMin != null && w.bakkenLactateMax != null) {
      const atMin = interpolateAtLactate(effectiveLabSteps, w.bakkenLactateMin)
      const atMax = interpolateAtLactate(effectiveLabSteps, w.bakkenLactateMax)
      if (atMin && atMax) {
        const paceSecs = [atMin.paceSecPerKm, atMax.paceSecPerKm].sort((a, b) => a - b)
        targetOverride = {
          paceMinSec: paceSecs[0],
          paceMaxSec: paceSecs[1],
          ...(atMin.hr != null && atMax.hr != null
            ? { hrMin: Math.min(atMin.hr, atMax.hr), hrMax: Math.max(atMin.hr, atMax.hr) }
            : {}),
        }
      }
    }

    const workoutDoc = {
      title: w.title,
      type: w.type as WorkoutType,
      description: w.description || '',
      duration: w.duration ?? null,
      distance: w.distance ?? null,
      warmup: w.warmup ?? null,
      cooldown: w.cooldown ?? null,
      notes: w.notes ?? null,
      targetThresholdLevel: w.targetThresholdLevel ?? null,
      comparisonGroup: w.comparisonGroup ?? null,
      thresholdDistance: w.thresholdDistance ?? null,
      sets: (w.sets || []).map((s, i) => ({
        id: `s${i}`,
        reps: s.reps,
        distanceMeters: s.distanceMeters ?? null,
        durationSec: s.durationSec ?? null,
        distance: s.distanceMeters != null ? formatMetersStr(s.distanceMeters, lang) : null,
        duration: s.durationSec != null ? formatSecondsStr(s.durationSec, lang) : null,
        restBetweenReps: s.restBetweenReps ?? null,
        restAfterSet: s.restAfterSet ?? null,
        notes: s.notes ?? null,
        intervals: (s.intervals || []).map((iv, j) => ({
          id: `s${i}-iv${j}`,
          distanceMeters: iv.distanceMeters ?? null,
          durationSec: iv.durationSec ?? null,
          distance: iv.distanceMeters != null ? formatMetersStr(iv.distanceMeters, lang) : null,
          duration: iv.durationSec != null ? formatSecondsStr(iv.durationSec, lang) : null,
          // The app's interval row shows "@ {pace}" for the effort label —
          // the model's per-segment effort text (e.g. "hard"/"easy") is the
          // right thing to show there, same as a Kenyan-fartlek template's
          // "@ ריצה קלה" / "@ הליכה מהירה".
          pace: iv.notes || null,
        })),
      })),
      createdBy: user!.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
    const wRef = await addDoc(collection(db, 'workouts'), workoutDoc)

    await addDoc(collection(db, 'assignedWorkouts'), {
      workoutId: wRef.id,
      workout: { id: wRef.id, ...workoutDoc, createdAt: new Date(), updatedAt: new Date() },
      athleteId,
      assignedBy: user!.id,
      scheduledDate: w.date,
      status: 'scheduled',
      session: w.session || 'other',
      source: 'bakken',
      ...(targetOverride ? { targetOverride } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }

  const generate = async () => {
    if (!user || !summary) return
    setLoading(true)
    setLastSummary(null)
    setProgress(null)
    try {
      // Persist whatever the coach set/adjusted above (schedule, notes, and
      // every editable athlete field) before reading the profile back —
      // this is exactly what the brain sees as athlete_context.*.
      // Only 'workout' days count as real training days — 'rest' is the
      // coach's own deliberate day off, not a day that happens to be
      // "available." Counting it as a training day (the old behavior:
      // everything except 'off') was the root cause of plans effectively
      // training every day regardless of how many days were marked rest.
      const derivedDaysPerWeek = DAY_ORDER.filter((day) => weekSchedule[day] === 'workout').length
      await updateDoc(doc(db, 'users', athleteId), {
        weekSchedule,
        daysPerWeek: derivedDaysPerWeek,
        bakkenGenerationBlocks: generationBlocks,
        coachPrivateNotes: coachNotes,
        preferredLanguage: summary.language,
        experienceLevel: summary.experienceLevel || null,
        weeklyMileage: summary.weeklyMileage ?? null,
        injuryHistory: summary.injuryHistory || null,
        currentShape: summary.currentShape || null,
        longRunMinutes: summary.longRunMinutes ?? null,
        longRunDay: summary.longRunDay || null,
        goalRaceEvent: summary.goalRaceEvent || null,
        goalRaceDistance: summary.goalRaceDistance || null,
        goalRaceDate: summary.goalRaceDate || null,
        goalRaceTarget: summary.goalRaceTarget || null,
        testRaceEvent: summary.testRaceEvent || null,
        testRaceDistance: summary.testRaceDistance || null,
        testRaceDate: summary.testRaceDate || null,
        personalRecords: summary.personalRecords,
      })

      const profileSnap = await getDoc(doc(db, 'users', athleteId))
      if (!profileSnap.exists()) {
        toast.error(t.profileNotFound)
        return
      }
      const profile = profileSnap.data() as any

      if (!profile.goalRaceDate) {
        toast.error(t.setGoalRaceFirst)
        return
      }

      const today = new Date()

      const [assignedSnap, logsSnap] = await Promise.all([
        getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId))),
        getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId))),
      ])
      const assigned = assignedSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
      const logs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
      const cutoff = format(addDays(today, -21), 'yyyy-MM-dd')
      const recentAssigned = assigned
        .filter((w) => w.scheduledDate >= cutoff)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
      const recentWorkouts = recentAssigned.map((w) => {
        const log =
          logs.find((l: any) => l.assignedWorkoutId === w.id) ||
          logs.find((l: any) => l.workoutId === w.workoutId && l.date === w.scheduledDate)
        return {
          date: w.scheduledDate,
          title: w.workout?.title || '',
          type: w.workout?.type || '',
          status: w.status,
          plannedKm: w.workout?.distance ?? undefined,
          actualKm: log?.actualDistance ?? undefined,
          effort: log?.effort ?? null,
          comment: log?.comment || undefined,
        }
      })

      const last3WeeksSummary = {
        week1: buildWeekSummary(recentAssigned, logs, today, 2),
        week2: buildWeekSummary(recentAssigned, logs, today, 1),
        week3: buildWeekSummary(recentAssigned, logs, today, 0),
      }

      // Real average weekly km actually run (over whichever of the last 3
      // weeks have logged data). Used as the season's starting volume only
      // when the coach hasn't set an explicit weeklyMileage override below
      // — a coach-entered number is intentional and always wins.
      const realWeeks = [last3WeeksSummary.week1, last3WeeksSummary.week2, last3WeeksSummary.week3]
        .filter((w): w is WeekAgg => w !== null && w.totalActual > 0)
      const actualAvgWeeklyKm = realWeeks.length
        ? Math.round(realWeeks.reduce((s, w) => s + w.totalActual, 0) / realWeeks.length)
        : null

      const athleteContext: PlanAthleteContext = {
        name: profile.name || 'Athlete',
        experienceLevel: profile.experienceLevel,
        daysPerWeek: profile.daysPerWeek,
        weekSchedule: profile.weekSchedule,
        weeklyMileage: profile.weeklyMileage,
        injuryHistory: profile.injuryHistory,
        currentShape: profile.currentShape,
        longRunMinutes: profile.longRunMinutes,
        longRunDay: profile.longRunDay,
        coachNotes: profile.coachPrivateNotes,
        goalRaceEvent: profile.goalRaceEvent || 'Goal Race',
        goalRaceDistance: profile.goalRaceDistance,
        goalRaceDate: profile.goalRaceDate,
        goalRaceTarget: profile.goalRaceTarget,
        testRaceEvent: profile.testRaceEvent,
        testRaceDistance: profile.testRaceDistance,
        testRaceDate: profile.testRaceDate,
        personalRecords: Array.isArray(profile.personalRecords)
          ? profile.personalRecords.slice(0, 5).map((p: any) => ({ event: p.event, time: p.time, date: p.date }))
          : [],
        physiology: {
          hasLabTest: !!labSteps && labSteps.length >= 2
            ? true
            : !!stepsFromPhysiologySummary(profile.physiology),
          lt1PaceSec: profile.physiology?.lt1PaceSec ?? null,
          lt1Hr: profile.physiology?.lt1Hr ?? null,
          lt2PaceSec: profile.physiology?.lt2PaceSec ?? null,
          lt2Hr: profile.physiology?.lt2Hr ?? null,
          lt3PaceSec: profile.physiology?.lt3PaceSec ?? null,
          lt3Hr: profile.physiology?.lt3Hr ?? null,
          vo2maxEst: profile.physiology?.vo2maxEst ?? null,
          testDate: profile.physiology?.testDate,
        },
        last3WeeksSummary,
        recentWorkouts,
        language: (profile.preferredLanguage as 'en' | 'he') || 'he',
      }

      // Continue an existing season instead of wiping it, whenever
      // possible. A click of Generate used to unconditionally delete every
      // prior Bakken-generated workout and rebuild the whole season from
      // today — harmless the first time, but the moment a coach used the
      // block-count control to generate a season in pieces and came back
      // later to add more, that same click would silently destroy the
      // weeks already generated (and possibly already run/logged) and
      // restart the entire season from today instead of picking up where
      // it left off. Now: if a season already exists for this exact goal
      // race, reuse its skeleton/stages untouched and just append new
      // blocks starting the day after the last day already generated.
      // forceRestart (an explicit coach opt-in) always takes the old wipe-
      // and-rebuild-from-today path instead.
      const existingBakken = assigned.filter((w: any) => w.source === 'bakken')
      const lastGeneratedDate: string | null = existingBakken.length
        ? existingBakken.reduce((max: string, w: any) => (w.scheduledDate > max ? w.scheduledDate : max), existingBakken[0].scheduledDate)
        : null
      const existingJourney = forceRestart ? null : await getJourney(athleteId, 'bakken_season')
      const canContinue = !!(existingJourney && lastGeneratedDate && existingJourney.goalRaceDate === profile.goalRaceDate)

      if (canContinue && lastGeneratedDate! >= existingJourney!.goalRaceDate) {
        toast.success(t.seasonAlreadyComplete)
        return
      }

      let journeyDoc: JourneyDoc
      let resumeCursor: string
      let previousBlockTail: Array<{ date: string; type: string; title: string }> | undefined

      if (canContinue) {
        journeyDoc = existingJourney!
        resumeCursor = addDaysStr(lastGeneratedDate!, 1)
        previousBlockTail = existingBakken
          .sort((a: any, b: any) => a.scheduledDate.localeCompare(b.scheduledDate))
          .slice(-3)
          .map((w: any) => ({ date: w.scheduledDate, type: w.workout?.type || '', title: w.workout?.title || '' }))
        setProgress(t.continuingSeason(resumeCursor))
        setJourneyPreview(journeyDoc)
      } else {
        // Full rebuild — wipe any prior Bakken-generated workouts and start
        // the season fresh from the upcoming Sunday (see seasonStartDate
        // below). Only deletes assignedWorkouts this feature created
        // (source:'bakken') — never touches anything the coach assigned
        // manually.
        setProgress(t.clearingPrevious)
        const priorSnap = await getDocs(
          query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId), where('source', '==', 'bakken')),
        )
        if (!priorSnap.empty) {
          await Promise.all(priorSnap.docs.map((d) => deleteDoc(d.ref)))
        }

        // 1. Season skeleton — one Bakken-brain call decides phase lengths
        // (in weeks), volume ramp, and key workout types per phase. Only the
        // date arithmetic below is code, not the model.
        //
        // A brand-new season always starts on the upcoming Sunday, never
        // mid-week — generating on a Thursday used to start a short 2-3 day
        // "stub" week right away, which regularly cut the long run's
        // designated day out of that first partial week entirely (either
        // it had already passed, or there wasn't a full week to place it
        // in), and left the athlete with a half-built first week. Skipping
        // straight to the next full Sun-Sat week means every week
        // (including the very first) gets the real long-run-day placement
        // and full weekly-volume logic from day one.
        const seasonStartDate = today.getDay() === 0 ? today : addDays(today, 7 - today.getDay())
        const startDateStr = format(seasonStartDate, 'yyyy-MM-dd')
        const totalWeeksAvailable = Math.max(
          1,
          Math.ceil((new Date(profile.goalRaceDate).getTime() - seasonStartDate.getTime()) / (7 * 86400000)),
        )
        // The coach's own entered number is an intentional override and
        // always wins when set (e.g. "start at 15" even though the last 3
        // weeks were low because the athlete was injured/traveling) — real
        // logged history is only the fallback for when the coach hasn't
        // set anything, so a brand-new athlete's plan still anchors to
        // reality instead of a hardcoded default.
        const currentWeeklyKm = profile.weeklyMileage ?? actualAvgWeeklyKm ?? 30
        const skeletonReq: SkeletonRequest = {
          totalWeeksAvailable,
          currentWeeklyKm,
          peakWeeklyKmHint: profile.weeklyKmRange?.max,
        }
        setProgress(t.designingSkeleton)
        const skeletonRes = await fetch('/api/bakken-coach/generate-skeleton', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ athlete: athleteContext, skeleton: skeletonReq }),
        })
        const skeletonData = await skeletonRes.json()
        if (skeletonData.error || !Array.isArray(skeletonData.skeleton?.stages) || skeletonData.skeleton.stages.length === 0) {
          toast.error(t.skeletonFailed(skeletonData.error || 'malformed response'))
          return
        }
        const skeletonOut: SkeletonOut = skeletonData.skeleton

        // Normalize week-counts so they sum exactly to totalWeeksAvailable —
        // the model can be off by a week or two; the last stage absorbs any
        // remainder so the season still lands exactly on goalRaceDate.
        const rawStages = skeletonOut.stages.filter((s) => s.weeks > 0)
        const weekSum = rawStages.reduce((s, st) => s + st.weeks, 0)
        if (weekSum !== totalWeeksAvailable && rawStages.length > 0) {
          const diff = totalWeeksAvailable - weekSum
          rawStages[rawStages.length - 1].weeks = Math.max(1, rawStages[rawStages.length - 1].weeks + diff)
        }

        let dateCursor = startDateStr
        const stages: JourneyStage[] = rawStages.map((s, i) => {
          const isLast = i === rawStages.length - 1
          const stageEnd = isLast ? profile.goalRaceDate : addDaysStr(dateCursor, s.weeks * 7 - 1)
          const stage: JourneyStage = {
            id: localId('stage'),
            name: s.name,
            type: s.type,
            startDate: dateCursor,
            endDate: stageEnd,
            focus: s.focus,
            weeklyVolumeKm: s.weeklyVolumeKm,
            keyWorkouts: s.keyWorkouts,
            milestones: s.milestones,
          }
          dateCursor = addDaysStr(stageEnd, 1)
          return stage
        })

        journeyDoc = {
          // Stable, not localId('journey') — each fresh rebuild must
          // overwrite the same journey doc (saveJourney does a setDoc),
          // not create a second one that overlaps the first and scrambles
          // which stage the calendar shows for a given week.
          id: 'bakken_season',
          title: skeletonOut.title,
          goalRaceEvent: profile.goalRaceEvent || 'Goal Race',
          goalRaceDate: profile.goalRaceDate,
          goalRaceTarget: profile.goalRaceTarget,
          startDate: startDateStr,
          stages,
          createdBy: user.id,
          createdAt: new Date(),
          updatedAt: new Date(),
        }
        await saveJourney(athleteId, journeyDoc)
        setJourneyPreview(journeyDoc)
        resumeCursor = journeyDoc.startDate
      }

      // 2. Split the season into ~14-day blocks, capped for cost/time.
      // Block boundaries are aligned to Sunday (matching the calendar-week
      // convention used everywhere else in the app) so no Sun-Sat week ever
      // gets split across two separate block-generation calls, which would
      // make normalizeWeeklyVolume see only part of that week's days at a
      // time. If the season doesn't start on a Sunday, the first block is a
      // short "stub" running only to that week's Saturday.
      const effectiveMaxBlocks = Math.min(Math.max(1, generationBlocks), MAX_BLOCKS)
      const blocks: { startDate: string; endDate: string }[] = []
      let cursor = resumeCursor
      const firstDow = parseISO(cursor).getDay() // 0=Sun..6=Sat
      if (firstDow !== 0 && cursor <= journeyDoc.goalRaceDate) {
        const stubEnd = dateMin(addDaysStr(cursor, 6 - firstDow), journeyDoc.goalRaceDate)
        blocks.push({ startDate: cursor, endDate: stubEnd })
        cursor = addDaysStr(stubEnd, 1)
      }
      while (cursor <= journeyDoc.goalRaceDate && blocks.length < effectiveMaxBlocks) {
        const end = dateMin(addDaysStr(cursor, BLOCK_DAYS - 1), journeyDoc.goalRaceDate)
        blocks.push({ startDate: cursor, endDate: end })
        cursor = addDaysStr(end, 1)
      }

      // 3. Fill in each block from the Bakken brain, writing as we go.
      // previousBlockTail is already seeded above when continuing an
      // existing season (from the real last-generated workouts), so rule 9
      // (no repeat hard day across the boundary) still holds even when the
      // "boundary" is between an old generate() call and this new one.
      let totalWritten = 0
      let firstBlockSummary: string | null = null

      for (let i = 0; i < blocks.length; i++) {
        setProgress(t.generatingBlock(blocks[i].startDate, blocks[i].endDate, i + 1, blocks.length))

        const stagesForBlock: BlockStageInfo[] = journeyDoc.stages
          .filter((s) => overlaps(s.startDate, s.endDate, blocks[i].startDate, blocks[i].endDate))
          .map((s) => ({
            type: s.type,
            name: s.name,
            focus: s.focus,
            weeklyVolumeKm: s.weeklyVolumeKm,
            startDate: s.startDate,
            endDate: s.endDate,
          }))

        const res = await fetch('/api/bakken-coach/generate-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            athlete: athleteContext,
            block: {
              blockIndex: i,
              totalBlocks: blocks.length,
              startDate: blocks[i].startDate,
              endDate: blocks[i].endDate,
              seasonStartDate: journeyDoc.startDate,
              stages: stagesForBlock,
              previousBlockTail,
            },
          }),
        })
        const data = await res.json()
        if (data.error || !Array.isArray(data.plan?.workouts)) {
          toast.error(t.blockFailed(i + 1, data.error || 'malformed response', totalWritten))
          break
        }
        const plan: BlockPlanOut = data.plan
        if (i === 0) firstBlockSummary = plan.blockSummary
        enforceWeekSchedule(plan.workouts, weekSchedule, athleteContext.language)
        enforceAmPmOrder(plan.workouts)
        enforceLongRunDay(plan.workouts, athleteContext.longRunDay, athleteContext.language)
        normalizeWeeklyVolume(plan.workouts, stagesForBlock, journeyDoc.startDate, journeyDoc.goalRaceDate, athleteContext.longRunMinutes, athleteContext.experienceLevel)

        for (const w of plan.workouts) {
          if (w.type === 'rest') continue
          await writeWorkout(w, athleteContext.language)
          totalWritten++
        }

        previousBlockTail = plan.workouts
          .filter((w) => w.type !== 'rest')
          .slice(-3)
          .map((w) => ({ date: w.date, type: w.type, title: w.title }))
      }

      // 4. The app's existing rolling-visibility window (default 2 weeks,
      // rolls every Saturday — components/athlete/athlete-dashboard.tsx)
      // is what actually hides the rest of the season from the athlete.
      await updateDoc(doc(db, 'users', athleteId), {
        visibleWeeksAhead: 2,
        bakkenPlanGeneratedAt: serverTimestamp(),
      })

      setLastSummary(
        `${journeyDoc.stages.length} ${uiLang === 'he' ? 'שלבים עד' : 'phases through'} ${journeyDoc.goalRaceDate}, ${blocks.length} ${uiLang === 'he' ? 'בלוקים' : 'blocks'}, ${totalWritten} ${uiLang === 'he' ? 'אימונים נכתבו. הספורטאי רואה את השבועיים הראשונים; השאר נחשף אוטומטית כל שבת.' : 'workouts written. Athlete sees the first 2 weeks; the rest reveals automatically each Saturday.'}\n\n${firstBlockSummary ?? ''}`,
      )
      toast.success(t.seasonWritten(totalWritten))
    } catch (e) {
      console.error('Bakken plan generation failed:', e)
      toast.error(t.generateFailed)
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> {t.cardTitle}
        </CardTitle>
        <CardDescription>{t.cardDesc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Everything the brain actually sees, in one place — so the coach
            can verify it and doesn't have to guess what data exists. */}
        {summary && (
          <div className="rounded-lg border p-3 space-y-3 text-sm">
            <p className="text-sm font-medium">{t.knowsAbout(summary.name)}</p>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t.planLanguage}</p>
              <div className="flex gap-1.5">
                <button type="button" onClick={() => setAthleteField('language', 'he')}
                  className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.language === 'he' ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                  עברית
                </button>
                <button type="button" onClick={() => setAthleteField('language', 'en')}
                  className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.language === 'en' ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                  English
                </button>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t.experienceLevel}</p>
              <div className="flex flex-wrap gap-1.5">
                {EXPERIENCE_LEVELS.map((lvl) => (
                  <button key={lvl} type="button" onClick={() => setAthleteField('experienceLevel', lvl)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium capitalize transition-colors ${summary.experienceLevel === lvl ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t.weeklyMileage}</p>
              <p className="text-[11px] text-muted-foreground mb-1.5">{t.weeklyMileageHint}</p>
              <div className="flex flex-wrap gap-1.5 mb-1.5">
                {MILEAGE_PRESETS.map((km) => (
                  <button key={km} type="button" onClick={() => setAthleteField('weeklyMileage', km)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.weeklyMileage === km ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                    {km}
                  </button>
                ))}
              </div>
              <input type="number" min={0} step={1} value={summary.weeklyMileage ?? ''}
                onChange={(e) => setAthleteField('weeklyMileage', e.target.value === '' ? undefined : Number(e.target.value))}
                placeholder={t.mileageCustomPlaceholder} dir="ltr"
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs" />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t.injuryHistory}</p>
              <textarea
                value={summary.injuryHistory}
                onChange={(e) => setAthleteField('injuryHistory', e.target.value)}
                placeholder={t.injuryPlaceholder}
                className="w-full min-h-[50px] rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
              />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t.currentShapeLabel}</p>
              <div className="flex flex-wrap gap-1.5">
                {CURRENT_SHAPES.map((shape) => (
                  <button key={shape} type="button" onClick={() => setAthleteField('currentShape', shape)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.currentShape === shape ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                    {CURRENT_SHAPE_LABELS[shape]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t.longRunLabel}</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setAthleteField('longRunMinutes', undefined)}
                  className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${!summary.longRunMinutes ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                  {t.longRunNone}
                </button>
                {LONG_RUN_MINUTES_PRESETS.map((min) => (
                  <button key={min} type="button" onClick={() => setAthleteField('longRunMinutes', min)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.longRunMinutes === min ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                    {min}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t.longRunDayLabel}</p>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => setAthleteField('longRunDay', undefined)}
                  className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${!summary.longRunDay ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                  {t.longRunDayNone}
                </button>
                {DAY_ORDER.map((day) => (
                  <button key={day} type="button" onClick={() => setAthleteField('longRunDay', day)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.longRunDay === day ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                    {DAY_LABELS[uiLang][day]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t.goalDistance}</p>
              <div className="flex flex-wrap gap-1.5">
                {RACE_DISTANCES.map((dist) => (
                  <button key={dist} type="button" onClick={() => setAthleteField('goalRaceDistance', dist)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.goalRaceDistance === dist ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                    {RACE_DISTANCE_LABELS[dist]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">{t.raceName}</p>
                <input type="text" value={summary.goalRaceEvent} onChange={(e) => setAthleteField('goalRaceEvent', e.target.value)}
                  placeholder={t.raceNamePlaceholder}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">{t.raceDate}</p>
                <input type="date" value={summary.goalRaceDate} onChange={(e) => setAthleteField('goalRaceDate', e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs" />
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t.goalTime}</p>
              <input type="text" value={summary.goalRaceTarget} onChange={(e) => setAthleteField('goalRaceTarget', e.target.value)}
                placeholder={t.goalTimePlaceholder} dir="ltr"
                className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs" />
              {summary.goalRaceDistance && (
                <div className="flex flex-wrap gap-1.5 mt-1.5">
                  {GOAL_TIME_PRESETS[summary.goalRaceDistance].map((timeOpt) => (
                    <button key={timeOpt} type="button" onClick={() => setAthleteField('goalRaceTarget', timeOpt)}
                      className={`px-2 py-0.5 rounded-full border text-[11px] font-medium transition-colors ${summary.goalRaceTarget === timeOpt ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                      {timeOpt}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-md border border-dashed border-input p-2 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">{t.testRaceTitle}</p>
              <p className="text-[11px] text-muted-foreground">{t.testRaceHint}</p>
              <div>
                <p className="text-[11px] font-medium text-muted-foreground mb-1">{t.testRaceDistanceLabel}</p>
                <div className="flex flex-wrap gap-1.5">
                  {RACE_DISTANCES.map((dist) => (
                    <button key={dist} type="button" onClick={() => setAthleteField('testRaceDistance', dist)}
                      className={`px-2 py-0.5 rounded-full border text-[11px] font-medium transition-colors ${summary.testRaceDistance === dist ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                      {RACE_DISTANCE_LABELS[dist]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">{t.testRaceEventLabel}</p>
                  <input type="text" value={summary.testRaceEvent} onChange={(e) => setAthleteField('testRaceEvent', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs" />
                </div>
                <div>
                  <p className="text-[11px] font-medium text-muted-foreground mb-1">{t.testRaceDateLabel}</p>
                  <input type="date" value={summary.testRaceDate} onChange={(e) => setAthleteField('testRaceDate', e.target.value)}
                    className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs" />
                </div>
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">{t.recentPRs}</p>
              {summary.personalRecords.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t.noPRsYet}</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {summary.personalRecords.map((p, i) => (
                    <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-input text-[11px] text-foreground">
                      {p.event} {p.time} ({p.date})
                      <button type="button" onClick={() => removePersonalRecord(i)} aria-label={t.removeBtn}>
                        <X className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="rounded-md border border-dashed border-input p-2 space-y-1.5">
                <p className="text-[11px] font-medium text-muted-foreground">{t.addPrTitle}</p>
                <div className="flex flex-wrap gap-1.5">
                  {RACE_DISTANCES.map((dist) => (
                    <button key={dist} type="button" onClick={() => setPrDistance(dist)}
                      className={`px-2 py-0.5 rounded-full border text-[11px] font-medium transition-colors ${prDistance === dist ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                      {RACE_DISTANCE_LABELS[dist]}
                    </button>
                  ))}
                </div>
                <div className={`grid gap-1.5 ${prDistance === 'half_marathon' || prDistance === 'marathon' ? 'grid-cols-3' : 'grid-cols-2'}`} dir="ltr">
                  {(prDistance === 'half_marathon' || prDistance === 'marathon') && (
                    <div>
                      <input type="number" min={0} max={23} value={prHours} onChange={(e) => setPrHours(e.target.value === '' ? 0 : Number(e.target.value))}
                        className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs" />
                      <span className="block text-[10px] text-muted-foreground mt-0.5">{t.prHours}</span>
                    </div>
                  )}
                  <div>
                    <input type="number" min={0} max={59} value={prMinutes} onChange={(e) => setPrMinutes(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs" />
                    <span className="block text-[10px] text-muted-foreground mt-0.5">{t.prMinutes}</span>
                  </div>
                  <div>
                    <input type="number" min={0} max={59} value={prSeconds} onChange={(e) => setPrSeconds(e.target.value === '' ? '' : Number(e.target.value))}
                      className="w-full rounded-md border border-input bg-background px-2 py-1 text-xs" />
                    <span className="block text-[10px] text-muted-foreground mt-0.5">{t.prSeconds}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <input type="date" value={prDate} onChange={(e) => setPrDate(e.target.value)}
                    className="rounded-md border border-input bg-background px-2 py-1 text-xs" />
                  <button type="button" onClick={addPersonalRecord} disabled={!prDistance}
                    className="ms-auto px-3 py-1 rounded-md bg-primary text-primary-foreground text-xs font-medium disabled:opacity-50">
                    {t.addBtn}
                  </button>
                </div>
              </div>
            </div>

            {hasLabTest ? (
              <div className="text-xs rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-1.5">
                {t.labTestYes}
              </div>
            ) : (
              <div className="text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1.5">
                {t.labTestNoBase}
                {summary.personalRecords.length > 0 ? t.labTestNoPRs : t.labTestNoPlain}
                {t.labTestNoSuffix}
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium">{t.coachNotesLabel}</p>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={saveCoachNotes} disabled={savingNotes}>
              {savingNotes ? <Loader2 className="h-3 w-3 animate-spin" /> : t.save}
            </Button>
          </div>
          <textarea
            value={coachNotes}
            onChange={(e) => setCoachNotes(e.target.value)}
            placeholder={t.coachNotesPlaceholder}
            className="w-full min-h-[70px] rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <p className="text-sm font-medium mb-1">{t.availability}</p>
          <p className="text-xs text-muted-foreground mb-3">
            {scheduleLoaded ? t.availabilityLoaded : t.loading}
          </p>
          <div className="space-y-1.5">
            {DAY_ORDER.map((day) => (
              <div key={day} className="flex items-center gap-2">
                <span className="w-8 text-xs font-semibold text-muted-foreground shrink-0">
                  {DAY_LABELS[uiLang][day]}
                </span>
                <div className="flex gap-1">
                  {DAY_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setDayType(day, type)}
                      className={`px-2 py-1 rounded-md border text-xs font-medium transition-colors ${
                        weekSchedule[day] === type
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-input text-muted-foreground hover:border-primary'
                      }`}
                    >
                      {DAY_TYPE_LABELS[uiLang][type]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">{t.generationScopeLabel}</p>
          <div className="flex flex-wrap gap-1.5 mb-1.5">
            {GENERATION_BLOCK_PRESETS.map((n) => (
              <button key={n} type="button" onClick={() => setGenerationBlocks(n)}
                className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${generationBlocks === n ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                {n === MAX_BLOCKS ? t.fullSeasonBtn(n) : n}
              </button>
            ))}
          </div>
          <input type="number" min={1} max={MAX_BLOCKS} value={generationBlocks}
            onChange={(e) => setGenerationBlocks(e.target.value === '' ? 1 : Math.min(Math.max(1, Number(e.target.value)), MAX_BLOCKS))}
            placeholder={t.generationBlocksCustomPlaceholder}
            className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs" />
        </div>
        <label className="flex items-start gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={forceRestart} onChange={(e) => setForceRestart(e.target.checked)}
            className="mt-0.5" />
          {t.forceRestartLabel}
        </label>
        <Button onClick={generate} disabled={loading || !summary}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {t.generateBtn}
        </Button>
        {progress && <div className="text-sm text-muted-foreground">{progress}</div>}
        {lastSummary && (
          <div className="text-sm text-muted-foreground border-t pt-4 whitespace-pre-wrap">{lastSummary}</div>
        )}
        {journeyPreview && journeyPreview.stages.length > 0 && (
          <div className="border-t pt-4 space-y-2">
            <div className="text-sm font-medium">{t.weekBreakdownTitle}</div>
            <div className="text-xs text-muted-foreground">{t.weekBreakdownHint}</div>
            <div className="text-xs text-muted-foreground">{t.seasonStarts(journeyPreview.startDate)}</div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-muted-foreground border-b">
                    <th className="text-start py-1 pe-2">{t.weekCol}</th>
                    <th className="text-start py-1 pe-2">{t.datesCol}</th>
                    <th className="text-start py-1 pe-2">{t.phaseCol}</th>
                    <th className="text-start py-1">{t.targetKmCol}</th>
                  </tr>
                </thead>
                <tbody>
                  {computeWeekBreakdown(journeyPreview).map((w) => (
                    <tr key={w.weekNum} className="border-b border-border/50">
                      <td className="py-1 pe-2">{w.weekNum}</td>
                      <td className="py-1 pe-2">{w.start} – {w.end}</td>
                      <td className="py-1 pe-2">{w.stage ? stageDisplayName(w.stage, uiLang === 'he') : '—'}</td>
                      <td className="py-1">{w.stage?.weeklyVolumeKm ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
