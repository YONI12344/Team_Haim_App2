import type Anthropic from '@anthropic-ai/sdk'
import { WORKOUT_ITEM_SCHEMA } from '@/lib/ai-coach-brain/plan-schema'

/**
 * Tools the coach's AI assistant can call. Definitions only — the server
 * route (app/api/ai-coach/agent) sends them to Claude, and the coach's
 * browser executes them (lib/ai-coach/agent-executors.ts) with the coach's
 * own Firestore permissions, so nothing here needs a server credential.
 *
 * Order and content are fixed: tools render first in the prompt, so any
 * change here invalidates the cached brain for every athlete's thread.
 */

// A workout in the exact shape the season pipeline writes, minus the
// block-range wording in the date description.
const WORKOUT_SCHEMA = {
  ...WORKOUT_ITEM_SCHEMA,
  properties: {
    ...WORKOUT_ITEM_SCHEMA.properties,
    date: { type: 'string', description: 'yyyy-MM-dd' },
  },
}

const DATE = { type: 'string', description: 'yyyy-MM-dd' } as const

export const AGENT_TOOLS: Anthropic.Tool[] = [
  {
    name: 'get_athlete_profile',
    description:
      "The athlete's profile: goal race, PRs, experience, weekly mileage, weekly availability (weekSchedule), long-run day, injury history, physiology (T1/T2/T3 paces/HR), the coach's private notes, and language.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_workouts',
    description:
      "Every workout on the athlete's schedule in a date range (past and future), each with its full plan (type, title, distance, sets, targets) and — when the athlete logged it — their log: actual distance/pace/duration, effort 1-10, comment, per-rep splits (pace, HR, lactate, rest), Strava HR/elevation. Also returns unplanned activities the athlete logged. Max range 180 days.",
    input_schema: {
      type: 'object',
      required: ['from', 'to'],
      properties: { from: DATE, to: DATE },
      additionalProperties: false,
    },
  },
  {
    name: 'get_lab_tests',
    description: "The athlete's lactate step tests and spot lactate readings, newest first.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'get_season_plan',
    description: "The athlete's current AI season (journey): phases with dates, focus, weekly volume and key workouts.",
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'generate_season_plan',
    description:
      "Runs the full season pipeline (periodized skeleton from the goal race, then ~14-day blocks from the brain, with deterministic safety backstops) and writes the workouts to the athlete's schedule. Continues the existing season from where it stops unless restart is true. restart=true DELETES every previously AI-generated workout for this athlete and rebuilds from next Sunday — confirm with the coach first. Takes a few minutes.",
    input_schema: {
      type: 'object',
      required: ['target'],
      properties: {
        target: {
          type: 'string',
          enum: ['current_stage', 'whole_season', 'base', 'build', 'peak', 'taper', 'race_week'],
          description: 'How far to generate: finish the current phase, the whole season through the goal race, or through a specific phase.',
        },
        restart: { type: 'boolean', description: 'Wipe previous AI-generated workouts and rebuild the season from scratch.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'create_workouts',
    description: "Adds workouts to the athlete's schedule. Each one becomes a normal workout the coach can edit and the athlete sees (within their visibility window).",
    input_schema: {
      type: 'object',
      required: ['workouts'],
      properties: { workouts: { type: 'array', minItems: 1, maxItems: 21, items: WORKOUT_SCHEMA } },
      additionalProperties: false,
    },
  },
  {
    name: 'update_workout',
    description:
      'Changes one scheduled workout (by assignedWorkoutId from get_workouts): move it (date), or replace its content. Fields you pass replace the old ones; fields you omit stay. Completed workouts cannot be changed.',
    input_schema: {
      type: 'object',
      required: ['assignedWorkoutId'],
      properties: {
        assignedWorkoutId: { type: 'string' },
        date: DATE,
        changes: {
          type: 'object',
          description: 'Any subset of the workout fields (type, title, description, distance, duration, warmup, cooldown, notes, sets, targetThresholdLevel, bakkenLactateMin/Max, comparisonGroup, session).',
          properties: WORKOUT_ITEM_SCHEMA.properties,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'delete_workouts',
    description: "Removes workouts from the athlete's schedule by assignedWorkoutId. Only workouts that aren't completed can be removed. Confirm with the coach first.",
    input_schema: {
      type: 'object',
      required: ['assignedWorkoutIds'],
      properties: { assignedWorkoutIds: { type: 'array', minItems: 1, items: { type: 'string' } } },
      additionalProperties: false,
    },
  },
  {
    name: 'update_plan_settings',
    description:
      "Updates the athlete's planning settings that the season pipeline reads. Only pass what the coach asked to change.",
    input_schema: {
      type: 'object',
      properties: {
        weekSchedule: {
          type: 'object',
          description: 'Per weekday: "workout" (can train), "rest" (planned rest), "off" (unavailable).',
          properties: Object.fromEntries(
            ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'].map((d) => [
              d,
              { type: 'string', enum: ['workout', 'rest', 'off'] },
            ]),
          ),
        },
        longRunDay: { type: 'string', enum: ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] },
        weeklyMileage: { type: 'number', description: 'Current weekly km the season should start from.' },
        goalRaceEvent: { type: 'string' },
        goalRaceDistance: { type: 'string', enum: ['1500m', 'mile', '3000m', '5k', '10k', '15k', 'half_marathon', 'marathon'] },
        goalRaceDate: DATE,
        goalRaceTarget: { type: 'string', description: 'Target finish time, e.g. "1:35:00".' },
        coachNotes: { type: 'string', description: "Replaces the coach's private notes for this athlete (the plan generator reads them)." },
      },
      additionalProperties: false,
    },
  },
]

export type AgentToolName =
  | 'get_athlete_profile'
  | 'get_workouts'
  | 'get_lab_tests'
  | 'get_season_plan'
  | 'generate_season_plan'
  | 'create_workouts'
  | 'update_workout'
  | 'delete_workouts'
  | 'update_plan_settings'

/** Tools that change the athlete's schedule — the UI refreshes the calendar after these. */
export const SCHEDULE_WRITING_TOOLS: AgentToolName[] = [
  'generate_season_plan',
  'create_workouts',
  'update_workout',
  'delete_workouts',
]
