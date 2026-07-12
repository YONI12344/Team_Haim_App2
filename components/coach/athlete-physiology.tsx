'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Plus, Trash2, FlaskConical, Heart, Gauge, ChevronDown } from 'lucide-react'
import { collection, doc, getDoc, getDocs, addDoc, deleteDoc, updateDoc, query, where, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { format } from 'date-fns'
import {
  type LactateStep, type PhysiologySummary, type SpotReading,
  computeThresholds, estimateVo2max, derivePaceBands, physiologyHrZones,
  analyzeSpotReading, paceToSec, secToPace, interpolateAtHr,
} from '@/lib/physiology'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { AthleteWorkoutProgress } from '@/components/coach/athlete-workout-progress'

// Matches the app's --gold/--coral theme tokens (recharts needs literal
// color strings, not CSS vars) — same gold hex already used in athlete-stats.tsx.
const CURVE_COLOR_OLD = '#c9a84c'
const CURVE_COLOR_NEW = '#e8826b'

/** Min/max HR covered by a curve's steps, or null if no step has an HR. */
function hrRange(steps: LactateStep[]): [number, number] | null {
  const hrs = steps.map(s => s.hr).filter((h): h is number => h != null)
  if (!hrs.length) return null
  return [Math.min(...hrs), Math.max(...hrs)]
}

interface LactateTestDoc {
  id: string
  athleteId: string
  date: string
  notes?: string
  /** 'step' = full incremental test (default); 'spot' = in-workout quick check */
  kind?: 'step' | 'spot'
  /** spot checks: session context, e.g. "20×400" + morning/evening */
  workoutLabel?: string
  session?: 'am' | 'pm'
  targetLactate?: number | null
  readings?: SpotReading[]
  steps: LactateStep[]
  lt1PaceSec?: number | null
  lt1Hr?: number | null
  lt2PaceSec?: number | null
  lt2Hr?: number | null
}

const emptyStep = (): LactateStep => ({ pace: '', hr: null, lactate: 0 })

/**
 * מעבדה — the physiology hub for one athlete, shared by the coach's planner
 * tab and the athlete's own self-serve lab page (components/athlete/athlete-lab-view.tsx):
 * lactate tests (T1/T2), threshold paces (measured or manual estimate),
 * VO2max estimate, derived training paces, and smart HR zones.
 */
export function AthletePhysiology({ athleteId }: { athleteId: string }) {
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

  // In-workout spot check form
  const emptyReading = (): SpotReading => ({ label: '', pace: '', hr: null, lactate: 0 })
  const [showSpot, setShowSpot] = useState(false)
  const [spotDate, setSpotDate] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [spotSession, setSpotSession] = useState<'am' | 'pm'>('am')
  const [spotWorkout, setSpotWorkout] = useState('')
  const [spotTarget, setSpotTarget] = useState('')
  const [spotReadings, setSpotReadings] = useState<SpotReading[]>([emptyReading()])
  const [savingSpot, setSavingSpot] = useState(false)

  // Lactate-curve comparison (step tests + threshold-workout readings share
  // the same LactateStep[] shape, so both are selectable here)
  const [curveAId, setCurveAId] = useState('')
  const [curveBId, setCurveBId] = useState('')

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

  // Default the curve comparison to oldest-vs-newest full test once loaded
  useEffect(() => {
    const full = tests.filter(t => t.kind !== 'spot')
    if (full.length >= 1 && !curveBId) setCurveBId(full[0].id)
    if (full.length >= 2 && !curveAId) setCurveAId(full[full.length - 1].id)
  }, [tests])

  // Live preview of thresholds while typing the new test
  const livePreview = useMemo(() => computeThresholds(steps), [steps])

  const savePhysiology = async (summary: PhysiologySummary) => {
    await updateDoc(doc(db, 'users', athleteId), { physiology: { ...summary, updatedAt: serverTimestamp() } })
    setPhys(summary)
  }

  const handleSaveManual = async () => {
    const lt1 = paceToSec(mT1Pace)
    const lt2 = paceToSec(mT2Pace)
    if (!lt2) { toast.error('נדרש לפחות קצב סף T2 (למשל 4:10)'); return }
    setSavingManual(true)
    try {
      await savePhysiology({
        lt1PaceSec: lt1, lt1Hr: mT1Hr ? Number(mT1Hr) : null,
        lt2PaceSec: lt2, lt2Hr: mT2Hr ? Number(mT2Hr) : null,
        vo2maxEst: estimateVo2max(lt2),
        source: 'manual',
      })
      toast.success('הספים עודכנו (הערכה ידנית)')
    } catch { toast.error('שמירה נכשלה') }
    finally { setSavingManual(false) }
  }

  const handleSaveTest = async () => {
    const validSteps = steps.filter(s => paceToSec(s.pace) != null && Number(s.lactate) > 0)
    if (validSteps.length < 3) { toast.error('נדרשות לפחות 3 מדרגות עם קצב ולקטט'); return }
    const { lt1, lt2 } = computeThresholds(validSteps)
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
        createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'lactateTests'), testDoc)
      setTests(prev => [{ ...testDoc, id: ref.id } as LactateTestDoc, ...prev])
      if (lt2) {
        await savePhysiology({
          lt1PaceSec: lt1?.paceSecPerKm ?? null, lt1Hr: lt1?.hr ?? null,
          lt2PaceSec: lt2.paceSecPerKm, lt2Hr: lt2.hr,
          vo2maxEst: estimateVo2max(lt2.paceSecPerKm),
          source: 'test', testDate,
        })
      }
      toast.success('הבדיקה נשמרה והספים חושבו ✓')
      setShowNewTest(false)
      setTestNotes(''); setSteps([emptyStep(), emptyStep(), emptyStep(), emptyStep()])
    } catch (e) { console.error(e); toast.error('שמירה נכשלה') }
    finally { setSavingTest(false) }
  }

  const applyTest = async (test: LactateTestDoc) => {
    if (!test.lt2PaceSec) { toast.error('לבדיקה זו אין T2 מחושב'); return }
    await savePhysiology({
      lt1PaceSec: test.lt1PaceSec ?? null, lt1Hr: test.lt1Hr ?? null,
      lt2PaceSec: test.lt2PaceSec, lt2Hr: test.lt2Hr ?? null,
      vo2maxEst: estimateVo2max(test.lt2PaceSec),
      source: 'test', testDate: test.date,
    })
    toast.success(`הספים עודכנו מבדיקת ${format(new Date(test.date), 'd/M/yy')}`)
  }

  const handleSaveSpot = async () => {
    const valid = spotReadings.filter(r => paceToSec(r.pace) != null && Number(r.lactate) > 0)
    if (valid.length === 0) { toast.error('נדרשת לפחות קריאה אחת עם קצב ולקטט'); return }
    setSavingSpot(true)
    try {
      const docData = {
        athleteId,
        kind: 'spot' as const,
        date: spotDate,
        session: spotSession,
        workoutLabel: spotWorkout.trim(),
        targetLactate: spotTarget ? Number(spotTarget) : null,
        readings: valid.map(r => ({
          label: r.label?.trim() || '',
          pace: r.pace.trim(),
          hr: r.hr ? Number(r.hr) : null,
          lactate: Number(r.lactate),
        })),
        steps: [] as LactateStep[],
        notes: '',
        createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'lactateTests'), docData)
      setTests(prev => [{ ...docData, id: ref.id } as LactateTestDoc, ...prev])
      toast.success('הבדיקה המהירה נשמרה ✓')
      setShowSpot(false)
      setSpotWorkout(''); setSpotTarget(''); setSpotReadings([emptyReading()])
    } catch (e) { console.error(e); toast.error('שמירה נכשלה') }
    finally { setSavingSpot(false) }
  }

  const handleDeleteTest = async (id: string) => {
    if (!confirm('למחוק את הבדיקה?')) return
    try {
      await deleteDoc(doc(db, 'lactateTests', id))
      setTests(prev => prev.filter(t => t.id !== id))
      toast.success('הבדיקה נמחקה')
    } catch { toast.error('מחיקה נכשלה') }
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
        description: b.labelHe,
      }))
      await updateDoc(doc(db, 'users', athleteId), { trainingPaces })
      toast.success('הטמפואים עודכנו אצל הספורטאי ✓')
    } catch { toast.error('עדכון נכשל') }
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
  const fullTests = tests.filter(t => t.kind !== 'spot')
  const spotChecks = tests.filter(t => t.kind === 'spot')
  const analyzeReading = (r: SpotReading) => {
    const sec = paceToSec(r.pace)
    if (sec == null || !Number(r.lactate)) return null
    return analyzeSpotReading(sec, Number(r.lactate), phys?.lt1PaceSec, phys?.lt2PaceSec)
  }
  const verdictClass = (v: string) =>
    v === 'improving' ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
    : v === 'tired' ? 'bg-red-50 text-red-600 border-red-200'
    : 'bg-gray-50 text-gray-600 border-gray-200'

  return (
    <div className="space-y-4" dir="rtl">

      {/* ── Current thresholds ── */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Gauge className="h-4 w-4 text-gold"/>
            ספים נוכחיים
            {phys && (
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                phys.source === 'test'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : 'bg-amber-50 text-amber-700 border-amber-200')}>
                {phys.source === 'test'
                  ? `מבדיקת לקטט ${phys.testDate ? format(new Date(phys.testDate), 'd/M/yy') : ''}`
                  : 'הערכה ידנית'}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {phys?.lt2PaceSec ? (
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl bg-emerald-50 border border-emerald-100 p-3 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">T1 · סף אירובי</p>
                <p className="text-xl font-black text-emerald-700">{secToPace(phys.lt1PaceSec)}</p>
                <p className="text-[10px] text-muted-foreground">{phys.lt1Hr ? `♥ ${phys.lt1Hr} bpm` : '/km'}</p>
              </div>
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">T2 · סף אנאירובי</p>
                <p className="text-xl font-black text-amber-700">{secToPace(phys.lt2PaceSec)}</p>
                <p className="text-[10px] text-muted-foreground">{phys.lt2Hr ? `♥ ${phys.lt2Hr} bpm` : '/km'}</p>
              </div>
              <div className="rounded-xl bg-navy/5 border border-navy/10 p-3 text-center">
                <p className="text-[10px] text-muted-foreground mb-0.5">VO2max (הערכה)</p>
                <p className="text-xl font-black text-navy">{phys.vo2maxEst ?? '—'}</p>
                <p className="text-[10px] text-muted-foreground">ml/kg/min</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground text-center py-2">
              אין עדיין ספים — הוסף בדיקת לקטט או הזן הערכה ידנית
            </p>
          )}

          {/* Manual override */}
          <button onClick={() => setShowManual(p => !p)}
            className="w-full flex items-center justify-between text-xs font-semibold text-muted-foreground hover:text-navy py-1">
            <span>עדכון ידני (בלי בדיקה — לפי הערכה)</span>
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', showManual && 'rotate-180')}/>
          </button>
          {showManual && (
            <div className="rounded-xl border border-border p-3 space-y-2">
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">T1 קצב</label>
                  <Input value={mT1Pace} onChange={e => setMT1Pace(e.target.value)} placeholder="4:45" className="h-9 text-sm text-center" dir="ltr"/>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">T1 דופק</label>
                  <Input value={mT1Hr} onChange={e => setMT1Hr(e.target.value)} placeholder="152" type="number" className="h-9 text-sm text-center"/>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">T2 קצב *</label>
                  <Input value={mT2Pace} onChange={e => setMT2Pace(e.target.value)} placeholder="4:10" className="h-9 text-sm text-center" dir="ltr"/>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">T2 דופק</label>
                  <Input value={mT2Hr} onChange={e => setMT2Hr(e.target.value)} placeholder="172" type="number" className="h-9 text-sm text-center"/>
                </div>
              </div>
              <Button onClick={handleSaveManual} disabled={savingManual} size="sm" className="w-full h-9 bg-navy text-white">
                {savingManual ? <Loader2 className="h-3.5 w-3.5 animate-spin"/> : 'שמור הערכה'}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Derived training paces ── */}
      {bands && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">טמפואים נגזרים מהספים</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-2">
            <div className="space-y-1.5">
              {bands.map(b => (
                <div key={b.key} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                  <div>
                    <p className="text-xs font-bold text-navy">{b.labelHe}</p>
                    <p className="text-[10px] text-muted-foreground">{b.noteHe}</p>
                  </div>
                  <p className="font-mono text-sm font-bold text-navy" dir="ltr">
                    {secToPace(b.highSec)}–{secToPace(b.lowSec)} <span className="text-[10px] text-muted-foreground">/km</span>
                  </p>
                </div>
              ))}
            </div>
            <Button onClick={handlePushPaces} disabled={updatingPaces}
              className="w-full h-10 bg-gold hover:bg-gold/90 text-navy font-bold">
              {updatingPaces ? <Loader2 className="h-4 w-4 animate-spin"/> : 'עדכן את הטמפואים אצל הספורטאי ←'}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ── HR zones ── */}
      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
          <CardTitle className="text-sm flex items-center gap-2">
            <Heart className="h-4 w-4 text-red-500"/>
            אזורי דופק
            {hrZones && (
              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                hrZones.anchored ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-500 border-gray-200')}>
                {hrZones.anchored ? 'מעוגן לספים מהבדיקה' : '% מדופק מקסימלי'}
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">דופק מקסימלי</label>
              <Input value={maxHr} type="number" className="h-9 text-sm text-center"
                onChange={e => setMaxHr(e.target.value)} onBlur={e => saveHr('maxHR', e.target.value)} placeholder="190"/>
            </div>
            <div>
              <label className="text-[10px] text-muted-foreground block mb-1">דופק מנוחה</label>
              <Input value={restingHr} type="number" className="h-9 text-sm text-center"
                onChange={e => setRestingHr(e.target.value)} onBlur={e => saveHr('restingHR', e.target.value)} placeholder="48"/>
            </div>
          </div>
          {hrZones ? (
            <div className="space-y-1.5">
              {hrZones.zones.map(z => (
                <div key={z.key} className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
                  <div>
                    <p className="text-xs font-bold text-navy">{z.labelHe}</p>
                    <p className="text-[10px] text-muted-foreground">{z.noteHe}</p>
                  </div>
                  <p className="font-mono text-sm font-bold text-navy" dir="ltr">
                    {z.lowBpm > 0 ? z.lowBpm : '<'}–{z.highBpm} <span className="text-[10px] text-muted-foreground">bpm</span>
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-2">הזן דופק מקסימלי או בדיקת לקטט עם דופק</p>
          )}
        </CardContent>
      </Card>

      {/* ── Lactate curve chart (compare any two real step tests) ── */}
      {fullTests.length >= 1 && (() => {
        const testA = fullTests.find(t => t.id === curveAId) || null
        const testB = fullTests.find(t => t.id === curveBId) || null
        const curveLabel = (t: LactateTestDoc) => `${format(new Date(t.date), 'd/M/yy')} · 🧪`
        const curveData = (t: LactateTestDoc) =>
          t.steps.filter(s => s.hr != null).map(s => ({ hr: s.hr, lactate: s.lactate, pace: s.pace })).sort((a, b) => (a.hr! - b.hr!))

        return (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm flex items-center gap-2">📈 עקומת לקטט</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">עקומה ישנה</label>
                  <Select value={curveAId} onValueChange={setCurveAId}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="בחר בדיקה" /></SelectTrigger>
                    <SelectContent>
                      {fullTests.map(t => <SelectItem key={t.id} value={t.id} className="text-xs">{curveLabel(t)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-[10px] text-muted-foreground block mb-1">עקומה חדשה</label>
                  <Select value={curveBId} onValueChange={setCurveBId}>
                    <SelectTrigger className="h-9 text-xs"><SelectValue placeholder="בחר בדיקה" /></SelectTrigger>
                    <SelectContent>
                      {fullTests.map(t => <SelectItem key={t.id} value={t.id} className="text-xs">{curveLabel(t)}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {testA && testB ? (
                <>
                  <div style={{ width: '100%', height: 260 }} dir="ltr">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart margin={{ top: 10, right: 15, left: -15, bottom: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                        <XAxis dataKey="hr" type="number" domain={['dataMin - 5', 'dataMax + 5']}
                          tick={{ fontSize: 11, fill: '#9ca3af' }}
                          label={{ value: 'HR (bpm)', position: 'insideBottom', offset: -3, fontSize: 11, fill: '#9ca3af' }} />
                        <YAxis dataKey="lactate" type="number" tick={{ fontSize: 11, fill: '#9ca3af' }}
                          label={{ value: 'mmol/L', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#9ca3af' }} />
                        <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #f0f0f0', borderRadius: '12px' }}
                          formatter={(v: any) => [`${v} mmol/L`, '']} labelFormatter={(v: any) => `${v} bpm`} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line name={curveLabel(testA)} data={curveData(testA)} dataKey="lactate"
                          stroke={CURVE_COLOR_OLD} strokeWidth={2} dot={{ r: 3 }} />
                        <Line name={curveLabel(testB)} data={curveData(testB)} dataKey="lactate"
                          stroke={CURVE_COLOR_NEW} strokeWidth={2} dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="rounded-xl border border-border overflow-hidden">
                    <div className="grid grid-cols-4 gap-1 bg-navy/5 px-2 py-1.5 text-[10px] font-bold text-navy text-center">
                      <span>עקומה</span><span>דופק</span><span>לקטט</span><span>קצב</span>
                    </div>
                    {[{ t: testA, color: CURVE_COLOR_OLD, label: 'ישנה' }, { t: testB, color: CURVE_COLOR_NEW, label: 'חדשה' }]
                      .flatMap(({ t, color, label }) => curveData(t).map((p, i) => (
                        <div key={`${t.id}-${i}`} className="grid grid-cols-4 gap-1 items-center px-2 py-1 border-t border-border/40 text-[11px] text-center text-navy">
                          <span className="font-semibold" style={{ color }}>{label}</span>
                          <span>{p.hr}</span>
                          <span className="font-bold">{p.lactate}</span>
                          <span dir="ltr" className="font-mono">{p.pace || '—'}</span>
                        </div>
                      )))}
                  </div>
                </>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-2">בחר שתי בדיקות להשוואה (נדרשות לפחות שתי בדיקות עם דופק)</p>
              )}
            </CardContent>
          </Card>
        )
      })()}

      {/* ── Fitness improvement: lactate at the same HR, old vs new ── */}
      {fullTests.length >= 2 && curveAId && curveBId && curveAId !== curveBId && (() => {
        const testA = fullTests.find(t => t.id === curveAId)
        const testB = fullTests.find(t => t.id === curveBId)
        if (!testA || !testB) return null
        const rangeA = hrRange(testA.steps)
        const rangeB = hrRange(testB.steps)
        if (!rangeA || !rangeB) return null
        const lo = Math.max(rangeA[0], rangeB[0])
        const hi = Math.min(rangeA[1], rangeB[1])
        // Whichever of the two selected tests is actually earlier in time —
        // independent of which dropdown ("old"/"new") it was picked in.
        const older = testA.date <= testB.date ? testA : testB
        const newer = testA.date <= testB.date ? testB : testA
        const checkpoints = lo < hi ? [0, 1, 2, 3].map(i => Math.round(lo + (hi - lo) * (i / 3))) : []
        const uniqueCheckpoints = Array.from(new Set(checkpoints))
        const rows = uniqueCheckpoints
          .map(hr => ({ hr, oldLac: interpolateAtHr(older.steps, hr), newLac: interpolateAtHr(newer.steps, hr) }))
          .filter(r => r.oldLac != null && r.newLac != null) as { hr: number; oldLac: number; newLac: number }[]

        return (
          <Card>
            <CardHeader className="pb-2 pt-4 px-4">
              <CardTitle className="text-sm">💡 שיפור כושר — לקטט באותו דופק</CardTitle>
            </CardHeader>
            <CardContent className="px-4 pb-4">
              {rows.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-2">אין טווח דופק חופף מספיק בין שתי הבדיקות להשוואה</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {rows.map(r => {
                    const delta = Math.round((r.newLac - r.oldLac) * 100) / 100
                    const pct = Math.round((delta / r.oldLac) * 1000) / 10
                    const better = delta < 0
                    return (
                      <div key={r.hr} className={cn('rounded-xl border p-3', better ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
                        <p className="text-[10px] text-muted-foreground mb-1">דופק {r.hr} bpm</p>
                        <p className="text-xs font-mono" dir="ltr">{r.oldLac} → <span className="font-bold">{r.newLac}</span> mmol/L</p>
                        <p className={cn('text-[11px] font-bold mt-1', better ? 'text-emerald-700' : 'text-red-600')} dir="ltr">
                          {better ? '✓ ' : '⚠ '}{pct > 0 ? '+' : ''}{pct}%
                        </p>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })()}

      {/* ── New lactate test ── */}
      <Card className={showNewTest ? 'border-gold/40' : ''}>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              <FlaskConical className="h-4 w-4 text-gold"/>
              בדיקת לקטט חדשה
            </CardTitle>
            {!showNewTest && (
              <Button size="sm" variant="outline" className="h-7 text-xs border-gold/40 text-gold hover:bg-gold/10"
                onClick={() => setShowNewTest(true)}>
                <Plus className="h-3 w-3 ml-1"/>הוסף בדיקה
              </Button>
            )}
          </div>
        </CardHeader>
        {showNewTest && (
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">תאריך</label>
                <Input type="date" value={testDate} onChange={e => setTestDate(e.target.value)} className="h-9 text-sm"/>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">הערות (פרוטוקול)</label>
                <Input value={testNotes} onChange={e => setTestNotes(e.target.value)} placeholder="מסילה, מדרגות 4 דק׳" className="h-9 text-sm" dir="rtl"/>
              </div>
            </div>

            {/* Step rows */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-[2rem_1fr_1fr_1fr_2rem] gap-1 bg-navy/5 px-2 py-1.5 text-[10px] font-bold text-navy text-center">
                <span>#</span><span>קצב /ק"מ</span><span>דופק</span><span>לקטט mmol</span><span/>
              </div>
              {steps.map((s, i) => (
                <div key={i} className="grid grid-cols-[2rem_1fr_1fr_1fr_2rem] gap-1 items-center px-2 py-1 border-t border-border/40">
                  <span className="text-[11px] font-bold text-center text-muted-foreground">{i + 1}</span>
                  <Input value={s.pace} onChange={e => setSteps(p => p.map((x, xi) => xi === i ? { ...x, pace: e.target.value } : x))}
                    placeholder="5:00" className="h-8 text-xs text-center" dir="ltr" inputMode="numeric"/>
                  <Input value={s.hr ?? ''} onChange={e => setSteps(p => p.map((x, xi) => xi === i ? { ...x, hr: e.target.value ? Number(e.target.value) : null } : x))}
                    placeholder="150" type="number" className="h-8 text-xs text-center"/>
                  <Input value={s.lactate || ''} onChange={e => setSteps(p => p.map((x, xi) => xi === i ? { ...x, lactate: Number(e.target.value) } : x))}
                    placeholder="1.8" type="number" step="0.1" className="h-8 text-xs text-center"/>
                  <button onClick={() => setSteps(p => p.filter((_, xi) => xi !== i))}
                    className="text-gray-300 hover:text-red-400 text-xs">✕</button>
                </div>
              ))}
              <button onClick={() => setSteps(p => [...p, emptyStep()])}
                className="w-full py-1.5 text-[11px] font-semibold text-gold hover:bg-gold/5 border-t border-border/40">
                + מדרגה
              </button>
            </div>

            {/* Live preview */}
            {(livePreview.lt1 || livePreview.lt2) && (
              <div className="rounded-xl bg-emerald-50/60 border border-emerald-100 px-3 py-2 flex items-center justify-around text-center">
                <div>
                  <p className="text-[10px] text-muted-foreground">T1 (2.0)</p>
                  <p className="text-sm font-black text-emerald-700" dir="ltr">
                    {livePreview.lt1 ? `${secToPace(livePreview.lt1.paceSecPerKm)}${livePreview.lt1.hr ? ` · ♥${livePreview.lt1.hr}` : ''}` : '—'}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted-foreground">T2 (4.0)</p>
                  <p className="text-sm font-black text-amber-700" dir="ltr">
                    {livePreview.lt2 ? `${secToPace(livePreview.lt2.paceSecPerKm)}${livePreview.lt2.hr ? ` · ♥${livePreview.lt2.hr}` : ''}` : '—'}
                  </p>
                </div>
              </div>
            )}

            <div className="flex gap-2">
              <Button onClick={handleSaveTest} disabled={savingTest} className="flex-1 h-10 bg-navy text-white font-bold">
                {savingTest ? <Loader2 className="h-4 w-4 animate-spin"/> : 'שמור בדיקה וחשב ספים'}
              </Button>
              <Button variant="ghost" onClick={() => setShowNewTest(false)} className="h-10">ביטול</Button>
            </div>
          </CardContent>
        )}
      </Card>

      {/* ── In-workout spot check ── */}
      <Card className={showSpot ? 'border-gold/40' : ''}>
        <CardHeader className="pb-2 pt-4 px-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm flex items-center gap-2">
              ⚡ בדיקה מהירה באימון
              <span className="text-[10px] font-normal text-muted-foreground">לקטט תוך כדי חזרות (20×400, 5×1600...)</span>
            </CardTitle>
            {!showSpot && (
              <Button size="sm" variant="outline" className="h-7 text-xs border-gold/40 text-gold hover:bg-gold/10"
                onClick={() => setShowSpot(true)}>
                <Plus className="h-3 w-3 ml-1"/>הוסף
              </Button>
            )}
          </div>
        </CardHeader>
        {showSpot && (
          <CardContent className="px-4 pb-4 space-y-3">
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">תאריך</label>
                <Input type="date" value={spotDate} onChange={e => setSpotDate(e.target.value)} className="h-9 text-sm"/>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">אימון</label>
                <Input value={spotWorkout} onChange={e => setSpotWorkout(e.target.value)} placeholder="20×400" className="h-9 text-sm text-center" dir="ltr"/>
              </div>
              <div>
                <label className="text-[10px] text-muted-foreground block mb-1">יעד לקטט</label>
                <Input value={spotTarget} onChange={e => setSpotTarget(e.target.value)} placeholder="2.5" type="number" step="0.1" className="h-9 text-sm text-center"/>
              </div>
            </div>
            {/* Session AM/PM */}
            <div className="flex gap-1 bg-muted rounded-xl p-0.5 w-fit">
              {(['am','pm'] as const).map(s => (
                <button key={s} onClick={() => setSpotSession(s)}
                  className={cn('text-xs px-4 py-1 rounded-lg font-semibold transition-all',
                    spotSession === s ? 'bg-white text-navy shadow-sm' : 'text-muted-foreground')}>
                  {s === 'am' ? '🌅 בוקר' : '🌇 ערב'}
                </button>
              ))}
            </div>

            {/* Readings */}
            <div className="rounded-xl border border-border overflow-hidden">
              <div className="grid grid-cols-[1fr_1fr_1fr_1fr_2rem] gap-1 bg-navy/5 px-2 py-1.5 text-[10px] font-bold text-navy text-center">
                <span>אחרי חזרה</span><span>קצב /ק"מ</span><span>דופק</span><span>לקטט</span><span/>
              </div>
              {spotReadings.map((r, i) => {
                const a = analyzeReading(r)
                return (
                  <div key={i} className="border-t border-border/40">
                    <div className="grid grid-cols-[1fr_1fr_1fr_1fr_2rem] gap-1 items-center px-2 py-1">
                      <Input value={r.label || ''} onChange={e => setSpotReadings(p => p.map((x, xi) => xi === i ? { ...x, label: e.target.value } : x))}
                        placeholder="8" className="h-8 text-xs text-center"/>
                      <Input value={r.pace} onChange={e => setSpotReadings(p => p.map((x, xi) => xi === i ? { ...x, pace: e.target.value } : x))}
                        placeholder="3:45" className="h-8 text-xs text-center" dir="ltr"/>
                      <Input value={r.hr ?? ''} onChange={e => setSpotReadings(p => p.map((x, xi) => xi === i ? { ...x, hr: e.target.value ? Number(e.target.value) : null } : x))}
                        placeholder="168" type="number" className="h-8 text-xs text-center"/>
                      <Input value={r.lactate || ''} onChange={e => setSpotReadings(p => p.map((x, xi) => xi === i ? { ...x, lactate: Number(e.target.value) } : x))}
                        placeholder="2.5" type="number" step="0.1" className="h-8 text-xs text-center"/>
                      <button onClick={() => setSpotReadings(p => p.filter((_, xi) => xi !== i))}
                        className="text-gray-300 hover:text-red-400 text-xs">✕</button>
                    </div>
                    {/* Live shape verdict per reading */}
                    {a && (
                      <div className="px-2 pb-1.5 flex items-center gap-2 flex-wrap">
                        <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', verdictClass(a.verdict))}>
                          {a.verdictHe}
                        </span>
                        <span className="text-[10px] text-muted-foreground" dir="ltr">
                          צפוי {a.expected} · נמדד {r.lactate} (Δ{a.delta > 0 ? '+' : ''}{a.delta})
                        </span>
                        {a.todayT2Sec && (
                          <span className="text-[10px] font-semibold text-navy" dir="ltr">
                            T2 היום ≈ {secToPace(a.todayT2Sec)}/km
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              <button onClick={() => setSpotReadings(p => [...p, emptyReading()])}
                className="w-full py-1.5 text-[11px] font-semibold text-gold hover:bg-gold/5 border-t border-border/40">
                + קריאה
              </button>
            </div>
            {!phys?.lt2PaceSec && (
              <p className="text-[11px] text-amber-600">להשוואת כושר נדרש T2 בסיס — הוסף בדיקת מדרגות או הערכה ידנית למעלה</p>
            )}

            <div className="flex gap-2">
              <Button onClick={handleSaveSpot} disabled={savingSpot} className="flex-1 h-10 bg-navy text-white font-bold">
                {savingSpot ? <Loader2 className="h-4 w-4 animate-spin"/> : 'שמור בדיקה מהירה'}
              </Button>
              <Button variant="ghost" onClick={() => setShowSpot(false)} className="h-10">ביטול</Button>
            </div>
          </CardContent>
        )}

        {/* Spot-check history — shape over time */}
        {spotChecks.length > 0 && (
          <CardContent className={cn('px-4 pb-4 space-y-1.5', showSpot && 'border-t border-border/40 pt-3')}>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">מעקב כושר ({spotChecks.length})</p>
            {spotChecks.map(check => {
              const analyses = (check.readings || []).map(analyzeReading).filter(Boolean) as NonNullable<ReturnType<typeof analyzeReading>>[]
              const avgDelta = analyses.length ? Math.round(analyses.reduce((s, a) => s + a.delta, 0) / analyses.length * 10) / 10 : null
              const overall = avgDelta == null ? null : avgDelta <= -0.5 ? 'improving' : avgDelta >= 0.5 ? 'tired' : 'stable'
              const lastT2 = analyses.length ? analyses[analyses.length - 1].todayT2Sec : null
              return (
                <div key={check.id} className="rounded-xl border border-border px-3 py-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-navy">{format(new Date(check.date), 'd/M/yy')}</span>
                      <span className="text-[10px] text-muted-foreground">{check.session === 'pm' ? '🌇' : '🌅'}</span>
                      {check.workoutLabel && <span className="text-[10px] font-semibold bg-navy/5 px-1.5 py-0.5 rounded-full" dir="ltr">{check.workoutLabel}</span>}
                      {overall && (
                        <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border', verdictClass(overall))}>
                          {overall === 'improving' ? 'משתפר 🔥' : overall === 'tired' ? 'עייף ⚠️' : 'יציב ✓'}
                        </span>
                      )}
                      {lastT2 && <span className="text-[10px] font-semibold text-navy" dir="ltr">T2≈{secToPace(lastT2)}</span>}
                    </div>
                    <button onClick={() => handleDeleteTest(check.id)} className="text-gray-300 hover:text-red-400 text-xs flex-shrink-0">✕</button>
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {(check.readings || []).map((r, i) => (
                      <span key={i} className="text-[10px] font-mono bg-muted/40 border border-border/40 px-1.5 py-0.5 rounded" dir="ltr">
                        {r.label ? `#${r.label} ` : ''}{r.pace} → {r.lactate}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </CardContent>
        )}
      </Card>

      {/* ── Test history ── */}
      {fullTests.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm">היסטוריית בדיקות מדרגות ({fullTests.length})</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1.5">
            {fullTests.map(test => (
              <div key={test.id} className="rounded-xl border border-border overflow-hidden">
                <button onClick={() => setExpandedTest(p => p === test.id ? null : test.id)}
                  className="w-full px-3 py-2 flex items-center justify-between hover:bg-muted/20">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-bold text-navy">{format(new Date(test.date), 'd/M/yyyy')}</span>
                    {test.lt2PaceSec && (
                      <span className="text-[10px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full" dir="ltr">
                        T2 {secToPace(test.lt2PaceSec)}
                      </span>
                    )}
                    {test.lt1PaceSec && (
                      <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded-full" dir="ltr">
                        T1 {secToPace(test.lt1PaceSec)}
                      </span>
                    )}
                  </div>
                  <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', expandedTest === test.id && 'rotate-180')}/>
                </button>
                {expandedTest === test.id && (
                  <div className="border-t border-border/40 px-3 py-2 space-y-2">
                    {test.notes && <p className="text-[11px] text-muted-foreground">{test.notes}</p>}
                    <div className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-1 text-[10px] font-bold text-navy text-center">
                      <span>#</span><span>קצב</span><span>דופק</span><span>לקטט</span>
                    </div>
                    {test.steps?.map((s, i) => (
                      <div key={i} className="grid grid-cols-[2rem_1fr_1fr_1fr] gap-1 text-[11px] text-center text-navy">
                        <span className="text-muted-foreground">{i + 1}</span>
                        <span dir="ltr" className="font-mono">{s.pace}</span>
                        <span>{s.hr ?? '—'}</span>
                        <span>{s.lactate}</span>
                      </div>
                    ))}
                    <div className="flex gap-2 pt-1">
                      <Button size="sm" variant="outline" className="h-7 text-[11px] flex-1" onClick={() => applyTest(test)}>
                        השתמש בבדיקה זו לספים
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 text-[11px] text-red-500 hover:text-red-600" onClick={() => handleDeleteTest(test.id)}>
                        <Trash2 className="h-3 w-3"/>
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Per-workout progress over time (separate from real T1/T2 above —
          see components/coach/athlete-workout-progress.tsx for why) ── */}
      <AthleteWorkoutProgress athleteId={athleteId} />
    </div>
  )
}
