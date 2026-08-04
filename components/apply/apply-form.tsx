'use client'

import { useState } from 'react'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useLanguage } from '@/contexts/language-context'
import { Loader2, Check } from 'lucide-react'

type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'professional'
type RaceDistance = '1500m' | 'mile' | '3000m' | '5k' | '10k' | '15k' | 'half_marathon' | 'marathon'
type Facility = 'track' | 'gym' | 'treadmill' | 'trails'
type RunningDuration = 'under_6mo' | '6to12mo' | '1to3yr' | 'over_3yr'
type Device = 'garmin' | 'strava' | 'polar' | 'coros' | 'apple_watch' | 'hr_strap' | 'other'
type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'

const EXPERIENCE_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'professional']
const RACE_DISTANCES: RaceDistance[] = ['1500m', 'mile', '3000m', '5k', '10k', '15k', 'half_marathon', 'marathon']
const RACE_DISTANCE_LABELS: Record<'en' | 'he', Record<RaceDistance, string>> = {
  en: { '1500m': '1500m', mile: 'Mile', '3000m': '3000m', '5k': '5K', '10k': '10K', '15k': '15K', half_marathon: 'Half Marathon', marathon: 'Marathon' },
  he: { '1500m': '1500 מ׳', mile: 'מייל', '3000m': '3000 מ׳', '5k': '5 ק"מ', '10k': '10 ק"מ', '15k': '15 ק"מ', half_marathon: 'חצי מרתון', marathon: 'מרתון' },
}
// Finer steps in the range most athletes fall in, coarser at the high end
// — more options than a handful of round-10 buttons, so someone doesn't
// have to round their real weekly km up or down significantly.
const MILEAGE_PRESETS = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 120, 150]
const DAYS_PRESETS = [3, 4, 5, 6, 7]
const FACILITIES: Facility[] = ['track', 'gym', 'treadmill', 'trails']
const FACILITY_LABELS: Record<'en' | 'he', Record<Facility, string>> = {
  en: { track: 'Track', gym: 'Gym / weights', treadmill: 'Treadmill', trails: 'Trails' },
  he: { track: 'מסלול אתלטיקה', gym: 'חדר כושר', treadmill: 'הליכון', trails: 'מסלולי שטח' },
}
const RUNNING_DURATIONS: RunningDuration[] = ['under_6mo', '6to12mo', '1to3yr', 'over_3yr']
const RUNNING_DURATION_LABELS: Record<'en' | 'he', Record<RunningDuration, string>> = {
  en: { under_6mo: 'Under 6 months', '6to12mo': '6–12 months', '1to3yr': '1–3 years', over_3yr: 'Over 3 years' },
  he: { under_6mo: 'פחות מ-6 חודשים', '6to12mo': '6-12 חודשים', '1to3yr': '1-3 שנים', over_3yr: 'מעל 3 שנים' },
}
const DEVICES: Device[] = ['garmin', 'strava', 'polar', 'coros', 'apple_watch', 'hr_strap', 'other']
const DEVICE_LABELS: Record<'en' | 'he', Record<Device, string>> = {
  en: { garmin: 'Garmin', strava: 'Strava', polar: 'Polar', coros: 'Coros', apple_watch: 'Apple Watch', hr_strap: 'HR chest strap', other: 'Other' },
  he: { garmin: 'Garmin', strava: 'Strava', polar: 'Polar', coros: 'Coros', apple_watch: 'Apple Watch', hr_strap: 'רצועת דופק', other: 'אחר' },
}
const DAY_ORDER: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_LABELS: Record<'en' | 'he', Record<DayKey, string>> = {
  en: { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' },
  he: { sunday: 'א׳', monday: 'ב׳', tuesday: 'ג׳', wednesday: 'ד׳', thursday: 'ה׳', friday: 'ו׳', saturday: 'ש׳' },
}

interface FormState {
  name: string; email: string; phone: string; dateOfBirth: string; city: string
  height: number | ''; weight: number | ''
  experienceLevel: ExperienceLevel | ''
  runningExperienceDuration: RunningDuration | ''
  weeklyMileage: number | ''
  recentRaceDistance: RaceDistance | ''
  recentRaceHours: number
  recentRaceMinutes: number | ''
  recentRaceSeconds: number | ''
  recentRaceDate: string
  shoesInfo: string
  devicesUsed: Device[]
  stravaOrGarminLink: string
  primaryGoal: string
  longTermGoal: string
  goalRaceEvent: string
  goalRaceDistance: RaceDistance | ''
  goalRaceDate: string
  goalRaceTarget: string
  daysPerWeek: number | ''
  preferredDays: DayKey[]
  facilitiesAccess: Facility[]
  lifestyleNotes: string
  currentInjuries: string
  injuryHistory: string
  medicalNotes: string
  additionalNotes: string
}

const EMPTY_FORM: FormState = {
  name: '', email: '', phone: '', dateOfBirth: '', city: '',
  height: '', weight: '',
  experienceLevel: '', runningExperienceDuration: '', weeklyMileage: '',
  recentRaceDistance: '', recentRaceHours: 0, recentRaceMinutes: '', recentRaceSeconds: '', recentRaceDate: '',
  shoesInfo: '', devicesUsed: [], stravaOrGarminLink: '',
  primaryGoal: '', longTermGoal: '',
  goalRaceEvent: '', goalRaceDistance: '', goalRaceDate: '', goalRaceTarget: '',
  daysPerWeek: '', preferredDays: [], facilitiesAccess: [],
  lifestyleNotes: '', currentInjuries: '', injuryHistory: '', medicalNotes: '', additionalNotes: '',
}

/**
 * Public "apply to work with me" intake — no login required. Submissions
 * land in the `leads` Firestore collection for the coach to review at
 * /coach/leads. Accepting a lead there means its data auto-fills the
 * athlete's profile the moment they actually sign up (matched by email —
 * see contexts/auth-context.tsx), so nothing has to be typed twice between
 * "applying" and the real in-app onboarding.
 */
export function ApplyForm() {
  const { language, setLanguage, isRTL } = useLanguage()
  const [form, setForm] = useState<FormState>(EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }))

  const toggleFacility = (f: Facility) =>
    set('facilitiesAccess', form.facilitiesAccess.includes(f)
      ? form.facilitiesAccess.filter((x) => x !== f)
      : [...form.facilitiesAccess, f])
  const toggleDevice = (d: Device) =>
    set('devicesUsed', form.devicesUsed.includes(d)
      ? form.devicesUsed.filter((x) => x !== d)
      : [...form.devicesUsed, d])
  const toggleDay = (d: DayKey) =>
    set('preferredDays', form.preferredDays.includes(d)
      ? form.preferredDays.filter((x) => x !== d)
      : [...form.preferredDays, d])

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c9a84c]"
  const t = (en: string, he: string) => (language === 'he' ? he : en)

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

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.email.trim()) {
      setError(t('Name and email are required.', 'שם ואימייל הם שדות חובה.'))
      return
    }
    setError(null)
    setSaving(true)
    try {
      await addDoc(collection(db, 'leads'), {
        name: form.name.trim(),
        email: form.email.trim().toLowerCase(),
        phone: form.phone.trim() || null,
        dateOfBirth: form.dateOfBirth || null,
        city: form.city.trim() || null,
        height: form.height === '' ? null : Number(form.height),
        weight: form.weight === '' ? null : Number(form.weight),
        experienceLevel: form.experienceLevel || null,
        runningExperienceDuration: form.runningExperienceDuration || null,
        weeklyMileage: form.weeklyMileage === '' ? null : Number(form.weeklyMileage),
        recentRaceEvent: form.recentRaceDistance ? RACE_DISTANCE_LABELS.en[form.recentRaceDistance] : null,
        recentRaceTime: formattedRecentRaceTime(),
        recentRaceDate: form.recentRaceDate || null,
        shoesInfo: form.shoesInfo.trim() || null,
        devicesUsed: form.devicesUsed,
        stravaOrGarminLink: form.stravaOrGarminLink.trim() || null,
        primaryGoal: form.primaryGoal.trim() || null,
        longTermGoal: form.longTermGoal.trim() || null,
        goalRaceEvent: form.goalRaceEvent.trim() || null,
        goalRaceDistance: form.goalRaceDistance || null,
        goalRaceDate: form.goalRaceDate || null,
        goalRaceTarget: form.goalRaceTarget.trim() || null,
        daysPerWeek: form.daysPerWeek === '' ? null : Number(form.daysPerWeek),
        preferredDays: form.preferredDays,
        facilitiesAccess: form.facilitiesAccess,
        lifestyleNotes: form.lifestyleNotes.trim() || null,
        currentInjuries: form.currentInjuries.trim() || null,
        injuryHistory: form.injuryHistory.trim() || null,
        medicalNotes: form.medicalNotes.trim() || null,
        additionalNotes: form.additionalNotes.trim() || null,
        status: 'new',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setSubmitted(true)
    } catch (e) {
      console.error(e)
      setError(t('Something went wrong — please try again.', 'משהו השתבש — נסה/י שוב.'))
    } finally {
      setSaving(false)
    }
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-[#f7f5f0] flex flex-col items-center justify-center p-4" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="w-full max-w-md bg-white rounded-2xl shadow-lg p-8 text-center space-y-4">
          <div className="flex justify-center">
            <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
              <Check className="h-8 w-8 text-green-600" />
            </div>
          </div>
          <h1 className="text-xl font-serif font-bold text-[#1a2744]">
            {t('Thanks — application received!', 'תודה — הבקשה התקבלה!')}
          </h1>
          <p className="text-gray-600">
            {t("I'll review your info and get back to you soon.", 'אעבור על הפרטים שלך ואחזור אליך בקרוב.')}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f7f5f0] flex flex-col items-center p-4 py-10" dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="w-full max-w-lg">
        <div className="flex items-center justify-between mb-6">
          <span className="text-2xl font-serif font-bold text-[#1a2744]">Team Haim</span>
          <div className="flex gap-1.5">
            <button onClick={() => setLanguage('he')} className={`px-2.5 py-1 rounded-md border text-xs font-medium ${language === 'he' ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-500'}`}>עברית</button>
            <button onClick={() => setLanguage('en')} className={`px-2.5 py-1 rounded-md border text-xs font-medium ${language === 'en' ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-500'}`}>English</button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-lg p-8 space-y-6">
          <div>
            <h1 className="text-2xl font-serif font-bold text-[#1a2744]">{t('Apply to work with me', 'בקשה לאימון אישי')}</h1>
            <p className="text-sm text-gray-500 mt-1">
              {t('A few questions so I can see if we\'re a good fit — takes about 3 minutes.', 'כמה שאלות כדי לבדוק התאמה — לוקח כ-3 דקות.')}
            </p>
          </div>

          {/* Personal info */}
          <div className="space-y-3">
            <h2 className="text-sm font-bold text-[#1a2744] uppercase tracking-wide">{t('Personal info', 'פרטים אישיים')}</h2>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Full Name *', 'שם מלא *')}</label>
              <input className={inputCls} value={form.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Email *', 'אימייל *')}</label>
                <input type="email" className={inputCls} value={form.email} onChange={(e) => set('email', e.target.value)} dir="ltr" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Phone', 'טלפון')}</label>
                <input type="tel" className={inputCls} value={form.phone} onChange={(e) => set('phone', e.target.value)} dir="ltr" /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Date of Birth', 'תאריך לידה')}</label>
                <input type="date" className={inputCls} value={form.dateOfBirth} onChange={(e) => set('dateOfBirth', e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('City', 'עיר')}</label>
                <input className={inputCls} value={form.city} onChange={(e) => set('city', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Height (cm)', 'גובה (ס"מ)')}</label>
                <input type="number" className={inputCls} value={form.height} onChange={(e) => set('height', e.target.value === '' ? '' : Number(e.target.value))} /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Weight (kg)', 'משקל (ק"ג)')}</label>
                <input type="number" className={inputCls} value={form.weight} onChange={(e) => set('weight', e.target.value === '' ? '' : Number(e.target.value))} /></div>
            </div>
          </div>

          {/* Athletic background */}
          <div className="space-y-3 pt-4 border-t border-gray-100">
            <h2 className="text-sm font-bold text-[#1a2744] uppercase tracking-wide">{t('Running background', 'רקע ריצה')}</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('Experience level', 'רמת ניסיון')}</label>
              <div className="grid grid-cols-2 gap-2">
                {EXPERIENCE_LEVELS.map((lvl) => (
                  <button key={lvl} type="button" onClick={() => set('experienceLevel', lvl)}
                    className={`py-2 rounded-lg border text-sm font-medium capitalize transition-colors ${form.experienceLevel === lvl ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>
                    {lvl}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('How long have you trained seriously?', 'כמה זמן אתה עוסק בריצה בצורה מסודרת?')}</label>
              <div className="grid grid-cols-2 gap-2">
                {RUNNING_DURATIONS.map((d) => (
                  <button key={d} type="button" onClick={() => set('runningExperienceDuration', d)}
                    className={`py-2 rounded-lg border text-xs font-medium transition-colors ${form.runningExperienceDuration === d ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>
                    {RUNNING_DURATION_LABELS[language][d]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('Average weekly mileage (km)', 'ק"מ שבועי ממוצע')}</label>
              <div className="flex flex-wrap gap-2 mb-2">
                {MILEAGE_PRESETS.map((km) => (
                  <button key={km} type="button" onClick={() => set('weeklyMileage', km)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${form.weeklyMileage === km ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>
                    {km}
                  </button>
                ))}
              </div>
              <input type="number" min={0} step={1} className={inputCls} value={form.weeklyMileage}
                onChange={(e) => set('weeklyMileage', e.target.value === '' ? '' : Number(e.target.value))}
                placeholder={t('Or type your exact km/week', 'או הקלד/י ק"מ מדויק')} dir="ltr" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('Recent race result (optional)', 'תוצאת מירוץ אחרונה (לא חובה)')}</label>
              <div className="grid grid-cols-2 gap-2 mb-2">
                {RACE_DISTANCES.map((dist) => (
                  <button key={dist} type="button" onClick={() => set('recentRaceDistance', dist)}
                    className={`py-1.5 rounded-lg border text-xs font-medium transition-colors ${form.recentRaceDistance === dist ? 'bg-[#c9a84c] text-white border-[#c9a84c]' : 'border-gray-200 text-gray-600 hover:border-[#c9a84c]'}`}>
                    {RACE_DISTANCE_LABELS[language][dist]}
                  </button>
                ))}
              </div>
              <div className="mb-2">
                <label className="block text-xs font-medium text-gray-500 mb-1">{t('Finish time', 'זמן סיום')}</label>
                <div className={`grid gap-2 ${showRaceHours ? 'grid-cols-3' : 'grid-cols-2'}`} dir="ltr">
                  {showRaceHours && (
                    <div>
                      <input type="number" min={0} max={23} className={inputCls} value={form.recentRaceHours}
                        onChange={(e) => set('recentRaceHours', e.target.value === '' ? 0 : Number(e.target.value))} />
                      <span className="block text-[11px] text-gray-400 mt-0.5">{t('hours', 'שעות')}</span>
                    </div>
                  )}
                  <div>
                    <input type="number" min={0} max={59} className={inputCls} value={form.recentRaceMinutes}
                      onChange={(e) => set('recentRaceMinutes', e.target.value === '' ? '' : Number(e.target.value))} />
                    <span className="block text-[11px] text-gray-400 mt-0.5">{t('minutes', 'דקות')}</span>
                  </div>
                  <div>
                    <input type="number" min={0} max={59} className={inputCls} value={form.recentRaceSeconds}
                      onChange={(e) => set('recentRaceSeconds', e.target.value === '' ? '' : Number(e.target.value))} />
                    <span className="block text-[11px] text-gray-400 mt-0.5">{t('seconds', 'שניות')}</span>
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input type="date" className={inputCls} value={form.recentRaceDate} onChange={(e) => set('recentRaceDate', e.target.value)} />
              </div>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Running shoes (models, size, estimated mileage)', 'נעלי ריצה (דגמים, מידה, קילומטראז\' משוער)')}</label>
              <textarea className={inputCls} rows={2} value={form.shoesInfo} onChange={(e) => set('shoesInfo', e.target.value)} /></div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('Devices / gear you train with', 'עזרי אימון/שעון בשימוש')}</label>
              <div className="flex flex-wrap gap-2">
                {DEVICES.map((d) => (
                  <button key={d} type="button" onClick={() => toggleDevice(d)}
                    className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${form.devicesUsed.includes(d) ? 'bg-[#c9a84c] text-white border-[#c9a84c]' : 'border-gray-200 text-gray-600 hover:border-[#c9a84c]'}`}>
                    {DEVICE_LABELS[language][d]}
                  </button>
                ))}
              </div>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Strava / Garmin Connect link (optional)', 'קישור ל-Strava / Garmin Connect (לא חובה)')}</label>
              <input className={inputCls} value={form.stravaOrGarminLink} onChange={(e) => set('stravaOrGarminLink', e.target.value)} dir="ltr" /></div>
          </div>

          {/* Goals */}
          <div className="space-y-3 pt-4 border-t border-gray-100">
            <h2 className="text-sm font-bold text-[#1a2744] uppercase tracking-wide">{t('Goals', 'מטרות')}</h2>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('What\'s your main goal right now?', 'מה המטרה המרכזית שלך?')}</label>
              <textarea className={inputCls} rows={2} value={form.primaryGoal} onChange={(e) => set('primaryGoal', e.target.value)} /></div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('Goal race distance', 'מרחק היעד')}</label>
              <div className="grid grid-cols-2 gap-2">
                {RACE_DISTANCES.map((dist) => (
                  <button key={dist} type="button" onClick={() => set('goalRaceDistance', dist)}
                    className={`py-2 rounded-lg border text-sm font-medium transition-colors ${form.goalRaceDistance === dist ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>
                    {RACE_DISTANCE_LABELS[language][dist]}
                  </button>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Race name', 'שם המירוץ')}</label>
                <input className={inputCls} value={form.goalRaceEvent} onChange={(e) => set('goalRaceEvent', e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Race date', 'תאריך המירוץ')}</label>
                <input type="date" className={inputCls} value={form.goalRaceDate} onChange={(e) => set('goalRaceDate', e.target.value)} /></div>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Goal time', 'זמן יעד')}</label>
              <input className={inputCls} value={form.goalRaceTarget} onChange={(e) => set('goalRaceTarget', e.target.value)} placeholder="e.g. 3:30:00" dir="ltr" /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Long-term goal for the next year', 'יעד ארוך טווח לשנה הקרובה')}</label>
              <textarea className={inputCls} rows={2} value={form.longTermGoal} onChange={(e) => set('longTermGoal', e.target.value)} /></div>
          </div>

          {/* Availability */}
          <div className="space-y-3 pt-4 border-t border-gray-100">
            <h2 className="text-sm font-bold text-[#1a2744] uppercase tracking-wide">{t('Availability', 'זמינות')}</h2>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('Days per week you can train', 'ימים בשבוע לאימון')}</label>
              <div className="flex gap-2">
                {DAYS_PRESETS.map((d) => (
                  <button key={d} type="button" onClick={() => set('daysPerWeek', d)}
                    className={`flex-1 py-2 rounded-lg border text-sm font-medium transition-colors ${form.daysPerWeek === d ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>
                    {d}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('Which days work for you?', 'באילו ימים נוח לך להתאמן?')}</label>
              <div className="flex flex-wrap gap-2">
                {DAY_ORDER.map((d) => (
                  <button key={d} type="button" onClick={() => toggleDay(d)}
                    className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${form.preferredDays.includes(d) ? 'bg-[#1a2744] text-white border-[#1a2744]' : 'border-gray-200 text-gray-600 hover:border-[#1a2744]'}`}>
                    {DAY_LABELS[language][d]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">{t('Facility access', 'נגישות למתקנים')}</label>
              <div className="flex flex-wrap gap-2">
                {FACILITIES.map((f) => (
                  <button key={f} type="button" onClick={() => toggleFacility(f)}
                    className={`px-3 py-1.5 rounded-full border text-sm font-medium transition-colors ${form.facilitiesAccess.includes(f) ? 'bg-[#c9a84c] text-white border-[#c9a84c]' : 'border-gray-200 text-gray-600 hover:border-[#c9a84c]'}`}>
                    {FACILITY_LABELS[language][f]}
                  </button>
                ))}
              </div>
            </div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Sleep & day-to-day load (work/study)', 'שינה ועומס יומיומי (עבודה/לימודים)')}</label>
              <textarea className={inputCls} rows={2} value={form.lifestyleNotes} onChange={(e) => set('lifestyleNotes', e.target.value)} /></div>
          </div>

          {/* Health */}
          <div className="space-y-3 pt-4 border-t border-gray-100">
            <h2 className="text-sm font-bold text-[#1a2744] uppercase tracking-wide">{t('Health', 'בריאות')}</h2>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Any active pain or injury right now?', 'האם יש כרגע כאב או פציעה פעילה?')}</label>
              <textarea className={inputCls} rows={2} value={form.currentInjuries} onChange={(e) => set('currentInjuries', e.target.value)} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Injury history (last 1-2 years)', 'היסטוריית פציעות (שנה-שנתיים אחרונות)')}</label>
              <textarea className={inputCls} rows={2} value={form.injuryHistory} onChange={(e) => set('injuryHistory', e.target.value)} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Medical conditions or restrictions I should know about', 'מגבלות רפואיות או דגשים בריאותיים')}</label>
              <textarea className={inputCls} rows={2} value={form.medicalNotes} onChange={(e) => set('medicalNotes', e.target.value)} /></div>
            <div><label className="block text-sm font-medium text-gray-700 mb-1">{t('Anything else I should know?', 'עוד משהו שכדאי שאדע?')}</label>
              <textarea className={inputCls} rows={2} value={form.additionalNotes} onChange={(e) => set('additionalNotes', e.target.value)} /></div>
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button onClick={handleSubmit} disabled={saving}
            className="w-full py-3 rounded-xl bg-[#1a2744] text-white font-medium flex items-center justify-center gap-2 hover:bg-[#1a2744]/90 transition-colors disabled:opacity-60">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {t('Submit Application', 'שליחת בקשה')}
          </button>
        </div>
      </div>
    </div>
  )
}
