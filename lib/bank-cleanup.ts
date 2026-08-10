/**
 * lib/bank-cleanup.ts
 *
 * Pure, deterministic analysis for the coach "Bank Cleanup" tool
 * (components/coach/bank-cleanup.tsx). No Firestore access here — takes
 * whatever workouts the caller already fetched and proposes changes;
 * nothing here writes anything. Rule-based on purpose: with no Anthropic
 * credits available and 200+ real production workouts, guessing content
 * via an LLM per-item isn't an option anyway, and transparent rules are
 * easier for a coach to spot-check than an opaque model call would be.
 */

import type { ExperienceLevel, Workout, WorkoutType } from './types'

export type FlagReason = 'bad_duration' | 'bad_reps' | 'empty_stub'

export interface WorkoutFlag {
  workoutId: string
  reason: FlagReason
  detail: string
  /** Only set for bad_duration — a plausible replacement derived from
   *  distance at a generic moderate pace, offered as a starting point,
   *  never auto-applied without the coach confirming/editing it. */
  suggestedDuration?: number
}

export interface TitleProposal {
  workoutId: string
  originalTitle: string
  proposedTitle: string
}

export interface LevelProposal {
  workoutId: string
  proposedLevel: ExperienceLevel | null
  ruleUsed: string
}

/** Anything with no real structure at all — not a judgment call, just
 *  genuinely empty. */
export function findEmptyStubs(workouts: Workout[]): WorkoutFlag[] {
  return workouts
    .filter((w) => w.type !== 'rest'
      && (!w.sets || w.sets.length === 0)
      && !w.warmup && !w.cooldown && !w.notes && !w.description)
    .map((w) => ({ workoutId: w.id, reason: 'empty_stub' as const, detail: 'No sets, warmup, cooldown, notes, or description' }))
}

/** duration > 180min for anything except long_run is almost certainly a
 *  typo (a fat-fingered extra digit, e.g. 3545 instead of ~35-45) —
 *  long_run gets a higher bar since a genuine ultra-distance long run
 *  can legitimately run past 3 hours. */
export function findBadDurations(workouts: Workout[]): WorkoutFlag[] {
  return workouts
    .filter((w) => w.duration != null && w.duration > (w.type === 'long_run' ? 240 : 180))
    .map((w) => {
      // Rough fallback estimate from distance at a generic 5min/km pace —
      // only a starting point for the coach to edit, not a real answer.
      const suggestedDuration = w.distance ? Math.round(w.distance * 5) : undefined
      return {
        workoutId: w.id,
        reason: 'bad_duration' as const,
        detail: `duration=${w.duration} (distance=${w.distance ?? '—'})`,
        suggestedDuration,
      }
    })
}

/** A single rep count over 30 is implausible for every type in this
 *  library (even 20x400m intervals tops out around 20) — almost always
 *  a copy-paste or typo artifact. No auto-fix offered; the right number
 *  can't be guessed from context, just flagged for the coach to correct. */
export function findBadReps(workouts: Workout[]): WorkoutFlag[] {
  const flags: WorkoutFlag[] = []
  for (const w of workouts) {
    for (const s of w.sets || []) {
      if (s.reps && s.reps > 30) {
        flags.push({ workoutId: w.id, reason: 'bad_reps', detail: `set reps=${s.reps} (distance="${s.distance || ''}" duration="${s.duration || ''}")` })
      }
    }
  }
  return flags
}

/** Same title reused across genuinely different sessions (different
 *  duration/distance) makes them impossible to tell apart once they're
 *  all sitting in the same Bank type/level bucket — appends the
 *  distinguishing number to the coach's own existing title text rather
 *  than inventing new wording. Only proposes a change when it would
 *  actually make the title more unique among its duplicate siblings. */
export function proposeTitleDisambiguation(workouts: Workout[]): TitleProposal[] {
  const byTitle = new Map<string, Workout[]>()
  for (const w of workouts) {
    const key = w.title.trim()
    if (!byTitle.has(key)) byTitle.set(key, [])
    byTitle.get(key)!.push(w)
  }
  const proposals: TitleProposal[] = []
  for (const [title, group] of byTitle) {
    if (group.length < 2) continue
    // Suffix combos already present among the group — skip disambiguating
    // further if every member would still collide after suffixing (e.g.
    // two identical 35min/8km entries really are the same workout twice).
    const suffixes = new Set<string>()
    for (const w of group) {
      const suffix = w.duration ? `${w.duration} דק'` : w.distance ? `${w.distance} ק"מ` : null
      if (suffix) suffixes.add(suffix)
    }
    if (suffixes.size < 2) continue // suffixing wouldn't actually distinguish them
    for (const w of group) {
      const suffix = w.duration ? `${w.duration} דק'` : w.distance ? `${w.distance} ק"מ` : null
      if (!suffix) continue
      if (title.includes(suffix)) continue // already distinguishing itself
      proposals.push({ workoutId: w.id, originalTitle: w.title, proposedTitle: `${title} ${suffix}` })
    }
  }
  return proposals
}

// Duration-based level buckets, per type family — deliberately coarse and
// entirely duration-driven (pace text is free-form Hebrew across this
// library and not reliably parseable). Quality-session types get lower
// thresholds than easy/long_run since a hard 55min session is a much
// bigger ask than an easy 55min run at the same athlete level.
const EASY_FAMILY: WorkoutType[] = ['easy', 'long_run', 'recovery']
const QUALITY_FAMILY: WorkoutType[] = ['fartlek', 'hill_repeats', 'tempo', 'threshold', 'intervals']

function levelFromDuration(duration: number, thresholds: [number, number, number]): ExperienceLevel {
  if (duration <= thresholds[0]) return 'beginner'
  if (duration <= thresholds[1]) return 'intermediate'
  if (duration <= thresholds[2]) return 'advanced'
  return 'professional'
}

export function proposeLevel(w: Workout): LevelProposal {
  if (w.duration == null) {
    return { workoutId: w.id, proposedLevel: null, ruleUsed: 'no duration data — needs manual review' }
  }
  if (EASY_FAMILY.includes(w.type)) {
    return {
      workoutId: w.id,
      proposedLevel: levelFromDuration(w.duration, [30, 60, 90]),
      ruleUsed: 'easy/long_run duration bucket (≤30/≤60/≤90/>90 min)',
    }
  }
  if (QUALITY_FAMILY.includes(w.type)) {
    return {
      workoutId: w.id,
      proposedLevel: levelFromDuration(w.duration, [25, 40, 55]),
      ruleUsed: 'quality-session duration bucket (≤25/≤40/≤55/>55 min)',
    }
  }
  return { workoutId: w.id, proposedLevel: null, ruleUsed: `type "${w.type}" has no reliable duration→level rule` }
}
