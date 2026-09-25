'use client'

import { useEffect, useState } from 'react'
import { getAiBudget, loadAiUsageThisMonth, setAiBudget } from '@/lib/ai-coach/usage-log'
import { formatUsd } from '@/lib/ai-coach/pricing'
import { cn } from '@/lib/utils'
import { DollarSign, Pencil } from 'lucide-react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { useLanguage } from '@/contexts/language-context'

/**
 * Header pill, coach-only (CoachNav only renders inside CoachLayout, which
 * already gates on isCoachEmail): this month's real AI spend against a
 * budget the coach sets themselves. There is no API for Anthropic's actual
 * account limit from the client, so "left" means left of THIS budget, not
 * Anthropic's real cap — the popover says so.
 */

const COPY = {
  en: {
    used: 'used', left: 'left', over: 'over', ofBudget: 'of',
    setBudget: 'Set a monthly AI budget', save: 'Save',
    placeholder: 'e.g. 50',
    note: "Tracks real token cost from this app's own AI calls — not Anthropic's account limit.",
    noBudget: 'Set budget',
  },
  he: {
    used: 'נוצל', left: 'נשאר', over: 'חריגה של', ofBudget: 'מתוך',
    setBudget: 'קביעת תקציב AI חודשי', save: 'שמירה',
    placeholder: 'למשל 50',
    note: 'עוקב אחר עלות אמיתית מקריאות ה-AI של האפליקציה — לא המגבלה בחשבון Anthropic.',
    noBudget: 'קבע תקציב',
  },
} as const

export function AiBudgetPill() {
  const { language } = useLanguage()
  const c = COPY[language === 'en' ? 'en' : 'he']
  const [budget, setBudget] = useState<number | null>(null)
  const [usedUsd, setUsedUsd] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const reload = () => {
    getAiBudget().then(setBudget).catch(() => {})
    loadAiUsageThisMonth().then((t) => setUsedUsd(t.costUsd)).catch(() => {})
  }
  useEffect(reload, [])

  const handleSave = async () => {
    const n = Number(draft)
    if (!Number.isFinite(n) || n <= 0) return
    setSaving(true)
    try {
      await setAiBudget(n)
      setBudget(n)
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  if (usedUsd === null) return null

  const pct = budget ? Math.min(100, (usedUsd / budget) * 100) : 0
  const remaining = budget != null ? budget - usedUsd : null
  const over = remaining != null && remaining < 0

  return (
    <Popover open={open} onOpenChange={(o) => { setOpen(o); if (o) setDraft(budget ? String(budget) : '') }}>
      <PopoverTrigger asChild>
        <button
          onClick={reload}
          className="flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 text-xs font-medium text-navy transition-colors hover:border-navy/30 hover:bg-navy-tint"
        >
          <DollarSign className="h-3.5 w-3.5 text-gold" />
          {budget != null ? (
            <>
              <span className="tabular-nums">{formatUsd(usedUsd)}</span>
              <span className="hidden text-muted-foreground sm:inline">{c.ofBudget} {formatUsd(budget)}</span>
              <span className={cn('hidden h-1.5 w-10 overflow-hidden rounded-full bg-navy-tint sm:block', over && 'bg-destructive/15')}>
                <span
                  className={cn('block h-full rounded-full', over ? 'bg-destructive' : 'bg-gold')}
                  style={{ width: `${pct}%` }}
                />
              </span>
            </>
          ) : (
            <span className="tabular-nums">{formatUsd(usedUsd)}</span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-navy">
            {formatUsd(usedUsd)} {c.used}
            {remaining != null && (
              <span className={cn('ms-1 font-normal', over ? 'text-destructive' : 'text-muted-foreground')}>
                · {formatUsd(Math.abs(remaining))} {over ? c.over : c.left}
              </span>
            )}
          </p>
          <p className="text-xs leading-relaxed text-muted-foreground">{c.note}</p>
        </div>
        <div className="flex items-center gap-2">
          <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <Input
            type="number"
            inputMode="decimal"
            min={1}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={c.placeholder}
            className="h-8 text-sm"
          />
          <Button size="sm" className="h-8 shrink-0" onClick={handleSave} disabled={saving}>
            {c.save}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
