// Output contract for plan generation: the athlete_context / block /
// skeleton request shapes and the tool schemas the model must answer with.
// Pure schema code — no brain content lives here (the 18-chapter brain is
// master-brain.json, wired in by plan-prompt.ts).
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
  // Coach preference — which weekday the long run must fall on, every week
  // of the season. A hard rule (see rule 2 in buildBlockSystemPrompt), not
  // a suggestion — unlike weekSchedule, which is only a strong preference.
  longRunDay?: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
  // Coach-only free text (AthleteProfile.coachPrivateNotes, never shown to
  // the athlete) — the coach's own catch-all for anything the brain should
  // know about this specific athlete that doesn't fit another field:
  // schedule quirks, gear, personality, race history detail, etc.
  coachNotes?: string
  goalRaceEvent?: string
  goalRaceDistance?: '1500m' | 'mile' | '3000m' | '5k' | '10k' | '15k' | 'half_marathon' | 'marathon'
  goalRaceDate?: string
  goalRaceTarget?: string
  // Optional mid-season tune-up race/time trial — NOT the goal race. See
  // rule 5e in buildBlockSystemPrompt: gets a short light taper before it,
  // then the season's normal plan resumes right after.
  testRaceEvent?: string
  testRaceDistance?: string
  testRaceDate?: string
  // Athlete's own read on where they're at right now — a self-report signal
  // for the brain alongside (not instead of) recentWorkouts/last3WeeksSummary.
  currentShape?: 'just_starting' | 'returning' | 'consistent' | 'peak_fitness'
  // Recent race results (AthleteProfile.personalRecords) — the best pace
  // anchor available when there's no lab test on file.
  personalRecords?: Array<{ event: string; time: string; date: string }>
  // Extended intake from the 18-chapter brain's onboarding (collected by
  // components/athlete/athlete-onboarding.tsx, stored on the profile under
  // the same names). All optional; the block prompt's EXTENDED ONBOARDING
  // SIGNALS section says how each one shifts the plan.
  age?: number
  weeklyTrainingHours?: number
  muscleFiberLeaning?: 'fast_explosive' | 'endurance' | 'in_between'
  occupationalPhysicalDemand?: 'sedentary' | 'on_feet' | 'physically_demanding'
  injuryHistoryDetail?: Array<'none' | 'recurring_asymmetric' | 'stress_fracture_history' | 'low_bone_density' | 'currently_nursing'>
  accessToLactateMeter?: 'have_one' | 'considering' | 'not_planning'
  thresholdTestingMethod?: 'lactate_meter' | 'recent_race' | 'max_hr_talk_test' | 'not_sure'
  priorTrainingInterruptions?: 'no' | 'once' | 'multiple_times'
  labMarkersKnown?: Array<'ferritin' | 'vitamin_d' | 'b12' | 'none_checked' | 'not_sure'>
  menstrualCycleTracking?: 'yes' | 'no' | 'not_applicable'
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
  // Coach-set fixed sessions (AthleteProfile.recurringActivities) that must
  // appear every week (or every other week) regardless of season phase —
  // a standing gym/yoga/cross-training slot the coach set once. See rule 2c
  // in buildBlockSystemPrompt.
  recurringActivities?: Array<{
    dayOfWeek: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
    frequency: 'every_week' | 'every_other_week'
    type: string
    title: string
    notes?: string
  }>
  // One-off calendar events (AthleteProfile.specialEvents) — a flight,
  // wedding, exam, anything non-recurring that isn't the goal/prep race.
  // See rule 2d in buildBlockSystemPrompt.
  specialEvents?: Array<{
    date: string
    label: string
    notes?: string
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
  // Coach-defined weekday -> workout-type skeleton for THIS stage type
  // (AthleteProfile.stageDayTypeTemplates[stage.type]) — when a weekday is
  // listed here, that EXACT type goes on that weekday every week this
  // stage is active; days not listed stay the AI's own call. See rule 2c.
  // A day's value is one of three shapes:
  //   string        — this exact type, every week the stage is active
  //   string[] (≤2) — TWO sessions this SAME day, every week (e.g. lift + easy run)
  //   { rotateWeekly: string[] } — ONE type per week, cycling through the
  //     list (week 1 of this stage instance = list[0], week 2 = list[1],
  //     wrapping around) — covers both "alternate fartlek/hills weekly"
  //     and "every other week X vs Y" (a 2-element rotation IS every-other-week).
  dayTypeTemplate?: Partial<Record<'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday', string | string[] | { rotateWeekly: string[] }>>
}

export interface BlockRequest {
  blockIndex: number
  totalBlocks: number
  startDate: string // yyyy-MM-dd, inclusive
  endDate: string // yyyy-MM-dd, inclusive (block is <= 14 days)
  seasonStartDate: string // yyyy-MM-dd — day 1 of the whole season/journey (stages[0].startDate); used to prorate a short first calendar week if this isn't a Sunday, see rule 3
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
  'recovery', 'strength', 'stretch', 'cross_training', 'swim', 'bike', 'rest', 'race', 'time_trial', 'threshold',
]

// Fixed value sets instead of open numbers — picked from what actually
// appears throughout <brain_reference_data> (track-distance rep menu,
// double threshold, etc.) plus round real-world training numbers. This
// keeps the model choosing from realistic, consistent values instead of
// drifting toward odd precise numbers (837m, 43min), and reads cleaner
// for the athlete than arbitrary decimals.
const REP_COUNTS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 16, 20, 24, 25, 30, 35, 40]
const REP_DISTANCES_M = [200, 300, 400, 600, 800, 1000, 1200, 1500, 1600, 2000, 3000, 5000]
const REP_DURATIONS_SEC = [15, 20, 30, 35, 45, 60, 90, 120, 180, 240, 300, 360, 420, 480, 600]
const TOTAL_DISTANCES_KM = [
  2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21.1, 22, 24, 25, 26, 28, 30, 32, 34, 35, 38, 40, 42.2, 45,
]
const TOTAL_DURATIONS_MIN = [10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 135, 150, 165, 180]
// Every lactate value that actually appears in brain.json's sub-threshold
// system — target_lactate_ceilings' 1.8-2.3 (AM/morning/long-rep) through
// 2.5-3.5 (PM/evening/short-rep) range, plus the intermediate rep-length
// buckets from golden_zone_concept (rule 6b), and the 4.0 absolute upper
// limit as a safety-ceiling value. VO2max/race-pace work gets null (rule
// 6) rather than a number above this — nothing invented past what the
// brain actually states. 1.0/1.2 for genuinely easy/recovery pace
// anchoring, well below the whole sub-threshold system — see rule 6.
const LACTATE_VALUES = [1.0, 1.2, 1.8, 2.0, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 3.0, 3.2, 3.5, 4.0]

export const WORKOUT_ITEM_SCHEMA = {
  type: 'object',
  required: ['date', 'type', 'title', 'description', 'duration', 'distance'],
  properties: {
    date: { type: 'string', description: 'yyyy-MM-dd, must fall within the requested block date range' },
    session: {
      type: 'string',
      enum: ['am', 'pm', 'other'],
      description: '"am"/"pm" on ANY day with two separate workout objects sharing the same date — a quality double-threshold day (rule 11) OR a level_id 3 elite day with two easy/recovery runs (morning + evening) on a non-quality day. Never leave two same-date entries both as "other"/unset — that\'s ambiguous and the app can\'t tell them apart. A day with exactly ONE session uses "other".',
    },
    type: { type: 'string', enum: WORKOUT_TYPES },
    title: {
      type: 'string',
      description: 'A short real workout name in this coach\'s own style, per the yoni_haim_coaching_philosophy sections of the brain (e.g. "ריצה קלה", "קלה 7/1", "ריצה ארוכה מתפתחת", "T2 Threshold 10x1000m", "אימון עליות", "2 ד\' / 1 ד\'"). NEVER a generic/numeric label like "Week 1", "Day 3", "Session 2", "אימון 1", "שבוע 2" — those describe the calendar position, not the workout itself, and this coach never names sessions that way.',
    },
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
    distance: { type: ['number', 'null'], enum: [...TOTAL_DISTANCES_KM, null], description: 'km, from the fixed list (42.2 is there for marathon race day) — REQUIRED (non-null) for every running type (easy/long_run/tempo/intervals/hill_repeats/fartlek/threshold/recovery/race/time_trial) except "rest"/"strength"/"stretch"/"cross_training".' },
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
      description: 'REQUIRED non-empty for tempo/intervals/hill_repeats/threshold/fartlek — this is what actually renders as reps/distance/rest in the athlete\'s app, description text alone is not enough. Leave empty for long_run/recovery/strength/rest/race, and for "easy" EXCEPT the absolute-beginner run/walk case (see rule 5c) which also needs sets[] populated. Usually ONE set object; use a second only for genuinely distinct blocks (e.g. a 2x(10x45/15) micro-interval session is 1 set with reps=10 and restAfterSet describing the 3min gap before repeating — do not create 2 sets for that, use reps and restAfterSet).',
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


export function buildSkeletonUserMessage(athlete: PlanAthleteContext, skeleton: SkeletonRequest): string {
  return `Design the season skeleton. Call submit_season_skeleton with the result.

athlete_context = ${JSON.stringify(athlete, null, 2)}

skeleton_request = ${JSON.stringify(skeleton, null, 2)}`
}
