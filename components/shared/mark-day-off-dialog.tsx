'use client'

/**
 * Lets an athlete or coach mark a date range as no-workout (sick, travel,
 * etc.) — writes a `daysOff` doc (see hooks/useDaysOff.ts) which suppresses
 * the "log your workout" reminders and the coach's "missed workout" alert
 * for that range, and shows a "day off" card in the planner instead of a
 * blank/missed day.
 */

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'
import type { DayOffReason } from '@/lib/types'

interface MarkDayOffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** yyyy-MM-dd — the day this was opened from; both start/end default to it. */
  defaultDate: string
  onSubmit: (payload: { startDate: string; endDate: string; reason: DayOffReason; note?: string }) => Promise<void>
}

export function MarkDayOffDialog({ open, onOpenChange, defaultDate, onSubmit }: MarkDayOffDialogProps) {
  const { t, isRTL } = useLanguage()
  const [reason, setReason] = useState<DayOffReason>('sick')
  const [startDate, setStartDate] = useState(defaultDate)
  const [endDate, setEndDate] = useState(defaultDate)
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) { setStartDate(defaultDate); setEndDate(defaultDate); setReason('sick'); setNote('') }
  }, [open, defaultDate])

  const handleSubmit = async () => {
    if (endDate < startDate) return
    setSaving(true)
    try {
      await onSubmit({ startDate, endDate, reason, note })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const REASONS: { key: DayOffReason; emoji: string; label: string }[] = [
    { key: 'sick', emoji: '🤒', label: t.dayOffReasonSick },
    { key: 'trip', emoji: '✈️', label: t.dayOffReasonTrip },
    { key: 'other', emoji: '📌', label: t.dayOffReasonOther },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full" dir={isRTL ? 'rtl' : 'ltr'}>
        <DialogHeader>
          <DialogTitle className={isRTL ? 'text-right' : 'text-left'}>{t.markDayOffTitle}</DialogTitle>
          <DialogDescription className={isRTL ? 'text-right' : 'text-left'}>{t.markDayOffDesc}</DialogDescription>
        </DialogHeader>

        <div className="flex gap-2">
          {REASONS.map(r => (
            <button key={r.key} type="button" onClick={() => setReason(r.key)}
              className={cn('flex-1 rounded-2xl border px-2 py-2.5 text-xs font-bold transition-all active:scale-[0.98] flex flex-col items-center gap-1',
                reason === r.key ? 'border-[#c9a84c] bg-[#c9a84c]/10 text-[#0a1628]' : 'border-border bg-white text-muted-foreground hover:bg-muted/30')}>
              <span className="text-xl">{r.emoji}</span>
              {r.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">{t.dayOffFromLabel}</label>
            <input type="date" value={startDate}
              onChange={e => { setStartDate(e.target.value); if (e.target.value > endDate) setEndDate(e.target.value) }}
              className="w-full h-10 rounded-xl border border-border px-2 text-sm" />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground">{t.dayOffToLabel}</label>
            <input type="date" value={endDate} min={startDate} onChange={e => setEndDate(e.target.value)}
              className="w-full h-10 rounded-xl border border-border px-2 text-sm" />
          </div>
        </div>

        <textarea value={note} onChange={e => setNote(e.target.value)} placeholder={t.dayOffNotePh} rows={2}
          className="w-full rounded-xl border border-border px-3 py-2 text-sm resize-none" dir="auto" />

        <button onClick={handleSubmit} disabled={saving}
          className="w-full h-12 rounded-2xl bg-[#0a1628] hover:bg-[#0a1628]/90 disabled:opacity-40 text-white text-base font-bold transition-all flex items-center justify-center gap-2">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          {saving ? t.savingDots : t.markDayOffSubmit}
        </button>
      </DialogContent>
    </Dialog>
  )
}
