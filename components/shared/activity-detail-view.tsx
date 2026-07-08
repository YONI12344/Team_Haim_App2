'use client'

import { Activity } from 'lucide-react'
import { cn } from '@/lib/utils'
import { getActivityInfo, activityLabel, formatDurationMin } from '@/lib/activity-types'
import { useLanguage } from '@/contexts/language-context'

interface ActivityDetailViewProps {
  log: {
    source?: string
    stravaName?: string
    activityType?: string
    stravaType?: string
    actualDistance?: number | null
    actualPace?: string | null
    averageHeartRate?: number | null
    elevationGain?: number | null
    durationMin?: number | null
    effort?: number | null
    comment?: string | null
    splitLogs?: any[]
    feedbackStatus?: string
  }
  /** Planned distance, to show a "% of planned" badge */
  plannedDistance?: number | null
}

/**
 * Full "what actually happened" card — same look the athlete sees:
 * Strava/manual header, stats grid, full splits table, effort + comment.
 * Shared between the coach dashboard and the coach planner so a completed
 * workout looks identical everywhere the coach reviews it.
 */
export function ActivityDetailView({ log, plannedDistance }: ActivityDetailViewProps) {
  const { t } = useLanguage()
  const isManual = log.source === 'manual'
  const actInfo = getActivityInfo(log)
  const duration = formatDurationMin(log.durationMin, true)
  const name = log.stravaName || activityLabel(actInfo.kind, true)
  const splits = log.splitLogs || []
  const pctOfPlanned = plannedDistance && log.actualDistance
    ? Math.round((log.actualDistance / plannedDistance) * 100)
    : null

  return (
    <div className="rounded-2xl border border-border overflow-hidden bg-white shadow-sm" dir="rtl">
      {/* Header */}
      <div className={cn('px-4 py-3 flex items-center gap-3 border-b border-border/50',
        isManual ? 'bg-[#0a1628]/5' : 'bg-[#FC4C02]/5')}>
        <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0',
          isManual ? 'bg-[#0a1628]' : 'bg-[#FC4C02]')}>
          {isManual
            ? <span className="text-lg">{actInfo.emoji}</span>
            : <Activity className="h-5 w-5 text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', actInfo.badgeClass)}>
              {activityLabel(actInfo.kind, true)}
            </span>
            <p className="text-sm font-bold text-[#0a1628] truncate">{name}</p>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {log.feedbackStatus === 'pending' ? t.pendingBadge : isManual ? t.manualActivityTag : 'Strava ✓'}
          </p>
        </div>
        {pctOfPlanned != null && (
          <span className={cn('text-xs font-bold px-2 py-1 rounded-full flex-shrink-0',
            pctOfPlanned >= 95 ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700')}>
            {pctOfPlanned}% מהמתוכנן
          </span>
        )}
      </div>

      {/* Stats grid 2×2 */}
      <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
        {duration && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">משך</p>
            <p className="text-xl font-black text-[#0a1628]">{duration}</p>
          </div>
        )}
        {log.actualDistance != null && log.actualDistance !== 0 && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">מרחק</p>
            <p className="text-xl font-black text-[#0a1628]">{log.actualDistance} ק"מ</p>
          </div>
        )}
        {log.actualPace && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">טמפו</p>
            <p className="text-xl font-black text-[#0a1628]" dir="ltr">{log.actualPace}</p>
          </div>
        )}
        {log.averageHeartRate && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">דופק ממוצע</p>
            <p className="text-xl font-black text-red-500">{log.averageHeartRate} <span className="text-sm font-semibold">bpm</span></p>
          </div>
        )}
        {log.elevationGain != null && log.elevationGain > 0 && (
          <div>
            <p className="text-[10px] text-muted-foreground mb-0.5">עלייה</p>
            <p className="text-xl font-black text-emerald-600">+{log.elevationGain}<span className="text-sm font-semibold">m</span></p>
          </div>
        )}
      </div>

      {/* All splits — vertical list */}
      {splits.length > 0 && (
        <div className="border-t border-border/30">
          <div className="px-4 pt-3 pb-1.5 grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr] gap-x-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
            <span>{splits[0]?.lapIndex ? 'Lap' : t.km}</span>
            <span>{t.tempoLabel}</span>
            <span>{t.timeInputLabel}</span>
            <span>{t.heartRateLabel}</span>
            <span>{t.elevationShort}</span>
          </div>
          <div className="divide-y divide-border/20">
            {splits.map((split: any, i: number) => (
              <div key={i}
                className={cn('px-4 py-2.5 grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr] gap-x-2 items-center text-xs',
                  i % 2 === 0 ? 'bg-white' : 'bg-muted/10')}>
                <span className="w-7 h-7 rounded-full bg-[#0a1628]/8 flex items-center justify-center text-[11px] font-black text-[#0a1628]">
                  {split.lapIndex || i + 1}
                </span>
                <span className="font-bold text-[#0a1628]">{split.pace || '—'}</span>
                <span className="text-muted-foreground">{split.time || '—'}</span>
                <span className={split.heartRate ? 'font-semibold text-red-500' : 'text-muted-foreground/40'}>
                  {split.heartRate ? `${split.heartRate}` : '—'}
                </span>
                <span className={
                  split.elevationDiff == null || split.elevationDiff === 0
                    ? 'text-muted-foreground/40'
                    : split.elevationDiff > 0
                    ? 'font-semibold text-emerald-600'
                    : 'font-semibold text-red-400'
                }>
                  {split.elevationDiff != null && split.elevationDiff !== 0
                    ? `${split.elevationDiff > 0 ? '+' : ''}${split.elevationDiff}m`
                    : '—'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Effort + comment from athlete */}
      {(log.effort != null || log.comment) && (
        <div className="border-t border-border/30 px-4 py-3 space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground">משוב ספורטאי</p>
          {log.effort != null && (
            <div className="flex items-center gap-2">
              <span className={cn('w-2.5 h-2.5 rounded-full flex-shrink-0',
                log.effort <= 4 ? 'bg-emerald-400' :
                log.effort <= 6 ? 'bg-amber-400' :
                log.effort <= 7 ? 'bg-orange-400' : 'bg-red-400')} />
              <p className="text-sm font-bold text-[#0a1628]">מאמץ {log.effort}/10</p>
            </div>
          )}
          {log.comment && (
            <p className="text-sm text-gray-600 italic leading-snug">"{log.comment}"</p>
          )}
        </div>
      )}
    </div>
  )
}
