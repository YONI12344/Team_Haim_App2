// The TeamHaim brain run on one athlete's app data, for the coach-only AI Coach page.
//   analyze -> decisions + free calibration week (no AI, $0)
//   ask     -> the coach asks about the athlete (AI, key points of the relevant chapters)
//   build   -> the coach asks for a new plan or a rebuild (AI, full science of the plan's chapters)
//   edit    -> a small change to the current plan (cheaper model, no science, only the changed days come back)
// Server-only. Never writes to Firestore: the coach exports plans from the page.

import Anthropic from '@anthropic-ai/sdk'
import { parseKm, runPipeline } from './pipeline'
import { buildCalibration } from './calibration'
import { allDays, normalizePlan, type BrainPlan } from './plan'
import { pyRound } from './paces'
import { enforceAll, isRecoveryWeek, progressionCycle, rulesText, volumeCeiling, VOLUME_LAWS } from './enforce'
import { type AthleteSnapshot, contextText, toBrainProfile } from './athlete-context'
import { ADAPTIVE_PROTOCOL, chapterIndexText, chapterScience, compactChapter, routeChapters, seasonChapters } from './brain'
import { ASK_TAIL, BUILD_TAIL, EDIT_TAIL, METHOD_GUARDRAILS, PERSONA, PLAN_RULES, PLAN_SCHEMA, PLAN_SCHEMA_DAY } from './prompts'

export const BRAIN_MODEL = process.env.HAIM_BRAIN_MODEL || 'claude-opus-5'
// Small changes to an existing plan: a cheaper model, since the rules are re-checked in code afterwards.
export const EDIT_MODEL = process.env.HAIM_EDIT_MODEL || 'claude-sonnet-5'
// USD per million tokens: input, output. Cache reads bill at 10% of input, cache writes at 125%.
const PRICING: Record<string, [number, number]> = { 'claude-opus-5': [5, 25], 'claude-sonnet-5': [3, 15], 'claude-haiku-4-5': [1, 5] }
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export interface CoachRequest {
  action: 'analyze' | 'ask' | 'build' | 'edit'
  snapshot: AthleteSnapshot
  startDate?: string
  message?: string
  messages?: { role: 'user' | 'assistant'; content: string }[]
  plan?: BrainPlan
}

export class CoachAIError extends Error {
  constructor(message: string, public status = 400) { super(message) }
}

function parseDay(ds: unknown): Date | null {
  const m = String(ds || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null
}

function calendarText(start: Date): string {
  const lines = ['Week 1:']
  for (let i = 0; i < 7; i++) {
    const d = new Date(start); d.setDate(d.getDate() + i)
    lines.push(`  Day ${i + 1} = ${WEEKDAYS[(d.getDay() + 6) % 7]} ${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
  }
  return lines.join('\n') + '\n(Later weeks continue in the same 7-day rhythm.)'
}

function extractJson(text: string): any {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start === -1 || end === -1) return null
  try { return JSON.parse(text.slice(start, end + 1)) } catch { return null }
}

function costOf(usage: Anthropic.Usage, model = BRAIN_MODEL): number {
  const [inP, outP] = PRICING[model] || PRICING['claude-opus-5']
  const cached = usage.cache_read_input_tokens || 0
  const written = usage.cache_creation_input_tokens || 0
  return (usage.input_tokens * inP + cached * inP * 0.1 + written * inP * 1.25 + usage.output_tokens * outP) / 1_000_000
}

export async function runCoachAI(req: CoachRequest, apiKey = process.env.ANTHROPIC_API_KEY) {
  const { action, snapshot } = req
  if (!snapshot?.profile || !['analyze', 'ask', 'build', 'edit'].includes(action)) throw new CoachAIError('Pick an athlete first.')
  const start = parseDay(req.startDate) || parseDay(snapshot.today) || new Date()
  const profile = toBrainProfile(snapshot)
  const pipeline = runPipeline(profile)

  if (action === 'analyze') {
    const cal = buildCalibration(profile, pipeline.trace[2].result, pipeline.planRequest.category, start)
    return { profile, choices: pipeline.choices, trace: pipeline.trace, calibration: normalizePlan(cal, start, 1), cost: 0 }
  }

  if (!apiKey) throw new CoachAIError('No ANTHROPIC_API_KEY on the server.', 500)
  const history = (req.messages || [])
    .filter((m) => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string')
    .slice(-12)
    .map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }))
  const message = String(req.message || '').trim().slice(0, 4000)
  if (!message) throw new CoachAIError('Write a message first.')

  // Volume starting point and the longest recent run, for the volume law. A calibration week on the page
  // counts as recent training when the app has no weekly km.
  const calKms = req.plan?.template ? allDays(req.plan).map((d) => d.km).filter((k): k is number => typeof k === 'number') : []
  const loggedKm = parseKm(profile.weekly_mileage)
  const [baseline, baselineSrc] = loggedKm ? [loggedKm, 'the weekly km in the app']
    : calKms.length ? [calKms.reduce((a, b) => a + b, 0), 'the calibration week'] : [null, 'unknown']
  const recentLongest = Math.max(parseKm(profile.longest_run_last_3_weeks) || 0, ...calKms) || null
  // With no recent run on record (no logs in the app), the 10%-longer rule starts from the plan's own first week
  // instead of from nothing: week 1 stays as written and every later jump is still capped.
  const longestFor = (p: BrainPlan) => recentLongest
    ?? (Math.max(0, ...(p.weeks[0]?.days || []).map((d) => (typeof d.km === 'number' ? d.km : 0))) || null)
  if (action === 'build') {
    const [cycle, cycleText] = progressionCycle(profile, 12)
    const [ceiling] = volumeCeiling(profile, baseline)
    pipeline.planRequest.progression = {
      baseline_weekly_km: baseline ? pyRound(baseline, 1) : null, baseline_source: baselineSrc,
      cycle, cycle_text: cycleText,
      recovery_weeks: Array.from({ length: 18 }, (_, i) => i + 1).filter((i) => isRecoveryWeek(cycle, i)).slice(0, 6),
      max_increase_between_build_weeks: '10% and at most 8 km', recovery_drop: '20-25%', week_1: 'at most 5% above baseline',
      ceiling_km: ceiling ? pyRound(ceiling) : null, athlete_volume_goal: profile.volume_goal || null, laws: VOLUME_LAWS,
    }
    pipeline.planRequest.schedule_anchors = Object.fromEntries(
      (['rest_day', 'long_run_day', 'gym_days'] as const).filter((k) => profile[k]).map((k) => [k, profile[k]]))
  }

  const athlete = contextText(snapshot, profile)

  if (action === 'edit') {
    // A small change: no book science, a cheaper model, and only the changed days come back. The code-checked
    // rules then run on the whole plan again, so a change can't break them.
    if (!req.plan?.weeks?.length) throw new CoachAIError('Build or load a plan first, then ask for a change.')
    const compact = req.plan.weeks.map((w) => ({
      week: w.week, phase: w.phase,
      days: w.days.map((d) => ({ date: d.date, weekday: d.weekday, type: d.type, title: d.title, km: d.km ?? null, minutes: d.minutes ?? null,
        steps: (d.steps || []).map((s) => [s.kind, s.label, s.reps && `${s.reps}x`, s.minutes && `${s.minutes}min`, s.km && `${s.km}km`, s.pace, s.rest && `rest ${s.rest}`].filter(Boolean).join(' ')) })),
    }))
    const system = [
      PERSONA, METHOD_GUARDRAILS,
      'Rules checked in code after you answer (a change that breaks them gets cut back):\n' + rulesText(['code']),
      '=== The athlete ===\n' + athlete,
      `=== Current plan (${req.plan.start_date} to ${req.plan.end_date}) ===\nPaces: ${JSON.stringify(req.plan.paces)}\n${JSON.stringify(compact)}`,
      EDIT_TAIL + PLAN_SCHEMA_DAY,
    ].join('\n\n')
    const client = new Anthropic({ apiKey })
    const msg = await client.messages.stream({
      model: EDIT_MODEL, max_tokens: 8000, system,
      messages: [...history.slice(-4), { role: 'user', content: message }],
    }).finalMessage()
    const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n')
    const meta = { cost: costOf(msg.usage, EDIT_MODEL), model: EDIT_MODEL, usage: msg.usage }
    const parsed = extractJson(text) || {}
    const changes: any[] = Array.isArray(parsed.changes) ? parsed.changes : []
    const byDate = new Map(changes.filter((c) => c?.date && c?.day && typeof c.day === 'object').map((c) => [c.date, c.day]))
    if (!byDate.size) return { reply: parsed.reply || text, plan: null, ...meta }
    const draft = structuredClone(req.plan)
    for (const w of draft.weeks) w.days = w.days.map((d) => (byDate.has(d.date!) ? { ...byDate.get(d.date!), date: d.date, weekday: d.weekday } : d))
    const rerun = normalizePlan({ ...draft, safety: undefined, volume_story: undefined }, parseDay(draft.start_date) || start)
    const plan = draft.template ? rerun : enforceAll(rerun, {
      profile, category: pipeline.planRequest.category, maxQuality: pipeline.planRequest.weekly_structure?.max_quality_sessions,
      baseline, baselineSrc, recentLongest: longestFor(rerun),
    })
    return { reply: parsed.reply || text, plan, changedDates: [...byDate.keys()], ...meta }
  }

  const decisions = "=== Pipeline result (computed in code from the book's rules) ===\n" + JSON.stringify(pipeline.planRequest)
  const age = Number(profile.age) || null
  // The big, stable part of the prompt goes first and is cached, so repeat requests in a session are cheaper.
  const knowledge = action === 'build'
    ? `Chapter index (for the 'chapter' field):\n${chapterIndexText()}` + chapterScience(seasonChapters(pipeline.planRequest, age))
      + '\n\nTeamHaim training-plan rules (from the brain). Follow every one; the rules checked in code are enforced after '
      + 'you answer anyway, so a plan that breaks them gets cut back:\n' + rulesText(['plan', 'code'])
    : 'Relevant method knowledge:' + (routeChapters(message + ' ' + history.slice(-2).map((m) => m.content).join(' ')).map(compactChapter).join('')
      || ' (no chapter matched -- answer from general coaching judgment and say so)')
      + '\n\nadaptive_progression protocol:\n' + JSON.stringify(ADAPTIVE_PROTOCOL)
      + '\n\nCoaching rules from the brain (use them when you answer):\n' + rulesText(['coach'])

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: `${PERSONA}\n\n${METHOD_GUARDRAILS}\n\n${knowledge}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: [
      '=== The athlete (data from the TeamHaim app) ===', athlete, decisions,
      action === 'build' ? `Plan starts on the coach's chosen start date. Calendar:\n${calendarText(start)}` : '',
      req.plan?.weeks?.length ? `=== Current plan on the page (the coach may ask to change it) ===\n${JSON.stringify({ ...req.plan, template: undefined, safety: undefined })}` : '',
      action === 'build' ? BUILD_TAIL + PLAN_SCHEMA + '\n\n' + PLAN_RULES : ASK_TAIL,
    ].filter(Boolean).join('\n\n') },
  ]

  const client = new Anthropic({ apiKey })
  const msg = await client.messages.stream({
    model: BRAIN_MODEL,
    max_tokens: action === 'build' ? 48000 : 4000,
    system,
    messages: [...history, { role: 'user', content: message }],
  }).finalMessage()
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n')
  const cost = costOf(msg.usage)
  // Raw usage goes back to the page, which records it in the app's AI usage log (lib/ai-coach/usage-log).
  const meta = { cost, model: BRAIN_MODEL, usage: msg.usage }
  if (action === 'ask') return { reply: text.trim(), plan: null, ...meta }
  const parsed = extractJson(text) || {}
  const written = parsed.plan?.weeks ? normalizePlan(parsed.plan, start) : null
  if (!written) {
    return { reply: parsed.reply || text, plan: null, ...meta,
      error: 'The plan came back malformed, so nothing changed. Try again or shorten the request.' }
  }
  // The code-checked rules run on every plan the AI writes; they can only make it safer.
  const plan = enforceAll(written, {
    profile, category: pipeline.planRequest.category,
    maxQuality: pipeline.planRequest.weekly_structure?.max_quality_sessions,
    baseline, baselineSrc, recentLongest: longestFor(written),
  })
  return { reply: parsed.reply || text, plan, ...meta }
}
