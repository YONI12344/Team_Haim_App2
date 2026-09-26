// The TeamHaim brain run on one athlete's app data, for the coach-only AI Coach page.
//   analyze -> decisions + free calibration week (no AI, $0)
//   ask     -> the coach asks about the athlete (AI, key points of the relevant chapters)
//   build   -> the coach asks for a plan or a change to it (AI, full science of the plan's chapters)
// Server-only. Never writes to Firestore: the coach exports plans from the page.

import Anthropic from '@anthropic-ai/sdk'
import { runPipeline } from './pipeline'
import { buildCalibration } from './calibration'
import { normalizePlan, type BrainPlan } from './plan'
import { type AthleteSnapshot, contextText, toBrainProfile } from './athlete-context'
import { ADAPTIVE_PROTOCOL, chapterIndexText, chapterScience, compactChapter, routeChapters, seasonChapters } from './brain'
import { ASK_TAIL, BUILD_TAIL, METHOD_GUARDRAILS, PERSONA, PLAN_RULES, PLAN_SCHEMA } from './prompts'

export const BRAIN_MODEL = process.env.HAIM_BRAIN_MODEL || 'claude-opus-5'
// USD per million tokens: input, output. Cache reads bill at 10% of input, cache writes at 125%.
const PRICING: Record<string, [number, number]> = { 'claude-opus-5': [5, 25], 'claude-sonnet-5': [3, 15], 'claude-haiku-4-5': [1, 5] }
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

export interface CoachRequest {
  action: 'analyze' | 'ask' | 'build'
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

function costOf(usage: Anthropic.Usage): number {
  const [inP, outP] = PRICING[BRAIN_MODEL] || PRICING['claude-opus-5']
  const cached = usage.cache_read_input_tokens || 0
  const written = usage.cache_creation_input_tokens || 0
  return (usage.input_tokens * inP + cached * inP * 0.1 + written * inP * 1.25 + usage.output_tokens * outP) / 1_000_000
}

export async function runCoachAI(req: CoachRequest, apiKey = process.env.ANTHROPIC_API_KEY) {
  const { action, snapshot } = req
  if (!snapshot?.profile || !['analyze', 'ask', 'build'].includes(action)) throw new CoachAIError('Pick an athlete first.')
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

  const athlete = contextText(snapshot, profile)
  const decisions = "=== Pipeline result (computed in code from the book's rules) ===\n" + JSON.stringify(pipeline.planRequest)
  const age = Number(profile.age) || null
  // The big, stable part of the prompt goes first and is cached, so repeat requests in a session are cheaper.
  const knowledge = action === 'build'
    ? `Chapter index (for the 'chapter' field):\n${chapterIndexText()}` + chapterScience(seasonChapters(pipeline.planRequest, age))
    : 'Relevant method knowledge:' + (routeChapters(message + ' ' + history.slice(-2).map((m) => m.content).join(' ')).map(compactChapter).join('')
      || ' (no chapter matched -- answer from general coaching judgment and say so)')
      + '\n\nadaptive_progression protocol:\n' + JSON.stringify(ADAPTIVE_PROTOCOL)

  const system: Anthropic.TextBlockParam[] = [
    { type: 'text', text: `${PERSONA}\n\n${METHOD_GUARDRAILS}\n\n${knowledge}`, cache_control: { type: 'ephemeral' } },
    { type: 'text', text: [
      '=== The athlete (data from the TeamHaim app) ===', athlete, decisions,
      action === 'build' ? `Plan starts on the coach's chosen start date. Calendar:\n${calendarText(start)}` : '',
      req.plan?.weeks?.length ? `=== Current plan on the page (the coach may ask to change it) ===\n${JSON.stringify({ ...req.plan, template: undefined })}` : '',
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
  if (action === 'ask') return { reply: text.trim(), plan: null, cost, model: BRAIN_MODEL }
  const parsed = extractJson(text) || {}
  const plan = parsed.plan?.weeks ? normalizePlan(parsed.plan, start) : null
  if (!plan) {
    return { reply: parsed.reply || text, plan: null, cost, model: BRAIN_MODEL,
      error: 'The plan came back malformed, so nothing changed. Try again or shorten the request.' }
  }
  return { reply: parsed.reply || text, plan, cost, model: BRAIN_MODEL }
}
