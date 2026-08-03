import brain from './brain.json'
import type Anthropic from '@anthropic-ai/sdk'

export type PlanLanguage = 'en' | 'he'

export interface PlanAthleteContext {
  name: string
  experienceLevel?: string
  daysPerWeek?: number
  weekSchedule?: Record<'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday', string>
  weeklyMileage?: number
  injuryHistory?: string
  // Coach preference — cap/target long_run duration in minutes. When set,
  // long runs should land at or under this rather than whatever the model
  // would otherwise pick.
  longRunMinutes?: number
  // Coach-only free text (AthleteProfile.coachPrivateNotes, never shown to
  // the athlete) — the coach's own catch-all for anything the brain should
  // know about this specific athlete that doesn't fit another field:
  // schedule quirks, gear, personality, race history detail, etc.
  coachNotes?: string
  goalRaceEvent?: string
  goalRaceDistance?: '1500m' | 'mile' | '3000m' | '5k' | '10k' | '15k' | 'half_marathon' | 'marathon'
  goalRaceDate?: string
  goalRaceTarget?: string
  // Athlete's own read on where they're at right now — a self-report signal
  // for the brain alongside (not instead of) recentWorkouts/last3WeeksSummary.
  currentShape?: 'just_starting' | 'returning' | 'consistent' | 'peak_fitness'
  // Recent race results (AthleteProfile.personalRecords) — the best pace
  // anchor available when there's no lab test on file.
  personalRecords?: Array<{ event: string; time: string; date: string }>
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

// Fixed value sets instead of open numbers — picked from what actually
// appears throughout <brain_reference_data> (standard_workouts, micro
// intervals, double threshold, etc.) plus round real-world training
// numbers. This keeps the model choosing from realistic, consistent
// values instead of drifting toward odd precise numbers (837m, 43min),
// and reads cleaner for the athlete than arbitrary decimals.
const REP_COUNTS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 25, 30, 35, 40]
const REP_DISTANCES_M = [200, 300, 400, 600, 800, 1000, 1200, 1500, 1600, 2000, 3000, 5000]
const REP_DURATIONS_SEC = [15, 20, 30, 35, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, 600]
const TOTAL_DISTANCES_KM = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21.1, 22, 24, 25, 26, 28, 30, 32, 34, 35, 38, 40, 42.2, 45,
]
const TOTAL_DURATIONS_MIN = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 135, 150, 165, 180]
// Every lactate value that actually appears in brain.json — the_golden_zone,
// double_threshold, LT1/LT2/LT3 definitions — nothing invented in between.
// 1.0/1.2 added below LT1 (~1.5, per the_physiological_hub) for genuinely
// easy/recovery pace anchoring — see rule 6 below.
const LACTATE_VALUES = [1.0, 1.2, 1.5, 1.8, 2.0, 2.2, 2.3, 2.5, 2.8, 3.0, 3.2, 3.5, 4.0, 4.5]

const WORKOUT_ITEM_SCHEMA = {
  type: 'object',
  required: ['date', 'type', 'title', 'description', 'duration', 'distance'],
  properties: {
    date: { type: 'string', description: 'yyyy-MM-dd, must fall within the requested block date range' },
    session: {
      type: 'string',
      enum: ['am', 'pm', 'other'],
      description: '"am"/"pm" ONLY on a double-threshold day (two entries sharing the same date) — see rule 11. Every other day is "other".',
    },
    type: { type: 'string', enum: WORKOUT_TYPES },
    title: { type: 'string' },
    description: {
      type: 'string',
      description: 'Full session in plain language: pace/effort guidance for easy/long_run (e.g. conversational, <70% HRmax), or the main-set structure in words for quality sessions — this is what the athlete reads first.',
    },
    warmup: { type: ['string', 'null'] },
    cooldown: { type: ['string', 'null'] },
    notes: {
      type: ['string', 'null'],
      description: 'Use for anything sets[] can\'t express: an embedded marathon-pace segment inside a long run, strength exercise list, fartlek 45/15 cycle count, etc.',
    },
    duration: { type: ['number', 'null'], enum: [...TOTAL_DURATIONS_MIN, null], description: 'minutes, from the fixed list — REQUIRED (non-null) for every type except "rest".' },
    distance: { type: ['number', 'null'], enum: [...TOTAL_DISTANCES_KM, null], description: 'km, from the fixed list (42.2 is there for marathon race day) — REQUIRED (non-null) for every running type (easy/long_run/tempo/intervals/hill_repeats/fartlek/threshold/recovery/race/time_trial) except "rest"/"strength"/"cross_training".' },
    targetThresholdLevel: { type: ['string', 'null'], enum: ['T1', 'T2', 'T3', null] },
    bakkenLactateMin: { type: ['number', 'null'], enum: [...LACTATE_VALUES, null], description: 'mmol/L, from the fixed list (every value that appears in brain_reference_data) — null for easy/recovery/rest days' },
    bakkenLactateMax: { type: ['number', 'null'], enum: [...LACTATE_VALUES, null], description: 'mmol/L, from the fixed list (every value that appears in brain_reference_data) — null for easy/recovery/rest days' },
    comparisonGroup: {
      type: ['string', 'null'],
      description: 'A short stable label so the coach can track this exact session type over time in the app\'s lab comparison view, e.g. "Golden Zone 5x6min" or "LT2 1000m reps". Use the EXACT SAME string every time this same structure recurs across the season — this is how progress gets tracked, so consistency matters more than cleverness. Null for easy/rest/strength.',
    },
    thresholdDistance: {
      type: ['number', 'null'],
      enum: [...REP_DISTANCES_M, null],
      description: 'meters, from the fixed list — if every rep in sets[] uses the same distanceMeters, repeat that value here (e.g. 1000). Null if reps use durationSec instead, or distances vary.',
    },
    sets: {
      type: 'array',
      description: 'REQUIRED non-empty for tempo/intervals/hill_repeats/threshold/fartlek — this is what actually renders as reps/distance/rest in the athlete\'s app, description text alone is not enough. Leave empty only for easy/long_run/recovery/strength/rest/race. Usually ONE set object; use a second only for genuinely distinct blocks (e.g. a 2x(10x45/15) micro-interval session is 1 set with reps=10 and restAfterSet describing the 3min gap before repeating — do not create 2 sets for that, use reps and restAfterSet).',
      items: {
        type: 'object',
        required: ['reps'],
        properties: {
          reps: { type: 'number', enum: REP_COUNTS, description: 'number of repetitions of the SAME structure in this set, from the fixed list, e.g. 10 for "10x1000m". Use 1 if this set is a single non-repeating segment (see intervals[] below for alternating sequences).' },
          distanceMeters: { type: ['number', 'null'], enum: [...REP_DISTANCES_M, null], description: 'per rep, from the fixed list, e.g. 1000 for 1000m reps — use for distance-based reps like LT2 Short Intervals (10-12x1000m, 25x400m), hill repeats, race-pace intervals.' },
          durationSec: { type: ['number', 'null'], enum: [...REP_DURATIONS_SEC, null], description: 'per rep, from the fixed list, e.g. 360 for 6-minute reps, 45 for 45s micro-intervals — use for TIME-based reps like LT1 Long Intervals (5x6min, 4x8min are minutes-based, not distance-based — use durationSec=360/480, NOT distanceMeters), Norwegian 4x4 (durationSec=240), hill intervals (durationSec=35).' },
          restBetweenReps: { type: ['string', 'null'], description: 'e.g. "60s jog" — required whenever reps > 1 and intervals is empty' },
          restAfterSet: { type: ['string', 'null'], description: 'only for multi-set sessions, e.g. "3 min" between the two sets of a 2x(10x45/15) micro-interval session' },
          notes: { type: ['string', 'null'] },
          intervals: {
            type: 'array',
            description: 'Use ONLY for an ALTERNATING sequence of different segments within one repeating cycle (e.g. a Kenyan-style fartlek 1min hard / 1min easy / 2min hard) — each array entry is one distinct segment in order, and "reps" above is how many times the whole intervals[] sequence repeats. Leave empty for uniform reps (all reps identical) — use distanceMeters/durationSec on the set itself for those.',
            items: {
              type: 'object',
              properties: {
                distanceMeters: { type: ['number', 'null'], enum: [...REP_DISTANCES_M, null] },
                durationSec: { type: ['number', 'null'], enum: [...REP_DURATIONS_SEC, null] },
                notes: { type: ['string', 'null'], description: 'effort for this segment, e.g. "hard" / "easy" / "very easy jog"' },
              },
            },
          },
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
2. Pick the athlete's track (recreational_singles_3_to_4_runs / intermediate_5_to_7_runs / ambitious_elite) from athlete_context.daysPerWeek and weeklyMileage — never assign more quality sessions per week than that track allows, and never schedule two hard days back to back. If athlete_context.weekSchedule is given, it maps each weekday to what the athlete told you at onboarding: "off" = physically unavailable that day, always output type "rest" for it, zero exceptions; "rest" = their chosen recovery day; "workout"/"long_run"/"easy" = their preferred session type for that weekday — treat those as a strong preference, not an absolute rule (adjust if the phase genuinely needs otherwise).
3. block_request.stages tells you which journey phase(s) (base/build/peak/taper/race_week/recovery) this block's dates fall in, plus the target weekly volume for that phase — respect it. base = high volume, conservative Golden Zone work per foundational_principles; build = introduce Norwegian 4x4 / hill intervals; peak/taper per coaching_psychology_and_peaking.the_peaking_window; race_week = minimal, sharp, no risk. This 14-day block can span TWO stages if a phase transition falls inside it (check each stage's own startDate/endDate against each date you're generating) — apply EACH stage's own weeklyVolumeKm to the days that actually fall within it, don't blend or average the two. Before finalizing, sum the distance of every day in each calendar week (Mon-Sun or however the athlete's week is anchored) within this block and confirm each week's total lands close to its stage's weeklyVolumeKm — do not let the per-day numbers drift into a total noticeably higher or lower than the stage target.
4. On the FIRST block only (block_request.blockIndex === 0), use athlete_context.last3WeeksSummary and recentWorkouts to adjust the starting point: if avgEffort has been trending high, completed/skipped ratio is poor, or comments mention fatigue/pain, start conservatively. If the athlete has been completing everything comfortably, you may start at the stage's full target volume.
5. If athlete_context.injuryHistory is non-empty, be conservative for the whole season — prefer lower-impact sessions (treadmill note, hill over flat speed, micro-intervals over long reps) and mention it once in blockSummary on block 0. If athlete_context.coachNotes is non-empty, treat it as high-priority context from the coach — it can override or add nuance to any other field (e.g. a schedule quirk, a race history detail, something the coach specifically wants respected this season). athlete_context.currentShape is the athlete's own self-report of where they're at right now ("just_starting" / "returning" after a break / "consistent" / "peak_fitness" just off a race) — weigh it alongside last3WeeksSummary/recentWorkouts on block 0 specifically: "returning" or "just_starting" means start block 0 noticeably below the stage's nominal target even if last3WeeksSummary looks fine (it may be empty/stale for someone new to logging), "peak_fitness" means it's safe to trust the stage's full target from day one.
5b. BENCHMARKING WHEN NO LAB TEST: if athlete_context.physiology.hasLabTest is false, don't block on it — use the_physiological_hub.intensity_triangulation instead: HR (85-90% HRmax at threshold), talk test (3-5 words between breaths), RPE (6-7/10 "controlled discomfort"). Use athlete_context.personalRecords (most recent relevant race time) as the pace anchor if present. Still set bakkenLactateMin/Max from the brain as normal — the app will fall back to the coarse T1/T2/T3 pace band instead of a lab-precise one until a test exists. On block 0 only, add one sentence to blockSummary noting a lactate step test (see advanced_coaching_and_applied_science.lactate_profiling) would sharpen personalization — informational, not a blocker.
6. For every quality (non-easy, non-rest) workout, set bakkenLactateMin/bakkenLactateMax to the exact mmol/L range from the_golden_zone or workout_mechanics_and_first_principles for the workout you chose (e.g. Golden Zone sub-threshold = 2.3-3.0, LT1 long intervals AM = 2.0-2.5, LT2 short intervals PM = 3.0-3.5). For "rest" days, leave both null. For "easy"/"recovery" days, set bakkenLactateMin/bakkenLactateMax to 1.0-1.2 — well below LT1 (~1.5), genuinely easy, not "moderate". This is not inventing a number: it's the same brain-derived interpolation mechanism used for quality sessions, anchored below the brain's own LT1 definition, applied to give the athlete a real personalized easy pace instead of just a vague instruction. When athlete_context.physiology.hasLabTest is true this becomes a real lab-derived pace/HR band in the app; when false, the app falls back to the coarse guidance in the description text (rule 12) — never invent a specific pace number in the description text itself, only in bakkenLactateMin/Max via this mechanism.
7. LANGUAGE PURITY — write EVERY user-facing string (blockSummary, title, description, warmup, cooldown, notes, sets[].notes, intervals[].notes) ENTIRELY in the language given by athlete_context.language ("he" = Hebrew, "en" = English). Zero exceptions, zero mixing — if language is "he", there must not be a single English word, unit, or phrase anywhere in those strings: translate "min"→"דק׳", "sec"→"שנ׳", "jog"→"ריצה קלה", "strides"→"סטרייד/ריצות האצה", "easy"→"קל/ה", "walk"→"הליכה", etc. A Hebrew string with an English phrase embedded in it (e.g. "חימום: 15-20 min easy jogging") is WRONG and breaks the app's RTL rendering — write the whole sentence in Hebrew instead ("חימום: 15-20 דק׳ ריצה קלה"). This applies with the same strictness in the other direction when language is "en".
8. Cover every date from block_request.startDate to block_request.endDate inclusive, one entry per day (including rest days as type "rest", minimal fields) — respecting daysPerWeek for how many are actual sessions vs. rest/easy. Work out the day-of-week for each date correctly before checking it against weekSchedule.
9. If block_request.previousBlockTail is given, its LAST entry is the day immediately before block_request.startDate — you MUST NOT schedule the same type on block_request.startDate itself, and in particular NEVER schedule "long_run" on the first day of this block if the tail's last entry was also "long_run" (or any hard/quality session) — two hard days back to back, including across the block boundary, is a hard rule violation, not a style choice. More generally, don't repeat the same session structure on the day immediately following it anywhere in the block — vary the stimulus (e.g. don't follow a long-interval day with another near-identical one), and keep the same weekly rhythm (long run on the same weekday as prior blocks where sensible).
10. Valid "targetThresholdLevel": "T1" (~2.0-2.5 mmol/L app baseline), "T2" (~3.0-4.0 mmol/L app baseline), "T3" (~4.0-5.0 mmol/L app baseline), or null — a coarse fallback only used when the athlete has no lab test on file (athlete_context.physiology.hasLabTest = false). When a lab test exists, bakkenLactateMin/Max (rule 6) is what actually gets used to compute the athlete's real pace/HR targets; still set this field to whichever T-level is closest, for UI grouping.
11. DOUBLE THRESHOLD DAYS (workout_mechanics_and_first_principles.double_threshold) — ONLY when the athlete is on the ambitious_elite track (daysPerWeek >= 6 and experienceLevel advanced/professional, or the current stage explicitly calls for it): pick at most 2 non-consecutive days per week (e.g. Tue/Thu, per training_structures_by_level.ambitious_elite.standard_week) and emit TWO separate workout objects that share the exact same "date" — one with session "am" (longer repeats, lower lactate ~2.0-2.5 mmol/L, e.g. 5x6min or 4x10min) and one with session "pm" (shorter repeats, higher lactate ~3.0-3.5 mmol/L, e.g. 10-12x1000m or 25x400m). Never do this for recreational or intermediate tracks — they get exactly one workout object per date, session "other".
12. PER-TYPE CONTENT REQUIREMENTS — every workout of every type must be fully specified, not just intervals/tempo:
    - "easy" / "recovery": distance and/or duration filled, bakkenLactateMin/Max set per rule 6 (1.0-1.2), description states the effort explicitly ("easy, conversational, under 70% HRmax — when in doubt, run slower, not faster" per foundational_principles.principle_4_easy_is_sacred), sets empty.
    - "long_run": distance and duration filled. If athlete_context.longRunMinutes is set, no long run this season should exceed it — pick duration at or below that cap, distance follows from pace, not the other way around. If athlete_context.goalRaceDistance is "marathon" and this block is in build/peak phase, embed a marathon-pace segment per distance_specific_adjustments.marathon.long_runs (e.g. "final 8-10km at goal marathon pace") described in notes — as its own set entry (reps:1, distanceMeters for that segment) if it has a distinct pace, otherwise in notes text. Otherwise sets stays empty.
    - "tempo" / "threshold" / "intervals": sets MUST be non-empty and match a standard_workouts entry or workout_mechanics_and_first_principles structure — use durationSec for TIME-based reps (LT1 Long Intervals: 5x6min → durationSec=360, or 4x8min → durationSec=480) and distanceMeters for DISTANCE-based reps (LT2 Short Intervals: 10-12x1000m → distanceMeters=1000, or 25x400m → distanceMeters=400; Norwegian 4x4 → durationSec=240 with restBetweenReps "3 min active recovery"). Never leave both null on a real interval. bakkenLactateMin/Max and targetThresholdLevel set per rule 6/10.
    - "hill_repeats": sets MUST be non-empty, e.g. 24x35s uphill → durationSec=35, restBetweenReps "jog back down".
    - "fartlek": give the title a real variant name, not just "Fartlek" (e.g. "Kenyan Fartlek 1-1-2", "45/15 Micro-Interval Fartlek"). Two valid structures — pick the one matching the variant: (a) UNIFORM micro-intervals (workout_mechanics_and_first_principles.micro_intervals_45_15) → one set, reps 15-35 by level, durationSec=45, restBetweenReps "15s float", use "sets" plain fields, intervals empty; (b) ALTERNATING Kenyan-style fartlek (different segment lengths/efforts in a repeating cycle, e.g. 1min hard / 1min easy / 2min hard / 1min easy) → one set with reps = number of times the cycle repeats, and intervals[] populated with each distinct segment in order (durationSec + notes stating hard/easy/very easy for each). Do not describe an alternating fartlek only in prose — it must be in intervals[], that's what actually renders correctly to the athlete.
    - "strength": sets empty, description/notes lists 2-4 exercises from muscular_state_and_strength.strength_training.core_exercises.
    - "rest": duration/distance/sets all null/empty, description brief.
13. comparisonGroup + thresholdDistance: set comparisonGroup on every quality workout (tempo/threshold/intervals/hill_repeats/fartlek/long_run) so the coach can track this exact session type's pace/HR trend over the season in the app's lab view — reuse the identical string every time the same structure recurs (e.g. every "Golden Zone Intervals 5x6min" session across every block gets comparisonGroup "Golden Zone 5x6min"). Set thresholdDistance to the rep distance in meters when sets use a uniform distanceMeters, else null.

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
// Fixed weekly-volume steps (5km granularity, 10-220km covers recreational
// through elite) — same "fixed numbers over open field" reasoning as the
// per-workout schema above.
const WEEKLY_KM_VALUES = Array.from({ length: 43 }, (_, i) => 10 + i * 5)

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
              weeklyVolumeKm: { type: 'number', enum: WEEKLY_KM_VALUES, description: 'km, from the fixed list (5km steps)' },
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
2. Use distance_specific_adjustments for athlete_context.goalRaceDistance to decide how much of the season is base vs. build vs. race-specific work — a marathon needs more base and marathon-pace-in-long-run work; a 5K/10K needs more race-pace/VO2max sharpening near the end. brain_reference_data only has explicit distance_specific_adjustments for "5k"/"10k"/"half_marathon"/"marathon" — for "1500m"/"mile"/"3000m" (shorter, more anaerobic/speed-weighted — lean toward the 5k_to_10k guidance but with even sharper race-pace/VO2max work and less volume) or "15k" (treat as between 10k and half_marathon guidance) apply the closest brain guidance by extension of the same underlying principles, don't invent a distance-specific rule that isn't grounded in the brain's actual logic for a neighboring distance.
3. Base phase gets the largest share of skeleton_request.totalWeeksAvailable once the peaking window is subtracted — high volume, conservative Golden Zone work per foundational_principles, minimal intensity variety.
4. Build phase introduces Norwegian 4x4 / hill intervals per workout_mechanics_and_first_principles.
5. weeklyVolumeKm must ramp sensibly from skeleton_request.currentWeeklyKm toward a believable peak — respect safety_guardrails-equivalent caution: don't ramp faster than ~10%/week on average between consecutive stages. currentWeeklyKm is already the athlete's real recent average when they have logged training history (see athlete_context.last3WeeksSummary for the detail behind that number) — trust it as the true starting point, don't second-guess it upward. If last3WeeksSummary shows a poor completion rate or high avgEffort even at that volume, start the base stage's weeklyVolumeKm AT OR BELOW currentWeeklyKm rather than immediately ramping up. Taper/race_week volumes drop well below peak. Use skeleton_request.peakWeeklyKmHint as a hint if given, but override it if the athlete's actual data (experience level, current volume, injury history) suggests it's unrealistic.
6. If athlete_context.experienceLevel is 'beginner' or daysPerWeek <= 4 (recreational_singles_3_to_4_runs track), keep the skeleton simpler — fewer, longer phases rather than many short ones.
7. If athlete_context.injuryHistory is non-empty, lengthen base relative to build/peak and keep the volume ramp more conservative. If athlete_context.coachNotes is non-empty, factor it in too — it's the coach's own high-priority context for this specific athlete.
8. The "weeks" field of every stage MUST be a positive integer, and the sum across all stages MUST equal skeleton_request.totalWeeksAvailable exactly.
9. keyWorkouts per stage: pick from the valid workout types, only the ones that actually define this phase (e.g. base might be just ["easy","long_run","tempo"]; build adds ["intervals","hill_repeats"]; peak/race_week narrows back down).
10. Write title and focus strings ENTIRELY in the language given by athlete_context.language ("he" = Hebrew, "en" = English) — no mixed-language words or phrases, translate every term including units.

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
