'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, CheckCircle2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'

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
    <div className="bg-white rounded-2xl border border-emerald-100 shadow-sm overflow-hidden" dir="rtl">
      {/* Header */}
      <div className="px-3.5 py-2.5 flex items-center gap-2">
        <div className="h-6 w-6 rounded-lg bg-emerald-500 flex items-center justify-center flex-shrink-0">
          <CheckCircle2 className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="flex-1 text-sm font-bold text-[#0a1628]">{t.actualPerformance}</span>
        {onEdit && (
          <button
            onClick={onEdit}
            className="text-[10px] text-[#0a1628]/50 hover:text-[#0a1628] font-medium border border-gray-200 rounded-full px-2 py-0.5 transition-colors flex-shrink-0">
            {t.editBtn}
          </button>
        )}
        {onDelete && (
          <button
            onClick={onDelete}
            className="h-6 w-6 rounded-full flex items-center justify-center text-gray-300 hover:text-red-400 hover:bg-red-50 transition-colors flex-shrink-0 text-sm">
            ✕
          </button>
        )}
      </div>

      {/* Stat tiles */}
      {hasStats && (
        <div className="px-3.5 pb-3 grid grid-cols-3 gap-1.5">
          {distance && (
            <div className="bg-gray-50 rounded-xl p-2 text-center">
              <p className="text-base font-black text-[#0a1628]">{distance}</p>
              <p className="text-[9px] text-gray-400">{t.km}</p>
            </div>
          )}
          {pace && (
            <div className="bg-gray-50 rounded-xl p-2 text-center">
              <p className="text-base font-black text-[#0a1628]" dir="ltr">{pace.replace('/km', '')}</p>
              <p className="text-[9px] text-gray-400">{t.tempoLabel}</p>
            </div>
          )}
          {effort != null && (
            <div className={cn('rounded-xl p-2 text-center',
              effort <= 4 ? 'bg-emerald-50' :
              effort <= 6 ? 'bg-amber-50' :
              effort <= 8 ? 'bg-orange-50' : 'bg-red-50'
            )}>
              <p className={cn('text-base font-black',
                effort <= 4 ? 'text-emerald-700' :
                effort <= 6 ? 'text-amber-700' :
                effort <= 8 ? 'text-orange-700' : 'text-red-700'
              )}>{effort}/10</p>
              <p className="text-[9px] text-gray-400">{t.effortValueLabel}</p>
            </div>
          )}
        </div>
      )}

      {/* Comment */}
      {comment && (
        <div className="px-3.5 pb-3">
          <p className="text-xs text-gray-500 italic">&ldquo;{comment}&rdquo;</p>
        </div>
      )}

      {/* Expandable splits */}
      {validSplits.length > 0 && (
        <div className="border-t border-gray-100">
          <button
            onClick={() => setShowSplits(p => !p)}
            className="w-full px-3.5 py-2 flex items-center justify-between text-xs font-bold text-[#0a1628]/60 hover:bg-gray-50 transition-colors">
            <span>{t.splitsLabelShort} ({validSplits.length})</span>
            {showSplits ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
          {showSplits && (
            <div className="px-3.5 pb-3 space-y-0.5">
              {Array.from(new Set(validSplits.map(s => s.setIndex))).map(si => {
                const items = validSplits.filter(s => s.setIndex === si)
                return (
                  <p key={si} className="text-xs text-gray-500">
                    <span className="font-semibold text-[#0a1628]">{t.setLabelPrefix} {Number(si) + 1}:</span>{' '}
                    {items.map(s => `${s.distance ? `${s.distance} ${s.time}` : s.time}${s.rest ? ` (+${s.rest})` : ''}`).join(' · ')}
                  </p>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
