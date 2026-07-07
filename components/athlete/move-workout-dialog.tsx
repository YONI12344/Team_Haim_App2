'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { addDays, format, isToday, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useLanguage } from '@/contexts/language-context'
import { getCoachInfo } from '@/lib/coach'
import type { AssignedWorkout } from '@/lib/types'

interface MoveWorkoutDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workout: AssignedWorkout
  athleteId: string
  athleteName?: string
  /** Dates (yyyy-MM-dd) that already have an assigned workout — shown with a dot */
  busyDates: string[]
  onMoved: (workoutId: string, newDate: string) => void
}

/**
 * Lets an athlete move a scheduled workout to another day (next 14 days).
 * Stores movedByAthlete + the original date and notifies the coach.
 */
export function MoveWorkoutDialog({ open, onOpenChange, workout, athleteId, athleteName, busyDates, onMoved }: MoveWorkoutDialogProps) {
  const { t, isRTL } = useLanguage()
  const [saving, setSaving] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)

  const today = new Date()
  const options = Array.from({ length: 14 }, (_, i) => addDays(today, i))
    .filter(d => format(d, 'yyyy-MM-dd') !== workout.scheduledDate)

  const handleMove = async () => {
    if (!picked) return
    setSaving(true)
    try {
      const { doc, updateDoc, serverTimestamp } = await import('firebase/firestore')
      const { db } = await import('@/lib/firebase')
      await updateDoc(doc(db, 'assignedWorkouts', workout.id), {
        scheduledDate: picked,
        movedByAthlete: true,
        movedFromDate: workout.scheduledDate,
        updatedAt: serverTimestamp(),
      })

      // Notify coach (fire-and-forget)
      ;(async () => {
        try {
          const coachInfo = await getCoachInfo()
          if (!coachInfo?.uid) return
          fetch('/api/send-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: coachInfo.uid,
              title: `${athleteName || 'ספורטאי'} הזיז אימון`,
              body: `"${workout.workout?.title || 'אימון'}" עבר מ-${format(parseISO(workout.scheduledDate), 'd/M')} ל-${format(parseISO(picked), 'd/M')}`,
              data: { type: 'workout_moved' },
              url: `/coach/athletes/${athleteId}/planner`,
            }),
          }).catch(() => {})
        } catch {}
      })()

      onMoved(workout.id, picked)
      toast.success(t.moveSuccessToast)
      setPicked(null)
      onOpenChange(false)
    } catch (e) {
      console.error('Error moving workout:', e)
      toast.error(t.savingError)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className={isRTL ? 'text-right' : 'text-left'}>{t.moveWorkoutTitle}</DialogTitle>
          <DialogDescription className={isRTL ? 'text-right' : 'text-left'}>
            {workout.workout?.title ? `"${workout.workout.title}" — ` : ''}{t.moveWorkoutDesc}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1.5 max-h-[50vh] overflow-y-auto py-1">
          {options.map(d => {
            const dStr = format(d, 'yyyy-MM-dd')
            const busy = busyDates.includes(dStr)
            const selected = picked === dStr
            return (
              <button key={dStr} type="button" onClick={() => setPicked(dStr)}
                className={cn(
                  'flex items-center justify-between rounded-2xl border px-3 py-2.5 transition-all active:scale-[0.98]',
                  selected
                    ? 'border-[#c9a84c] bg-[#c9a84c]/10 ring-1 ring-[#c9a84c]/40'
                    : 'border-border bg-white hover:bg-muted/30'
                )}>
                <div className={isRTL ? 'text-right' : 'text-left'}>
                  <p className={cn('text-sm font-bold', selected ? 'text-[#0a1628]' : 'text-[#0a1628]/80')}>
                    {isToday(d)
                      ? t.today
                      : d.toLocaleDateString(isRTL ? 'he-IL' : 'en-US', { weekday: 'long' })}
                  </p>
                  <p className="text-[11px] text-gray-400">{format(d, 'd/M')}</p>
                </div>
                {busy && <span className="w-2 h-2 rounded-full bg-[#c9a84c]/70 flex-shrink-0" title={t.workouts} />}
              </button>
            )
          })}
        </div>

        <button onClick={handleMove} disabled={saving || !picked}
          className="w-full h-12 rounded-2xl bg-[#0a1628] hover:bg-[#0a1628]/90 disabled:opacity-40 text-white text-base font-bold transition-all flex items-center justify-center gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? t.savingDots : t.moveWorkoutBtn}
        </button>
      </DialogContent>
    </Dialog>
  )
}
