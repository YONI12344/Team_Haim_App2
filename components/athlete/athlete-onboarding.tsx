'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { doc, getDoc, setDoc, serverTimestamp, arrayUnion } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { Loader2, ChevronRight, ChevronLeft, Check } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Athlete onboarding. Collects the profile the coach and the AI coach plan
 * from — the original fields plus the 18-chapter brain's extended intake
 * (training hours, fiber leaning, job demand, injury detail, threshold
 * testing, lab markers...), stored on users/{uid} under the same names that
 * lib/ai-coach/season-pipeline.ts reads. Everything past the core fields is
 * optional; nothing here talks to the AI.
 */

type Lang = 'en' | 'he'
type Discipline = 'track' | 'road' | 'trail' | 'jogger' | 'mixed'
type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'professional'
type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
type DayType = 'workout' | 'rest' | 'off'
type RaceDistance = '1500m' | 'mile' | '3000m' | '5k' | '10k' | '15k' | 'half_marathon' | 'marathon'
type CurrentShape = 'just_starting' | 'returning' | 'consistent' | 'peak_fitness'
type FiberLeaning = 'fast_explosive' | 'endurance' | 'in_between'
type JobDemand = 'sedentary' | 'on_feet' | 'physically_demanding'
type InjuryDetail = 'none' | 'recurring_asymmetric' | 'stress_fracture_history' | 'low_bone_density' | 'currently_nursing'
type Interruptions = 'no' | 'once' | 'multiple_times'
type ThresholdMethod = 'lactate_meter' | 'recent_race' | 'max_hr_talk_test' | 'not_sure'
type LactateMeter = 'have_one' | 'considering' | 'not_planning'
type LabMarker = 'ferritin' | 'vitamin_d' | 'b12' | 'none_checked' | 'not_sure'
type CycleTracking = 'yes' | 'no' | 'not_applicable'

const RACE_DISTANCES: RaceDistance[] = ['1500m', 'mile', '3000m', '5k', '10k', '15k', 'half_marathon', 'marathon']
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
const DAY_ORDER: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_TYPES: DayType[] = ['workout', 'rest', 'off']
const MILEAGE_PRESETS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 100, 120]
const HOURS_PRESETS = [2, 3, 4, 5, 6, 8, 10, 12]
const CURRENT_SHAPES: CurrentShape[] = ['just_starting', 'returning', 'consistent', 'peak_fitness']

const COPY = {
  en: {
    steps: ['Language', 'Welcome', 'About you', 'Your training', 'Body & history', 'Testing', 'Goal race', 'Ready'],
    welcomeTitle: 'Your season starts here',
    welcomeBody: 'A few questions so your coach can build a plan that fits you. About 3 minutes; everything can be changed later in your profile.',
    start: "Let's go",
    back: 'Back',
    next: 'Next',
    finish: 'Save & finish',
    optional: 'optional',
    name: 'Full name', dob: 'Date of birth', gender: 'Gender',
    genders: { male: 'Male', female: 'Female', other: 'Other' },
    height: 'Height (cm)', weight: 'Weight (kg)', events: 'Events you run (e.g. 5k, 10k, marathon)',
    discipline: 'What kind of running?',
    disciplines: { track: 'Track', road: 'Road', trail: 'Trail', jogger: 'Jogging', mixed: 'Mixed' },
    experience: 'Experience level',
    levels: { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', professional: 'Elite' },
    mileage: 'Average weekly km right now', mileageTyped: 'or type exact km',
    hours: 'Hours a week you can train (incl. gym / cross-training)',
    days: 'Your week', daysHint: "Mark each day — including days you can't run at all.",
    dayLabels: { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' },
    dayTypes: { workout: 'Can train', rest: 'Rest day', off: "Can't run" },
    longRunDay: 'Preferred long-run day',
    shape: 'How is your fitness right now?',
    shapes: { just_starting: 'Just starting out', returning: 'Back after a break', consistent: 'Training consistently', peak_fitness: 'Peak shape / just raced' },
    restingHR: 'Resting heart rate (bpm)', maxHR: 'Max heart rate (bpm)', hrHint: "Don't know? Leave it — we'll estimate.",
    injuries: 'Injuries in the last 12 months', injuriesPh: 'Anything current or recurring?',
    injuryDetail: 'Any of these apply?',
    injuryDetails: { none: 'None', recurring_asymmetric: 'Keeps coming back on one side', stress_fracture_history: 'Had a stress fracture', low_bone_density: 'Low bone density', currently_nursing: 'Nursing an injury now' },
    interruptions: 'Have injuries or illness stopped your training before?',
    interruptionOpts: { no: 'No', once: 'Once', multiple_times: 'More than once' },
    job: 'Your day job is mostly…',
    jobs: { sedentary: 'Sitting', on_feet: 'On my feet', physically_demanding: 'Physically hard' },
    fiber: 'You feel more like a…',
    fibers: { fast_explosive: 'Sprinter — fast & explosive', endurance: 'Diesel — goes forever', in_between: 'Somewhere between' },
    cycle: 'Do you track your menstrual cycle?',
    cycles: { yes: 'Yes', no: 'No', not_applicable: 'Not relevant' },
    testingIntro: 'The Team Haim method trains by threshold. These help your coach set your zones.',
    threshold: 'How do you know your threshold today?',
    thresholds: { lactate_meter: 'Lactate test', recent_race: 'From a recent race', max_hr_talk_test: 'Heart rate / talk test', not_sure: 'Not sure yet' },
    meter: 'Lactate meter',
    meters: { have_one: 'I have one', considering: 'Thinking about it', not_planning: 'No plans' },
    labs: 'Blood markers you checked this year',
    labOpts: { ferritin: 'Ferritin', vitamin_d: 'Vitamin D', b12: 'B12', none_checked: 'None checked', not_sure: 'Not sure' },
    goalDistance: 'Goal distance', raceName: 'Race name', raceNamePh: 'e.g. Tel Aviv Marathon',
    raceDate: 'Race date', goalTime: 'Goal time', goalTimePh: 'e.g. 3:30:00',
    recentRace: 'Recent race result', recentRaceHint: 'Sets accurate pace targets even without a lab test.',
    finishTime: 'Finish time', hoursU: 'hours', minutesU: 'min', secondsU: 'sec',
    distances: { '1500m': '1500m', mile: 'Mile', '3000m': '3000m', '5k': '5K', '10k': '10K', '15k': '15K', half_marathon: 'Half', marathon: 'Marathon' },
    doneTitle: "You're in",
    doneBody: 'Your coach can now see everything and build your season.',
    strava: 'Connect Strava', stravaBody: 'Your runs sync to Team Haim automatically.',
    toHome: 'Go to my plan',
    later: 'You can connect Strava later from your profile.',
    saveFailed: 'Could not save — check your connection and try again.',
    required: 'Add your name to continue.',
  },
  he: {
    steps: ['שפה', 'ברוכים הבאים', 'עליך', 'האימונים שלך', 'גוף והיסטוריה', 'בדיקות', 'מירוץ היעד', 'מוכן'],
    welcomeTitle: 'העונה שלך מתחילה כאן',
    welcomeBody: 'כמה שאלות כדי שהמאמן יבנה לך תוכנית שמתאימה בדיוק לך. בערך 3 דקות, והכל אפשר לשנות אחר כך בפרופיל.',
    start: 'יאללה, מתחילים',
    back: 'חזרה',
    next: 'הבא',
    finish: 'שמירה וסיום',
    optional: 'לא חובה',
    name: 'שם מלא', dob: 'תאריך לידה', gender: 'מגדר',
    genders: { male: 'זכר', female: 'נקבה', other: 'אחר' },
    height: 'גובה (ס"מ)', weight: 'משקל (ק"ג)', events: 'מקצים שאת/ה רץ/ה (למשל 5 ק"מ, 10 ק"מ, מרתון)',
    discipline: 'איזה סוג ריצה?',
    disciplines: { track: 'מסלול', road: 'כביש', trail: 'שטח', jogger: 'ריצה קלה', mixed: 'משולב' },
    experience: 'רמת ניסיון',
    levels: { beginner: 'מתחיל/ה', intermediate: 'בינוני', advanced: 'מתקדם/ת', professional: 'עילית' },
    mileage: 'ק"מ שבועי ממוצע כרגע', mileageTyped: 'או הקלד/י ק"מ מדויק',
    hours: 'שעות בשבוע שאפשר להתאמן (כולל חדר כושר / אימון משלים)',
    days: 'השבוע שלך', daysHint: 'סמן/י כל יום — כולל ימים שבהם אי אפשר לרוץ בכלל.',
    dayLabels: { sunday: 'א׳', monday: 'ב׳', tuesday: 'ג׳', wednesday: 'ד׳', thursday: 'ה׳', friday: 'ו׳', saturday: 'ש׳' },
    dayTypes: { workout: 'אפשר', rest: 'מנוחה', off: 'לא זמין' },
    longRunDay: 'יום מועדף לריצה ארוכה',
    shape: 'איך הכושר שלך כרגע?',
    shapes: { just_starting: 'רק מתחיל/ה', returning: 'חוזר/ת אחרי הפסקה', consistent: 'מתאמן/ת באופן עקבי', peak_fitness: 'בשיא / התחרתי לאחרונה' },
    restingHR: 'דופק מנוחה', maxHR: 'דופק מקסימלי', hrHint: 'לא יודע/ת? אפשר להשאיר — נעריך.',
    injuries: 'פציעות ב-12 החודשים האחרונים', injuriesPh: 'משהו נוכחי או שחוזר?',
    injuryDetail: 'משהו מאלה מתאים?',
    injuryDetails: { none: 'כלום', recurring_asymmetric: 'חוזרת בצד אחד', stress_fracture_history: 'היה שבר מאמץ', low_bone_density: 'צפיפות עצם נמוכה', currently_nursing: 'מתאושש/ת מפציעה עכשיו' },
    interruptions: 'פציעה או מחלה עצרו לך אימונים בעבר?',
    interruptionOpts: { no: 'לא', once: 'פעם אחת', multiple_times: 'יותר מפעם' },
    job: 'העבודה שלך בעיקר…',
    jobs: { sedentary: 'בישיבה', on_feet: 'על הרגליים', physically_demanding: 'פיזית קשה' },
    fiber: 'את/ה מרגיש/ה יותר כמו…',
    fibers: { fast_explosive: 'ספרינטר — מהיר ונפיץ', endurance: 'דיזל — הולך לנצח', in_between: 'באמצע' },
    cycle: 'את עוקבת אחרי המחזור?',
    cycles: { yes: 'כן', no: 'לא', not_applicable: 'לא רלוונטי' },
    testingIntro: 'שיטת Team Haim מתאמנת לפי סף. זה עוזר למאמן לקבוע לך אזורים.',
    threshold: 'איך את/ה יודע/ת היום מה הסף שלך?',
    thresholds: { lactate_meter: 'בדיקת לקטט', recent_race: 'ממירוץ אחרון', max_hr_talk_test: 'דופק / מבחן דיבור', not_sure: 'עוד לא יודע/ת' },
    meter: 'מד לקטט',
    meters: { have_one: 'יש לי', considering: 'שוקל/ת', not_planning: 'לא מתכנן/ת' },
    labs: 'בדיקות דם שעשית השנה',
    labOpts: { ferritin: 'פריטין', vitamin_d: 'ויטמין D', b12: 'B12', none_checked: 'לא בדקתי', not_sure: 'לא בטוח/ה' },
    goalDistance: 'מרחק היעד', raceName: 'שם המירוץ', raceNamePh: 'למשל מרתון תל אביב',
    raceDate: 'תאריך המירוץ', goalTime: 'זמן יעד', goalTimePh: 'למשל 3:30:00',
    recentRace: 'תוצאת מירוץ אחרונה', recentRaceHint: 'קובעת יעדי קצב מדויקים גם בלי בדיקת מעבדה.',
    finishTime: 'זמן סיום', hoursU: 'שעות', minutesU: 'דקות', secondsU: 'שניות',
    distances: { '1500m': '1500 מ׳', mile: 'מייל', '3000m': '3000 מ׳', '5k': '5 ק"מ', '10k': '10 ק"מ', '15k': '15 ק"מ', half_marathon: 'חצי מרתון', marathon: 'מרתון' },
    doneTitle: 'את/ה בפנים',
    doneBody: 'המאמן רואה עכשיו הכל ויכול לבנות לך את העונה.',
    strava: 'חיבור Strava', stravaBody: 'הריצות שלך יסתנכרנו אוטומטית ל-Team Haim.',
    toHome: 'לתוכנית שלי',
    later: 'אפשר לחבר Strava גם אחר כך מהפרופיל.',
    saveFailed: 'השמירה נכשלה — בדוק/י חיבור ונסה/י שוב.',
    required: 'צריך שם כדי להמשיך.',
  },
} as const

interface OnboardingForm {
  name: string; dateOfBirth: string; gender: '' | 'male' | 'female' | 'other'
  height: string; weight: string; events: string
  discipline: Discipline[]; experienceLevel: ExperienceLevel | ''
  weeklyMileage: string; weeklyTrainingHours: string
  weekSchedule: Record<DayKey, DayType>; longRunDay: DayKey | ''
  currentShape: CurrentShape | ''
  restingHR: string; maxHR: string; injuryHistory: string
  injuryHistoryDetail: InjuryDetail[]; priorTrainingInterruptions: Interruptions | ''
  occupationalPhysicalDemand: JobDemand | ''; muscleFiberLeaning: FiberLeaning | ''
  menstrualCycleTracking: CycleTracking | ''
  thresholdTestingMethod: ThresholdMethod | ''; accessToLactateMeter: LactateMeter | ''
  labMarkersKnown: LabMarker[]
  goalRaceEvent: string; goalRaceDistance: RaceDistance | ''; goalRaceDate: string; goalRaceTarget: string
  recentRaceDistance: RaceDistance | ''; recentRaceHours: number
  recentRaceMinutes: number | ''; recentRaceSeconds: number | ''; recentRaceDate: string
}

const EMPTY: OnboardingForm = {
  name: '', dateOfBirth: '', gender: '', height: '', weight: '', events: '',
  discipline: [], experienceLevel: '', weeklyMileage: '', weeklyTrainingHours: '',
  weekSchedule: { sunday: 'workout', monday: 'workout', tuesday: 'workout', wednesday: 'workout', thursday: 'workout', friday: 'rest', saturday: 'workout' },
  longRunDay: '', currentShape: '',
  restingHR: '', maxHR: '', injuryHistory: '',
  injuryHistoryDetail: [], priorTrainingInterruptions: '', occupationalPhysicalDemand: '', muscleFiberLeaning: '',
  menstrualCycleTracking: '', thresholdTestingMethod: '', accessToLactateMeter: '', labMarkersKnown: [],
  goalRaceEvent: '', goalRaceDistance: '', goalRaceDate: '', goalRaceTarget: '',
  recentRaceDistance: '', recentRaceHours: 0, recentRaceMinutes: '', recentRaceSeconds: '', recentRaceDate: '',
}

const oneOf = <T extends string>(v: unknown, opts: readonly T[]): T | '' => (opts.includes(v as T) ? (v as T) : '')
const listOf = <T extends string>(v: unknown, opts: readonly T[]): T[] => (Array.isArray(v) ? v.filter((x) => opts.includes(x)) : [])

const inputCls = 'w-full rounded-xl border border-input bg-background px-3.5 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground/60 transition-colors duration-150 focus:border-gold focus:outline-none focus:ring-2 focus:ring-gold/25'

function Field({ label, hint, optional, children }: { label: string; hint?: string; optional?: string; children: ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-sm font-semibold text-navy">
        {label}
        {optional && <span className="ms-1.5 text-xs font-normal text-muted-foreground">({optional})</span>}
      </p>
      {hint && <p className="-mt-1 mb-2 text-xs text-muted-foreground">{hint}</p>}
      {children}
    </div>
  )
}

function Chips<T extends string>({ options, labels, value, onChange, multi, columns }: {
  options: readonly T[]
  labels: Record<T, string>
  value: T | '' | T[]
  onChange: (next: any) => void
  multi?: boolean
  columns?: 2 | 3 | 4
}) {
  const selected = (o: T) => (Array.isArray(value) ? value.includes(o) : value === o)
  const toggle = (o: T) => {
    if (!multi) return onChange(value === o ? '' : o)
    const arr = value as T[]
    onChange(arr.includes(o) ? arr.filter((x) => x !== o) : [...arr, o])
  }
  return (
    <div
      role={multi ? 'group' : 'radiogroup'}
      className={cn(columns ? `grid gap-2 ${{ 2: 'grid-cols-2', 3: 'grid-cols-3', 4: 'grid-cols-4' }[columns]}` : 'flex flex-wrap gap-2')}
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role={multi ? 'checkbox' : 'radio'}
          aria-checked={selected(o)}
          onClick={() => toggle(o)}
          className={cn(
            'min-h-10 rounded-xl border px-3 py-2 text-sm font-medium transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.97]',
            selected(o) ? 'border-navy bg-navy text-white' : 'border-border text-foreground hover:border-navy/40',
          )}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  )
}

export function AthleteOnboarding() {
  const { user } = useAuth()
  const { language, setLanguage } = useLanguage()
  const router = useRouter()
  const lang: Lang = language === 'en' ? 'en' : 'he'
  const c = COPY[lang]
  const isRTL = lang === 'he'
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stravaConnecting, setStravaConnecting] = useState(false)
  const [form, setForm] = useState<OnboardingForm>(EMPTY)

  useEffect(() => { if (user?.name) setForm(f => ({ ...f, name: f.name || user.name })) }, [user?.name])

  // Athletes sent back through onboarding keep whatever they already filled in.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    getDoc(doc(db, 'users', user.id)).then((snap) => {
      if (cancelled || !snap.exists()) return
      const d = snap.data() as any
      setForm(f => ({
        ...f,
        name: d.name || f.name,
        dateOfBirth: d.dateOfBirth || '',
        gender: oneOf(d.gender, ['male', 'female', 'other'] as const),
        height: d.height != null ? String(d.height) : '',
        weight: d.weight != null ? String(d.weight) : '',
        events: Array.isArray(d.events) ? d.events.join(', ') : '',
        discipline: listOf(d.discipline, ['track', 'road', 'trail', 'jogger', 'mixed'] as const),
        experienceLevel: oneOf(d.experienceLevel, ['beginner', 'intermediate', 'advanced', 'professional'] as const),
        weeklyMileage: d.weeklyMileage != null ? String(d.weeklyMileage) : '',
        weeklyTrainingHours: d.weeklyTrainingHours != null ? String(d.weeklyTrainingHours) : '',
        weekSchedule: d.weekSchedule && DAY_ORDER.every((day) => d.weekSchedule[day])
          ? Object.fromEntries(DAY_ORDER.map((day) => [day, d.weekSchedule[day] === 'off' ? 'off' : d.weekSchedule[day] === 'rest' ? 'rest' : 'workout'])) as Record<DayKey, DayType>
          : f.weekSchedule,
        longRunDay: oneOf(d.longRunDay, DAY_ORDER),
        currentShape: oneOf(d.currentShape, CURRENT_SHAPES),
        restingHR: d.restingHR != null ? String(d.restingHR) : '',
        maxHR: d.maxHR != null ? String(d.maxHR) : '',
        injuryHistory: d.injuryHistory || '',
        injuryHistoryDetail: listOf(d.injuryHistoryDetail, ['none', 'recurring_asymmetric', 'stress_fracture_history', 'low_bone_density', 'currently_nursing'] as const),
        priorTrainingInterruptions: oneOf(d.priorTrainingInterruptions, ['no', 'once', 'multiple_times'] as const),
        occupationalPhysicalDemand: oneOf(d.occupationalPhysicalDemand, ['sedentary', 'on_feet', 'physically_demanding'] as const),
        muscleFiberLeaning: oneOf(d.muscleFiberLeaning, ['fast_explosive', 'endurance', 'in_between'] as const),
        menstrualCycleTracking: oneOf(d.menstrualCycleTracking, ['yes', 'no', 'not_applicable'] as const),
        thresholdTestingMethod: oneOf(d.thresholdTestingMethod, ['lactate_meter', 'recent_race', 'max_hr_talk_test', 'not_sure'] as const),
        accessToLactateMeter: oneOf(d.accessToLactateMeter, ['have_one', 'considering', 'not_planning'] as const),
        labMarkersKnown: listOf(d.labMarkersKnown, ['ferritin', 'vitamin_d', 'b12', 'none_checked', 'not_sure'] as const),
        goalRaceEvent: d.goalRaceEvent || '',
        goalRaceDistance: oneOf(d.goalRaceDistance, RACE_DISTANCES),
        goalRaceDate: d.goalRaceDate || '',
        goalRaceTarget: d.goalRaceTarget || '',
      }))
      if (d.preferredLanguage === 'en' || d.preferredLanguage === 'he') setLanguage(d.preferredLanguage)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [user?.id])

  const set = <K extends keyof OnboardingForm>(key: K, value: OnboardingForm[K]) => setForm(f => ({ ...f, [key]: value }))

  const showRaceHours = form.recentRaceDistance === 'half_marathon' || form.recentRaceDistance === 'marathon'
  const formattedRecentRaceTime = () => {
    const m = form.recentRaceMinutes === '' ? 0 : form.recentRaceMinutes
    const s = form.recentRaceSeconds === '' ? 0 : form.recentRaceSeconds
    if (form.recentRaceHours === 0 && m === 0 && s === 0) return null
    const pad = (n: number) => String(n).padStart(2, '0')
    return form.recentRaceHours > 0 ? `${form.recentRaceHours}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
  }
  const num = (v: string) => (v.trim() === '' ? null : Number(v))

  const handleSave = async () => {
    if (!user?.id) return
    setSaving(true)
    setError(null)
    try {
      const recentTime = formattedRecentRaceTime()
      await setDoc(doc(db, 'users', user.id), {
        name: form.name.trim(),
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        height: num(form.height),
        weight: num(form.weight),
        events: form.events ? form.events.split(',').map((e) => e.trim()).filter(Boolean) : [],
        discipline: form.discipline,
        experienceLevel: form.experienceLevel || null,
        weeklyMileage: num(form.weeklyMileage),
        weeklyTrainingHours: num(form.weeklyTrainingHours),
        weekSchedule: form.weekSchedule,
        daysPerWeek: DAY_ORDER.filter((day) => form.weekSchedule[day] === 'workout').length,
        longRunDay: form.longRunDay || null,
        currentShape: form.currentShape || null,
        restingHR: num(form.restingHR),
        maxHR: num(form.maxHR),
        injuryHistory: form.injuryHistory.trim() || null,
        injuryHistoryDetail: form.injuryHistoryDetail,
        priorTrainingInterruptions: form.priorTrainingInterruptions || null,
        occupationalPhysicalDemand: form.occupationalPhysicalDemand || null,
        muscleFiberLeaning: form.muscleFiberLeaning || null,
        menstrualCycleTracking: form.gender === 'female' ? (form.menstrualCycleTracking || null) : null,
        thresholdTestingMethod: form.thresholdTestingMethod || null,
        accessToLactateMeter: form.accessToLactateMeter || null,
        labMarkersKnown: form.labMarkersKnown,
        goalRaceEvent: form.goalRaceEvent.trim() || null,
        goalRaceDistance: form.goalRaceDistance || null,
        goalRaceDate: form.goalRaceDate || null,
        goalRaceTarget: form.goalRaceTarget.trim() || null,
        preferredLanguage: lang,
        onboardingComplete: true,
        updatedAt: serverTimestamp(),
        ...(form.recentRaceDistance && recentTime ? {
          personalRecords: arrayUnion({
            id: `pr_${Date.now()}`,
            event: COPY.en.distances[form.recentRaceDistance],
            time: recentTime,
            date: form.recentRaceDate || '',
          }),
        } : {}),
      }, { merge: true })
      setStep(7)
    } catch (e) {
      console.error(e)
      setError(c.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  const handleStravaConnect = () => {
    setStravaConnecting(true)
    const params = new URLSearchParams({
      client_id: '255142',
      response_type: 'code',
      redirect_uri: 'https://app.teamhaim.com/api/strava/callback',
      scope: 'read,activity:read_all',
      approval_prompt: 'force',
    })
    window.location.href = `https://www.strava.com/oauth/authorize?${params.toString()}`
  }

  const next = () => {
    setError(null)
    if (step === 2 && !form.name.trim()) { setError(c.required); return }
    if (step === 6) { handleSave(); return }
    setStep(s => s + 1)
    window.scrollTo({ top: 0 })
  }
  const back = () => { setError(null); setStep(s => s - 1); window.scrollTo({ top: 0 }) }

  const Forward = isRTL ? ChevronLeft : ChevronRight
  const Backward = isRTL ? ChevronRight : ChevronLeft
  const formStep = step >= 2 && step <= 6

  return (
    <div className="min-h-screen bg-background" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="mx-auto flex min-h-screen max-w-lg flex-col px-4 pb-10 pt-6">
        <header className="mb-5 flex items-center justify-between">
          <span className="font-display text-xl font-semibold text-navy" dir="ltr">Team Haim</span>
          {formStep && (
            <span className="text-sm font-medium tabular-nums text-muted-foreground">{step - 1} / 5</span>
          )}
        </header>

        {formStep && (
          <ol className="mb-6 grid grid-cols-5 gap-1.5" aria-hidden>
            {[2, 3, 4, 5, 6].map((i) => (
              <li key={i} className={cn('h-1.5 rounded-full transition-colors duration-300', i <= step ? 'bg-gold' : 'bg-border')} />
            ))}
          </ol>
        )}

        {/* ── 0. Language ── */}
        {step === 0 && (
          <div className="flex flex-1 flex-col justify-center gap-3 step-enter" key="step-0">
            <h1 className="mb-2 text-center font-display text-2xl font-semibold text-navy">בחר/י שפה · Language</h1>
            {(['he', 'en'] as const).map((l) => (
              <button
                key={l}
                onClick={() => { setLanguage(l); setStep(1) }}
                className={cn(
                  'h-14 rounded-2xl border text-lg font-semibold transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.98]',
                  lang === l ? 'border-navy bg-navy text-white' : 'border-border text-navy hover:border-navy/40',
                )}
              >
                {l === 'he' ? 'עברית' : 'English'}
              </button>
            ))}
          </div>
        )}

        {/* ── 1. Welcome ── */}
        {step === 1 && (
          <section className="relative overflow-hidden rounded-2xl bg-navy p-6 text-white shadow-sm step-enter" key="step-1">
            <div className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-gold/25 blur-3xl" aria-hidden />
            <div className="relative">
              <h1 className="text-balance font-display text-3xl font-semibold">{c.welcomeTitle}</h1>
              <p className="mt-3 text-[15px] leading-relaxed text-white/75">{c.welcomeBody}</p>
              <button
                onClick={() => setStep(2)}
                className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gold text-base font-semibold text-navy transition-transform duration-150 ease-out active:scale-[0.97]"
              >
                {c.start} <Forward className="h-5 w-5" />
              </button>
            </div>
          </section>
        )}

        {formStep && (
          <>
            <h1 className="mb-5 font-display text-2xl font-semibold text-navy">{c.steps[step]}</h1>
            <div className="space-y-6 step-enter" key={`step-${step}`}>
              {/* ── 2. About you ── */}
              {step === 2 && (<>
                <Field label={c.name}>
                  <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} autoComplete="name" />
                </Field>
                <Field label={c.dob}>
                  <input type="date" className={inputCls} value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} />
                </Field>
                <Field label={c.gender}>
                  <Chips options={['male', 'female', 'other'] as const} labels={c.genders} value={form.gender} onChange={v => set('gender', v)} columns={3} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={c.height} optional={c.optional}>
                    <input type="number" inputMode="numeric" className={inputCls} value={form.height} onChange={e => set('height', e.target.value)} placeholder="175" dir="ltr" />
                  </Field>
                  <Field label={c.weight} optional={c.optional}>
                    <input type="number" inputMode="decimal" className={inputCls} value={form.weight} onChange={e => set('weight', e.target.value)} placeholder="70" dir="ltr" />
                  </Field>
                </div>
                <Field label={c.events} optional={c.optional}>
                  <input className={inputCls} value={form.events} onChange={e => set('events', e.target.value)} placeholder="5k, 10k" />
                </Field>
              </>)}

              {/* ── 3. Your training ── */}
              {step === 3 && (<>
                <Field label={c.discipline}>
                  <Chips options={['road', 'track', 'trail', 'jogger', 'mixed'] as const} labels={c.disciplines} value={form.discipline} onChange={v => set('discipline', v)} multi />
                </Field>
                <Field label={c.experience}>
                  <Chips options={['beginner', 'intermediate', 'advanced', 'professional'] as const} labels={c.levels} value={form.experienceLevel} onChange={v => set('experienceLevel', v)} columns={2} />
                </Field>
                <Field label={c.mileage}>
                  <div className="mb-2 flex flex-wrap gap-2">
                    {MILEAGE_PRESETS.map(km => (
                      <button key={km} type="button" onClick={() => set('weeklyMileage', String(km))}
                        className={cn('tabular-nums min-h-10 min-w-12 rounded-xl border px-3 text-sm font-semibold transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.97]',
                          form.weeklyMileage === String(km) ? 'border-navy bg-navy text-white' : 'border-border hover:border-navy/40')}>
                        {km}
                      </button>
                    ))}
                  </div>
                  <input type="number" inputMode="numeric" min={0} className={inputCls} value={form.weeklyMileage}
                    onChange={e => set('weeklyMileage', e.target.value)} placeholder={c.mileageTyped} dir="ltr" />
                </Field>
                <Field label={c.hours} optional={c.optional}>
                  <div className="flex flex-wrap gap-2">
                    {HOURS_PRESETS.map(h => (
                      <button key={h} type="button" onClick={() => set('weeklyTrainingHours', form.weeklyTrainingHours === String(h) ? '' : String(h))}
                        className={cn('tabular-nums min-h-10 min-w-12 rounded-xl border px-3 text-sm font-semibold transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.97]',
                          form.weeklyTrainingHours === String(h) ? 'border-navy bg-navy text-white' : 'border-border hover:border-navy/40')}>
                        {h}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label={c.days} hint={c.daysHint}>
                  <div className="space-y-1.5">
                    {DAY_ORDER.map(day => (
                      <div key={day} className="flex items-center gap-2">
                        <span className="w-9 shrink-0 text-xs font-semibold text-muted-foreground">{c.dayLabels[day]}</span>
                        <div className="grid flex-1 grid-cols-3 gap-1.5">
                          {DAY_TYPES.map(type => (
                            <button key={type} type="button"
                              aria-pressed={form.weekSchedule[day] === type}
                              onClick={() => setForm(f => ({ ...f, weekSchedule: { ...f.weekSchedule, [day]: type } }))}
                              className={cn('h-9 rounded-lg border text-xs font-semibold transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.97]',
                                form.weekSchedule[day] === type
                                  ? type === 'workout' ? 'border-pine bg-pine text-white' : 'border-navy bg-navy text-white'
                                  : 'border-border text-muted-foreground hover:border-navy/30')}>
                              {c.dayTypes[type]}
                            </button>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </Field>
                <Field label={c.longRunDay} optional={c.optional}>
                  <Chips options={DAY_ORDER} labels={c.dayLabels} value={form.longRunDay} onChange={v => set('longRunDay', v)} />
                </Field>
                <Field label={c.shape}>
                  <Chips options={CURRENT_SHAPES} labels={c.shapes} value={form.currentShape} onChange={v => set('currentShape', v)} columns={2} />
                </Field>
              </>)}

              {/* ── 4. Body & history ── */}
              {step === 4 && (<>
                <div className="grid grid-cols-2 gap-3">
                  <Field label={c.restingHR} optional={c.optional}>
                    <input type="number" inputMode="numeric" className={inputCls} value={form.restingHR} onChange={e => set('restingHR', e.target.value)} placeholder="50" dir="ltr" />
                  </Field>
                  <Field label={c.maxHR} optional={c.optional}>
                    <input type="number" inputMode="numeric" className={inputCls} value={form.maxHR} onChange={e => set('maxHR', e.target.value)} placeholder="185" dir="ltr" />
                  </Field>
                </div>
                <p className="-mt-3 text-xs text-muted-foreground">{c.hrHint}</p>
                <Field label={c.injuries} optional={c.optional}>
                  <textarea className={cn(inputCls, 'min-h-20')} rows={3} value={form.injuryHistory} onChange={e => set('injuryHistory', e.target.value)} placeholder={c.injuriesPh} />
                </Field>
                <Field label={c.injuryDetail} optional={c.optional}>
                  <Chips
                    options={['none', 'recurring_asymmetric', 'stress_fracture_history', 'low_bone_density', 'currently_nursing'] as const}
                    labels={c.injuryDetails}
                    value={form.injuryHistoryDetail}
                    onChange={(v: InjuryDetail[]) => {
                      // "None" is exclusive: picking it clears the rest, picking anything else clears it.
                      const addedNone = v.includes('none') && !form.injuryHistoryDetail.includes('none')
                      set('injuryHistoryDetail', addedNone ? ['none'] : v.filter(x => x !== 'none'))
                    }}
                    multi
                  />
                </Field>
                <Field label={c.interruptions}>
                  <Chips options={['no', 'once', 'multiple_times'] as const} labels={c.interruptionOpts} value={form.priorTrainingInterruptions} onChange={v => set('priorTrainingInterruptions', v)} columns={3} />
                </Field>
                <Field label={c.job}>
                  <Chips options={['sedentary', 'on_feet', 'physically_demanding'] as const} labels={c.jobs} value={form.occupationalPhysicalDemand} onChange={v => set('occupationalPhysicalDemand', v)} columns={3} />
                </Field>
                <Field label={c.fiber} optional={c.optional}>
                  <Chips options={['fast_explosive', 'endurance', 'in_between'] as const} labels={c.fibers} value={form.muscleFiberLeaning} onChange={v => set('muscleFiberLeaning', v)} />
                </Field>
                {form.gender === 'female' && (
                  <Field label={c.cycle} optional={c.optional}>
                    <Chips options={['yes', 'no', 'not_applicable'] as const} labels={c.cycles} value={form.menstrualCycleTracking} onChange={v => set('menstrualCycleTracking', v)} columns={3} />
                  </Field>
                )}
              </>)}

              {/* ── 5. Testing ── */}
              {step === 5 && (<>
                <p className="text-[15px] leading-relaxed text-foreground/80">{c.testingIntro}</p>
                <Field label={c.threshold}>
                  <Chips options={['lactate_meter', 'recent_race', 'max_hr_talk_test', 'not_sure'] as const} labels={c.thresholds} value={form.thresholdTestingMethod} onChange={v => set('thresholdTestingMethod', v)} columns={2} />
                </Field>
                <Field label={c.meter} optional={c.optional}>
                  <Chips options={['have_one', 'considering', 'not_planning'] as const} labels={c.meters} value={form.accessToLactateMeter} onChange={v => set('accessToLactateMeter', v)} columns={3} />
                </Field>
                <Field label={c.labs} optional={c.optional}>
                  <Chips
                    options={['ferritin', 'vitamin_d', 'b12', 'none_checked', 'not_sure'] as const}
                    labels={c.labOpts}
                    value={form.labMarkersKnown}
                    onChange={(v: LabMarker[]) => {
                      const exclusive = (['none_checked', 'not_sure'] as LabMarker[]).find(x => v.includes(x) && !form.labMarkersKnown.includes(x))
                      set('labMarkersKnown', exclusive ? [exclusive] : v.filter(x => x !== 'none_checked' && x !== 'not_sure'))
                    }}
                    multi
                  />
                </Field>
              </>)}

              {/* ── 6. Goal race ── */}
              {step === 6 && (<>
                <Field label={c.goalDistance}>
                  <Chips options={RACE_DISTANCES} labels={c.distances} value={form.goalRaceDistance} onChange={v => set('goalRaceDistance', v)} columns={4} />
                </Field>
                <Field label={c.raceName} optional={c.optional}>
                  <input className={inputCls} value={form.goalRaceEvent} onChange={e => set('goalRaceEvent', e.target.value)} placeholder={c.raceNamePh} />
                </Field>
                <Field label={c.raceDate}>
                  <input type="date" className={inputCls} value={form.goalRaceDate} onChange={e => set('goalRaceDate', e.target.value)} />
                </Field>
                <Field label={c.goalTime} optional={c.optional}>
                  <input className={inputCls} value={form.goalRaceTarget} onChange={e => set('goalRaceTarget', e.target.value)} placeholder={c.goalTimePh} dir="ltr" />
                  {form.goalRaceDistance && (
                    <div className="mt-2 flex flex-wrap gap-1.5" dir="ltr">
                      {GOAL_TIME_PRESETS[form.goalRaceDistance].map(tm => (
                        <button key={tm} type="button" onClick={() => set('goalRaceTarget', tm)}
                          className={cn('tabular-nums rounded-full border px-2.5 py-1 text-xs font-semibold transition-[transform,background-color,border-color,color] duration-150 ease-out active:scale-[0.97]',
                            form.goalRaceTarget === tm ? 'border-navy bg-navy text-white' : 'border-border text-muted-foreground hover:border-navy/40')}>
                          {tm}
                        </button>
                      ))}
                    </div>
                  )}
                </Field>

                <div className="border-t border-border" />

                <Field label={c.recentRace} hint={c.recentRaceHint} optional={c.optional}>
                  <Chips options={RACE_DISTANCES} labels={c.distances} value={form.recentRaceDistance} onChange={v => set('recentRaceDistance', v)} columns={4} />
                  <p className="mb-1.5 mt-3 text-xs font-semibold text-muted-foreground">{c.finishTime}</p>
                  <div className={cn('grid gap-2', showRaceHours ? 'grid-cols-3' : 'grid-cols-2')} dir="ltr">
                    {showRaceHours && (
                      <label className="text-[11px] text-muted-foreground">
                        <input type="number" min={0} max={23} className={inputCls} value={form.recentRaceHours}
                          onChange={e => set('recentRaceHours', e.target.value === '' ? 0 : Number(e.target.value))} />
                        {c.hoursU}
                      </label>
                    )}
                    <label className="text-[11px] text-muted-foreground">
                      <input type="number" min={0} max={59} className={inputCls} value={form.recentRaceMinutes}
                        onChange={e => set('recentRaceMinutes', e.target.value === '' ? '' : Number(e.target.value))} />
                      {c.minutesU}
                    </label>
                    <label className="text-[11px] text-muted-foreground">
                      <input type="number" min={0} max={59} className={inputCls} value={form.recentRaceSeconds}
                        onChange={e => set('recentRaceSeconds', e.target.value === '' ? '' : Number(e.target.value))} />
                      {c.secondsU}
                    </label>
                  </div>
                  <input type="date" className={cn(inputCls, 'mt-2')} value={form.recentRaceDate} onChange={e => set('recentRaceDate', e.target.value)} />
                </Field>
              </>)}
            </div>

            {error && <p role="alert" className="mt-5 rounded-xl bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{error}</p>}

            {/* Fixed, not sticky: html/body overflow-x:hidden (globals.css) breaks sticky. */}
            <div className="h-24" aria-hidden />
            <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              <div className="mx-auto flex max-w-lg gap-3 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3">
              <button onClick={back} className="flex h-12 items-center gap-1 rounded-xl border border-border px-4 text-sm font-semibold text-navy transition-[transform,background-color] duration-150 ease-out active:scale-[0.97] hover:bg-navy-tint">
                <Backward className="h-4 w-4" /> {c.back}
              </button>
              <button onClick={next} disabled={saving}
                className="flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-navy text-base font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60 hover:bg-navy-light">
                {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : step === 6 ? c.finish : <>{c.next} <Forward className="h-5 w-5" /></>}
              </button>
              </div>
            </div>
          </>
        )}

        {/* ── 7. Done ── */}
        {step === 7 && (
          <section className="relative overflow-hidden rounded-2xl bg-navy p-6 text-white shadow-sm step-enter" key="step-7">
            <div className="pointer-events-none absolute -end-16 -top-16 h-56 w-56 rounded-full bg-gold/25 blur-3xl" aria-hidden />
            <div className="relative space-y-5">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-gold text-navy">
                <Check className="h-7 w-7" />
              </span>
              <div>
                <h1 className="font-display text-3xl font-semibold">{c.doneTitle}</h1>
                <p className="mt-2 text-[15px] text-white/75">{c.doneBody}</p>
              </div>
              <div className="rounded-xl border border-white/15 p-4">
                <p className="text-[15px] font-semibold">{c.strava}</p>
                <p className="mt-0.5 text-xs text-white/60">{c.stravaBody}</p>
                <button
                  onClick={handleStravaConnect}
                  disabled={stravaConnecting}
                  className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#FC4C02] text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60"
                >
                  {stravaConnecting && <Loader2 className="h-4 w-4 animate-spin" />}
                  {c.strava}
                </button>
              </div>
              <button onClick={() => router.replace('/athlete')}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-gold text-base font-semibold text-navy transition-transform duration-150 ease-out active:scale-[0.97]">
                {c.toHome} <Forward className="h-5 w-5" />
              </button>
              <p className="text-center text-xs text-white/50">{c.later}</p>
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
