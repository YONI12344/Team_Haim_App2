'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { Loader2, ChevronRight, ChevronLeft, Check } from 'lucide-react'

type Discipline = 'track' | 'road' | 'trail' | 'jogger' | 'mixed'
type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'professional'

interface OnboardingForm {
  name: string; dateOfBirth: string; gender: '' | 'male' | 'female' | 'other'
  height: string; weight: string; discipline: Discipline[]
  experienceLevel: ExperienceLevel | ''; weeklyMileage: string
  restingHR: string; maxHR: string; goalRaceEvent: string
  goalRaceDate: string; goalRaceTarget: string; events: string
}

const STEPS = [
  { title: 'Welcome to Team Haim 👋', subtitle: "Let's set up your athlete profile" },
  { title: 'Personal Details', subtitle: 'Tell us about yourself' },
  { title: 'Training Background', subtitle: 'Your experience & weekly load' },
  { title: 'Physiology', subtitle: 'Heart rate data helps personalize your zones' },
  { title: 'Your Goal Race', subtitle: "What are you training for?" },
  { title: "You're all set! 🎉", subtitle: 'Your profile is ready' },
]

export function AthleteOnboarding() {
  const { user } = useAuth()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState<OnboardingForm>({
    name: '', dateOfBirth: '', gender: '', height: '', weight: '',
    discipline: [], experienceLevel: '', weeklyMileage: '',
    restingHR: '', maxHR: '', goalRaceEvent: '', goalRaceDate: '',
    goalRaceTarget: '', events: '',
  })

  useEffect(() => { if (user?.name) setForm(f => ({ ...f, name: user.name })) }, [user?.name])

  const set = (key: keyof OnboardingForm, value: any) => setForm(f => ({ ...f, [key]: value }))
  const toggleDiscipline = (d: Discipline) => set('discipline',
    form.discipline.includes(d) ? form.discipline.filter(x => x !== d) : [...form.discipline, d])

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
        goalRaceDate: form.goalRaceDate || null,
        goalRaceTarget: form.goalRaceTarget || null,
        events: form.events ? form.events.split(',').map((e: string) => e.trim()).filter(Boolean) : [],
        onboardingComplete: true,
        updatedAt: serverTimestamp(),
      }, { merge: true })
      setStep(5)
    } catch (e) { console.error(e) }
    finally { setSaving(false) }
  }

  const next = () => { if (step === 4) { handleSave(); return } setStep(s => s + 1) }
  const back = () => setStep(s => s - 1)
  const progress = (step / 4) * 100

  const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#c9a84c]"

  return (
    <div className="min-h-screen bg-[#f7f5f0] flex flex-col items-center justify-center p-4">
      <div className="mb-8">
        <span className="text-2xl font-serif font-bold text-[#1a2744]">Team Haim</span>
      </div>
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-lg overflow-hidden">
        {step > 0 && step < 5 && (
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
            <div className="space-y-4">
              <p className="text-gray-600 leading-relaxed">Before you can see your training plan, we need a few details so your coach can personalize everything for you.</p>
              <p className="text-gray-600 leading-relaxed">This takes about <strong>2 minutes</strong>. You can always update these later from your profile.</p>
              <button onClick={next} className="w-full mt-4 py-3 rounded-xl bg-[#1a2744] text-white font-medium flex items-center justify-center gap-2 hover:bg-[#1a2744]/90 transition-colors">
                Let's go <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {step === 1 && (
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

          {step === 2 && (
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
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Weekly Mileage (km)</label>
                <input type="number" className={inputCls} value={form.weeklyMileage} onChange={e => set('weeklyMileage', e.target.value)} placeholder="40" /></div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-500">Optional — helps us calculate your training zones accurately.</p>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Resting Heart Rate (bpm)</label>
                <input type="number" className={inputCls} value={form.restingHR} onChange={e => set('restingHR', e.target.value)} placeholder="e.g. 50" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Max Heart Rate (bpm)</label>
                <input type="number" className={inputCls} value={form.maxHR} onChange={e => set('maxHR', e.target.value)} placeholder="e.g. 185" />
                <p className="text-xs text-gray-400 mt-1">Don't know? We can estimate from your age.</p></div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Goal Race Event</label>
                <input className={inputCls} value={form.goalRaceEvent} onChange={e => set('goalRaceEvent', e.target.value)} placeholder="e.g. Tel Aviv Marathon" /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Race Date</label>
                <input type="date" className={inputCls} value={form.goalRaceDate} onChange={e => set('goalRaceDate', e.target.value)} /></div>
              <div><label className="block text-sm font-medium text-gray-700 mb-1">Goal Time</label>
                <input className={inputCls} value={form.goalRaceTarget} onChange={e => set('goalRaceTarget', e.target.value)} placeholder="e.g. 3:30:00" /></div>
            </div>
          )}

          {step === 5 && (
            <div className="space-y-4 text-center">
              <div className="flex justify-center">
                <div className="h-16 w-16 rounded-full bg-green-100 flex items-center justify-center">
                  <Check className="h-8 w-8 text-green-600" />
                </div>
              </div>
              <p className="text-gray-600">Your profile has been saved. Your coach can now see your details and personalize your training plan.</p>
              <button onClick={() => router.replace('/athlete')}
                className="w-full py-3 rounded-xl bg-[#c9a84c] text-white font-medium hover:bg-[#c9a84c]/90 transition-colors">
                Go to Dashboard
              </button>
            </div>
          )}

          {step > 0 && step < 5 && (
            <div className="flex gap-3 mt-8">
              <button onClick={back} className="flex items-center gap-1 px-4 py-2.5 rounded-xl border border-gray-200 text-sm font-medium text-gray-600 hover:border-gray-400 transition-colors">
                <ChevronLeft className="h-4 w-4" /> Back
              </button>
              <button onClick={next} disabled={saving}
                className="flex-1 py-2.5 rounded-xl bg-[#1a2744] text-white text-sm font-medium flex items-center justify-center gap-2 hover:bg-[#1a2744]/90 transition-colors disabled:opacity-60">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : step === 4 ? 'Save & Finish' : <>Next <ChevronRight className="h-4 w-4" /></>}
              </button>
            </div>
          )}
        </div>
      </div>
      {step > 0 && step < 5 && (
        <div className="flex gap-1.5 mt-6">
          {[1,2,3,4].map(i => (
            <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${i === step ? 'w-6 bg-[#c9a84c]' : i < step ? 'w-3 bg-[#1a2744]' : 'w-3 bg-gray-300'}`} />
          ))}
        </div>
      )}
    </div>
  )
}
