'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, Plus, Trash2, FlaskConical, Heart, Gauge, ChevronDown } from 'lucide-react'
import { collection, doc, getDoc, getDocs, addDoc, deleteDoc, updateDoc, query, where, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { format } from 'date-fns'
import { useLanguage } from '@/contexts/language-context'
import {
  type LactateStep, type PhysiologySummary,
  computeThresholds, estimateVo2max, derivePaceBands, physiologyHrZones,
  paceToSec, secToPace,
} from '@/lib/physiology'
import { LactateWorkoutGallery } from '@/components/coach/lactate-workout-gallery'
import { WorkoutComparisonGallery } from '@/components/coach/workout-comparison-gallery'

interface LactateTestDoc {
  id: string
  athleteId: string
  date: string
  notes?: string
  /** 'step' = full incremental test (default); 'spot' = legacy in-workout
   *  quick check — no longer created, but old docs may still have this. */
  kind?: 'step' | 'spot'
  steps: LactateStep[]
  lt1PaceSec?: number | null
  lt1Hr?: number | null
  lt2PaceSec?: number | null
  lt2Hr?: number | null
  lt3PaceSec?: number | null
  lt3Hr?: number | null
}

const emptyStep = (): LactateStep => ({ pace: '', hr: null, lactate: 0 })

// The Lab's shared dark-card language — same gradient as the T1/T2/T3 hero
// above, so every section of the page reads as one design instead of a mix
// of dark hero + plain white cards.
const darkCard = 'rounded-3xl bg-gradient-to-br from-[#0a1628] to-[#0a1628]/85'
// Form controls on a dark card (same treatment as the reassign-select in
// athlete-planner-view.tsx's dark mode).
const darkInput = 'bg-white/10 border-white/15 text-white placeholder:text-white/30'

/**
 * מעבדה — the physiology hub for one athlete, shared by the coach's planner
 * tab and the athlete's own self-serve lab page (components/athlete/athlete-lab-view.tsx):
 * lactate tests (T1/T2), threshold paces (measured or manual estimate),
 * VO2max estimate, derived training paces, and smart HR zones.
 */
export function AthletePhysiology({ athleteId }: { athleteId: string }) {
  const { t, isRTL } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [phys, setPhys] = useState<PhysiologySummary | null>(null)
  const [maxHr, setMaxHr] = useState<string>('')
  const [restingHr, setRestingHr] = useState<string>('')
  const [tests, setTests] = useState<LactateTestDoc[]>([])

  // Manual override inputs
  const [mT1Pace, setMT1Pace] = useState('')
  const [mT1Hr, setMT1Hr] = useState('')
  const [mT2Pace, setMT2Pace] = useState('')
  const [mT2Hr, setMT2Hr] = useState('')
  const [mT3Pace, setMT3Pace] = useState('')
  const [mT3Hr, setMT3Hr] = useState('')
  const [savingManual, setSavingManual] = useState(false)
  const [showManual, setShowManual] = useState(false)

  // New test form
  const [showNewTest, setShowNewTest] = useState(false)
  const [testDate, setTestDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [testNotes, setTestNotes] = useState('')
  const [steps, setSteps] = useState<LactateStep[]>([emptyStep(), emptyStep(), emptyStep(), emptyStep()])
  const [savingTest, setSavingTest] = useState(false)
  const [expandedTest, setExpandedTest] = useState<string | null>(null)
  const [updatingPaces, setUpdatingPaces] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const [userSnap, testsSnap] = await Promise.all([
          getDoc(doc(db, 'users', athleteId)),
          getDocs(query(collection(db, 'lactateTests'), where('athleteId', '==', athleteId))),
        ])
        const u = userSnap.data() || {}
        if (u.physiology) {
          setPhys(u.physiology as PhysiologySummary)
          setMT1Pace(u.physiology.lt1PaceSec ? secToPace(u.physiology.lt1PaceSec) : '')
          setMT1Hr(u.physiology.lt1Hr ? String(u.physiology.lt1Hr) : '')
          setMT2Pace(u.physiology.lt2PaceSec ? secToPace(u.physiology.lt2PaceSec) : '')
          setMT2Hr(u.physiology.lt2Hr ? String(u.physiology.lt2Hr) : '')
          setMT3Pace(u.physiology.lt3PaceSec ? secToPace(u.physiology.lt3PaceSec) : '')
          setMT3Hr(u.physiology.lt3Hr ? String(u.physiology.lt3Hr) : '')
        }
        if (u.maxHR) setMaxHr(String(u.maxHR))
        if (u.restingHR) setRestingHr(String(u.restingHR))
        setTests(
          testsSnap.docs
            .map(d => ({ ...(d.data() as Omit<LactateTestDoc, 'id'>), id: d.id }))
            .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        )
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [athleteId])

  // Live preview of thresholds while typing the new test
  const livePreview = useMemo(() => computeThresholds(steps), [steps])

  const savePhysiology = async (summary: PhysiologySummary) => {
    await updateDoc(doc(db, 'users', athleteId), { physiology: { ...summary, updatedAt: serverTimestamp() } })
    setPhys(summary)
  }

  const handleSaveManual = async () => {
    const lt1 = paceToSec(mT1Pace)
    const lt2 = paceToSec(mT2Pace)
    const lt3 = paceToSec(mT3Pace)
    if (!lt2) { toast.error(t.labToastT2Required); return }
    setSavingManual(true)
    try {
      await savePhysiology({
        lt1PaceSec: lt1, lt1Hr: mT1Hr ? Number(mT1Hr) : null,
        lt2PaceSec: lt2, lt2Hr: mT2Hr ? Number(mT2Hr) : null,
        lt3PaceSec: lt3, lt3Hr: mT3Hr ? Number(mT3Hr) : null,
        vo2maxEst: estimateVo2max(lt2),
        source: 'manual',
      })
      toast.success(t.labToastManualSaved)
    } catch { toast.error(t.labToastSaveFailed) }
    finally { setSavingManual(false) }
  }

  const handleSaveTest = async () => {
    const validSteps = steps.filter(s => paceToSec(s.pace) != null && Number(s.lactate) > 0)
    if (validSteps.length < 3) { toast.error(t.labToastNeed3Steps); return }
    const { lt1, lt2, lt3 } = computeThresholds(validSteps)
    setSavingTest(true)
    try {
      const testDoc = {
        athleteId,
        date: testDate,
        notes: testNotes.trim(),
        steps: validSteps.map(s => ({ pace: s.pace.trim(), hr: s.hr ? Number(s.hr) : null, lactate: Number(s.lactate) })),
        lt1PaceSec: lt1?.paceSecPerKm ?? null,
        lt1Hr: lt1?.hr ?? null,
        lt2PaceSec: lt2?.paceSecPerKm ?? null,
        lt2Hr: lt2?.hr ?? null,
        lt3PaceSec: lt3?.paceSecPerKm ?? null,
        lt3Hr: lt3?.hr ?? null,
        createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'lactateTests'), testDoc)
      setTests(prev => [{ ...testDoc, id: ref.id } as LactateTestDoc, ...prev])
      if (lt2) {
        await savePhysiology({
          lt1PaceSec: lt1?.paceSecPerKm ?? null, lt1Hr: lt1?.hr ?? null,
          lt2PaceSec: lt2.paceSecPerKm, lt2Hr: lt2.hr,
          lt3PaceSec: lt3?.paceSecPerKm ?? null, lt3Hr: lt3?.hr ?? null,
          vo2maxEst: estimateVo2max(lt2.paceSecPerKm),
          source: 'test', testDate,
        })
      }
      toast.success(t.labToastTestSaved)
      setShowNewTest(false)
      setTestNotes(''); setSteps([emptyStep(), emptyStep(), emptyStep(), emptyStep()])
    } catch (e) { console.error(e); toast.error(t.labToastSaveFailed) }
    finally { setSavingTest(false) }
  }

  const applyTest = async (test: LactateTestDoc) => {
    if (!test.lt2PaceSec) { toast.error(t.labToastNoT2); return }
    await savePhysiology({
      lt1PaceSec: test.lt1PaceSec ?? null, lt1Hr: test.lt1Hr ?? null,
      lt2PaceSec: test.lt2PaceSec, lt2Hr: test.lt2Hr ?? null,
      lt3PaceSec: test.lt3PaceSec ?? null, lt3Hr: test.lt3Hr ?? null,
      vo2maxEst: estimateVo2max(test.lt2PaceSec),
      source: 'test', testDate: test.date,
    })
    toast.success(`${t.labToastThresholdsFromTest} ${format(new Date(test.date), 'd/M/yy')}`)
  }

  const handleDeleteTest = async (id: string) => {
    if (!confirm(t.labConfirmDeleteTest)) return
    try {
      await deleteDoc(doc(db, 'lactateTests', id))
      setTests(prev => prev.filter(x => x.id !== id))
      toast.success(t.labToastTestDeleted)
    } catch { toast.error(t.labToastDeleteFailed) }
  }

  const saveHr = async (field: 'maxHR' | 'restingHR', value: string) => {
    const n = Number(value)
    if (!value || !isFinite(n)) return
    try { await updateDoc(doc(db, 'users', athleteId), { [field]: n }) } catch {}
  }

  // Push derived paces into the athlete's trainingPaces (visible in profile + planner)
  const handlePushPaces = async () => {
    if (!phys?.lt2PaceSec) return
    setUpdatingPaces(true)
    try {
      const bands = derivePaceBands(phys.lt2PaceSec, phys.lt1PaceSec)
      const typeMap: Record<string, string> = {
        recovery: 'easy', easy: 'easy', marathon: 'tempo',
        threshold: 'threshold', interval: 'interval', reps: 'repetition',
      }
      const trainingPaces = bands.map((b, i) => ({
        id: `phys-${b.key}`,
        type: typeMap[b.key] || 'easy',
        pace: `${secToPace(b.highSec)}–${secToPace(b.lowSec)}`,
        description: bandText[b.key]?.label ?? b.labelHe,
      }))
      await updateDoc(doc(db, 'users', athleteId), { trainingPaces })
      toast.success(t.labToastPacesUpdated)
    } catch { toast.error(t.labToastUpdateFailed) }
    finally { setUpdatingPaces(false) }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[300px]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )

  const bands = phys?.lt2PaceSec ? derivePaceBands(phys.lt2PaceSec, phys.lt1PaceSec) : null
  const hrZones = physiologyHrZones({
    maxHr: maxHr ? Number(maxHr) : null,
    lt1Hr: phys?.lt1Hr, lt2Hr: phys?.lt2Hr,
  })
  const fullTests = tests.filter(x => x.kind !== 'spot')

  // derivePaceBands/physiologyHrZones return fixed Hebrew label/note text
  // (labelHe/noteHe) — translated here by each row's stable `key` instead
  // of touching those pure math functions, so the Lab reads in whichever
  // language is active without making the underlying library language-aware.
  const bandText: Record<string, { label: string; note: string }> = isRTL ? {
    recovery: { label: 'התאוששות', note: 'ריצה קלה מאוד, שיחה חופשית' },
    easy: { label: 'קל / אירובי', note: phys?.lt1PaceSec != null ? 'מתחת לסף האירובי (T1)' : 'הערכה מ-T2' },
    marathon: { label: 'קצב מרתון', note: 'בין T1 ל-T2' },
    threshold: { label: 'סף (T2)', note: 'קצב סף חומצת חלב' },
    interval: { label: 'אינטרוולים (VO2)', note: 'קטעים 2–5 דק׳' },
    reps: { label: 'חזרות מהירות', note: 'קטעים קצרים, מהירות' },
  } : {
    recovery: { label: 'Recovery', note: 'Very easy running, free conversation' },
    easy: { label: 'Easy / Aerobic', note: phys?.lt1PaceSec != null ? 'Below aerobic threshold (T1)' : 'Estimated from T2' },
    marathon: { label: 'Marathon pace', note: 'Between T1 and T2' },
    threshold: { label: 'Threshold (T2)', note: 'Lactate threshold pace' },
    interval: { label: 'Intervals (VO2)', note: '2–5 min reps' },
    reps: { label: 'Fast reps', note: 'Short, fast segments' },
  }
  const zoneText: Record<string, { label: string; note: string }> = isRTL ? {
    z1: { label: 'Z1 התאוששות', note: hrZones?.anchored ? 'מתחת לסף האירובי' : '50–60% מדופק מקס׳' },
    z2: { label: 'Z2 אירובי', note: hrZones?.anchored ? 'עד T1 — בסיס הנפח' : '60–70%' },
    z3: { label: 'Z3 טמפו', note: hrZones?.anchored ? 'בין הספים' : '70–80%' },
    z4: { label: 'Z4 סף', note: hrZones?.anchored ? 'סביב T2' : '80–90%' },
    z5: { label: 'Z5 מקסימלי', note: hrZones?.anchored ? 'מעל הסף — VO2max' : '90–100%' },
  } : {
    z1: { label: 'Z1 Recovery', note: hrZones?.anchored ? 'Below aerobic threshold' : '50–60% of max HR' },
    z2: { label: 'Z2 Aerobic', note: hrZones?.anchored ? 'Up to T1 — volume base' : '60–70%' },
    z3: { label: 'Z3 Tempo', note: hrZones?.anchored ? 'Between thresholds' : '70–80%' },
    z4: { label: 'Z4 Threshold', note: hrZones?.anchored ? 'Around T2' : '80–90%' },
    z5: { label: 'Z5 Maximal', note: hrZones?.anchored ? 'Above threshold — VO2max' : '90–100%' },
  }

  return (
    <div className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'}>

      {/* ── Current thresholds — hero treatment: the single headline number
          an athlete actually opens this page to check, so it gets the same
          dark gradient "hero card" language as a workout tile elsewhere in
          the app instead of blending in as just another white card. ── */}
      <div className="rounded-3xl bg-gradient-to-br from-[#0a1628] to-[#0a1628]/85 p-5">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <span className="flex items-center gap-1.5 text-white/90 font-bold text-sm">
            <Gauge className="h-4 w-4 text-[#c9a84c]"/>
            {t.labCurrentThresholds}
          </span>
          {phys && (
            <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full',
              phys.source === 'test' ? 'bg-emerald-400/20 text-emerald-300' : 'bg-amber-400/20 text-amber-300')}>
              {phys.source === 'test'
                ? `${t.labFromLactateTest} ${phys.testDate ? format(new Date(phys.testDate), 'd/M/yy') : ''}`
                : t.labManualEstimate}
            </span>
          )}
        </div>
        {phys?.lt2PaceSec ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <p className="text-[10px] text-white/50 mb-0.5">{t.labT1Aerobic}</p>
              <p className="text-xl font-black text-emerald-300" dir="ltr">{secToPace(phys.lt1PaceSec)}</p>
              <p className="text-[10px] text-white/50" dir="ltr">{phys.lt1Hr ? `♥ ${phys.lt1Hr} bpm` : '/km'}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <p className="text-[10px] text-white/50 mb-0.5">{t.labT2Anaerobic}</p>
              <p className="text-xl font-black text-amber-300" dir="ltr">{secToPace(phys.lt2PaceSec)}</p>
              <p className="text-[10px] text-white/50" dir="ltr">{phys.lt2Hr ? `♥ ${phys.lt2Hr} bpm` : '/km'}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <p className="text-[10px] text-white/50 mb-0.5">{t.labT3DeepAnaerobic}</p>
              <p className="text-xl font-black text-rose-300" dir="ltr">{secToPace(phys.lt3PaceSec)}</p>
              <p className="text-[10px] text-white/50" dir="ltr">{phys.lt3Hr ? `♥ ${phys.lt3Hr} bpm` : '/km'}</p>
            </div>
            <div className="rounded-2xl bg-white/10 p-3 text-center">
              <p className="text-[10px] text-white/50 mb-0.5">{t.labVo2maxEstimate}</p>
              <p className="text-xl font-black text-white" dir="ltr">{phys.vo2maxEst ?? '—'}</p>
              <p className="text-[10px] text-white/50">ml/kg/min</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-white/50 text-center py-2">
            {t.labNoThresholdsYet}
          </p>
        )}
      </div>
      <div className={cn(darkCard, 'p-4 space-y-3')}>

        {/* Manual override */}
        <button onClick={() => setShowManual(p => !p)}
          className="w-full flex items-center justify-between text-xs font-semibold text-white/60 hover:text-white py-1">
          <span>{t.labManualUpdateToggle}</span>
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showManual && 'rotate-180')}/>
        </button>
        {showManual && (
          <div className="rounded-xl border border-white/15 p-3 space-y-2">
            <div className="grid grid-cols-4 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{t.labT1Pace}</label>
                <Input value={mT1Pace} onChange={e => setMT1Pace(e.target.value)} placeholder="4:45" className={cn('h-9 text-sm text-center', darkInput)} dir="ltr"/>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{t.labT1Hr}</label>
                <Input value={mT1Hr} onChange={e => setMT1Hr(e.target.value)} placeholder="152" type="number" className={cn('h-9 text-sm text-center', darkInput)}/>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{t.labT2PaceRequired}</label>
                <Input value={mT2Pace} onChange={e => setMT2Pace(e.target.value)} placeholder="4:10" className={cn('h-9 text-sm text-center', darkInput)} dir="ltr"/>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{t.labT2Hr}</label>
                <Input value={mT2Hr} onChange={e => setMT2Hr(e.target.value)} placeholder="172" type="number" className={cn('h-9 text-sm text-center', darkInput)}/>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{t.labT3Pace}</label>
                <Input value={mT3Pace} onChange={e => setMT3Pace(e.target.value)} placeholder="4:00" className={cn('h-9 text-sm text-center', darkInput)} dir="ltr"/>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{t.labT3Hr}</label>
                <Input value={mT3Hr} onChange={e => setMT3Hr(e.target.value)} placeholder="178" type="number" className={cn('h-9 text-sm text-center', darkInput)}/>
              </div>
            </div>
            <Button onClick={handleSaveManual} disabled={savingManual} size="sm" className="w-full h-9 bg-gold hover:bg-gold/90 text-navy font-bold">
              {savingManual ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : t.labSaveEstimateBtn}
            </Button>
          </div>
        )}
      </div>

      {/* ── Workout gallery: every workout type + the real baseline test,
          each as its own graph, so they can all be scanned/compared at once ── */}
      <LactateWorkoutGallery athleteId={athleteId} />

      {/* ── Workout trends: coach-tagged comparison groups (any workout
          type, no lactate needed) — pace/HR over calendar time ── */}
      <WorkoutComparisonGallery athleteId={athleteId} />

      {/* ── Derived training paces ── */}
      {bands && (
        <div className={cn(darkCard, 'p-4 space-y-2')}>
          <p className="text-sm font-bold text-white/90 mb-3">{t.labDerivedPaces}</p>
          <div className="space-y-1.5">
            {bands.map(b => (
              <div key={b.key} className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
                <div>
                  <p className="text-xs font-bold text-white">{bandText[b.key]?.label ?? b.labelHe}</p>
                  <p className="text-[10px] text-white/50">{bandText[b.key]?.note ?? b.noteHe}</p>
                </div>
                <p className="font-mono text-sm font-bold text-[#c9a84c]" dir="ltr">
                  {secToPace(b.highSec)}–{secToPace(b.lowSec)} <span className="text-[10px] text-white/50">/km</span>
                </p>
              </div>
            ))}
          </div>
          <Button onClick={handlePushPaces} disabled={updatingPaces}
            className="w-full h-10 bg-gold hover:bg-gold/90 text-navy font-bold">
            {updatingPaces ? <Loader2 className="h-4 w-4 animate-spin"/> : t.labPushPacesBtn}
          </Button>
        </div>
      )}

      {/* ── HR zones ── */}
      <div className={cn(darkCard, 'p-4 space-y-3')}>
        <p className="text-sm font-bold text-white/90 flex items-center gap-2">
          <Heart className="h-4 w-4 text-red-400"/>
          {t.labHrZones}
          {hrZones && (
            <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full',
              hrZones.anchored ? 'bg-emerald-400/20 text-emerald-300' : 'bg-white/10 text-white/60')}>
              {hrZones.anchored ? t.labAnchoredToTest : t.labPercentMaxHr}
            </span>
          )}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{t.labMaxHr}</label>
            <Input value={maxHr} type="number" className={cn('h-9 text-sm text-center', darkInput)}
              onChange={e => setMaxHr(e.target.value)} onBlur={e => saveHr('maxHR', e.target.value)} placeholder="190"/>
          </div>
          <div>
            <label className="text-[10px] text-white/50 block mb-1">{t.labRestingHr}</label>
            <Input value={restingHr} type="number" className={cn('h-9 text-sm text-center', darkInput)}
              onChange={e => setRestingHr(e.target.value)} onBlur={e => saveHr('restingHR', e.target.value)} placeholder="48"/>
          </div>
        </div>
        {hrZones ? (
          <div className="space-y-1.5">
            {hrZones.zones.map(z => (
              <div key={z.key} className="flex items-center justify-between rounded-xl bg-white/10 px-3 py-2">
                <div>
                  <p className="text-xs font-bold text-white">{zoneText[z.key]?.label ?? z.labelHe}</p>
                  <p className="text-[10px] text-white/50">{zoneText[z.key]?.note ?? z.noteHe}</p>
                </div>
                <p className="font-mono text-sm font-bold text-[#c9a84c]" dir="ltr">
                  {z.lowBpm > 0 ? z.lowBpm : '<'}–{z.highBpm} <span className="text-[10px] text-white/50">bpm</span>
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-white/50 text-center py-2">{t.labEnterMaxHrHint}</p>
        )}
      </div>

      {/* ── New lactate test ── */}
      <div className={cn(darkCard, 'p-4', showNewTest && 'ring-1 ring-[#c9a84c]/40')}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-white/90 flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-[#c9a84c]"/>
            {t.labNewLactateTest}
          </p>
          {!showNewTest && (
            <Button size="sm" variant="outline" className="h-7 text-xs bg-transparent border-[#c9a84c]/40 text-[#c9a84c] hover:bg-white/10 hover:text-[#c9a84c]"
              onClick={() => setShowNewTest(true)}>
              <Plus className="h-3 w-3 ml-1"/>{t.labAddTestBtn}
            </Button>
          )}
        </div>
        {showNewTest && (
          <div className="mt-3 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{t.labDateLabel}</label>
                <Input type="date" value={testDate} onChange={e => setTestDate(e.target.value)} className={cn('h-9 text-sm [color-scheme:dark]', darkInput)}/>
              </div>
              <div>
                <label className="text-[10px] text-white/50 block mb-1">{t.labNotesProtocol}</label>
                <Input value={testNotes} onChange={e => setTestNotes(e.target.value)} placeholder={t.labNotesPlaceholder} className={cn('h-9 text-sm', darkInput)} dir={isRTL ? 'rtl' : 'ltr'}/>
              </div>
            </div>

            {/* Step rows */}
            <div className="rounded-xl border border-white/15 overflow-hidden">
              <div className="grid grid-cols-[2rem_1fr_1fr_1fr_2rem] gap-1 bg-white/10 px-2 py-1.5 text-[10px] font-bold text-white text-center">
                <span>#</span><span>{t.labPaceUnit}</span><span>{t.labHrLabel}</span><span>{t.labLactateMmol}</span><span/>
              </div>
              {steps.map((s, i) => (
                <div key={i} className="grid grid-cols-[2rem_1fr_1fr_1fr_2rem] gap-1 items-center px-2 py-1 border-t border-white/10">
                  <span className="text-[11px] font-bold text-center text-white/40">{i + 1}</span>
                  <Input value={s.pace} onChange={e => setSteps(p => p.map((x, xi) => xi === i ? { ...x, pace: e.target.value } : x))}
                    placeholder="5:00" className={cn('h-8 text-xs text-center', darkInput)} dir="ltr" inputMode="numeric"/>
                  <Input value={s.hr ?? ''} onChange={e => setSteps(p => p.map((x, xi) => xi === i ? { ...x, hr: e.target.value ? Number(e.target.value) : null } : x))}
                    placeholder="150" type="number" className={cn('h-8 text-xs text-center', darkInput)}/>
                  <Input value={s.lactate || ''} onChange={e => setSteps(p => p.map((x, xi) => xi === i ? { ...x, lactate: Number(e.target.value) } : x))}
                    placeholder="1.8" type="number" step="0.1" className={cn('h-8 text-xs text-center', darkInput)}/>
                  <button onClick={() => setSteps(p => p.filter((_, xi) => xi !== i))}
                    className="text-white/30 hover:text-red-400 text-xs">✕</button>
                </div>
              ))}
              <button onClick={() => setSteps(p => [...p, emptyStep()])}
                className="w-full py-1.5 text-[11px] font-semibold text-[#c9a84c] hover:bg-white/5 border-t border-white/10">
                {t.labAddStepBtn}
              </button>
            </div>

            {/* Live preview */}
            {(livePreview.lt1 || livePreview.lt2 || livePreview.lt3) && (
              <div className="rounded-xl bg-white/10 border border-white/10 px-3 py-2 flex items-center justify-around text-center">
                <div>
                  <p className="text-[10px] text-white/50">T1 (2.0)</p>
                  <p className="text-sm font-black text-emerald-300" dir="ltr">
                    {livePreview.lt1 ? `${secToPace(livePreview.lt1.paceSecPerKm)}${livePreview.lt1.hr ? ` · ♥${livePreview.lt1.hr}` : ''}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-white/50">T2 (4.0)</p>
                  <p className="text-sm font-black text-amber-300" dir="ltr">
                    {livePreview.lt2 ? `${secToPace(livePreview.lt2.paceSecPerKm)}${livePreview.lt2.hr ? ` · ♥${livePreview.lt2.hr}` : ''}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-white/50">T3 (4.5)</p>
                  <p className="text-sm font-black text-rose-300" dir="ltr">
                    {livePreview.lt3 ? `${secToPace(livePreview.lt3.paceSecPerKm)}${livePreview.lt3.hr ? ` · ♥${livePreview.lt3.hr}` : ''}` : '—'}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleSaveTest} disabled={savingTest} className="flex-1 h-10 bg-gold hover:bg-gold/90 text-navy font-bold">
                {savingTest ? <Loader2 className="h-4 w-4 animate-spin"/> : t.labSaveTestBtn}
              </Button>
              <Button variant="ghost" onClick={() => setShowNewTest(false)} className="h-10 text-white/70 hover:text-white hover:bg-white/10">{t.cancel}</Button>
            </div>
          </div>
        )}
      </div>

      {/* ── Test history ── */}
      {fullTests.length > 0 && (
        <div className={cn(darkCard, 'p-4 space-y-1.5')}>
          <p className="text-sm font-bold text-white/90 mb-3">{t.labTestHistory} ({fullTests.length})</p>
          {fullTests.map(test => (
            <div key={test.id} className="rounded-xl border border-white/10 bg-white/5 overflow-hidden">
              <button onClick={() => setExpandedTest(p => p === test.id ? null : test.id)}
                className="w-full px-3 py-2 flex items-center justify-between hover:bg-white/5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-white">{format(new Date(test.date), 'd/M/yyyy')}</span>
                  {test.lt2PaceSec && (
                    <span className="text-[10px] font-semibold bg-amber-400/15 text-amber-300 border border-amber-400/25 px-1.5 py-0.5 rounded-full" dir="ltr">
                      T2 {secToPace(test.lt2PaceSec)}
                    </span>
                  )}
                  {test.lt1PaceSec && (
                    <span className="text-[10px] font-semibold bg-emerald-400/15 text-emerald-300 border border-emerald-400/25 px-1.5 py-0.5 rounded-full" dir="ltr">
                      T1 {secToPace(test.lt1PaceSec)}
                    </span>
                  )}
                  {test.lt3PaceSec && (
                    <span className="text-[10px] font-semibold bg-rose-400/15 text-rose-300 border border-rose-400/25 px-1.5 py-0.5 rounded-full" dir="ltr">
                      T3 {secToPace(test.lt3PaceSec)}
                    </span>
                  )}
                </div>
                <ChevronDown className={cn('h-3.5 w-3.5 text-white/50 transition-transform', expandedTest === test.id && 'rotate-180')}/>
              </button>
              {expandedTest === test.id && (
                <div className="border-t border-white/10 px-3 py-2 space-y-2">
                  {test.notes && <p className="text-[11px] text-white/50">{test.notes}</p>}
                  <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-1 text-[10px] font-bold text-white text-center">
                    <span>#</span><span>{isRTL ? 'קצב' : 'Pace'}</span><span>{t.labHrLabel}</span><span>{t.labLactateLabel}</span>
                  </div>
                  {test.steps?.map((s, i) => (
                    <div key={i} className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-1 text-[11px] text-center text-white/85">
                      <span className="text-white/40">{i + 1}</span>
                      <span dir="ltr" className="font-mono">{s.pace}</span>
                      <span>{s.hr ?? '—'}</span>
                      <span>{s.lactate}</span>
                    </div>
                  ))}
                  <div className="flex gap-2 pt-1">
                    <Button size="sm" variant="outline" className="h-7 text-[11px] flex-1 bg-transparent border-white/20 text-white hover:bg-white/10 hover:text-white" onClick={() => applyTest(test)}>
                      {t.labUseThisTestBtn}
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px] text-red-400 hover:text-red-300 hover:bg-white/10" onClick={() => handleDeleteTest(test.id)}>
                      <Trash2 className="h-3 w-3"/>
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

    </div>
  )
}
