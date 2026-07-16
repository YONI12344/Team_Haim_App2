'use client'

/**
 * components/coach/workout-comparison-gallery.tsx
 *
 * The Lab's "workout trends" view: every comparisonGroup the coach has
 * tagged (any workout type — e.g. "Fartlek A") gets its own collapsible
 * card showing pace/HR over calendar time across every logged session,
 * plus a session table. Independent of LactateWorkoutGallery, which is
 * lactate-specific (threshold workouts only) — this covers any workout
 * type and needs no lactate data at all.
 */

import { useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { useWorkoutComparisonGroups, buildComparisonPoints } from '@/hooks/useWorkoutComparisonGroups'
import { WorkoutComparisonChart } from '@/components/coach/workout-comparison-chart'
import { useLanguage } from '@/contexts/language-context'

export function WorkoutComparisonGallery({ athleteId }: { athleteId: string }) {
  const { t, isRTL } = useLanguage()
  const { loading, grouped, groupOptions } = useWorkoutComparisonGroups(athleteId)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (loading) return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="h-6 w-6 animate-spin text-gold" />
    </div>
  )

  if (groupOptions.length === 0) return (
    <div className="rounded-2xl border border-dashed border-border p-4 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
      <p className="text-sm font-semibold text-navy">{t.labNoTrendGroups}</p>
      <p className="text-xs text-muted-foreground mt-1">{t.labNoTrendGroupsHint}</p>
    </div>
  )

  return (
    <div className="space-y-2" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h3 className="text-sm font-bold text-navy">{t.labWorkoutTrends}</h3>
        <p className="text-xs text-muted-foreground">{t.labWorkoutTrendsHint}</p>
      </div>

      <div className="space-y-2">
        {groupOptions.map(opt => {
          const group = grouped.get(opt.id)!
          const points = buildComparisonPoints(group)
          const isOpen = expandedId === opt.id
          // Interval-type sessions (structured rest between reps) compare
          // rest prescribed session-to-session; a continuous session
          // (fartlek etc., no rest field at all) compares duration instead.
          const hasRest = points.some(p => p.restLabel)
          return (
            <Card key={opt.id} className="min-w-0">
              <button onClick={() => setExpandedId(p => p === opt.id ? null : opt.id)}
                className="w-full text-right px-3 py-3 hover:bg-muted/20">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-navy whitespace-nowrap">{opt.name}</span>
                    <span className="text-[9px] font-medium text-muted-foreground whitespace-nowrap">
                      {opt.count} {t.labSessionsCount}
                    </span>
                  </div>
                  <ChevronDown className={cn('h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform', isOpen && 'rotate-180')} />
                </div>
              </button>

              {isOpen && (
                <CardContent className="px-3 pb-3 space-y-3">
                  <WorkoutComparisonChart points={points} />
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-muted-foreground border-b border-border">
                          <th className="text-left font-medium py-1 pr-2">{t.labTrendTableDate}</th>
                          <th className="text-left font-medium py-1 pr-2">{t.labTrendTableDistance}</th>
                          <th className="text-left font-medium py-1 pr-2">{t.labTrendTablePace}</th>
                          <th className="text-left font-medium py-1 pr-2">{t.labTrendTableHr}</th>
                          {hasRest ? (
                            <th className="text-left font-medium py-1 pr-2">{t.labTrendTableRest}</th>
                          ) : (
                            <th className="text-left font-medium py-1 pr-2">{t.labTrendTableDuration}</th>
                          )}
                          <th className="text-left font-medium py-1">{t.labTrendTableEffort}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {points.map((p, i) => {
                          const prevRest = i > 0 ? points[i - 1].restLabel : undefined
                          const restChanged = hasRest && prevRest !== undefined && p.restLabel !== prevRest
                          return (
                            <tr key={p.logId} className="border-b border-border/50 last:border-0">
                              <td className="py-1 pr-2 whitespace-nowrap">{format(new Date(p.date), 'd/M/yy')}</td>
                              <td className="py-1 pr-2">{p.distance != null ? `${p.distance} ק"מ` : '—'}</td>
                              <td className="py-1 pr-2" dir="ltr">{p.pace ?? '—'}</td>
                              <td className="py-1 pr-2">{p.hr ?? '—'}</td>
                              {hasRest ? (
                                <td className={cn('py-1 pr-2', restChanged && 'font-bold text-navy')}>
                                  {p.restLabel ?? '—'}{restChanged && ' *'}
                                </td>
                              ) : (
                                <td className="py-1 pr-2">{p.durationMin != null ? `${p.durationMin} ${t.labTrendTableMin}` : '—'}</td>
                              )}
                              <td className="py-1">{p.effort ?? '—'}</td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
