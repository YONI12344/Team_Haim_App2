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
    <div className="border border-border rounded-xl overflow-hidden bg-white" dir="rtl">
      {w.workout.warmup && (
        <div className="px-4 py-2.5 border-b border-border">
          <p className="text-sm text-muted-foreground text-right">{t.warmupLabel}: {w.workout.warmup}</p>
        </div>
      )}
      {w.workout.sets && w.workout.sets.length > 0 && (w.workout.sets as any[]).map((set: any, si: number) => {
        const hasIntervals = set.intervals && set.intervals.length > 0
        return (
          <div key={set.id||si}>
            {si > 0 && (
              <div className="flex items-center gap-3 px-4" style={{height:'24px'}}>
                <div className="flex-1 h-px bg-border"/>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {set.rest ? `${t.restBetweenSets}: ${set.rest}` : t.continueToNext}
                </span>
                <div className="flex-1 h-px bg-border"/>
              </div>
            )}
            <div className="px-4 py-2.5 border-t border-border">
              <p className="text-sm font-bold text-navy text-right">
                סט {si+1}
                {set.reps > 1 && !hasIntervals
                  ? <span className="font-normal"> · {set.reps}× {set.distance||set.duration||''}{set.pace ? ` @ ${set.pace}` : ''}</span>
                  : <>
                    {!hasIntervals && (set.distance||set.duration) && <span className="font-normal"> · {set.distance||set.duration}</span>}
                    {!hasIntervals && set.pace && <span className="font-normal text-muted-foreground"> @ {set.pace}</span>}
                  </>
                }
                {hasIntervals && set.reps > 1 && <span className="font-normal text-muted-foreground"> · {set.reps}×</span>}
              </p>
              {!hasIntervals && set.rest && <p className="text-xs text-muted-foreground text-right mt-0.5">מנוחה: {set.rest}</p>}
            </div>
            {hasIntervals && (set.intervals as any[]).map((iv: any, ii: number) => (
              <div key={iv.id||ii}>
                <div className="px-4 py-2.5 border-t border-border flex items-center justify-end gap-3">
                  {iv.pace && <span className="text-sm text-muted-foreground">@ {iv.pace}</span>}
                  <span className="text-base font-bold text-navy">{iv.distance}</span>
                  <span className="w-6 h-6 rounded-full bg-navy text-white font-bold flex items-center justify-center text-xs flex-shrink-0">{ii+1}</span>
                </div>
                {iv.rest && (
                  <div className="px-4 py-1.5 border-t border-border/30">
                    <p className="text-xs text-muted-foreground text-right">מנוחה: {iv.rest}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )
      })}
      {w.workout.cooldown && (
        <div className="px-4 py-2.5 border-t border-border">
          <p className="text-sm text-muted-foreground text-right">{t.cooldownLabel}: {w.workout.cooldown}</p>
        </div>
      )}
      {w.workout.notes && (
        <div className="px-4 py-2.5 border-t border-border">
          <p className="text-sm text-navy text-right">{t.coachNotesLabel}: {w.workout.notes}</p>
        </div>
      )}
      {showLog && log && (
        <div className="px-4 py-3 border-t border-emerald-200 bg-emerald-50">
          <div className="flex items-center gap-3 flex-wrap text-sm">
            <span className="font-bold text-navy">מאמץ {log.effort}/10</span>
            {log.actualDistance && <span className="text-muted-foreground">· {log.actualDistance} ק"מ</span>}
            {log.actualPace && <span className="text-muted-foreground">· {log.actualPace}/ק"מ</span>}
          </div>
          {log.comment && <p className="text-sm text-navy italic mt-1">"{log.comment}"</p>}
        </div>
      )}
    </div>
  )
}
