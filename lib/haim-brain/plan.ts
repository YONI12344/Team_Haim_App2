// The brain's plan format (weeks -> 7 days -> steps), date assignment, and the conversion to the
// app's own Workout shape for "Export to schedule".

import { format } from 'date-fns'
import type { WorkoutType } from '@/lib/types'

export type Zone = 'easy' | 'golden' | 'above' | 'rest'
export type SessionType = 'rest' | 'easy' | 'golden' | 'long' | 'test' | 'x' | 'strength' | 'race'

export interface PlanStep {
  kind: 'warmup' | 'reps' | 'steady' | 'recovery' | 'cooldown' | 'test' | 'strength' | 'note'
  label?: string
  reps?: number | null
  minutes?: number | null
  km?: number | null
  pace?: string | null
  rest?: string | null
  detail?: string | null
}

export interface PlanDay {
  type: SessionType
  zone: Zone
  title: string
  summary?: string
  km?: number | null
  minutes?: number | null
  steps: PlanStep[]
  why?: string
  chapter?: string | null
  date?: string
  weekday?: string
}

export interface BrainPlan {
  title: string
  summary?: string
  paces: Record<string, string>
  hr?: { easy_max?: number | null; golden?: string | null }
  pace_source?: string
  phases: { name: string; weeks: string; focus: string }[]
  weeks: { week: number; phase?: string; focus?: string; days: PlanDay[] }[]
  notes: string[]
  template?: { name: string; level: string; adjustments: string[]; cost_usd: number }
  start_date?: string
  end_date?: string
}

const SESSION_TYPES: SessionType[] = ['rest', 'easy', 'golden', 'long', 'test', 'x', 'strength', 'race']
const ZONES: Zone[] = ['easy', 'golden', 'above', 'rest']
const STEP_KINDS = ['warmup', 'reps', 'steady', 'recovery', 'cooldown', 'test', 'strength', 'note']
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** The model reasons in day order; dates and weekdays are assigned here in code, and every enum is
 *  clamped so the page can always render the plan. */
export function normalizePlan(raw: any, start: Date, maxWeeks = 20): BrainPlan {
  const weeks = (Array.isArray(raw?.weeks) ? raw.weeks : []).filter((w: any) => w && typeof w === 'object').slice(0, maxWeeks)
  let i = 0
  for (const [wi, w] of weeks.entries()) {
    w.week = wi + 1
    const days: any[] = (Array.isArray(w.days) ? w.days : []).filter((d: any) => d && typeof d === 'object').slice(0, 7)
    while (days.length < 7) days.push({ type: 'rest', title: 'Rest', summary: 'Recovery day.', zone: 'rest', steps: [] })
    for (const d of days) {
      const dt = new Date(start)
      dt.setDate(dt.getDate() + i)
      d.date = format(dt, 'yyyy-MM-dd')
      d.weekday = WEEKDAYS[(dt.getDay() + 6) % 7]
      if (!SESSION_TYPES.includes(d.type)) d.type = 'easy'
      if (!ZONES.includes(d.zone)) d.zone = ({ rest: 'rest', golden: 'golden', test: 'golden', x: 'above', race: 'above' } as any)[d.type] || 'easy'
      if (d.type === 'rest') d.zone = 'rest'
      d.steps = (Array.isArray(d.steps) ? d.steps : []).filter((s: any) => s && typeof s === 'object')
      for (const s of d.steps) if (!STEP_KINDS.includes(s.kind)) s.kind = 'note'
      d.title = d.title || 'Session'
      i++
    }
    w.days = days
  }
  const end = new Date(start)
  end.setDate(end.getDate() + Math.max(i - 1, 0))
  return {
    title: raw?.title || 'Plan', summary: raw?.summary || '', paces: raw?.paces || {}, hr: raw?.hr || {},
    pace_source: raw?.pace_source || '', phases: Array.isArray(raw?.phases) ? raw.phases : [],
    weeks, notes: Array.isArray(raw?.notes) ? raw.notes : [], template: raw?.template,
    start_date: format(start, 'yyyy-MM-dd'), end_date: format(end, 'yyyy-MM-dd'),
  }
}

export function allDays(plan: BrainPlan): PlanDay[] {
  return plan.weeks.flatMap((w) => w.days)
}

// ---------------------------------------------------------------- export to the app's Workout shape

export function workoutTypeFor(day: PlanDay): WorkoutType {
  const title = day.title.toLowerCase()
  if (day.type === 'long') return 'long_run'
  if (day.type === 'golden') return 'threshold'
  if (day.type === 'test') return /hill/.test(title) ? 'hill_repeats' : 'time_trial'
  if (day.type === 'x') return /hill/.test(title) ? 'hill_repeats' : 'intervals'
  if (day.type === 'race') return 'race'
  if (day.type === 'strength') return 'strength'
  return 'easy'
}

export function describeStep(s: PlanStep): string {
  const size = s.reps && s.reps > 1
    ? `${s.reps} x ${s.minutes ? `${s.minutes} min` : s.km ? `${s.km} km` : 'rep'}`
    : s.minutes ? `${s.minutes} min` : s.km ? `${s.km} km` : ''
  const parts = [s.label, size && `(${size})`, s.pace && `@ ${s.pace}`, s.rest && `, rest ${s.rest}`].filter(Boolean).join(' ')
  return s.detail ? `${parts}. ${s.detail}` : parts
}

/** Fields for a new workouts/{id} doc. The text is English (the brain writes English), stored in both
 *  the main and the English-cache fields so every athlete sees it the same way. */
export function toWorkoutFields(day: PlanDay) {
  const steps = day.steps || []
  const warm = steps.filter((s) => s.kind === 'warmup').map(describeStep).join('\n')
  const cool = steps.filter((s) => s.kind === 'cooldown').map(describeStep).join('\n')
  const main = steps.filter((s) => s.kind !== 'warmup' && s.kind !== 'cooldown').map((s) => `- ${describeStep(s)}`).join('\n')
  const description = [day.summary, main].filter(Boolean).join('\n\n')
  const notes = day.why || ''
  return {
    title: day.title, titleEn: day.title,
    type: workoutTypeFor(day),
    description, descriptionEn: description,
    ...(warm ? { warmup: warm, warmupEn: warm } : {}),
    ...(cool ? { cooldown: cool, cooldownEn: cool } : {}),
    ...(notes ? { notes, notesEn: notes } : {}),
    ...(day.minutes ? { duration: Math.round(day.minutes) } : {}),
    ...(day.km ? { distance: day.km } : {}),
  }
}
