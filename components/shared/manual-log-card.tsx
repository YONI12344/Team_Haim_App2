'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'
import { SplitsTable } from '@/components/shared/splits-table'

interface SplitRow {
  setIndex: number
  time?: string
  distance?: string
  [key: string]: any
}

interface ManualLogCardProps {
  distance?: number | null
  pace?: string | null
  effort?: number | null
  comment?: string
  splitLogs?: SplitRow[]
  onEdit?: () => void
  onDelete?: () => void
}

export function ManualLogCard({
  distance, pace, effort, comment, splitLogs, onEdit, onDelete,
}: ManualLogCardProps) {
  const { t } = useLanguage()
  const [showSplits, setShowSplits] = useState(false)
  const validSplits = (splitLogs || []).filter(s => s.time && s.time.includes(':'))
  const hasStats = !!(distance || pace || effort != null)

  return (
    <div className="bg-card rounded-2xl border border-pine/25 shadow-sm overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="px-3.5 py-2.5 flex items-center gap-2">
        <div className="h-6 w-6 rounded-lg bg-pine flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="flex-1 text-sm font-bold text-navy">{t.actualPerformance}</span>
        {onEdit && (
          <button
            onClick={onEdit}
            className="text-[10px] text-navy/50 hover:text-navy font-medium border border-border rounded-full px-2 py-0.5 transition-colors flex-shrink-0">
            {t.editBtn}
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="h-6 w-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-rust-deep hover:bg-rust/10 transition-colors flex-shrink-0 text-sm">
            ✕
          </button>
        )}
      </div>

      {/* Stat tiles */}
      {hasStats && (
        <div className="px-3.5 pb-3 grid grid-cols-3 gap-1.5">
          {distance && (
            <div className="bg-muted rounded-xl p-2 text-center">
              <p className="text-base font-black text-navy">{distance}</p>
              <p className="text-[9px] text-muted-foreground">{t.km}</p>
            </div>
          )}
          {pace && (
            <div className="bg-muted rounded-xl p-2 text-center">
              <p className="text-base font-black text-navy" dir="ltr">{pace.replace('/km', '')}</p>
              <p className="text-[9px] text-muted-foreground">{t.tempoLabel}</p>
            </div>
          )}
          {effort != null && (
            <div className={cn('rounded-xl p-2 text-center',
              effort <= 4 ? 'bg-pine/10' :
              effort <= 6 ? 'bg-ochre/10' :
              effort <= 8 ? 'bg-orange-50' : 'bg-rust/10'
            )}>
              <p className={cn('text-base font-black',
                effort <= 4 ? 'text-pine' :
                effort <= 6 ? 'text-ochre-deep' :
                effort <= 8 ? 'text-orange-700' : 'text-rust-deep'
              )}>{effort}/10</p>
              <p className="text-[9px] text-muted-foreground">{t.effortValueLabel}</p>
            </div>
          )}
        </div>
      )}

      {/* Comment */}
      {comment && (
        <div className="px-3.5 pb-3">
          <p className="text-xs text-muted-foreground italic">&ldquo;{comment}&rdquo;</p>
        </div>
      )}

      {/* Expandable splits */}
      {validSplits.length > 0 && (
        <div className="border-t border-border">
          <button
            onClick={() => setShowSplits(p => !p)}
            className="w-full px-3.5 py-2 flex items-center justify-between text-xs font-bold text-navy/60 hover:bg-muted transition-colors">
            <span>{t.splitsLabelShort} ({validSplits.length})</span>
            {showSplits ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showSplits && (
            <div className="px-3.5 pb-3 space-y-3">
              {Array.from(new Set(validSplits.map(s => s.setIndex))).map(si => {
                const items = validSplits.filter(s => s.setIndex === si)
                return (
                  <div key={si}>
                    <p className="text-xs font-semibold text-navy mb-1.5">{t.setLabelPrefix} {Number(si) + 1}</p>
                    <SplitsTable splitLogs={items} referencePace={pace} />
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
