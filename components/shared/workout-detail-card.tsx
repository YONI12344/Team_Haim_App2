'use client'

import { AssignedWorkout } from '@/lib/types'
import { useLanguage } from '@/contexts/language-context'
import { cn } from '@/lib/utils'

interface Props {
  w: AssignedWorkout
  showLog?: boolean
  log?: any
}

export function WorkoutDetailCard({ w, showLog, log }: Props) {
  const { t } = useLanguage()
  return (
    <div className="rounded-2xl border border-border overflow-hidden bg-white shadow-sm" dir="rtl">

      {/* Warmup */}
      {w.workout.warmup && (
        <div className="border-r-4 border-blue-400 bg-blue-50/60 px-5 py-4 border-b border-border/60">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-blue-500 mb-1.5">{t.warmupLabel}</p>
          <p className="text-sm text-navy leading-relaxed">{w.workout.warmup}</p>
        </div>
      )}

      {/* Sets */}
      {w.workout.sets && w.workout.sets.length > 0 && (w.workout.sets as any[]).map((set: any, si: number) => {
        const hasIntervals = set.intervals && set.intervals.length > 0
        const isLast = si === (w.workout.sets as any[]).length - 1
        return (
          <div key={set.id || si} className={cn('border-r-4 border-navy', !isLast && 'border-b border-border/60')}>
            {/* Set header */}
            <div className="bg-navy/5 px-5 py-3 flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-bold text-navy">סט {si + 1}</span>
                {!hasIntervals && set.reps > 1 && (
                  <span className="bg-navy/10 text-navy text-[11px] font-semibold px-2.5 py-0.5 rounded-full">{set.reps}×</span>
                )}
                {!hasIntervals && (set.distance || set.duration) && (
                  <span className="bg-navy/10 text-navy text-[11px] font-semibold px-2.5 py-0.5 rounded-full">{set.distance || set.duration}</span>
                )}
                {!hasIntervals && set.pace && (
                  <span className="bg-gold/15 text-yellow-700 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">{set.pace}</span>
                )}
                {hasIntervals && set.reps > 1 && (
                  <span className="bg-navy/10 text-navy text-[11px] font-semibold px-2.5 py-0.5 rounded-full">{set.reps}×</span>
                )}
              </div>
              {set.rest && !hasIntervals && (
                <span className="text-[11px] text-muted-foreground bg-muted px-2.5 py-0.5 rounded-full">מנוחה: {set.rest}</span>
              )}
            </div>

            {/* Intervals */}
            {hasIntervals && (
              <div className="divide-y divide-border/40 px-5">
                {(set.intervals as any[]).map((iv: any, ii: number) => (
                  <div key={iv.id || ii} className="py-3 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 rounded-full bg-navy text-white font-bold flex items-center justify-center text-[10px] flex-shrink-0">{ii + 1}</span>
                      <span className="text-sm font-bold text-navy">{iv.distance}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {iv.pace && (
                        <span className="bg-gold/15 text-yellow-700 text-[11px] font-semibold px-2.5 py-0.5 rounded-full">{iv.pace}</span>
                      )}
                      {iv.rest && (
                        <span className="text-[11px] text-muted-foreground bg-muted px-2 py-0.5 rounded-full">מנוחה: {iv.rest}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Between-sets rest for interval sets */}
            {hasIntervals && set.rest && (
              <div className="px-5 py-2 bg-muted/30 border-t border-border/40">
                <p className="text-[11px] text-muted-foreground text-center">מנוחה בין סטים: {set.rest}</p>
              </div>
            )}
          </div>
        )
      })}

      {/* Cooldown */}
      {w.workout.cooldown && (
        <div className="border-r-4 border-emerald-400 bg-emerald-50/60 px-5 py-4 border-t border-border/60">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-1.5">{t.cooldownLabel}</p>
          <p className="text-sm text-navy leading-relaxed">{w.workout.cooldown}</p>
        </div>
      )}

      {/* Coach notes */}
      {w.workout.notes && (
        <div className="px-5 py-4 border-t border-border/40 bg-muted/20">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">{t.coachNotesLabel}</p>
          <p className="text-sm text-navy leading-relaxed">{w.workout.notes}</p>
        </div>
      )}

      {/* Log summary */}
      {showLog && log && (
        <div className="px-5 py-4 border-t-2 border-emerald-200 bg-emerald-50">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600 mb-2">תוצאות</p>
          <div className="flex items-center gap-2 flex-wrap">
            {log.effort != null && (
              <span className={cn(
                'px-2.5 py-1 rounded-full text-xs font-bold',
                log.effort <= 4 ? 'bg-emerald-100 text-emerald-700' :
                log.effort <= 6 ? 'bg-amber-100 text-amber-700' :
                log.effort <= 7 ? 'bg-orange-100 text-orange-700' :
                'bg-red-100 text-red-700'
              )}>מאמץ {log.effort}/10</span>
            )}
            {log.actualDistance && <span className="text-sm text-muted-foreground">{log.actualDistance} ק"מ</span>}
            {log.actualPace && <span className="text-sm text-muted-foreground">{log.actualPace}/ק"מ</span>}
          </div>
          {log.comment && <p className="text-sm text-navy italic mt-2">"{log.comment}"</p>}
        </div>
      )}
    </div>
  )
}
