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
import { format, addDays, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { useLatestStepTest } from '@/hooks/useLatestStepTest'
import { saveJourney } from '@/lib/journey'
import { interpolateAtLactate } from '@/lib/physiology'
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
type RaceDistance = '5k' | '10k' | 'half_marathon' | 'marathon'
const EXPERIENCE_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'professional']
const MILEAGE_PRESETS = [15, 25, 35, 45, 55, 65, 80]
const RACE_DISTANCES: RaceDistance[] = ['5k', '10k', 'half_marathon', 'marathon']
const RACE_DISTANCE_LABELS: Record<RaceDistance, string> = {
  '5k': '5K', '10k': '10K', half_marathon: 'Half Marathon', marathon: 'Marathon',
}
const GOAL_TIME_PRESETS: Record<RaceDistance, string[]> = {
  '5k': ['16:00', '18:00', '20:00', '22:00', '25:00', '28:00', '32:00'],
  '10k': ['34:00', '38:00', '42:00', '46:00', '50:00', '55:00', '60:00'],
  half_marathon: ['1:15:00', '1:25:00', '1:35:00', '1:45:00', '1:55:00', '2:10:00', '2:30:00'],
  marathon: ['2:45:00', '3:00:00', '3:15:00', '3:30:00', '3:45:00', '4:00:00', '4:30:00', '5:00:00'],
}

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
    weeklyMileage: 'Weekly mileage (km)',
    injuryHistory: 'Injury history',
    injuryPlaceholder: 'Any current or recurring injuries?',
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
    generateBtn: 'Generate full season',
    notesSaved: 'Notes saved',
    notesFailed: 'Failed to save notes',
    profileNotFound: 'Athlete profile not found',
    clearingPrevious: 'Clearing previous Bakken-generated season...',
    setGoalRaceFirst: "Set a Goal Race Date for this athlete first — go to their profile page → Profile tab → Edit Profile → Goal Race Date — then generate the Bakken season plan.",
    designingSkeleton: 'Designing season skeleton...',
    skeletonFailed: (err: string) => `Skeleton generation failed: ${err}. Try again.`,
    blockFailed: (n: number, err: string, written: number) => `Block ${n} failed: ${err}. ${written} workouts from earlier blocks are already saved.`,
    generatingBlock: (from: string, to: string, i: number, total: number) => `Generating ${from} → ${to} (block ${i}/${total})...`,
    seasonWritten: (n: number) => `Bakken season plan written: ${n} workouts`,
    generateFailed: 'Failed to generate Bakken AI plan',
  },
  he: {
    cardTitle: 'מאמן AI בקן',
    cardDesc: 'בונה מראש את כל העונה של הספורטאי — שלד שלבים לפי מירוץ היעד, אימונים יום-אחר-יום מהמוח של בקן/אלמגרן, יעדי קצב/דופק מבוססי מעבדה. כותב ישירות ללוח האימונים. הספורטאי רואה רק את השבועיים הראשונים; השאר נחשף אוטומטית כל שבת.',
    knowsAbout: (name: string) => `כל מה שמאמן ה-AI של בקן יודע על ${name} — ניתן לערוך כאן לפני היצירה אם משהו השתנה`,
    planLanguage: 'שפת התוכנית (טקסט האימון, חימום/שחרור, הערות)',
    experienceLevel: 'רמת ניסיון',
    weeklyMileage: 'ק"מ שבועי',
    injuryHistory: 'היסטוריית פציעות',
    injuryPlaceholder: 'פציעות נוכחיות או חוזרות?',
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
    generateBtn: 'צור עונה מלאה',
    notesSaved: 'ההערות נשמרו',
    notesFailed: 'שמירת ההערות נכשלה',
    profileNotFound: 'פרופיל הספורטאי לא נמצא',
    clearingPrevious: 'מנקה עונה קודמת שנוצרה על ידי בקן...',
    setGoalRaceFirst: 'קבע/י תאריך מירוץ יעד לספורטאי קודם — לך/י לעמוד הפרופיל שלו ← לשונית פרופיל ← עריכת פרופיל ← תאריך מירוץ יעד — ואז צור/י את תוכנית העונה של בקן.',
    designingSkeleton: 'מתכנן שלד עונה...',
    skeletonFailed: (err: string) => `יצירת השלד נכשלה: ${err}. נסה/י שוב.`,
    blockFailed: (n: number, err: string, written: number) => `בלוק ${n} נכשל: ${err}. ${written} אימונים מבלוקים קודמים כבר נשמרו.`,
    generatingBlock: (from: string, to: string, i: number, total: number) => `יוצר ${from} → ${to} (בלוק ${i}/${total})...`,
    seasonWritten: (n: number) => `תוכנית העונה של בקן נכתבה: ${n} אימונים`,
    generateFailed: 'יצירת תוכנית ה-AI של בקן נכשלה',
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
  goalRaceEvent: string
  goalRaceDistance: RaceDistance | ''
  goalRaceDate: string
  goalRaceTarget: string
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
  const [scheduleLoaded, setScheduleLoaded] = useState(false)
  const [summary, setSummary] = useState<AthleteSummary | null>(null)
  const [coachNotes, setCoachNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

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
      setSummary({
        name: d.name || 'Athlete',
        language: d.preferredLanguage === 'en' ? 'en' : 'he',
        experienceLevel: EXPERIENCE_LEVELS.includes(d.experienceLevel) ? d.experienceLevel : '',
        weeklyMileage: d.weeklyMileage,
        injuryHistory: d.injuryHistory || '',
        goalRaceEvent: d.goalRaceEvent || '',
        goalRaceDistance: RACE_DISTANCES.includes(d.goalRaceDistance) ? d.goalRaceDistance : '',
        goalRaceDate: d.goalRaceDate || '',
        goalRaceTarget: d.goalRaceTarget || '',
        physiology: d.physiology,
        personalRecords: Array.isArray(d.personalRecords)
          ? d.personalRecords.slice(0, 5).map((p: any) => ({ event: p.event, time: p.time, date: p.date }))
          : [],
      })
      setCoachNotes(d.coachPrivateNotes || '')
      setScheduleLoaded(true)
    }
    load()
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

  const hasLabTest = !!labSteps && labSteps.length >= 2

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
    if (labSteps && labSteps.length >= 2 && w.bakkenLactateMin != null && w.bakkenLactateMax != null) {
      const atMin = interpolateAtLactate(labSteps, w.bakkenLactateMin)
      const atMax = interpolateAtLactate(labSteps, w.bakkenLactateMax)
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
      const derivedDaysPerWeek = DAY_ORDER.filter((day) => weekSchedule[day] !== 'off').length
      await updateDoc(doc(db, 'users', athleteId), {
        weekSchedule,
        daysPerWeek: derivedDaysPerWeek,
        coachPrivateNotes: coachNotes,
        preferredLanguage: summary.language,
        experienceLevel: summary.experienceLevel || null,
        weeklyMileage: summary.weeklyMileage ?? null,
        injuryHistory: summary.injuryHistory || null,
        goalRaceEvent: summary.goalRaceEvent || null,
        goalRaceDistance: summary.goalRaceDistance || null,
        goalRaceDate: summary.goalRaceDate || null,
        goalRaceTarget: summary.goalRaceTarget || null,
      })

      const profileSnap = await getDoc(doc(db, 'users', athleteId))
      if (!profileSnap.exists()) {
        toast.error(t.profileNotFound)
        return
      }
      const profile = profileSnap.data() as any

      // Regeneration must REPLACE the previous Bakken-generated season, not
      // stack on top of it. Without this, every re-click during testing (or
      // any future re-generate) leaves the prior run's workouts in place —
      // doubled/overlapping sessions on the same dates, weekly km silently
      // summing both runs, and (via the journey doc below) scrambled stage
      // labels once more than one Bakken journey exists at once. Only
      // deletes assignedWorkouts this feature created (source:'bakken') —
      // never touches anything the coach assigned manually.
      setProgress(t.clearingPrevious)
      const priorSnap = await getDocs(
        query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId), where('source', '==', 'bakken')),
      )
      if (!priorSnap.empty) {
        await Promise.all(priorSnap.docs.map((d) => deleteDoc(d.ref)))
      }

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

      // Anchor the season's starting volume to what the athlete has ACTUALLY
      // been running (averaged over whichever of the last 3 weeks have real
      // logged data), not the onboarding self-report — that number can be
      // stale or optimistic. Falls back to the self-report only when there's
      // no logged history yet (brand new athlete).
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
        coachNotes: profile.coachPrivateNotes,
        goalRaceEvent: profile.goalRaceEvent || 'Goal Race',
        goalRaceDistance: profile.goalRaceDistance,
        goalRaceDate: profile.goalRaceDate,
        goalRaceTarget: profile.goalRaceTarget,
        personalRecords: Array.isArray(profile.personalRecords)
          ? profile.personalRecords.slice(0, 5).map((p: any) => ({ event: p.event, time: p.time, date: p.date }))
          : [],
        physiology: {
          hasLabTest: !!labSteps && labSteps.length >= 2,
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

      // 1. Season skeleton — one Bakken-brain call decides phase lengths
      // (in weeks), volume ramp, and key workout types per phase. Only the
      // date arithmetic below is code, not the model.
      const startDateStr = format(today, 'yyyy-MM-dd')
      const totalWeeksAvailable = Math.max(
        1,
        Math.ceil((new Date(profile.goalRaceDate).getTime() - today.getTime()) / (7 * 86400000)),
      )
      const currentWeeklyKm = actualAvgWeeklyKm ?? profile.weeklyMileage ?? 30
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

      const journeyDoc: JourneyDoc = {
        // Stable, not localId('journey') — each regenerate must overwrite
        // the same journey doc (saveJourney does a setDoc), not create a
        // second one that overlaps the first and scrambles which stage the
        // calendar shows for a given week.
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

      // 2. Split the season into ~14-day blocks, capped for cost/time.
      const blocks: { startDate: string; endDate: string }[] = []
      let cursor = journeyDoc.startDate
      while (cursor <= journeyDoc.goalRaceDate && blocks.length < MAX_BLOCKS) {
        const end = dateMin(addDaysStr(cursor, BLOCK_DAYS - 1), journeyDoc.goalRaceDate)
        blocks.push({ startDate: cursor, endDate: end })
        cursor = addDaysStr(end, 1)
      }

      // 3. Fill in each block from the Bakken brain, writing as we go.
      let previousBlockTail: Array<{ date: string; type: string; title: string }> | undefined
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
              <div className="flex flex-wrap gap-1.5">
                {MILEAGE_PRESETS.map((km) => (
                  <button key={km} type="button" onClick={() => setAthleteField('weeklyMileage', km)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.weeklyMileage === km ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                    {km}
                  </button>
                ))}
              </div>
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
              {summary.goalRaceDistance ? (
                <div className="flex flex-wrap gap-1.5">
                  {GOAL_TIME_PRESETS[summary.goalRaceDistance].map((timeOpt) => (
                    <button key={timeOpt} type="button" onClick={() => setAthleteField('goalRaceTarget', timeOpt)}
                      className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.goalRaceTarget === timeOpt ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                      {timeOpt}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t.pickDistanceFirst}</p>
              )}
            </div>

            {summary.personalRecords.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">{t.recentPRs}</span>
                <span className="text-foreground">
                  {summary.personalRecords.map((p) => `${p.event} ${p.time} (${p.date})`).join(' · ')}
                </span>
              </div>
            )}

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
        <Button onClick={generate} disabled={loading || !summary}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {t.generateBtn}
        </Button>
        {progress && <div className="text-sm text-muted-foreground">{progress}</div>}
        {lastSummary && (
          <div className="text-sm text-muted-foreground border-t pt-4 whitespace-pre-wrap">{lastSummary}</div>
        )}
      </CardContent>
    </Card>
  )
}
