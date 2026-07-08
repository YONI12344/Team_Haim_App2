'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2, Plus, Sparkles, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { useWorkoutTypeLabels } from '@/lib/workout-labels'
import { buildCustomJourney, saveJourney, defaultPhaseVolumes, type InterimRace } from '@/lib/journey'
import type { JourneyDoc, WorkoutType, ExperienceLevel } from '@/lib/types'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  athleteId: string
  /** Called with the newly created journey once everything is saved */
  onCreated: (journey: JourneyDoc) => void
}

const WIZARD_TYPES: WorkoutType[] = [
  'easy', 'long_run', 'tempo', 'intervals', 'hill_repeats', 'fartlek',
  'recovery', 'strength', 'cross_training', 'swim', 'bike',
]

const todayISO = () => new Date().toISOString().slice(0, 10)
const plusWeeksISO = (weeks: number) => {
  const d = new Date()
  d.setDate(d.getDate() + weeks * 7)
  return d.toISOString().slice(0, 10)
}

/**
 * Journey creation wizard: coach fills in the athlete's real numbers (goal
 * race, current vs. peak weekly km, tune-up races, preferred workout
 * types), and buildCustomJourney() turns that into a full base/build/peak/
 * taper/race-week plan sized to those inputs — instead of a fixed generic
 * template. Interim races become real scheduled workouts too, and the
 * athlete's profile is updated with the goal + km range for consistency
 * everywhere else in the app.
 */
export function JourneyWizard({ open, onOpenChange, athleteId, onCreated }: Props) {
  const { user } = useAuth()
  const workoutTypeLabels = useWorkoutTypeLabels()
  const [loadingProfile, setLoadingProfile] = useState(false)
  const [saving, setSaving] = useState(false)

  const [goalRaceEvent, setGoalRaceEvent] = useState('')
  const [goalRaceDate, setGoalRaceDate] = useState(plusWeeksISO(12))
  const [goalRaceTarget, setGoalRaceTarget] = useState('')
  const [startDate, setStartDate] = useState(todayISO())
  const [currentWeeklyKm, setCurrentWeeklyKm] = useState('')
  const [peakWeeklyKm, setPeakWeeklyKm] = useState('')
  const [experienceLevel, setExperienceLevel] = useState<ExperienceLevel | ''>('')
  const [selectedTypes, setSelectedTypes] = useState<WorkoutType[]>(['easy', 'long_run', 'hill_repeats', 'fartlek', 'tempo', 'intervals'])
  const [interimRaces, setInterimRaces] = useState<InterimRace[]>([])
  // Per-phase km override — empty = use the auto-computed default (shown as placeholder)
  const [phaseKmOverride, setPhaseKmOverride] = useState<string[]>(['', '', '', '', ''])
  const phaseLabels = ['בסיס', 'בנייה', 'שיא', 'חידוד', 'שבוע תחרות']
  const computedDefaults = defaultPhaseVolumes(Number(currentWeeklyKm) || 0, Number(peakWeeklyKm) || Number(currentWeeklyKm) || 0)

  // Prefill from the athlete's existing profile whenever the wizard opens
  useEffect(() => {
    if (!open || !athleteId) return
    setLoadingProfile(true)
    ;(async () => {
      try {
        const { doc, getDoc } = await import('firebase/firestore')
        const { db } = await import('@/lib/firebase')
        const snap = await getDoc(doc(db, 'users', athleteId))
        const d = snap.data()
        if (d) {
          if (d.goalRaceEvent) setGoalRaceEvent(d.goalRaceEvent)
          if (d.goalRaceDate) setGoalRaceDate(d.goalRaceDate)
          if (d.goalRaceTarget) setGoalRaceTarget(d.goalRaceTarget)
          if (d.weeklyKmRange?.min != null) setCurrentWeeklyKm(String(d.weeklyKmRange.min))
          if (d.weeklyKmRange?.max != null) setPeakWeeklyKm(String(d.weeklyKmRange.max))
          if (d.experienceLevel) setExperienceLevel(d.experienceLevel)
        }
      } catch (e) { console.error('Journey wizard prefill error:', e) }
      finally { setLoadingProfile(false) }
    })()
  }, [open, athleteId])

  const addRace = () => setInterimRaces(prev => [...prev, { event: '', date: '', type: 'time_trial' }])
  const updateRace = (i: number, patch: Partial<InterimRace>) =>
    setInterimRaces(prev => prev.map((r, ri) => ri === i ? { ...r, ...patch } : r))
  const removeRace = (i: number) => setInterimRaces(prev => prev.filter((_, ri) => ri !== i))

  const toggleType = (ty: WorkoutType) =>
    setSelectedTypes(prev => prev.includes(ty) ? prev.filter(t => t !== ty) : [...prev, ty])

  const handleGenerate = async () => {
    if (!user?.id) return
    if (!goalRaceEvent.trim() || !goalRaceDate) {
      toast.error('נדרש שם תחרות ותאריך יעד')
      return
    }
    const current = Number(currentWeeklyKm) || 0
    const peak = Number(peakWeeklyKm) || current
    // Per-phase km: blank field falls back to the computed default for that phase
    const phaseVolumesKm = computedDefaults.map((def, i) =>
      phaseKmOverride[i].trim() ? Number(phaseKmOverride[i]) : def)
    setSaving(true)
    try {
      const journey = buildCustomJourney({
        startDate,
        goalRaceEvent: goalRaceEvent.trim(),
        goalRaceDate,
        goalRaceTarget: goalRaceTarget.trim() || undefined,
        createdBy: user.id,
        currentWeeklyKm: current,
        peakWeeklyKm: peak,
        workoutTypes: selectedTypes,
        interimRaces: interimRaces.filter(r => r.event.trim() && r.date),
        phaseVolumesKm,
      })
      await saveJourney(athleteId, journey)

      // Interim races become real scheduled workouts (race/time_trial types
      // bypass the athlete's rolling visibility window automatically)
      const { collection, addDoc, serverTimestamp } = await import('firebase/firestore')
      const { db } = await import('@/lib/firebase')
      for (const race of interimRaces) {
        if (!race.event.trim() || !race.date) continue
        try {
          const workoutData = {
            title: race.event.trim(),
            type: race.type || 'time_trial',
            description: race.notes?.trim() || '',
            duration: null, distance: null, notes: null,
            createdBy: user.id,
          }
          const wRef = await addDoc(collection(db, 'workouts'), {
            ...workoutData, createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
          })
          await addDoc(collection(db, 'assignedWorkouts'), {
            workoutId: wRef.id,
            workout: { ...workoutData, id: wRef.id },
            athleteId,
            assignedBy: user.id,
            scheduledDate: race.date,
            status: 'scheduled',
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          })
        } catch (e) { console.error('Interim race creation failed:', e) }
      }

      // Keep the athlete's profile in sync with the new plan
      const { doc, updateDoc } = await import('firebase/firestore')
      await updateDoc(doc(db, 'users', athleteId), {
        goalRaceEvent: goalRaceEvent.trim(),
        goalRaceDate,
        goalRaceTarget: goalRaceTarget.trim() || null,
        weeklyKmRange: { min: current, max: peak },
        ...(experienceLevel ? { experienceLevel } : {}),
      })

      toast.success('המסע נוצר בהצלחה ✓')
      onCreated(journey)
      onOpenChange(false)
    } catch (e) {
      console.error('Journey generation error:', e)
      toast.error('יצירת המסע נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg w-full max-h-[88vh] overflow-y-auto" dir="rtl">
        <div className="space-y-5">
          <DialogHeader>
            <DialogTitle className="text-right flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-gold" />
              בניית מסע מותאם אישית
            </DialogTitle>
            <DialogDescription className="text-right">
              הזן את נתוני הספורטאי — המערכת תבנה תכנית עונתית מלאה (בסיס → בנייה → שיא → חידוד → שבוע תחרות) לפי הנתונים האלה
            </DialogDescription>
          </DialogHeader>

          {loadingProfile && (
            <div className="flex items-center justify-center py-2">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Goal race */}
          <div className="space-y-2.5">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">🎯 מטרת העונה</p>
            <div className="space-y-1.5">
              <Label className="text-xs">שם התחרות</Label>
              <Input value={goalRaceEvent} onChange={e => setGoalRaceEvent(e.target.value)} placeholder="מרתון תל אביב" className="h-10 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">תאריך התחרות</Label>
                <Input type="date" value={goalRaceDate} onChange={e => setGoalRaceDate(e.target.value)} className="h-10 text-sm" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">יעד זמן (לא חובה)</Label>
                <Input value={goalRaceTarget} onChange={e => setGoalRaceTarget(e.target.value)} placeholder="2:59:00" dir="ltr" className="h-10 text-sm text-center" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">תחילת התכנית</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="h-10 text-sm" />
            </div>
          </div>

          {/* Weekly km */}
          <div className="space-y-2.5 border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">📊 נפח שבועי (ק&quot;מ)</p>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs">נפח נוכחי</Label>
                <Input type="number" min="0" value={currentWeeklyKm} onChange={e => setCurrentWeeklyKm(e.target.value)} placeholder="40" className="h-10 text-sm text-center font-semibold" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">נפח שיא</Label>
                <Input type="number" min="0" value={peakWeeklyKm} onChange={e => setPeakWeeklyKm(e.target.value)} placeholder="70" className="h-10 text-sm text-center font-semibold" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">רמת ניסיון (לא חובה)</Label>
              <select
                value={experienceLevel}
                onChange={e => setExperienceLevel(e.target.value as ExperienceLevel)}
                className="h-9 w-full text-sm rounded-lg border border-border bg-white px-2 font-medium text-navy">
                <option value="">—</option>
                <option value="beginner">מתחיל</option>
                <option value="intermediate">בינוני</option>
                <option value="advanced">מתקדם</option>
                <option value="professional">מקצועי</option>
              </select>
            </div>
          </div>

          {/* Km target per phase — auto-computed, fully overridable */}
          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">📈 ק&quot;מ שבועי לפי שלב</p>
            <p className="text-[11px] text-muted-foreground -mt-1">מחושב אוטומטית מהנפח הנוכחי לשיא — אפשר לשנות כל שלב בנפרד</p>
            <div className="grid grid-cols-5 gap-1.5">
              {phaseLabels.map((label, i) => (
                <div key={i} className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground block text-center">{label}</Label>
                  <Input
                    type="number" min="0"
                    value={phaseKmOverride[i]}
                    onChange={e => setPhaseKmOverride(prev => prev.map((v, vi) => vi === i ? e.target.value : v))}
                    placeholder={String(computedDefaults[i])}
                    className="h-9 text-xs text-center font-semibold px-1"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Preferred workout types */}
          <div className="space-y-2 border-t pt-4">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">🏃 סוגי אימונים לתכנית</p>
            <div className="flex flex-wrap gap-1.5">
              {WIZARD_TYPES.map(ty => (
                <button key={ty} type="button" onClick={() => toggleType(ty)}
                  className={cn('text-xs font-semibold px-3 py-1.5 rounded-full border transition-all active:scale-95',
                    selectedTypes.includes(ty)
                      ? 'bg-navy text-white border-navy'
                      : 'bg-white text-gray-500 border-border hover:border-navy/40')}>
                  {workoutTypeLabels[ty]}
                </button>
              ))}
            </div>
          </div>

          {/* Interim races / time trials */}
          <div className="space-y-2 border-t pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">🏁 תחרויות ביניים / מבחני זמן</p>
              <button onClick={addRace} className="text-xs font-semibold text-gold flex items-center gap-1">
                <Plus className="h-3 w-3" /> הוסף
              </button>
            </div>
            {interimRaces.length === 0 && (
              <p className="text-xs text-muted-foreground">אין — אפשר להוסיף מרוצי הכנה או מבחני זמן שיסומנו בלוח ויוצגו לספורטאי מראש</p>
            )}
            {interimRaces.map((race, i) => (
              <div key={i} className="rounded-xl border border-border p-2.5 space-y-1.5 bg-muted/10">
                <div className="flex items-center gap-1.5">
                  <Input value={race.event} onChange={e => updateRace(i, { event: e.target.value })}
                    placeholder="חצי מרתון תל אביב" className="h-8 text-xs flex-1" />
                  <button onClick={() => removeRace(i)} className="w-6 h-6 rounded-full flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 flex-shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <Input type="date" value={race.date} onChange={e => updateRace(i, { date: e.target.value })} className="h-8 text-xs" />
                  <select value={race.type || 'time_trial'} onChange={e => updateRace(i, { type: e.target.value as 'race' | 'time_trial' })}
                    className="h-8 text-xs rounded-lg border border-border bg-white px-2 font-medium text-navy">
                    <option value="time_trial">מבחן זמן</option>
                    <option value="race">תחרות הכנה</option>
                  </select>
                </div>
              </div>
            ))}
          </div>

          <Button onClick={handleGenerate} disabled={saving}
            className="w-full h-12 bg-gold hover:bg-gold/90 text-navy font-bold rounded-xl text-base">
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <><Sparkles className="h-4 w-4 mr-2" />בנה את המסע</>}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
