'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { doc, getDoc, setDoc, serverTimestamp, arrayUnion } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { Loader2, ChevronRight, ChevronLeft, Check } from 'lucide-react'

type Discipline = 'track' | 'road' | 'trail' | 'jogger' | 'mixed'
type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'professional'
type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
type DayType = 'workout' | 'long_run' | 'easy' | 'rest' | 'off'
type RaceDistance = '1500m' | 'mile' | '3000m' | '5k' | '10k' | '15k' | 'half_marathon' | 'marathon'
type CurrentShape = 'just_starting' | 'returning' | 'consistent' | 'peak_fitness'

// Wider than just the road-race staples — track/sub-elite athletes race
// 1500m/mile/3000m too. Anything without explicit brain guidance for its
// exact distance still gets a real plan (the brain reasons by analogy to
// the nearest distance it does cover).
const RACE_DISTANCES: RaceDistance[] = ['1500m', 'mile', '3000m', '5k', '10k', '15k', 'half_marathon', 'marathon']
const RACE_DISTANCE_LABELS: Record<'en' | 'he', Record<RaceDistance, string>> = {
  en: { '1500m': '1500m', mile: 'Mile', '3000m': '3000m', '5k': '5K', '10k': '10K', '15k': '15K', half_marathon: 'Half Marathon', marathon: 'Marathon' },
  he: { '1500m': '1500 מ׳', mile: 'מייל', '3000m': '3000 מ׳', '5k': '5 ק"מ', '10k': '10 ק"מ', '15k': '15 ק"מ', half_marathon: 'חצי מרתון', marathon: 'מרתון' },
}
// Presets are just quick-fill suggestions — the goal time field itself is
// freely editable text, since a real target (especially for a competitive
// athlete) is rarely exactly one of these round numbers.
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
const CURRENT_SHAPE_LABELS: Record<'en' | 'he', Record<CurrentShape, string>> = {
  en: { just_starting: 'Just starting out', returning: 'Returning after a break', consistent: 'Training consistently', peak_fitness: 'Peak fitness / just raced' },
  he: { just_starting: 'רק מתחיל/ה', returning: 'חוזר/ת אחרי הפסקה', consistent: 'מתאמן/ת באופן עקבי', peak_fitness: 'בכושר שיא / התחרתי לאחרונה' },
}

const DAY_ORDER: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
// Deliberately only 3 choices at onboarding — most athletes don't know
// whether a given day "should" be a long run vs. a quality day vs. easy;
// that's exactly what the Bakken brain decides during plan generation.
// The athlete only needs to flag hard constraints: can I run at all, and
// do I want this specific day to always be recovery.
const DAY_TYPES: DayType[] = ['workout', 'rest', 'off']
const MILEAGE_PRESETS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 120, 150]

const DAY_LABELS: Record<'en' | 'he', Record<DayKey, string>> = {
  en: { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' },
  he: { sunday: 'א׳', monday: 'ב׳', tuesday: 'ג׳', wednesday: 'ד׳', thursday: 'ה׳', friday: 'ו׳', saturday: 'ש׳' },
}
const DAY_TYPE_LABELS: Record<'en' | 'he', Record<DayType, string>> = {
  en: { workout: 'Available', long_run: 'Long', easy: 'Easy', rest: 'Rest day', off: "Can't run" },
  he: { workout: 'זמין', long_run: 'ארוכה', easy: 'קלה', rest: 'יום מנוחה', off: 'לא זמין' },
}

type WeekScheduleForm = Record<DayKey, DayType>
const DEFAULT_WEEK_SCHEDULE: WeekScheduleForm = {
  sunday: 'workout', monday: 'workout', tuesday: 'workout', wednesday: 'workout',
  thursday: 'workout', friday: 'rest', saturday: 'workout',
}

interface OnboardingForm {
  name: string; dateOfBirth: string; gender: '' | 'male' | 'female' | 'other'
  height: string; weight: string; discipline: Discipline[]
  experienceLevel: ExperienceLevel | ''; weeklyMileage: string
  weekSchedule: WeekScheduleForm; injuryHistory: string
  currentShape: CurrentShape | ''
  restingHR: string; maxHR: string; goalRaceEvent: string
  goalRaceDistance: RaceDistance | ''
  goalRaceDate: string; goalRaceTarget: string; events: string
  // Recent race result — the pace anchor the Bakken brain falls back to
  // when there's no lab test yet. One entry is enough to be useful; the
  // coach/athlete can add more later via the app's own PR editor.
  recentRaceDistance: RaceDistance | ''
  recentRaceHours: number
  recentRaceMinutes: number | ''
  recentRaceSeconds: number | ''
  recentRaceDate: string
}

const STEPS_EN = [
  { title: 'Choose your language', subtitle: '' },
  { title: 'Welcome to Team Haim 👋', subtitle: "Let's set up your athlete profile" },
  { title: 'Personal Details', subtitle: 'Tell us about yourself' },
  { title: 'Training Background', subtitle: 'Your experience & weekly schedule' },
  { title: 'Physiology', subtitle: 'Heart rate data helps personalize your zones' },
  { title: 'Your Goal Race', subtitle: "What are you training for?" },
  { title: "You're all set! 🎉", subtitle: 'Your profile is ready' },
]
const STEPS_HE = [
  { title: 'בחר/י שפה', subtitle: '' },
  { title: 'ברוכים הבאים ל-Team Haim 👋', subtitle: 'בואו נגדיר את פרופיל הספורטאי שלך' },
  { title: 'פרטים אישיים', subtitle: 'ספר/י לנו קצת עליך' },
  { title: 'רקע אימונים', subtitle: 'הניסיון שלך והלו"ז השבועי' },
  { title: 'פיזיולוגיה', subtitle: 'נתוני דופק עוזרים להתאים לך אזורי אימון' },
  { title: 'מירוץ היעד שלך', subtitle: 'לקראת מה מתאמנים?' },
  { title: 'הכל מוכן! 🎉', subtitle: 'הפרופיל שלך מוכן' },
]

export function AthleteOnboarding() {
  const { user } = useAuth()
  const { language, setLanguage } = useLanguage()
  const router = useRouter()
  const STEPS = language === 'he' ? STEPS_HE : STEPS_EN
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [stravaConnecting, setStravaConnecting] = useState(false)
  const [form, setForm] = useState<OnboardingForm>({
    name: '', dateOfBirth: '', gender: '', height: '', weight: '',
    discipline: [], experienceLevel: '', weeklyMileage: '',
    weekSchedule: DEFAULT_WEEK_SCHEDULE, injuryHistory: '', currentShape: '',
    restingHR: '', maxHR: '', goalRaceEvent: '', goalRaceDistance: '',
    goalRaceDate: '', goalRaceTarget: '', events: '',
    recentRaceDistance: '', recentRaceHours: 0, recentRaceMinutes: '', recentRaceSeconds: '', recentRaceDate: '',
  })

  useEffect(() => { if (user?.name) setForm(f => ({ ...f, name: user.name })) }, [user?.name])

  // Athletes sent back through onboarding (e.g. via the coach's "Add Bakken
  // Coach" button, which just flips onboardingComplete back to false) keep
  // whatever they already filled in — this isn't a first-time signup for them.
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    const load = async () => {
      const snap = await getDoc(doc(db, 'users', user.id))
      if (cancelled || !snap.exists()) return
      const d = snap.data() as any
      setForm(f => ({
        ...f,
        name: d.name || f.name,
        dateOfBirth: d.dateOfBirth || '',
        gender: d.gender || '',
        height: d.height != null ? String(d.height) : '',
        weight: d.weight != null ? String(d.weight) : '',
        discipline: Array.isArray(d.discipline) ? d.discipline : [],
        experienceLevel: d.experienceLevel || '',
        weeklyMileage: d.weeklyMileage != null ? String(d.weeklyMileage) : '',
        weekSchedule: d.weekSchedule && DAY_ORDER.every((day) => d.weekSchedule[day]) ? d.weekSchedule : f.weekSchedule,
        injuryHistory: d.injuryHistory || '',
        currentShape: CURRENT_SHAPES.includes(d.currentShape) ? d.currentShape : '',
        restingHR: d.restingHR != null ? String(d.restingHR) : '',
        maxHR: d.maxHR != null ? String(d.maxHR) : '',
        goalRaceEvent: d.goalRaceEvent || '',
        goalRaceDistance: RACE_DISTANCES.includes(d.goalRaceDistance) ? d.goalRaceDistance : '',
        goalRaceDate: d.goalRaceDate || '',
        goalRaceTarget: d.goalRaceTarget || '',
        events: Array.isArray(d.events) ? d.events.join(', ') : '',
        recentRaceDistance: '', recentRaceHours: 0, recentRaceMinutes: '', recentRaceSeconds: '', recentRaceDate: '',
      }))
      if (d.preferredLanguage === 'en' || d.preferredLanguage === 'he') setLanguage(d.preferredLanguage)
    }
    load()
    return () => { cancelled = true }
  }, [user?.id])

  const set = (key: keyof OnboardingForm, value: any) => setForm(f => ({ ...f, [key]: value }))
  const toggleDiscipline = (d: Discipline) => set('discipline',
    form.discipline.includes(d) ? form.discipline.filter(x => x !== d) : [...form.discipline, d])
  const setDayType = (day: DayKey, type: DayType) =>
    setForm(f => ({ ...f, weekSchedule: { ...f.weekSchedule, [day]: type } }))

  const handleSave = async () => {
    if (!user?.id) return
    setSaving(true)
    try {
      await setDoc(doc(db, 'users', user.id), {
        name: form.name,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        height: form.height ? Number(form.height) : null,
        weight: form.weight ? Number(form.weight) : null,
        discipline: form.discipline,
        experienceLevel: form.experienceLevel || null,
        weeklyMileage: form.weeklyMileage ? Number(form.weeklyMileage) : null,
        restingHR: form.restingHR ? Number(form.restingHR) : null,
        maxHR: form.maxHR ? Number(form.maxHR) : null,
        goalRaceEvent: form.goalRaceEvent || null,
        goalRaceDistance: form.goalRaceDistance || null,
        goalRaceDate: form.goalRaceDate || null,
        goalRaceTarget: form.goalRaceTarget || null,
        events: form.events ? form.events.split(',').map((e: string) => e.trim()).filter(Boolean) : [],
        weekSchedule: form.weekSchedule,
        daysPerWeek: DAY_ORDER.filter((day) => form.weekSchedule[day] === 'workout').length,
        injuryHistory: form.injuryHistory || null,
        currentShape: form.currentShape || null,
        preferredLanguage: language,
        onboardingComplete: true,
        updatedAt: serverTimestamp(),
        ...(form.recentRaceDistance && formattedRecentRaceTime() ? {
          personalRecords: arrayUnion({
            id: `pr_${Date.now()}`,
            event: RACE_DISTANCE_LABELS.en[form.recentRaceDistance],
            time: formattedRecentRaceTime(),
            date: form.recentRaceDate || '',
          }),
        } : {}),
      }, { merge: true })
      setStep(6)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
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

  const next = () => { if (step === 5) { handleSave(); return } setStep(s => s + 1) }
  const back = () => setStep(s => s - 1)
  const progress = ((step - 1) / 4) * 100

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c9a84c]"

  const showRaceHours = form.recentRaceDistance === 'half_marathon' || form.recentRaceDistance === 'marathon'
  const formattedRecentRaceTime = () => {
    const m = form.recentRaceMinutes === '' ? 0 : form.recentRaceMinutes
    const s = form.recentRaceSeconds === '' ? 0 : form.recentRaceSeconds
    if (form.recentRaceHours === 0 && m === 0 && s === 0) return null
    const pad = (n: number) => String(n).padStart(2, '0')
    return form.recentRaceHours > 0
      ? `${form.recentRaceHours}:${pad(m)}:${pad(s)}`
      : `${m}:${pad(s)}`
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] flex flex-col items-center justify-center p-4" dir={language === 'he' ? 'rtl' : 'ltr'}>
      <div className="mb-8">
        <span className="text-2xl font-serif font-bold text-[#1a2744]">Team Haim</span>
      </div>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg overflow-hidden">
        {step > 1 && step < 6 && (
          <div className="h-1 bg-gray-100">
            <div className="h-full bg-[#c9a84c] transition-all duration-500" style={{ width: `${progress}%` }} />
          </div>
        )}
        <div className="p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-serif font-bold text-[#1a2744]">{STEPS[step].title}</h1>
            <p className="text-sm text-gray-500 mt-1">{STEPS[step].subtitle}</p>
          </div>

          {step === 0 && (
            <div className="space-y-3">
              <button onClick={() => { setLanguage('he'); next() }}
                className={`w-full py-4 rounded-xl border-2 text-lg font-medium transition-colors ${language === 'he' ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-700 hover:border-[#1a2744]'}`}>
                עברית
              </button>
              <button onClick={() => { setLanguage('en'); next() }}
                className={`w-full py-4 rounded-xl border-2 text-lg font-medium transition-colors ${language === 'en' ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-700 hover:border-[#1a2744]'}`}>
                English
              </button>
            </div>
          )}

          {step === 1 && (
            <div className="space-y-4">
              <p className="text-gray-600 leading-relaxed">
                {language === 'he'
                  ? 'לפני שתוכל/י לראות את תוכנית האימונים שלך, נצטרך כמה פרטים כדי שהמאמן יוכל להתאים לך הכל אישית.'
                  : 'Before you can see your training plan, we need a few details so your coach can personalize everything for you.'}
              </p>
              <p className="text-gray-600 leading-relaxed">
                {language === 'he'
                  ? <>זה ייקח בערך <strong>2 דקות</strong>. תמיד אפשר לעדכן את זה מאוחר יותר מהפרופיל שלך.</>
                  : <>This takes about <strong>2 minutes</strong>. You can always update these later from your profile.</>}
              </p>
              <button onClick={next} className="w-full mt-4 py-3 rounded-xl bg-[#1a2744] text-white font-medium flex items-center justify-center gap-2 hover:bg-[#1a2744]/90 transition-colors">
                {language === 'he' ? 'בואו נתחיל' : "Let's go"} <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Full Name *</label>
                <input className={inputCls} value={form.name} onChange={e => set('name', e.target.value)} placeholder="Your name" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Date of Birth</label>
                <input type="date" className={inputCls} value={form.dateOfBirth} onChange={e => set('dateOfBirth', e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">Gender</label>
                <div className="flex gap-2">
                  {(['male', 'female', 'other'] as const).map(g => (
                    <button key={g} onClick={() => set('gender', g)}
                      className={`flex-1 py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${form.gender === g ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>{g}</button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Height (cm)</label>
                  <input type="number" className={inputCls} value={form.height} onChange={e => set('height', e.target.value)} placeholder="175" /></div>
                <div><label className="block text-sm font-medium text-gray-700 mb-1">Weight (kg)</label>
                  <input type="number" className={inputCls} value={form.weight} onChange={e => set('weight', e.target.value)} placeholder="70" /></div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Events (e.g. 5k, 10k, Marathon)</label>
                <input className={inputCls} value={form.events} onChange={e => set('events', e.target.value)} placeholder="5k, 10k" /></div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <div><label className="block text-sm font-medium text-gray-700 mb-2">Discipline</label>
                <div className="flex flex-wrap gap-2">
                  {(['track', 'road', 'trail', 'jogger', 'mixed'] as Discipline[]).map(d => (
                    <button key={d} onClick={() => toggleDiscipline(d)}
                      className={`px-3 py-1.5 rounded-full border text-sm font-medium capitalize transition-colors ${form.discipline.includes(d) ? 'bg-[#c9a84c] text-white border-[#c9a84c]' : 'border-gray-200 text-gray-600 hover:border-[#c9a84c]'}`}>{d}</button>
                  ))}
                </div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">Experience Level</label>
                <div className="grid grid-cols-2 gap-2">
                  {(['beginner', 'intermediate', 'advanced', 'professional'] as ExperienceLevel[]).map(l => (
                    <button key={l} onClick={() => set('experienceLevel', l)}
                      className={`py-2.5 rounded-lg border text-sm font-medium capitalize transition-colors ${form.experienceLevel === l ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>{l}</button>
                  ))}
                </div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-2">
                {language === 'he' ? 'ק"מ שבועי ממוצע' : 'Average weekly mileage (km)'}
              </label>
                <div className="flex flex-wrap gap-2 mb-2">
                  {MILEAGE_PRESETS.map(km => (
                    <button key={km} type="button" onClick={() => set('weeklyMileage', String(km))}
                      className={`px-4 py-2 rounded-lg border text-sm font-medium transition-colors ${form.weeklyMileage === String(km) ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>{km}</button>
                  ))}
                </div>
                <input type="number" min={0} step={1} className={inputCls} value={form.weeklyMileage}
                  onChange={e => set('weeklyMileage', e.target.value)}
                  placeholder={language === 'he' ? 'או הקלד/י ק"מ מדויק' : 'Or type your exact km/week'} dir="ltr" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {language === 'he' ? 'ימי אימון בשבוע' : 'Your weekly training days'}
                </label>
                <p className="text-xs text-gray-400 mb-3">
                  {language === 'he'
                    ? 'לחצ/י על סוג האימון לכל יום — כולל ימים שבהם את/ה לא יכול/ה לרוץ בכלל.'
                    : "Tap the type for each day — including days you can't run at all."}
                </p>
                <div className="space-y-2">
                  {DAY_ORDER.map(day => (
                    <div key={day} className="flex items-center gap-2">
                      <span className="w-8 text-xs font-semibold text-gray-500 shrink-0">{DAY_LABELS[language][day]}</span>
                      <div className="flex gap-1 flex-wrap">
                        {DAY_TYPES.map(type => (
                          <button key={type} type="button" onClick={() => setDayType(day, type)}
                            className={`px-2 py-1.5 rounded-md border text-xs font-medium transition-colors ${form.weekSchedule[day] === type ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>
                            {DAY_TYPE_LABELS[language][type]}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Optional — helps us calculate your training zones accurately.</p>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Resting Heart Rate (bpm)</label>
                <input type="number" className={inputCls} value={form.restingHR} onChange={e => set('restingHR', e.target.value)} placeholder="e.g. 50" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Max Heart Rate (bpm)</label>
                <input type="number" className={inputCls} value={form.maxHR} onChange={e => set('maxHR', e.target.value)} placeholder="e.g. 185" />
                <p className="text-xs text-gray-400 mt-1">Don't know? We can estimate from your age.</p></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Injury history (optional)</label>
                <textarea className={inputCls} rows={3} value={form.injuryHistory} onChange={e => set('injuryHistory', e.target.value)} placeholder="Any current or recurring injuries in the last 12 months?" /></div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {language === 'he' ? 'איך מרגיש הכושר שלך כרגע?' : 'How would you describe your current shape?'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {CURRENT_SHAPES.map(shape => (
                    <button key={shape} type="button" onClick={() => set('currentShape', shape)}
                      className={`py-2.5 rounded-lg border text-xs font-medium transition-colors ${form.currentShape === shape ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>
                      {CURRENT_SHAPE_LABELS[language][shape]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {language === 'he' ? 'מרחק היעד' : 'Goal distance'}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {RACE_DISTANCES.map(dist => (
                    <button key={dist} type="button"
                      onClick={() => set('goalRaceDistance', dist)}
                      className={`py-2.5 rounded-lg border text-sm font-medium transition-colors ${form.goalRaceDistance === dist ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>
                      {RACE_DISTANCE_LABELS[language][dist]}
                    </button>
                  ))}
                </div>
              </div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">
                {language === 'he' ? 'שם המירוץ (לא חובה)' : 'Race name (optional)'}
              </label>
                <input className={inputCls} value={form.goalRaceEvent} onChange={e => set('goalRaceEvent', e.target.value)} placeholder="e.g. Tel Aviv Marathon" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">
                {language === 'he' ? 'תאריך המירוץ' : 'Race Date'}
              </label>
                <input type="date" className={inputCls} value={form.goalRaceDate} onChange={e => set('goalRaceDate', e.target.value)} /></div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {language === 'he' ? 'זמן יעד' : 'Goal Time'}
                </label>
                <input className={inputCls} value={form.goalRaceTarget} onChange={e => set('goalRaceTarget', e.target.value)}
                  placeholder={language === 'he' ? 'לדוגמה: 3:30:00' : 'e.g. 3:30:00'} dir="ltr" />
                {form.goalRaceDistance && (
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {GOAL_TIME_PRESETS[form.goalRaceDistance].map(t => (
                      <button key={t} type="button" onClick={() => set('goalRaceTarget', t)}
                        className={`px-2.5 py-1 rounded-full border text-xs font-medium transition-colors ${form.goalRaceTarget === t ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-500 hover:border-[#1a2744]'}`}>
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="pt-2 border-t border-gray-100">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {language === 'he' ? 'תוצאת מירוץ אחרונה (לא חובה)' : 'Recent race result (optional)'}
                </label>
                <p className="text-xs text-gray-400 mb-2">
                  {language === 'he' ? 'עוזר לבנות עבורך יעדי קצב מדויקים גם ללא בדיקת מעבדה.' : 'Helps build accurate pace targets for you even without a lab test.'}
                </p>
                <div className="grid grid-cols-2 gap-2 mb-2">
                  {RACE_DISTANCES.map(dist => (
                    <button key={dist} type="button" onClick={() => set('recentRaceDistance', dist)}
                      className={`py-2 rounded-lg border text-xs font-medium transition-colors ${form.recentRaceDistance === dist ? 'bg-[#c9a84c] text-white border-[#c9a84c]' : 'border-gray-200 text-gray-600 hover:border-[#c9a84c]'}`}>
                      {RACE_DISTANCE_LABELS[language][dist]}
                    </button>
                  ))}
                </div>
                <div className="mb-2">
                  <label className="block text-xs font-medium text-gray-500 mb-1">
                    {language === 'he' ? 'זמן סיום' : 'Finish time'}
                  </label>
                  <div className={`grid gap-2 ${showRaceHours ? 'grid-cols-3' : 'grid-cols-2'}`} dir="ltr">
                    {showRaceHours && (
                      <div>
                        <input type="number" min={0} max={23} className={inputCls} value={form.recentRaceHours}
                          onChange={e => set('recentRaceHours', e.target.value === '' ? 0 : Number(e.target.value))} />
                        <span className="block text-[11px] text-gray-400 mt-0.5">{language === 'he' ? 'שעות' : 'hours'}</span>
                      </div>
                    )}
                    <div>
                      <input type="number" min={0} max={59} className={inputCls} value={form.recentRaceMinutes}
                        onChange={e => set('recentRaceMinutes', e.target.value === '' ? '' : Number(e.target.value))} />
                      <span className="block text-[11px] text-gray-400 mt-0.5">{language === 'he' ? 'דקות' : 'minutes'}</span>
                    </div>
                    <div>
                      <input type="number" min={0} max={59} className={inputCls} value={form.recentRaceSeconds}
                        onChange={e => set('recentRaceSeconds', e.target.value === '' ? '' : Number(e.target.value))} />
                      <span className="block text-[11px] text-gray-400 mt-0.5">{language === 'he' ? 'שניות' : 'seconds'}</span>
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <input type="date" className={inputCls} value={form.recentRaceDate} onChange={e => set('recentRaceDate', e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {step === 6 && (
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <Check className="h-8 w-8 text-green-600" />
                </div>
              </div>
              <p className="text-gray-600">Your profile has been saved. Your coach can now see your details and personalize your training plan.</p>
              
              <div className="border border-orange-200 rounded-xl p-4 bg-orange-50 text-left">
                <p className="text-sm font-medium text-orange-800 mb-1">🚴 Connect Strava (Optional)</p>
                <p className="text-xs text-orange-600 mb-3">Automatically sync your workouts from Strava to Team Haim.</p>
                <button
                  onClick={handleStravaConnect}
                  disabled={stravaConnecting}
                  className="w-full py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
                >
                  {stravaConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : '🚴'}
                  Connect with Strava
                </button>
              </div>

              <button onClick={() => router.replace('/athlete')}
                className="w-full py-3 rounded-xl bg-[#c9a84c] text-white font-medium hover:bg-[#c9a84c]/90 transition-colors">
                Go to Dashboard
              </button>
              <p className="text-xs text-gray-400">You can connect Strava later from your profile settings.</p>
            </div>
          )}

          {step > 1 && step < 6 && (
            <div className="flex gap-3 mt-8">
              <button onClick={back} className="flex items-center gap-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:border-gray-400 transition-colors">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button onClick={next} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-[#1a2744] text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#1a2744]/90 transition-colors disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : step === 5 ? 'Save & Finish' : <>Next <ChevronRight className="h-4 w-4" /></>}
              </button>
            </div>
          )}
        </div>
      </div>
      {step > 1 && step < 6 && (
        <div className="flex gap-1.5 mt-6">
          {[2,3,4,5].map(i => (
            <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-[#c9a84c]' : i < step ? 'w-3 bg-[#1a2744]' : 'w-3 bg-gray-300'}`} />
          ))}
        </div>
      )}
    </div>
  )
}
