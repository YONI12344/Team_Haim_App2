import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { format, addDays, parseISO } from 'date-fns'
import {
  buildBlockSystemPrompt, buildBlockToolDefinition, buildBlockUserMessage,
  buildSkeletonSystemPrompt, buildSkeletonToolDefinition, buildSkeletonUserMessage,
  type PlanAthleteContext, type BlockRequest, type BlockStageInfo,
} from '@/lib/bakken/plan-prompt'
import {
  normalizeInvalidTypes, enforceWeekSchedule, enforceAmPmOrder, enforceSameDaySessionTags,
  enforceNoBackToBackBigDays, enforceLongRunDay, normalizeWeeklyVolume,
  type DayKey, type BlockWorkoutOut,
} from '@/lib/bakken/backstops'

// Generates a real 2-week example using whatever brain.json/coach-voice.json/
// safety-rules.json currently say on disk — the exact same pipeline
// production uses (prompt-building + every deterministic backstop), so
// what you see here is what an athlete would actually get. Local-only,
// same reasoning as app/api/dev/brain-editor/files/route.ts.
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-5'
const addDaysStr = (dateStr: string, n: number) => format(addDays(parseISO(dateStr), n), 'yyyy-MM-dd')

const PROFILES: Record<string, { athlete: PlanAthleteContext; label: string }> = {
  beginner: {
    label: 'Beginner (absolute, 0km, 5k goal)',
    athlete: {
      name: 'Preview Athlete', experienceLevel: 'beginner', daysPerWeek: 3,
      weekSchedule: { sunday: 'off', monday: 'workout', tuesday: 'off', wednesday: 'workout', thursday: 'off', friday: 'off', saturday: 'workout' },
      weeklyMileage: 0, currentShape: 'just_starting',
      goalRaceEvent: 'Fun 5k', goalRaceDistance: '5k', goalRaceDate: '2027-01-01',
      physiology: { hasLabTest: false }, last3WeeksSummary: { week1: null, week2: null, week3: null }, recentWorkouts: [], language: 'he',
    },
  },
  recreational: {
    label: 'Recreational (25km/wk, 10k goal)',
    athlete: {
      name: 'Preview Athlete', experienceLevel: 'intermediate', daysPerWeek: 4,
      weekSchedule: { sunday: 'workout', monday: 'off', tuesday: 'workout', wednesday: 'off', thursday: 'workout', friday: 'off', saturday: 'workout' },
      weeklyMileage: 25, currentShape: 'consistent',
      goalRaceEvent: 'City 10k', goalRaceDistance: '10k', goalRaceDate: '2026-11-15',
      physiology: { hasLabTest: false }, last3WeeksSummary: { week1: null, week2: null, week3: null }, recentWorkouts: [], language: 'he',
      longRunDay: 'saturday',
    },
  },
  intermediate: {
    label: 'Intermediate (45km/wk, half marathon goal)',
    athlete: {
      name: 'Preview Athlete', experienceLevel: 'intermediate', daysPerWeek: 5,
      weekSchedule: { sunday: 'workout', monday: 'off', tuesday: 'workout', wednesday: 'workout', thursday: 'off', friday: 'workout', saturday: 'workout' },
      weeklyMileage: 45, currentShape: 'consistent',
      goalRaceEvent: 'City Half', goalRaceDistance: 'half_marathon', goalRaceDate: '2026-12-01',
      physiology: { hasLabTest: false }, last3WeeksSummary: { week1: null, week2: null, week3: null }, recentWorkouts: [], language: 'he',
      longRunDay: 'saturday', longRunMinutes: 110,
    },
  },
  advanced: {
    label: 'Advanced (70km/wk, marathon goal)',
    athlete: {
      name: 'Preview Athlete', experienceLevel: 'advanced', daysPerWeek: 6,
      weekSchedule: { sunday: 'workout', monday: 'workout', tuesday: 'workout', wednesday: 'workout', thursday: 'off', friday: 'workout', saturday: 'workout' },
      weeklyMileage: 70, currentShape: 'consistent',
      goalRaceEvent: 'City Marathon', goalRaceDistance: 'marathon', goalRaceDate: '2027-03-01',
      physiology: { hasLabTest: false }, last3WeeksSummary: { week1: null, week2: null, week3: null }, recentWorkouts: [], language: 'he',
      longRunDay: 'sunday', longRunMinutes: 150,
    },
  },
  elite: {
    label: 'Elite (double-threshold, 100km/wk, 10k goal)',
    athlete: {
      name: 'Preview Athlete', experienceLevel: 'professional', daysPerWeek: 7,
      weekSchedule: { sunday: 'workout', monday: 'workout', tuesday: 'workout', wednesday: 'workout', thursday: 'workout', friday: 'workout', saturday: 'workout' },
      weeklyMileage: 100, currentShape: 'peak_fitness',
      goalRaceEvent: 'National 10k Championship', goalRaceDistance: '10k', goalRaceDate: '2026-11-01',
      physiology: { hasLabTest: false }, last3WeeksSummary: { week1: null, week2: null, week3: null }, recentWorkouts: [], language: 'he',
      longRunDay: 'sunday',
    },
  },
}

function guardDev() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'The brain editor only works when running locally (npm run dev), not on the deployed site.' }, { status: 403 })
  }
  return null
}

const BIG_TYPES = new Set(['long_run', 'tempo', 'threshold', 'intervals', 'hill_repeats', 'fartlek'])
function analyzeIssues(workouts: BlockWorkoutOut[]): string[] {
  const issues: string[] = []
  const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date))
  for (let i = 1; i < sorted.length; i++) {
    const gap = Math.round((parseISO(sorted[i].date).getTime() - parseISO(sorted[i - 1].date).getTime()) / 86400000)
    if (gap === 1 && BIG_TYPES.has(sorted[i - 1].type) && BIG_TYPES.has(sorted[i].type)) {
      issues.push(`Back-to-back big days: ${sorted[i - 1].date} [${sorted[i - 1].type}] -> ${sorted[i].date} [${sorted[i].type}]`)
    }
  }
  for (const w of sorted) {
    if (w.type !== 'rest' && w.duration == null) issues.push(`Missing duration: ${w.date} [${w.type}] "${w.title}"`)
  }
  return issues
}

export async function POST(req: NextRequest) {
  const guard = guardDev()
  if (guard) return guard
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || ''
    if (!apiKey) return NextResponse.json({ error: 'No ANTHROPIC_API_KEY set' }, { status: 500 })

    const { profileKey } = (await req.json()) as { profileKey: string }
    const profile = PROFILES[profileKey]
    if (!profile) return NextResponse.json({ error: `Unknown profile "${profileKey}"` }, { status: 400 })

    const anthropic = new Anthropic({ apiKey })
    const seasonStart = format(addDays(new Date(), (7 - new Date().getDay()) % 7 || 7), 'yyyy-MM-dd') // next Sunday

    // 1. Skeleton
    const skeletonTool = buildSkeletonToolDefinition()
    const skeletonRes = await anthropic.messages.create({
      model: MODEL, max_tokens: 8000, system: buildSkeletonSystemPrompt(),
      messages: [{ role: 'user', content: buildSkeletonUserMessage(profile.athlete, { totalWeeksAvailable: 20, currentWeeklyKm: profile.athlete.weeklyMileage || 20 }) }],
      tools: [skeletonTool], tool_choice: { type: 'tool', name: skeletonTool.name },
    })
    const skeletonToolUse = skeletonRes.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
    let skeletonInput = skeletonToolUse?.input as { title?: unknown; stages?: unknown } | undefined
    if (skeletonInput && typeof skeletonInput.stages === 'string') {
      try {
        const unwrapped = JSON.parse(skeletonInput.stages)
        if (unwrapped && Array.isArray(unwrapped.stages)) skeletonInput = { title: unwrapped.title, stages: unwrapped.stages }
      } catch { /* fall through */ }
    }
    if (!skeletonInput || !Array.isArray(skeletonInput.stages) || skeletonInput.stages.length === 0) {
      return NextResponse.json({ error: 'Skeleton generation failed — try again' }, { status: 500 })
    }
    const rawStages = skeletonInput.stages as Array<{ name: string; type: string; weeks: number; focus?: string; weeklyVolumeKm: number }>

    let cursor = seasonStart
    const stages: BlockStageInfo[] = rawStages.map((s) => {
      const end = addDaysStr(cursor, s.weeks * 7 - 1)
      const stage: BlockStageInfo = { type: s.type, name: s.name, focus: s.focus, weeklyVolumeKm: s.weeklyVolumeKm, startDate: cursor, endDate: end }
      cursor = addDaysStr(end, 1)
      return stage
    })

    // 2. One 14-day block
    const blockEnd = addDaysStr(seasonStart, 13)
    const stagesForBlock = stages.filter((s) => s.startDate <= blockEnd && s.endDate >= seasonStart)
    const block: BlockRequest = {
      blockIndex: 0, totalBlocks: 1, startDate: seasonStart, endDate: blockEnd,
      seasonStartDate: seasonStart, stages: stagesForBlock,
    }
    const blockTool = buildBlockToolDefinition()
    const blockRes = await anthropic.messages.create({
      model: MODEL, max_tokens: 16000, system: buildBlockSystemPrompt(),
      messages: [{ role: 'user', content: buildBlockUserMessage(profile.athlete, block) }],
      tools: [blockTool], tool_choice: { type: 'tool', name: blockTool.name },
    })
    const blockToolUse = blockRes.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use')
    if (!blockToolUse) return NextResponse.json({ error: 'Block generation failed — no tool_use in response' }, { status: 500 })
    const workouts = (blockToolUse.input as { workouts: BlockWorkoutOut[] }).workouts

    // 3. Same backstops production uses
    normalizeInvalidTypes(workouts, profile.athlete.language)
    enforceWeekSchedule(workouts, profile.athlete.weekSchedule as Record<DayKey, 'workout' | 'rest' | 'off'>, profile.athlete.language)
    enforceAmPmOrder(workouts)
    enforceLongRunDay(workouts, profile.athlete.longRunDay as DayKey | undefined, profile.athlete.language)
    enforceNoBackToBackBigDays(workouts, undefined, profile.athlete.longRunDay as DayKey | undefined, profile.athlete.language)
    enforceSameDaySessionTags(workouts)
    normalizeWeeklyVolume(workouts, stagesForBlock, seasonStart, '2099-01-01', profile.athlete.longRunMinutes, profile.athlete.experienceLevel)

    return NextResponse.json({
      skeleton: { title: skeletonInput.title, stages: rawStages },
      workouts: workouts.sort((a, b) => a.date.localeCompare(b.date)),
      issues: analyzeIssues(workouts),
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function GET() {
  const guard = guardDev()
  if (guard) return guard
  return NextResponse.json({ profiles: Object.entries(PROFILES).map(([key, p]) => ({ key, label: p.label })) })
}
