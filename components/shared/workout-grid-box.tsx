'use client'

import type { ElementType, MouseEvent, ReactNode } from 'react'
import { cn, resolveText } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'
import { setRestAfter, setRestBetweenReps } from '@/lib/types'
import { AlertTriangle } from 'lucide-react'

// Single source of truth for the week/month schedule grid's per-workout
// box — used identically by the coach's own planner
// (components/coach/athlete-planner.tsx) and the athlete's read-only view
// (components/athlete/athlete-planner-view.tsx). Both used to keep their
// own hand-copied version of this and kept drifting apart every time one
// side got a tweak the other didn't; importing the same component instead
// makes that impossible — there is only one implementation to change.
export const GRID_TYPE_DOT_COLORS: Record<string, string> = {
  easy: 'bg-emerald-400', recovery: 'bg-emerald-400',
  long_run: 'bg-orange-400',
  tempo: 'bg-amber-400', intervals: 'bg-amber-400', hill_repeats: 'bg-amber-400', fartlek: 'bg-amber-400',
  threshold: 'bg-pink-400',
  race: 'bg-gold', time_trial: 'bg-gold',
  strength: 'bg-slate-400', cross_training: 'bg-slate-400', swim: 'bg-slate-400', bike: 'bg-slate-400',
  rest: 'bg-slate-500',
}

/** The full workout structure (description/warmup/every set+interval+rest/
 *  strength exercises/cooldown) at tiny font — read via the grid's zoom
 *  control rather than resized to fit, same idea as a dense spreadsheet
 *  cell. Wording mirrors the athlete's own full-detail view exactly. */
export function GridWorkoutDetail({ workout }: { workout: any }) {
  const { t } = useLanguage()
  if (!workout) return null
  return (
    <div className="w-full min-w-0 space-y-1">
      {workout.description && (
        <p className="opacity-90 font-medium text-[8px] leading-[1.3] break-words">{workout.description}</p>
      )}
      {workout.warmup && (
        <p className="opacity-60 text-[8px] leading-[1.3] break-words">{t.warmupLabel}: {workout.warmup}</p>
      )}
      {workout.sets?.map((set: any, si: number) => {
        const hasIntervals = set.intervals && set.intervals.length > 0
        const isLastSet = si === workout.sets.length - 1
        const restBetweenReps = setRestBetweenReps(set)
        const restAfterSet = setRestAfter(set)
        return (
          <div key={set.id || si} className="space-y-1">
            <p className="font-bold opacity-95 text-[9px] leading-[1.3] break-words">
              {t.setLabelPrefix} {si + 1}
              {set.reps > 1 && !hasIntervals && ` · ${set.reps}× ${set.distance || set.duration || ''}`}
              {!hasIntervals && !(set.reps > 1) && (set.distance || set.duration) && ` · ${set.distance || set.duration}`}
              {hasIntervals && set.reps > 1 && ` · ${set.reps}×`}
              {set.pace && ` @ ${set.pace}`}
            </p>
            {hasIntervals && set.intervals.map((iv: any, ii: number) => (
              <p key={iv.id || ii} className="opacity-80 text-[8px] leading-[1.3] break-words pr-1.5">
                {ii + 1}. {iv.distance || iv.duration}{iv.pace ? ` @ ${iv.pace}` : ''}{iv.rest ? ` — ${t.restPrefix} ${iv.rest}` : ''}
              </p>
            ))}
            {(set.reps || 1) > 1 && restBetweenReps && (
              <p className="opacity-50 text-[8px] leading-[1.3]">{t.restBetweenReps}: {restBetweenReps}</p>
            )}
            {!isLastSet && (
              <p className="opacity-50 text-[8px] leading-[1.3]">{restAfterSet ? `${t.restBetweenSets}: ${restAfterSet}` : t.continueToNext}</p>
            )}
          </div>
        )
      })}
      {!!workout.strengthBlocks?.length && workout.strengthBlocks.map((b: any) => (
        <p key={b.id} className="opacity-90 font-medium text-[8px] leading-[1.3] break-words">{b.label}: {b.exercises.map((ex: any) => ex.name).join(', ')}</p>
      ))}
      {workout.cooldown && (
        <p className="opacity-60 text-[8px] leading-[1.3] break-words">{t.cooldownLabel}: {workout.cooldown}</p>
      )}
    </div>
  )
}

interface GridWorkoutBoxProps {
  workout: any
  done?: boolean
  /** Coach-only QA flag (implausible distance) — never passed by the
   *  athlete's read-only grid. */
  suspicious?: boolean
  /** Coach-only private feedback line — never passed by the athlete's
   *  read-only grid (that's a separate, expiring note — see
   *  components/coach/athlete-planner.tsx's "coach comments" box). */
  coachFeedback?: string
  /** Coach passes this to open the edit panel; the athlete's grid passes
   *  nothing — the whole day cell (not the box) drives selection there. */
  onClick?: (e: MouseEvent) => void
  selected?: boolean
  extraContent?: ReactNode
}

export function GridWorkoutBox({ workout, done, suspicious, coachFeedback, onClick, selected, extraContent }: GridWorkoutBoxProps) {
  const { t, language } = useLanguage()
  if (!workout) return null
  const metric = workout.distance ? `${workout.distance}k` : workout.duration ? `${workout.duration}'` : null
  const Tag = (onClick ? 'button' : 'div') as ElementType
  return (
    <Tag
      dir="rtl"
      onClick={onClick}
      className={cn('w-full text-right rounded-lg px-1.5 py-1.5 flex flex-col gap-1 overflow-hidden',
        onClick ? 'transition-all hover:opacity-90' : '',
        suspicious ? 'bg-gradient-to-br from-red-700 to-red-800 text-white' : 'bg-gradient-to-br from-[#0a1628] to-[#0a1628]/85 text-white',
        selected ? 'ring-2 ring-gold' : ''
      )}>
      <div className="w-full min-w-0 flex items-center gap-1 text-[10px]">
        <span className={cn('w-2 h-2 rounded-full flex-shrink-0', GRID_TYPE_DOT_COLORS[workout.type as string] || GRID_TYPE_DOT_COLORS.easy)} />
        {suspicious && <AlertTriangle className="h-2.5 w-2.5 shrink-0" />}
        {done && <span className="flex-shrink-0 text-emerald-400">✓</span>}
        <span className="flex-1 min-w-0 truncate font-bold">{resolveText(language, workout.title, workout.titleEn)}</span>
        {metric && (
          <span className="flex-shrink-0 text-[9px] font-bold bg-[#c9a84c] text-[#0a1628] px-1.5 py-0.5 rounded-full">{metric}</span>
        )}
      </div>
      <GridWorkoutDetail workout={workout} />
      {coachFeedback && (
        <p className="w-full min-w-0 opacity-60 text-[8px] leading-[1.3] break-words" dir="rtl">{t.theCoachFallback}: {coachFeedback}</p>
      )}
      {extraContent}
    </Tag>
  )
}
