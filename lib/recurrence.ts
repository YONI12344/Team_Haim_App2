/**
 * lib/recurrence.ts
 *
 * Shared recurrence helpers for turning a single workout assignment into
 * a repeating one (weekly / every-other-week), used by both the
 * dedicated assign flow (components/coach/workout-assign.tsx) and the
 * per-athlete schedule's "repeat this" control (components/coach/
 * athlete-planner.tsx). No Firestore access — pure date math plus one
 * journey-progress lookup, callers do the actual writes.
 */

import { addDays } from 'date-fns'
import { computeJourneyProgress } from './journey'
import type { AthleteProfile, JourneyDoc } from './types'

export type RepeatFrequency = 'none' | 'weekly' | 'biweekly'

// Hard safety cap on how many occurrences a single action can write,
// regardless of the chosen end date — bounded cost/time per click, coach
// can always repeat the action to extend further.
export const MAX_OCCURRENCES = 52

export function occurrenceDates(start: Date, frequency: RepeatFrequency, until: Date | undefined): Date[] {
  if (frequency === 'none' || !until) return [start]
  const dates: Date[] = []
  let cursor = start
  const stepDays = frequency === 'weekly' ? 7 : 14
  while (cursor <= until && dates.length < MAX_OCCURRENCES) {
    dates.push(cursor)
    cursor = addDays(cursor, stepDays)
  }
  return dates
}

/** "Is this week an off/down week for this athlete", generalized to an
 *  arbitrary date instead of always "today" — lets a recurrence
 *  generator skip an occurrence that would land on a future down week,
 *  not just detect today's. */
export function isDownWeekFor(athlete: AthleteProfile, journeys: JourneyDoc[], date: Date): boolean {
  const activeJourney = journeys.find((j) => new Date(j.startDate) <= date && new Date(j.goalRaceDate) >= date)
    || journeys[journeys.length - 1]
  if (!activeJourney) return false
  const progress = computeJourneyProgress(activeJourney, date)
  const stage = progress.activeStage
  if (!stage) return false
  const stageStart = new Date(stage.startDate)
  const weekInStage = Math.max(1, Math.ceil((date.getTime() - stageStart.getTime()) / (7 * 86400000)))
  const offInterval = athlete.offWeekInterval ?? 4
  return weekInStage % offInterval === 0
}
