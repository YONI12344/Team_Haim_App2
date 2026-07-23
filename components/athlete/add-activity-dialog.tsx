'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useLanguage } from '@/contexts/language-context'
import {
  ACTIVITY_KINDS, MANUAL_ACTIVITY_KINDS, activityLabel,
  isRunningKind, isGymKind, type ActivityKind,
} from '@/lib/activity-types'

interface AddActivityDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  athleteId: string
  athleteName?: string
  /** yyyy-MM-dd — the day being viewed */
  date: string
  /** Called with the saved log (incl. Firestore id) so the parent can refresh */
  onSaved: (log: any) => void
}

/**
 * Manual activity upload — lets an athlete log a run / gym / yoga / any
 * session that isn't in the plan or didn't sync from Strava. Saved into the
 * same `logs` collection with source: 'manual' + activityType so it renders
 * exactly like a Strava activity but tagged "added manually".
 */
export function AddActivityDialog({ open, onOpenChange, athleteId, athleteName, date, onSaved }: AddActivityDialogProps) {
  const { t, isRTL } = useLanguage()
  const [kind, setKind] = useState<ActivityKind>('run')
  const [distance, setDistance] = useState('')
  const [pace, setPace] = useState('')
  const [duration, setDuration] = useState('')
  const [effort, setEffort] = useState<number | null>(null)
  const [comment, setComment] = useState('')
  const [saving, setSaving] = useState(false)

  const info = ACTIVITY_KINDS[kind]

  const reset = () => {
    setKind('run'); setDistance(''); setPace(''); setDuration(''); setEffort(null); setComment('')
  }

  const handleSave = async () => {
    const parsedDistance = distance.trim() ? parseFloat(distance) : null
    if (distance.trim() && (!Number.isFinite(parsedDistance!) || parsedDistance! < 0)) {
      toast.error(t.toastDistanceInvalid)
      return
    }
    const parsedDuration = duration.trim() ? parseInt(duration, 10) : null
    setSaving(true)
    try {
      const { collection, addDoc, getDocs, query, where, updateDoc, doc, serverTimestamp } = await import('firebase/firestore')
      const { db } = await import('@/lib/firebase')
      const logData = {
        athleteId,
        workoutId: `manual_${Date.now()}`,
        date,
        activityType: kind,
        actualDistance: info.hasDistance ? parsedDistance : null,
        actualPace: info.hasDistance && pace.trim() ? pace.trim() : null,
        durationMin: parsedDuration,
        effort,
        comment: comment.trim(),
        source: 'manual',
        feedbackStatus: 'done',
        createdAt: serverTimestamp(),
      }
      const ref = await addDoc(collection(db, 'logs'), logData)

      // Smart auto-complete: mark a matching assigned workout as done
      try {
        const awSnap = await getDocs(query(
          collection(db, 'assignedWorkouts'),
          where('athleteId', '==', athleteId),
          where('scheduledDate', '==', date)
        ))
        for (const aw of awSnap.docs) {
          if (aw.data().status === 'completed') continue
          const wType = aw.data().workout?.type || ''
          const isStrengthW = ['strength', 'cross_training'].includes(wType)
          const plannedDist = aw.data().workout?.distance ?? 0
          let shouldComplete = false
          if (isStrengthW) shouldComplete = isGymKind(kind)
          else if (wType === 'swim') shouldComplete = kind === 'swim'
          else if (wType === 'bike') shouldComplete = kind === 'ride'
          else if (isRunningKind(kind) && parsedDistance) {
            shouldComplete = plannedDist === 0 || parsedDistance >= plannedDist * 0.7
          }
          if (shouldComplete) {
            await updateDoc(doc(db, 'assignedWorkouts', aw.id), { status: 'completed', completedAt: serverTimestamp() })
          }
        }
      } catch (e) { console.error('Manual activity auto-complete failed:', e) }

      // Coach notification is handled server-side (Cloud Function
      // notifyCoachOnLogChange, functions/src/index.ts) on this same
      // logs write — no client-side push needed here.

      onSaved({ id: ref.id, ...logData, createdAt: new Date() })
      toast.success(t.activityAddedToast)
      reset()
      onOpenChange(false)
    } catch (e) {
      console.error('Error saving manual activity:', e)
      toast.error(t.toastSaveLogFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full" dir={isRTL ? 'rtl' : 'ltr'}>
        <div className="max-h-[80vh] overflow-y-auto pr-1 space-y-4">
          <DialogHeader>
            <DialogTitle className={isRTL ? 'text-right' : 'text-left'}>{t.addActivityTitle}</DialogTitle>
            <DialogDescription className={isRTL ? 'text-right' : 'text-left'}>{t.addActivityDesc}</DialogDescription>
          </DialogHeader>

          {/* Type picker */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.activityTypeLabel}</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {MANUAL_ACTIVITY_KINDS.map(k => {
                const ki = ACTIVITY_KINDS[k]
                const selected = kind === k
                return (
                  <button key={k} type="button" onClick={() => setKind(k)}
                    className={cn(
                      'flex flex-col items-center gap-1 rounded-2xl border px-2 py-2.5 transition-all active:scale-95',
                      selected
                        ? 'border-[#c9a84c] bg-[#c9a84c]/10 ring-1 ring-[#c9a84c]/40'
                        : 'border-border bg-white hover:bg-muted/30'
                    )}>
                    <span className="text-xl leading-none">{ki.emoji}</span>
                    <span className={cn('text-[11px] font-semibold leading-tight text-center',
                      selected ? 'text-[#0a1628]' : 'text-gray-500')}>
                      {activityLabel(k, isRTL)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Distance + pace — only for distance sports */}
          {info.hasDistance && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.actualDistanceKm}</Label>
                <Input type="number" step="0.1" min="0" placeholder="10"
                  value={distance} onChange={e => setDistance(e.target.value)}
                  className="h-11 text-base rounded-xl text-center font-semibold" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.actualPaceKm}</Label>
                <Input type="text" placeholder="5:30"
                  value={pace} onChange={e => setPace(e.target.value)}
                  className="h-11 text-base rounded-xl text-center font-semibold" />
              </div>
            </div>
          )}

          {/* Duration */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.durationMinLabel}</Label>
            <Input type="number" min="0" placeholder="45"
              value={duration} onChange={e => setDuration(e.target.value)}
              className="h-11 text-base rounded-xl text-center font-semibold" />
          </div>

          {/* Effort 1–10 */}
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.effortRange}</Label>
            <div className="flex items-center justify-center gap-5 py-1" dir="rtl">
              <button type="button"
                onClick={() => setEffort(prev => prev != null ? Math.max(1, prev - 1) : 5)}
                className="w-12 h-12 rounded-full border-2 border-border bg-white hover:bg-muted/40 transition-all flex items-center justify-center shadow-sm text-xl font-bold text-[#0a1628] select-none">
                −
              </button>
              <div className="flex flex-col items-center gap-0.5 min-w-[64px]">
                <span className={cn('text-5xl font-black leading-none transition-colors',
                  effort == null ? 'text-muted-foreground/30' :
                  effort <= 2 ? 'text-emerald-500' :
                  effort <= 4 ? 'text-emerald-400' :
                  effort <= 6 ? 'text-amber-500' :
                  effort <= 8 ? 'text-orange-500' : 'text-red-500')}>
                  {effort ?? '—'}
                </span>
                <span className="text-xs font-semibold text-muted-foreground">
                  {effort == null ? t.chooseIntensity :
                   effort <= 2 ? t.effortVeryEasy :
                   effort <= 4 ? t.effortEasyLabel :
                   effort <= 6 ? t.effortModerate :
                   effort <= 8 ? t.effortHard : t.effortVeryHard}
                </span>
              </div>
              <button type="button"
                onClick={() => setEffort(prev => prev != null ? Math.min(10, prev + 1) : 5)}
                className="w-12 h-12 rounded-full border-2 border-border bg-white hover:bg-muted/40 transition-all flex items-center justify-center shadow-sm text-xl font-bold text-[#0a1628] select-none">
                +
              </button>
            </div>
          </div>

          {/* Comment */}
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t.commentOptional}</Label>
            <Textarea placeholder={t.commentPlaceholder} value={comment}
              onChange={e => setComment(e.target.value)} className="resize-none h-20 rounded-2xl text-sm" />
          </div>

          <button onClick={handleSave} disabled={saving}
            className="w-full h-12 rounded-2xl bg-[#0a1628] hover:bg-[#0a1628]/90 disabled:opacity-50 text-white text-base font-bold transition-all flex items-center justify-center gap-2">
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            {saving ? t.savingDots : t.addActivityBtn}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
