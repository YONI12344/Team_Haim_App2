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
import { useWorkoutTypeLabels } from '@/lib/workout-labels'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { useLatestStepTest } from '@/hooks/useLatestStepTest'
import { saveJourney, getJourney, stageDisplayName } from '@/lib/journey'
import { interpolateAtLactate, stepsFromPhysiologySummary } from '@/lib/physiology'
import type { WorkoutType, JourneyDoc, JourneyStage, Workout } from '@/lib/types'
import type { PlanAthleteContext, BlockStageInfo, SkeletonRequest, SkeletonOut } from '@/lib/bakken/plan-prompt'
import type { BlockWorkoutOut, DayKey, RecurringActivityInput } from '@/lib/bakken/backstops'
import {
  normalizeInvalidTypes,
  enforceWeekSchedule,
  enforceAmPmOrder,
  enforceSameDaySessionTags,
  enforceRecurringActivities,
  enforceSpecialEvents,
  enforceDayTypeTemplate,
  enforceNoBackToBackBigDays,
  enforceLongRunDay,
  normalizeWeeklyVolume,
  applyCutbackWeekAdjustments,
  DAY_INDEX,
} from '@/lib/bakken/backstops'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

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
const MAX_BLOCKS = 10 // safety cap: 20 weeks of upfront generation per click, regardless of target

// What a single "Generate" click targets — instead of a raw block count,
// the coach picks a stage of the journey (or "continue"/"whole season"),
// and the block loop below stops at that stage's end date (still capped
// by MAX_BLOCKS per click for cost/quality reasons).
type StageTargetType = 'base' | 'build' | 'peak' | 'taper' | 'race_week'
type GenerationTarget = 'current_stage' | 'whole_season' | StageTargetType
const GENERATION_TARGET_STAGES: StageTargetType[] = ['base', 'build', 'peak', 'taper', 'race_week']

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
const STAGE_TYPE_LABELS: Record<'en' | 'he', Record<'base' | 'build' | 'peak' | 'taper' | 'race_week', string>> = {
  en: { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', race_week: 'Race Week' },
  he: { base: 'בסיס', build: 'בנייה', peak: 'שיא', taper: 'הפחתת עומסים', race_week: 'שבוע מרוץ' },
}
// The workout types that actually make sense to fix onto a specific
// weekday in a coach-defined skeleton — excludes race/time_trial/rest
// (those are decided by other mechanisms, not a recurring weekly slot).
const DAY_TEMPLATE_TYPE_OPTIONS: string[] = [
  'easy', 'long_run', 'tempo', 'threshold', 'intervals', 'hill_repeats', 'fartlek', 'recovery', 'strength', 'stretch',
]
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
    recurringTitle: 'Recurring weekly activities',
    recurringHint: 'A gym day, yoga, standing cross-training — set once, always included regardless of phase.',
    recurringAdd: 'Add recurring activity',
    specialEventsTitle: 'One-off events (flight, wedding, exam...)',
    specialEventsHint: "A single date the AI should keep light instead of a hard session — not recurring, and not the goal/prep race.",
    specialEventsLabelPlaceholder: 'What is it? (e.g. Flight to Kenya)',
    specialEventsNotesPlaceholder: 'Notes (optional)',
    specialEventsAdd: 'Add event',
    cutbackTitle: 'Down/cutback week',
    cutbackHint: 'Default: an automatic down week every 3rd week (beginner) or 4th week (everyone else) at 75% volume. Override any of that below.',
    cutbackIntervalLabel: 'Down week every N weeks:',
    cutbackIntervalPlaceholder: 'auto',
    cutbackFewerDaysLabel: 'Also drop one easy day entirely that week (full rest instead)',
    cutbackDowngradeLabel: 'Also downgrade that week\'s quality sessions to easy',
    recurringTitlePlaceholder: 'Title (e.g. "Gym")',
    recurringNotesPlaceholder: 'Notes (optional)',
    recurringPickWorkout: 'or pick existing workout...',
    recurringPickWorkoutHint: 'Reuse an existing workout from the library (e.g. a real lift workout or stretching routine) instead of typing type/title manually.',
    everyWeek: 'Every week',
    everyOtherWeek: 'Every other week',
    dayTemplateTitle: 'Day-type template per season phase',
    dayTemplateHint: 'Assign which day gets which workout type for each phase — the AI fills in the actual content, you decide the skeleton. Leave a day blank to let the AI decide.',
    dayTemplateAiDecides: 'AI decides',
    dayTemplateSecondHint: 'Optional second session the same day (e.g. lift + easy run, or double threshold)',
    dayTemplateNoSecond: '(single session)',
    dayModeFixed: 'Fixed',
    dayModePair: 'Same day',
    dayModeRotate: 'Rotate weekly',
    dayModeRotateHint: 'Alternates week to week (e.g. fartlek one week, hills the next). Leave the second slot on "AI decides" for a plain fixed day.',
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
    generationScopeLabel: 'What to generate',
    continueCurrentStageBtn: 'Continue current stage',
    wholeSeasonBtn: 'Whole season',
    stageAlreadyPassedError: 'That stage is already fully in the past — pick a later stage or "Whole season".',
    generationCapNote: 'Each stage button generates from wherever you currently are THROUGH THE END of that stage (earlier stages included automatically) — not that stage in isolation. Each click generates up to ~20 weeks; click Generate again if the target is further out.',
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
    recurringTitle: 'אימונים קבועים שבועיים',
    recurringHint: 'יום כושר, יוגה, אימון חיזוק קבוע — מגדירים פעם אחת, תמיד ייכלל ללא קשר לשלב העונה.',
    recurringAdd: 'הוסף אימון קבוע',
    specialEventsTitle: 'אירועים חד-פעמיים (טיסה, חתונה, מבחן...)',
    specialEventsHint: 'תאריך בודד שה-AI ישמור עליו קליל במקום אימון קשה — לא חוזר, ולא מירוץ היעד/הכנה.',
    specialEventsLabelPlaceholder: 'מה זה? (למשל טיסה לקניה)',
    specialEventsNotesPlaceholder: 'הערות (לא חובה)',
    specialEventsAdd: 'הוסף אירוע',
    cutbackTitle: 'שבוע הפחתת עומסים',
    cutbackHint: 'ברירת מחדל: שבוע הפחתה אוטומטי כל 3 שבועות (מתחילים) או כל 4 שבועות (כולם) ב-75% נפח. אפשר לשנות למטה.',
    cutbackIntervalLabel: 'שבוע הפחתה כל N שבועות:',
    cutbackIntervalPlaceholder: 'אוטומטי',
    cutbackFewerDaysLabel: 'גם להוריד יום ריצה קלה אחד לגמרי (למנוחה מלאה) באותו שבוע',
    cutbackDowngradeLabel: 'גם להפוך את אימוני האיכות של השבוע הזה לריצה קלה',
    recurringTitlePlaceholder: 'כותרת (למשל "חדר כושר")',
    recurringNotesPlaceholder: 'הערות (לא חובה)',
    recurringPickWorkout: 'או בחר אימון קיים...',
    recurringPickWorkoutHint: 'להשתמש באימון קיים מהספרייה (למשל אימון כוח אמיתי או תרגילי מתיחות) במקום להקליד סוג/שם ידנית.',
    everyWeek: 'כל שבוע',
    everyOtherWeek: 'כל שבוע שני',
    dayTemplateTitle: 'תבנית ימים לפי שלב עונה',
    dayTemplateHint: 'קבעו איזה יום מקבל איזה סוג אימון בכל שלב — ה-AI ימלא את התוכן בפועל, אתם קובעים את השלד. השאירו יום ריק כדי לתת ל-AI להחליט.',
    dayTemplateAiDecides: 'ה-AI מחליט',
    dayTemplateSecondHint: 'אימון שני אופציונלי באותו יום (למשל חדר כושר + ריצה קלה, או סף כפול)',
    dayTemplateNoSecond: '(אימון בודד)',
    dayModeFixed: 'קבוע',
    dayModePair: 'אותו יום',
    dayModeRotate: 'סבב שבועי',
    dayModeRotateHint: 'מתחלף משבוע לשבוע (למשל פרטלק שבוע אחד, עליות בשבוע הבא). השאירו את הבחירה השנייה על "ה-AI מחליט" ליום קבוע רגיל.',
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
    generationScopeLabel: 'מה ליצור',
    continueCurrentStageBtn: 'המשך מהשלב הנוכחי',
    wholeSeasonBtn: 'כל העונה',
    stageAlreadyPassedError: 'השלב הזה כבר עבר לגמרי — בחרו שלב מאוחר יותר או "כל העונה".',
    generationCapNote: 'כל כפתור שלב יוצר מהנקודה הנוכחית עד סוף אותו שלב (השלבים הקודמים נכללים אוטומטית) — לא רק את השלב הזה בבידוד. כל לחיצה יוצרת עד כ-20 שבועות; אם היעד רחוק יותר, לחצו על "צור" שוב.',
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
  const workoutTypeLabels = useWorkoutTypeLabels()
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [lastSummary, setLastSummary] = useState<string | null>(null)
  const [weekSchedule, setWeekSchedule] = useState<Record<DayKey, DayType>>(DEFAULT_WEEK_SCHEDULE)
  const [generationTarget, setGenerationTarget] = useState<GenerationTarget>('current_stage')
  const [forceRestart, setForceRestart] = useState(false)
  const [scheduleLoaded, setScheduleLoaded] = useState(false)
  const [summary, setSummary] = useState<AthleteSummary | null>(null)
  const [coachNotes, setCoachNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)
  // Fixed weekly/every-other-week sessions (gym, yoga, standing cross-
  // training) the coach sets once — always included by the AI generator
  // regardless of phase, see rule 2b in plan-prompt.ts.
  const [recurringActivities, setRecurringActivities] = useState<Array<{
    id: string
    dayOfWeek: DayKey
    frequency: 'every_week' | 'every_other_week'
    type: string
    title: string
    notes?: string
    workoutId?: string
  }>>([])
  // Existing library workouts a recurring activity can reference (e.g. a
  // real structured lift workout, or a stretching routine) instead of a
  // generic type+title stub — loaded once, same list as the workout library.
  const [libraryWorkouts, setLibraryWorkouts] = useState<Workout[]>([])
  useEffect(() => {
    getDocs(collection(db, 'workouts')).then((snap) => {
      setLibraryWorkouts(snap.docs.filter((d) => !d.data().libraryHidden).map((d) => ({ ...(d.data() as Workout), id: d.id })))
    }).catch(console.error)
  }, [])
  // Coach-defined weekday->type skeleton per season-stage TYPE (base/build/
  // peak/etc.) — the AI generator uses the exact type on that weekday for
  // any week that stage is active instead of deciding itself. See rule 2c.
  const [stageDayTypeTemplates, setStageDayTypeTemplates] = useState<Record<string, Partial<Record<DayKey, string | string[] | { rotateWeekly: string[] }>>>>({})
  // One-off calendar events (flight, wedding, exam...) — the AI generator
  // keeps the event date itself light instead of a hard/big session, see
  // rule 2d in plan-prompt.ts.
  const [specialEvents, setSpecialEvents] = useState<Array<{
    id: string
    date: string
    label: string
    notes?: string
  }>>([])
  // Cutback/down-week overrides — see AthleteProfile.cutbackIntervalWeeks
  // etc. in lib/types.ts. Purely a post-generation backstop concern (not
  // sent to the AI), applied in applyCutbackWeekAdjustments/
  // normalizeWeeklyVolume.
  const [cutbackIntervalWeeks, setCutbackIntervalWeeks] = useState<number | ''>('')
  const [cutbackFewerDays, setCutbackFewerDays] = useState(false)
  const [cutbackDowngradeQuality, setCutbackDowngradeQuality] = useState(false)
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
      if (typeof d.bakkenGenerationTarget === 'string' && ['current_stage', 'whole_season', ...GENERATION_TARGET_STAGES].includes(d.bakkenGenerationTarget)) {
        setGenerationTarget(d.bakkenGenerationTarget)
      }
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
      setRecurringActivities(Array.isArray(d.recurringActivities) ? d.recurringActivities : [])
      setStageDayTypeTemplates(d.stageDayTypeTemplates && typeof d.stageDayTypeTemplates === 'object' ? d.stageDayTypeTemplates : {})
      setSpecialEvents(Array.isArray(d.specialEvents) ? d.specialEvents : [])
      setCutbackIntervalWeeks(typeof d.cutbackIntervalWeeks === 'number' ? d.cutbackIntervalWeeks : '')
      setCutbackFewerDays(!!d.cutbackFewerDays)
      setCutbackDowngradeQuality(!!d.cutbackDowngradeQuality)
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
      source: 'bakken' as const,
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
        bakkenGenerationTarget: generationTarget,
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
        recurringActivities,
        stageDayTypeTemplates,
        specialEvents,
        cutbackIntervalWeeks: cutbackIntervalWeeks === '' ? null : cutbackIntervalWeeks,
        cutbackFewerDays,
        cutbackDowngradeQuality,
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
        recurringActivities: Array.isArray(profile.recurringActivities) && profile.recurringActivities.length > 0
          ? profile.recurringActivities.map((r: any) => {
              const linked = r.workoutId ? libraryWorkouts.find((w) => w.id === r.workoutId) : undefined
              return {
                dayOfWeek: r.dayOfWeek, frequency: r.frequency,
                type: linked?.type || r.type, title: linked?.title || r.title, notes: r.notes,
              }
            })
          : undefined,
        specialEvents: Array.isArray(profile.specialEvents) && profile.specialEvents.length > 0
          ? profile.specialEvents.map((e: any) => ({ date: e.date, label: e.label, notes: e.notes }))
          : undefined,
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
          // 10, not 3 — rule 9's adjacency check only needs the last couple
          // of days, but rule 12's cross-block threshold/fartlek format
          // ROTATION check needs enough real history to actually see "this
          // exact format has been the only one for the last several weeks"
          // instead of just the immediately preceding day or two.
          .slice(-10)
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

      // 2. Resolve how far this click should generate, per the coach's
      // chosen generationTarget: a specific named stage type ("only Base"),
      // "current_stage" (finish whatever stage resumeCursor falls in), or
      // "whole_season" (all the way to the goal race). "current_stage" on a
      // brand-new journey naturally resolves to the season's first stage,
      // since resumeCursor === journeyDoc.startDate at that point.
      let targetEndDate: string
      if (generationTarget === 'whole_season') {
        targetEndDate = journeyDoc.goalRaceDate
      } else if (generationTarget === 'current_stage') {
        const stage = journeyDoc.stages.find((s) => resumeCursor >= s.startDate && resumeCursor <= s.endDate)
        targetEndDate = stage ? stage.endDate : journeyDoc.goalRaceDate
      } else {
        const matching = journeyDoc.stages.filter((s) => s.type === generationTarget && s.endDate >= resumeCursor)
        if (matching.length === 0) {
          toast.error(t.stageAlreadyPassedError)
          setLoading(false)
          return
        }
        targetEndDate = matching[matching.length - 1].endDate
      }
      const seasonEndBound = dateMin(targetEndDate, journeyDoc.goalRaceDate)

      // 3. Split the target range into ~14-day blocks, capped for cost/time.
      // Block boundaries are aligned to Sunday (matching the calendar-week
      // convention used everywhere else in the app) so no Sun-Sat week ever
      // gets split across two separate block-generation calls, which would
      // make normalizeWeeklyVolume see only part of that week's days at a
      // time. If the season doesn't start on a Sunday, the first block is a
      // short "stub" running only to that week's Saturday. Every block is
      // also clamped to the end of whichever stage its start date falls in,
      // so a block never straddles two different named stages even when the
      // overall target ("whole_season" or a later stage) spans several.
      const effectiveMaxBlocks = MAX_BLOCKS
      const stageEndDateFor = (dateStr: string): string => {
        const stage = journeyDoc.stages.find((s) => dateStr >= s.startDate && dateStr <= s.endDate)
        return stage ? stage.endDate : seasonEndBound
      }
      const blocks: { startDate: string; endDate: string }[] = []
      let cursor = resumeCursor
      const firstDow = parseISO(cursor).getDay() // 0=Sun..6=Sat
      if (firstDow !== 0 && cursor <= seasonEndBound) {
        const stubEnd = dateMin(addDaysStr(cursor, 6 - firstDow), dateMin(stageEndDateFor(cursor), seasonEndBound))
        blocks.push({ startDate: cursor, endDate: stubEnd })
        cursor = addDaysStr(stubEnd, 1)
      }
      while (cursor <= seasonEndBound && blocks.length < effectiveMaxBlocks) {
        const end = dateMin(addDaysStr(cursor, BLOCK_DAYS - 1), dateMin(stageEndDateFor(cursor), seasonEndBound))
        blocks.push({ startDate: cursor, endDate: end })
        cursor = addDaysStr(end, 1)
      }

      // Resolved once for the whole generate() call — recurring activities
      // that reference an existing library workout (workoutId) get that
      // workout's real content attached, so enforceRecurringActivities
      // places the actual lift/stretch workout instead of a generic stub.
      const recurringActivitiesResolved: RecurringActivityInput[] | undefined = athleteContext.recurringActivities?.map((r, idx) => {
        const raw = profile.recurringActivities?.[idx]
        const linked = raw?.workoutId ? libraryWorkouts.find((w) => w.id === raw.workoutId) : undefined
        return {
          ...r,
          content: linked ? {
            description: linked.description, warmup: linked.warmup, cooldown: linked.cooldown,
            notes: linked.notes, duration: linked.duration, distance: linked.distance,
            sets: linked.sets as any, strengthBlocks: linked.strengthBlocks,
          } : undefined,
        }
      })

      // 4. Fill in each block from the Bakken brain, writing as we go.
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
            // Coach-defined day->type skeleton for this stage TYPE (not this
            // specific stage instance) — stored on the athlete profile so it
            // survives a full season regenerate, since stages themselves get
            // recreated fresh each time. See rule 2c in plan-prompt.ts.
            dayTypeTemplate: (profile.stageDayTypeTemplates as any)?.[s.type],
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
        normalizeInvalidTypes(plan.workouts, athleteContext.language)
        enforceWeekSchedule(plan.workouts, weekSchedule, athleteContext.language)
        enforceDayTypeTemplate(plan.workouts, stagesForBlock)
        enforceAmPmOrder(plan.workouts)
        enforceLongRunDay(plan.workouts, athleteContext.longRunDay, athleteContext.language)
        enforceNoBackToBackBigDays(plan.workouts, previousBlockTail, athleteContext.longRunDay, athleteContext.language)
        enforceRecurringActivities(plan.workouts, recurringActivitiesResolved, journeyDoc.startDate, athleteContext.language)
        enforceSpecialEvents(plan.workouts, athleteContext.specialEvents, athleteContext.language)
        // Runs LAST among the date/session-touching backstops — enforceLongRunDay
        // swaps dates (not sessions) when relocating a long run, which can land
        // it on a date that already has a tagged am/pm entry; verified in
        // practice that running this before enforceLongRunDay left exactly
        // that kind of freshly-created pairing untagged.
        enforceSameDaySessionTags(plan.workouts)
        // Must run BEFORE normalizeWeeklyVolume — dropping/downgrading a
        // day on a cutback week changes the flexible-distance pool that
        // the volume scaling right after this reads.
        applyCutbackWeekAdjustments(
          plan.workouts, stagesForBlock, athleteContext.experienceLevel,
          { intervalOverride: cutbackIntervalWeeks === '' ? undefined : cutbackIntervalWeeks, fewerDays: cutbackFewerDays, downgradeQuality: cutbackDowngradeQuality },
          athleteContext.language,
        )
        normalizeWeeklyVolume(plan.workouts, stagesForBlock, journeyDoc.startDate, journeyDoc.goalRaceDate, athleteContext.longRunMinutes, athleteContext.experienceLevel, cutbackIntervalWeeks === '' ? undefined : cutbackIntervalWeeks)

        for (const w of plan.workouts) {
          if (w.type === 'rest') continue
          await writeWorkout(w, athleteContext.language)
          totalWritten++
        }

        previousBlockTail = plan.workouts
          .filter((w) => w.type !== 'rest')
          .slice(-10) // see the -10 comment above — same reasoning
          .map((w) => ({ date: w.date, type: w.type, title: w.title }))
      }

      // 5. The app's existing rolling-visibility window (default 2 weeks,
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

            <div className="rounded-md border border-dashed border-input p-2 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t.recurringTitle}</p>
              <p className="text-[11px] text-muted-foreground">{t.recurringHint}</p>
              {recurringActivities.map((activity, idx) => (
                <div key={activity.id} className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/40 p-1.5">
                  <select value={activity.dayOfWeek}
                    onChange={(e) => setRecurringActivities(recurringActivities.map((a, i) => i === idx ? { ...a, dayOfWeek: e.target.value as DayKey } : a))}
                    className="rounded-md border border-input bg-background px-1.5 py-1 text-[11px]">
                    {DAY_ORDER.map((day) => <option key={day} value={day}>{DAY_LABELS[uiLang][day]}</option>)}
                  </select>
                  <select value={activity.frequency}
                    onChange={(e) => setRecurringActivities(recurringActivities.map((a, i) => i === idx ? { ...a, frequency: e.target.value as 'every_week' | 'every_other_week' } : a))}
                    className="rounded-md border border-input bg-background px-1.5 py-1 text-[11px]">
                    <option value="every_week">{t.everyWeek}</option>
                    <option value="every_other_week">{t.everyOtherWeek}</option>
                  </select>
                  {activity.workoutId ? (
                    <span className="min-w-[100px] flex-1 rounded-md border border-primary/30 bg-primary/5 px-1.5 py-1 text-[11px] text-primary truncate">
                      🔗 {libraryWorkouts.find((w) => w.id === activity.workoutId)?.title || activity.workoutId}
                    </span>
                  ) : (
                    <>
                      <select value={activity.type}
                        onChange={(e) => setRecurringActivities(recurringActivities.map((a, i) => i === idx ? { ...a, type: e.target.value } : a))}
                        className="rounded-md border border-input bg-background px-1.5 py-1 text-[11px]">
                        <option value="strength">{workoutTypeLabels.strength}</option>
                        <option value="stretch">{workoutTypeLabels.stretch}</option>
                        <option value="cross_training">{workoutTypeLabels.cross_training}</option>
                      </select>
                      <input type="text" value={activity.title} placeholder={t.recurringTitlePlaceholder}
                        onChange={(e) => setRecurringActivities(recurringActivities.map((a, i) => i === idx ? { ...a, title: e.target.value } : a))}
                        className="min-w-[100px] flex-1 rounded-md border border-input bg-background px-1.5 py-1 text-[11px]" />
                    </>
                  )}
                  <select value={activity.workoutId || ''}
                    onChange={(e) => setRecurringActivities(recurringActivities.map((a, i) => i === idx ? { ...a, workoutId: e.target.value || undefined } : a))}
                    title={t.recurringPickWorkoutHint}
                    className="rounded-md border border-input bg-background px-1.5 py-1 text-[11px] max-w-[130px]">
                    <option value="">{t.recurringPickWorkout}</option>
                    {libraryWorkouts.map((w) => <option key={w.id} value={w.id}>{w.title}</option>)}
                  </select>
                  <input type="text" value={activity.notes || ''} placeholder={t.recurringNotesPlaceholder}
                    onChange={(e) => setRecurringActivities(recurringActivities.map((a, i) => i === idx ? { ...a, notes: e.target.value } : a))}
                    className="min-w-[80px] flex-1 rounded-md border border-input bg-background px-1.5 py-1 text-[11px]" />
                  <button type="button" onClick={() => setRecurringActivities(recurringActivities.filter((_, i) => i !== idx))}
                    className="rounded-md p-1 text-muted-foreground hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]"
                onClick={() => setRecurringActivities([...recurringActivities, {
                  id: localId('recurring'), dayOfWeek: 'monday', frequency: 'every_week', type: 'strength', title: '', notes: '',
                }])}>
                {t.recurringAdd}
              </Button>
            </div>

            <div className="rounded-md border border-dashed border-input p-2 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t.specialEventsTitle}</p>
              <p className="text-[11px] text-muted-foreground">{t.specialEventsHint}</p>
              {specialEvents.map((event, idx) => (
                <div key={event.id} className="flex flex-wrap items-center gap-1.5 rounded-md bg-muted/40 p-1.5">
                  <input type="date" value={event.date}
                    onChange={(e) => setSpecialEvents(specialEvents.map((ev, i) => i === idx ? { ...ev, date: e.target.value } : ev))}
                    className="rounded-md border border-input bg-background px-1.5 py-1 text-[11px]" />
                  <input type="text" value={event.label} placeholder={t.specialEventsLabelPlaceholder}
                    onChange={(e) => setSpecialEvents(specialEvents.map((ev, i) => i === idx ? { ...ev, label: e.target.value } : ev))}
                    className="min-w-[100px] flex-1 rounded-md border border-input bg-background px-1.5 py-1 text-[11px]" />
                  <input type="text" value={event.notes || ''} placeholder={t.specialEventsNotesPlaceholder}
                    onChange={(e) => setSpecialEvents(specialEvents.map((ev, i) => i === idx ? { ...ev, notes: e.target.value } : ev))}
                    className="min-w-[100px] flex-1 rounded-md border border-input bg-background px-1.5 py-1 text-[11px]" />
                  <button type="button" onClick={() => setSpecialEvents(specialEvents.filter((_, i) => i !== idx))}
                    className="rounded-md p-1 text-muted-foreground hover:text-destructive">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" className="h-7 text-[11px]"
                onClick={() => setSpecialEvents([...specialEvents, {
                  id: localId('event'), date: new Date().toISOString().slice(0, 10), label: '', notes: '',
                }])}>
                {t.specialEventsAdd}
              </Button>
            </div>

            <div className="rounded-md border border-dashed border-input p-2 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t.cutbackTitle}</p>
              <p className="text-[11px] text-muted-foreground">{t.cutbackHint}</p>
              <div className="flex items-center gap-2">
                <span className="text-[11px] shrink-0 text-muted-foreground">{t.cutbackIntervalLabel}</span>
                <input type="number" min={2} max={8} placeholder={t.cutbackIntervalPlaceholder}
                  value={cutbackIntervalWeeks}
                  onChange={(e) => setCutbackIntervalWeeks(e.target.value === '' ? '' : Number(e.target.value))}
                  className="rounded-md border border-input bg-background px-1.5 py-1 text-[11px] max-w-[80px]" />
              </div>
              <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={cutbackFewerDays} onChange={(e) => setCutbackFewerDays(e.target.checked)} className="mt-0.5" />
                {t.cutbackFewerDaysLabel}
              </label>
              <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
                <input type="checkbox" checked={cutbackDowngradeQuality} onChange={(e) => setCutbackDowngradeQuality(e.target.checked)} className="mt-0.5" />
                {t.cutbackDowngradeLabel}
              </label>
            </div>

            <div className="rounded-md border border-dashed border-input p-2 space-y-2">
              <p className="text-xs font-medium text-muted-foreground">{t.dayTemplateTitle}</p>
              <p className="text-[11px] text-muted-foreground">{t.dayTemplateHint}</p>
              {(['base', 'build', 'peak', 'taper', 'race_week'] as const).map((stageType) => {
                const overrideCount = Object.values(stageDayTypeTemplates[stageType] || {})
                  .filter((v) => (Array.isArray(v) ? v.length > 0 : !!v)).length
                type DayMode = 'fixed' | 'pair' | 'rotate'
                const modeOf = (day: DayKey): DayMode => {
                  const v = stageDayTypeTemplates[stageType]?.[day]
                  if (v && typeof v === 'object' && !Array.isArray(v) && 'rotateWeekly' in v) return 'rotate'
                  if (Array.isArray(v)) return 'pair'
                  return 'fixed'
                }
                const primaryOf = (day: DayKey) => {
                  const v = stageDayTypeTemplates[stageType]?.[day]
                  if (v && typeof v === 'object' && !Array.isArray(v) && 'rotateWeekly' in v) return v.rotateWeekly[0] || ''
                  return (Array.isArray(v) ? v[0] : v) || ''
                }
                const secondaryOf = (day: DayKey) => {
                  const v = stageDayTypeTemplates[stageType]?.[day]
                  if (v && typeof v === 'object' && !Array.isArray(v) && 'rotateWeekly' in v) return v.rotateWeekly[1] || ''
                  return (Array.isArray(v) ? v[1] : '') || ''
                }
                const setDayTemplate = (day: DayKey, primary: string, secondary: string, mode: DayMode) => {
                  setStageDayTypeTemplates((prev) => {
                    const next = { ...prev, [stageType]: { ...prev[stageType] } }
                    if (!primary) delete next[stageType]![day]
                    else if (mode === 'rotate') next[stageType]![day] = { rotateWeekly: [primary, secondary] }
                    else if (mode === 'pair' && secondary) next[stageType]![day] = [primary, secondary]
                    else next[stageType]![day] = primary
                    return next
                  })
                }
                return (
                  <details key={stageType} className="rounded-md bg-muted/40 p-1.5">
                    <summary className="text-[11px] font-semibold text-muted-foreground cursor-pointer select-none flex items-center gap-1.5">
                      {STAGE_TYPE_LABELS[uiLang][stageType]}
                      {overrideCount > 0 && (
                        <span className="rounded-full bg-primary/15 text-primary px-1.5 py-0.5 text-[9px] font-medium">
                          {overrideCount}
                        </span>
                      )}
                    </summary>
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {DAY_ORDER.map((day) => {
                        const primary = primaryOf(day)
                        const secondary = secondaryOf(day)
                        const mode = modeOf(day)
                        return (
                          <div key={day} className="flex flex-col items-center gap-0.5">
                            <span className="text-[9px] text-muted-foreground">{DAY_LABELS[uiLang][day]}</span>
                            <select
                              value={primary}
                              onChange={(e) => setDayTemplate(day, e.target.value, e.target.value ? secondary : '', mode)}
                              className="rounded-md border border-input bg-background px-1 py-0.5 text-[10px]">
                              <option value="">{t.dayTemplateAiDecides}</option>
                              {DAY_TEMPLATE_TYPE_OPTIONS.map((wt) => (
                                <option key={wt} value={wt}>{(workoutTypeLabels as Record<string, string>)[wt] || wt}</option>
                              ))}
                            </select>
                            {primary && (
                              <div className="flex gap-0.5">
                                {([['fixed', t.dayModeFixed], ['pair', t.dayModePair], ['rotate', t.dayModeRotate]] as const).map(([m, label]) => (
                                  <button key={m} type="button"
                                    title={m === 'pair' ? t.dayTemplateSecondHint : m === 'rotate' ? t.dayModeRotateHint : undefined}
                                    onClick={() => setDayTemplate(day, primary, m === mode ? secondary : '', m)}
                                    className={`px-1 py-0.5 rounded text-[8px] border ${mode === m ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground'}`}>
                                    {label}
                                  </button>
                                ))}
                              </div>
                            )}
                            {primary && mode !== 'fixed' && (
                              <select
                                value={secondary}
                                onChange={(e) => setDayTemplate(day, primary, e.target.value, mode)}
                                title={mode === 'rotate' ? t.dayModeRotateHint : t.dayTemplateSecondHint}
                                className="rounded-md border border-input bg-background px-1 py-0.5 text-[10px]">
                                <option value="">{mode === 'rotate' ? t.dayTemplateAiDecides : t.dayTemplateNoSecond}</option>
                                {DAY_TEMPLATE_TYPE_OPTIONS.map((wt) => (
                                  <option key={wt} value={wt}>{mode === 'rotate' ? '' : '+'}{(workoutTypeLabels as Record<string, string>)[wt] || wt}</option>
                                ))}
                              </select>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  </details>
                )
              })}
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
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setGenerationTarget('current_stage')}
              className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${generationTarget === 'current_stage' ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
              {t.continueCurrentStageBtn}
            </button>
            {GENERATION_TARGET_STAGES.map((stageType) => (
              <button key={stageType} type="button" onClick={() => setGenerationTarget(stageType)}
                className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${generationTarget === stageType ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                {STAGE_TYPE_LABELS[uiLang][stageType]}
              </button>
            ))}
            <button type="button" onClick={() => setGenerationTarget('whole_season')}
              className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${generationTarget === 'whole_season' ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
              {t.wholeSeasonBtn}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground mt-1">{t.generationCapNote}</p>
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
