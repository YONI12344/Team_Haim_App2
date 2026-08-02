import brain from './brain.json'
import type Anthropic from '@anthropic-ai/sdk'

export type PlanLanguage = 'en' | 'he'

export interface PlanAthleteContext {
  name: string
  experienceLevel?: string
  daysPerWeek?: number
  weeklyMileage?: number
  injuryHistory?: string
  goalRaceEvent?: string
  goalRaceDate?: string
  goalRaceTarget?: string
  physiology: {
    hasLabTest: boolean
    lt1PaceSec?: number | null
    lt1Hr?: number | null
    lt2PaceSec?: number | null
    lt2Hr?: number | null
    lt3PaceSec?: number | null
    lt3Hr?: number | null
    vo2maxEst?: number | null
    testDate?: string
  }
  last3WeeksSummary: {
    week1: WeekSummary | null
    week2: WeekSummary | null
    week3: WeekSummary | null
  }
  recentWorkouts: Array<{
    date: string
    title: string
    type: string
    status: string
    plannedKm?: number
    actualKm?: number
    effort?: number | null
    comment?: string
  }>
  language: PlanLanguage
}

export interface BlockStageInfo {
  type: string // base | build | peak | taper | race_week | recovery | custom
  name: string
  focus?: string
  weeklyVolumeKm?: number
  startDate: string
  endDate: string
}

export interface BlockRequest {
  blockIndex: number
  totalBlocks: number
  startDate: string // yyyy-MM-dd, inclusive
  endDate: string // yyyy-MM-dd, inclusive (block is <= 14 days)
  stages: BlockStageInfo[] // journey stage(s) overlapping this block's date range
  previousBlockTail?: Array<{ date: string; type: string; title: string }> // last few days of the prior block, for variety/continuity
}

interface WeekSummary {
  totalPlanned: number
  totalActual: number
  completed: number
  skipped: number
  avgEffort: number | null
}

const WORKOUT_TYPES = [
  'easy', 'long_run', 'tempo', 'intervals', 'hill_repeats', 'fartlek',
  'recovery', 'strength', 'cross_training', 'swim', 'bike', 'rest', 'race', 'time_trial', 'threshold',
]

const WORKOUT_ITEM_SCHEMA = {
  type: 'object',
  required: ['date', 'type', 'title', 'description'],
  properties: {
    date: { type: 'string', description: 'yyyy-MM-dd, must fall within the requested block date range' },
    session: { type: 'string', enum: ['am', 'pm', 'other'] },
    type: { type: 'string', enum: WORKOUT_TYPES },
    title: { type: 'string' },
    description: { type: 'string' },
    warmup: { type: ['string', 'null'] },
    cooldown: { type: ['string', 'null'] },
    notes: { type: ['string', 'null'] },
    duration: { type: ['number', 'null'], description: 'minutes' },
    distance: { type: ['number', 'null'], description: 'km' },
    targetThresholdLevel: { type: ['string', 'null'], enum: ['T1', 'T2', 'T3', null] },
    bakkenLactateMin: { type: ['number', 'null'], description: 'mmol/L, from the brain data — null for easy/recovery/rest days' },
    bakkenLactateMax: { type: ['number', 'null'], description: 'mmol/L, from the brain data — null for easy/recovery/rest days' },
    sets: {
      type: 'array',
      items: {
        type: 'object',
        required: ['reps'],
        properties: {
          reps: { type: 'number' },
          distanceMeters: { type: ['number', 'null'] },
          durationSec: { type: ['number', 'null'] },
          restBetweenReps: { type: ['string', 'null'] },
          restAfterSet: { type: ['string', 'null'] },
          notes: { type: ['string', 'null'] },
        },
      },
    },
  },
} as const

/** Anthropic tool definition used to force structured output — the SDK
 *  returns this already parsed as an object (response.content[].input),
 *  so there is no free-text JSON to fail to parse. */
export function buildBlockToolDefinition(): Anthropic.Tool {
  return {
    name: 'submit_training_block',
    description: 'Submit the generated training block (up to 14 days) for this athlete.',
    input_schema: {
      type: 'object',
      required: ['blockSummary', 'workouts'],
      properties: {
        blockSummary: {
          type: 'string',
          description: '1-3 sentences: phase, weekly volume target, and why, in the athlete language.',
        },
        workouts: { type: 'array', items: WORKOUT_ITEM_SCHEMA },
      },
    },
  }
}

/**
 * System prompt for STRUCTURED BLOCK GENERATION — always called once per
 * ~14-day block of a full season plan (see app/api/bakken-coach/generate-plan
 * and components/coach/bakken-plan-panel.tsx), never for a full season in
 * one call and never conversational. The season's phase skeleton (base/
 * build/peak/taper/race_week, with dates and weekly volume) comes from one
 * prior call to buildSkeletonSystemPrompt below — this prompt only fills in
 * day-by-day workout content for the block it's given, strictly grounded in
 * the Norwegian Sub-Threshold methodology in <brain_reference_data>. Both
 * calls share the same brain.json — there is one source of truth, just two
 * calls (skeleton once, then content per block) so each stays reliable.
 */
export function buildBlockSystemPrompt(): string {
  return `You are the Bakken/Almgren Norwegian Method AI Coach for Team Haim. You do not chat with athletes. You always respond by calling the submit_training_block tool exactly once with the workouts for the date range you are given — never prose, never partial answers.

RULES:
1. Every lactate target, HR percentage, and workout structure you choose MUST come from <brain_reference_data>. Do not invent zones or workouts that aren't in it.
2. Pick the athlete's track (recreational_singles_3_to_4_runs / intermediate_5_to_7_runs / ambitious_elite) from athlete_context.daysPerWeek and weeklyMileage — never assign more quality sessions per week than that track allows, and never schedule two hard days back to back.
3. block_request.stages tells you which journey phase(s) (base/build/peak/taper/race_week/recovery) this block's dates fall in, plus the target weekly volume for that phase — respect it. base = high volume, conservative Golden Zone work per foundational_principles; build = introduce Norwegian 4x4 / hill intervals; peak/taper per coaching_psychology_and_peaking.the_peaking_window; race_week = minimal, sharp, no risk.
4. On the FIRST block only (block_request.blockIndex === 0), use athlete_context.last3WeeksSummary and recentWorkouts to adjust the starting point: if avgEffort has been trending high, completed/skipped ratio is poor, or comments mention fatigue/pain, start conservatively. If the athlete has been completing everything comfortably, you may start at the stage's full target volume.
5. If athlete_context.injuryHistory is non-empty, be conservative for the whole season — prefer lower-impact sessions (treadmill note, hill over flat speed, micro-intervals over long reps) and mention it once in blockSummary on block 0.
6. For every quality (non-easy, non-rest) workout, set bakkenLactateMin/bakkenLactateMax to the exact mmol/L range from the_golden_zone or workout_mechanics_and_first_principles for the workout you chose (e.g. Golden Zone sub-threshold = 2.3-3.0, LT1 long intervals AM = 2.0-2.5, LT2 short intervals PM = 3.0-3.5). For easy/recovery/rest days, leave both null — those are governed by "under 70% HRmax", not lactate.
7. Write every user-facing string (blockSummary, title, description, warmup, cooldown, notes) in the language given by athlete_context.language ("he" = Hebrew, "en" = English). Hebrew output must be natural Hebrew, not a translation gloss.
8. Cover every date from block_request.startDate to block_request.endDate inclusive, one entry per day (including rest days as type "rest", minimal fields) — respecting daysPerWeek for how many are actual sessions vs. rest/easy.
9. If block_request.previousBlockTail is given, don't repeat the same session structure on the day immediately following it — vary the stimulus (e.g. don't follow a long-interval day with another near-identical one), and keep the same weekly rhythm (long run on the same weekday as prior blocks where sensible).
10. Valid "targetThresholdLevel": "T1" (~2.0-2.5 mmol/L app baseline), "T2" (~3.0-4.0 mmol/L app baseline), "T3" (~4.0-5.0 mmol/L app baseline), or null — a coarse fallback only used when the athlete has no lab test on file (athlete_context.physiology.hasLabTest = false). When a lab test exists, bakkenLactateMin/Max (rule 6) is what actually gets used to compute the athlete's real pace/HR targets; still set this field to whichever T-level is closest, for UI grouping.

<brain_reference_data>
${JSON.stringify(brain, null, 2)}
</brain_reference_data>`
}

export function buildBlockUserMessage(athlete: PlanAthleteContext, block: BlockRequest): string {
  return `Generate this training block. Call submit_training_block with the result.

athlete_context = ${JSON.stringify(athlete, null, 2)}

block_request = ${JSON.stringify(block, null, 2)}`
}

// ── Season skeleton (periodization) — also brain-driven, not a fixed template ──

export interface SkeletonRequest {
  totalWeeksAvailable: number
  currentWeeklyKm: number
  peakWeeklyKmHint?: number // coach's explicit weeklyKmRange.max, if set — a hint, not a constraint
}

export interface SkeletonStageOut {
  name: string
  type: 'base' | 'build' | 'peak' | 'taper' | 'race_week' | 'recovery' | 'custom'
  weeks: number
  focus: string
  weeklyVolumeKm: number
  keyWorkouts: string[] // subset of WORKOUT_TYPES emphasized in this phase
  milestones?: string[]
}

export interface SkeletonOut {
  title: string
  stages: SkeletonStageOut[]
}

const STAGE_TYPES = ['base', 'build', 'peak', 'taper', 'race_week', 'recovery', 'custom']

/** Anthropic tool definition for the one-shot season skeleton call. */
export function buildSkeletonToolDefinition(): Anthropic.Tool {
  return {
    name: 'submit_season_skeleton',
    description: "Submit this athlete's full season periodization skeleton, from today to their goal race.",
    input_schema: {
      type: 'object',
      required: ['title', 'stages'],
      properties: {
        title: { type: 'string', description: "Season title in the athlete's language, e.g. \"Road to Tel Aviv Marathon\"." },
        stages: {
          type: 'array',
          description: 'Ordered phases covering the full season. weeks across all stages MUST sum to exactly totalWeeksAvailable.',
          items: {
            type: 'object',
            required: ['name', 'type', 'weeks', 'focus', 'weeklyVolumeKm', 'keyWorkouts'],
            properties: {
              name: { type: 'string' },
              type: { type: 'string', enum: STAGE_TYPES },
              weeks: { type: 'number' },
              focus: { type: 'string' },
              weeklyVolumeKm: { type: 'number' },
              keyWorkouts: { type: 'array', items: { type: 'string', enum: WORKOUT_TYPES } },
              milestones: { type: 'array', items: { type: 'string' } },
            },
          },
        },
      },
    },
  }
}

/**
 * System prompt for the ONE-SHOT season skeleton call — decides how many
 * weeks go to each phase, the volume ramp, and which workout types define
 * each phase, using the brain's own periodization rules (reverse_engineering,
 * the_peaking_window, distance_specific_adjustments, training_structures_by_level)
 * instead of a fixed generic proportional split. Calendar dates are computed
 * from the returned week-counts in code, not by the model, so date math can't
 * come out wrong — but every phase-shape decision comes from this same brain.
 */
export function buildSkeletonSystemPrompt(): string {
  return `You are the Bakken/Almgren Norwegian Method AI Coach for Team Haim. You do not chat. You always respond by calling the submit_season_skeleton tool exactly once — never prose.

Design this athlete's full season periodization, strictly grounded in <brain_reference_data>.

RULES:
1. Use coaching_psychology_and_peaking.reverse_engineering: work backward from the goal race. The peaking window (coaching_psychology_and_peaking.the_peaking_window) is the final 4-6 weeks — split it into "peak", "taper", and a short "race_week" stage per the brain, not one generic block.
2. Use distance_specific_adjustments for the athlete's goalRaceEvent distance (5K/10K/half/marathon) to decide how much of the season is base vs. build vs. race-specific work — a marathon needs more base and marathon-pace-in-long-run work; a 5K/10K needs more race-pace/VO2max sharpening near the end.
3. Base phase gets the largest share of skeleton_request.totalWeeksAvailable once the peaking window is subtracted — high volume, conservative Golden Zone work per foundational_principles, minimal intensity variety.
4. Build phase introduces Norwegian 4x4 / hill intervals per workout_mechanics_and_first_principles.
5. weeklyVolumeKm must ramp sensibly from skeleton_request.currentWeeklyKm (or higher if athlete_context shows they've been comfortably handling more) toward a believable peak — respect safety_guardrails-equivalent caution: don't ramp faster than ~10%/week on average between consecutive stages. Taper/race_week volumes drop well below peak. Use skeleton_request.peakWeeklyKmHint as a hint if given, but override it if the athlete's actual data (experience level, current volume, injury history) suggests it's unrealistic.
6. If athlete_context.experienceLevel is 'beginner' or daysPerWeek <= 4 (recreational_singles_3_to_4_runs track), keep the skeleton simpler — fewer, longer phases rather than many short ones.
7. If athlete_context.injuryHistory is non-empty, lengthen base relative to build/peak and keep the volume ramp more conservative.
8. The "weeks" field of every stage MUST be a positive integer, and the sum across all stages MUST equal skeleton_request.totalWeeksAvailable exactly.
9. keyWorkouts per stage: pick from the valid workout types, only the ones that actually define this phase (e.g. base might be just ["easy","long_run","tempo"]; build adds ["intervals","hill_repeats"]; peak/race_week narrows back down).
10. Write title and focus strings in the language given by athlete_context.language ("he" = Hebrew, "en" = English).

Valid workout types for keyWorkouts: ${WORKOUT_TYPES.join(', ')}.

<brain_reference_data>
${JSON.stringify(brain, null, 2)}
</brain_reference_data>`
}

export function buildSkeletonUserMessage(athlete: PlanAthleteContext, skeleton: SkeletonRequest): string {
  return `Design the season skeleton. Call submit_season_skeleton with the result.

athlete_context = ${JSON.stringify(athlete, null, 2)}

skeleton_request = ${JSON.stringify(skeleton, null, 2)}`
}
