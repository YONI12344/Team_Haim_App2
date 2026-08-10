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

import type { ExperienceLevel, Workout, WorkoutSet, WorkoutType } from './types'

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

// -------------------- adapted-copy generation for coverage gaps --------------------
// "Keep how I write it, keep the structure, adapt warmup/cooldown, but
// also scale the volume (reps → total distance/time) by level" — the
// coach's own exact instruction. Structure (rep pattern/intervals shape)
// is preserved byte-for-byte; only rep COUNT and the totals derived from
// it scale, plus warmup/cooldown swap to the target level's real
// template (from coach-voice.json's own warmup_patterns/cooldown_patterns
// — not invented text).

const BANK_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'professional']
const LEVEL_WEIGHT: Record<ExperienceLevel, number> = { beginner: 1, intermediate: 2, advanced: 3, professional: 4 }
export const LEVEL_LABEL_HE: Record<ExperienceLevel, string> = {
  beginner: 'מתחילים', intermediate: 'בינוני', advanced: 'מתקדם', professional: 'עילית',
}
// Verbatim from lib/bakken/coach-voice.json's warmup_patterns/cooldown_patterns
// (real recurring structures this coach actually uses) — not generated text.
const WARMUP_BY_LEVEL: Record<ExperienceLevel, string> = {
  beginner: 'מתיחות דינמיות, 3 ד׳ הליכה מהירה + 2 ד׳ ריצה קלה',
  intermediate: 'ריצה קלה 2 ק״מ, מתיחות דינמיות, 4X100 מתגברת להתחיל לאט ולהגביר',
  advanced: 'מתיחות דינמיות + 10 ד׳ ריצה קלה',
  professional: 'מתיחות דינמיות + 10 ד׳ ריצה קלה',
}
const COOLDOWN_BY_LEVEL: Record<ExperienceLevel, string> = {
  beginner: '5 דקות הליכת שחרור',
  intermediate: 'שחרור 5 ד׳ ריצה קלה ומתיחות סטטיות',
  advanced: 'ריצה קלה 1-2 ק״מ ומתיחות סטטיות',
  professional: 'ריצה קלה 1-2 ק״מ ומתיחות סטטיות',
}

export interface CoverageGap {
  type: WorkoutType
  targetLevel: ExperienceLevel
  templateWorkoutId: string
  templateLevel: ExperienceLevel
}

/** For every type that has AT LEAST ONE bank-tagged workout somewhere,
 *  find which levels have none yet — only types already started in the
 *  bank get gap-filled, so this never invents coverage for a type the
 *  coach hasn't chosen to bank at all. */
export function findCoverageGaps(workouts: Workout[]): CoverageGap[] {
  const relevantTypes = new Set<WorkoutType>([...EASY_FAMILY, ...QUALITY_FAMILY])
  const byTypeLevel = new Map<WorkoutType, Map<ExperienceLevel, Workout[]>>()
  for (const w of workouts) {
    if (!w.bankLevel || !relevantTypes.has(w.type)) continue
    if (!byTypeLevel.has(w.type)) byTypeLevel.set(w.type, new Map())
    const byLevel = byTypeLevel.get(w.type)!
    if (!byLevel.has(w.bankLevel)) byLevel.set(w.bankLevel, [])
    byLevel.get(w.bankLevel)!.push(w)
  }
  const gaps: CoverageGap[] = []
  for (const [type, byLevel] of byTypeLevel) {
    for (const level of BANK_LEVELS) {
      if (byLevel.has(level)) continue
      let best: { level: ExperienceLevel; dist: number } | null = null
      for (const lvl of byLevel.keys()) {
        const dist = Math.abs(LEVEL_WEIGHT[lvl] - LEVEL_WEIGHT[level])
        if (!best || dist < best.dist) best = { level: lvl, dist }
      }
      if (!best) continue
      const candidates = byLevel.get(best.level)!
      const template = candidates.reduce((a, b) => ((a.sets?.[0]?.reps || 0) >= (b.sets?.[0]?.reps || 0) ? a : b))
      gaps.push({ type, targetLevel: level, templateWorkoutId: template.id, templateLevel: best.level })
    }
  }
  return gaps
}

export type AdaptedWorkout = Omit<Workout, 'id' | 'createdAt' | 'updatedAt' | 'createdBy'>

/** Builds the proposed adapted copy — same title/description/notes/voice
 *  as the template, same rep STRUCTURE (order, rest patterns, intervals
 *  shape all untouched), only reps count + totals scaled by the level
 *  ratio, and warmup/cooldown swapped to the target level's template. */
export function buildAdaptedWorkout(template: Workout, targetLevel: ExperienceLevel): AdaptedWorkout {
  const templateLevel = template.bankLevel || 'intermediate'
  const ratio = LEVEL_WEIGHT[targetLevel] / LEVEL_WEIGHT[templateLevel]
  const scaleReps = (n: number) => Math.max(2, Math.round(n * ratio))

  const scaledSets: WorkoutSet[] = (template.sets || []).map((s) => ({ ...s, reps: scaleReps(s.reps || 1) }))
  const firstOrigReps = template.sets?.[0]?.reps || 1
  const firstNewReps = scaledSets[0]?.reps || firstOrigReps
  const totalsRatio = firstNewReps / firstOrigReps

  return {
    title: `${template.title} (${LEVEL_LABEL_HE[targetLevel]})`,
    type: template.type,
    description: template.description,
    duration: template.duration != null ? Math.max(5, Math.round(template.duration * totalsRatio)) : template.duration,
    distance: template.distance != null ? Math.round(template.distance * totalsRatio * 10) / 10 : template.distance,
    sets: scaledSets,
    warmup: WARMUP_BY_LEVEL[targetLevel],
    cooldown: COOLDOWN_BY_LEVEL[targetLevel],
    notes: template.notes,
    bankLevel: targetLevel,
  }
}
