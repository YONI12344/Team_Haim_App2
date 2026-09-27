// "In my words": rewrites the brain's plan days the way the coach writes workouts in the app for this
// athlete -- the coach's language and shorthand, the athlete's name, Hebrew grammatical gender only when the
// profile states it -- so the coach can review, edit and approve before anything reaches the athlete.
// Kept apart from the brain (lib/haim-brain): the brain decides the training, this only changes the words.
// Numbers never change here: distance, duration, reps, rest and paces come from the plan.

import type { PlanDay } from '../haim-brain/plan'
import { describeStep, workoutTypeFor } from '../haim-brain/plan'

export interface CoachExample {
  title?: string; description?: string; warmup?: string; cooldown?: string; notes?: string
  type?: string; distance?: number; duration?: number
}

export interface WrittenWorkout {
  date: string
  title: string; description: string; warmup: string; cooldown: string; notes: string
  titleEn: string; descriptionEn: string; warmupEn: string; cooldownEn: string; notesEn: string
}

export function voiceSystem(examples: CoachExample[], athlete: { firstName: string; gender?: string; language?: string }): string {
  const gender = athlete.gender === 'female' ? 'female: use feminine Hebrew forms (e.g. תרוצי, תעשי)'
    : athlete.gender === 'male' ? 'male: use masculine Hebrew forms (e.g. תרוץ, תעשה)'
    : 'not stated: use gender-neutral Hebrew (infinitives or plural, e.g. לרוץ / ריצה) and never guess a gender'
  const shown = examples.slice(0, 15).map((e, i) => `Example ${i + 1} [${e.type || '?'}${e.distance ? `, ${e.distance} km` : ''}${e.duration ? `, ${e.duration} min` : ''}]\n`
    + Object.entries({ title: e.title, description: e.description, warmup: e.warmup, cooldown: e.cooldown, notes: e.notes })
      .filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}: ${String(v).slice(0, 600)}`).join('\n')).join('\n\n')
  return `You rewrite training-plan sessions so they read exactly like the TeamHaim coach's own workouts in the coaching app.

The coach's real workouts (their style, language, shorthand, length, structure and tone -- copy it closely):
${shown || '(no examples on file: write in short, clear coach Hebrew, the way a running coach texts an athlete)'}

Rules:
- Main fields (title, description, warmup, cooldown, notes) in the language the coach writes in the examples (Hebrew if unclear).
  Use the coach's shorthand the way the examples do (e.g. ד' / דק' for minutes, ק"מ for km, חזרות, מנוחה).
- The *En fields are the same workout in natural, plain English (for athletes who read the app in English).
- The athlete's first name is "${athlete.firstName}". Use it only where the coach's examples address the athlete by name.
- Hebrew grammatical gender for this athlete: ${gender}.
- Keep EVERY number exactly as given: distances, minutes, reps, rest times, paces, heart rates. Never add or remove work.
- Keep the method's meaning: Golden Zone / threshold work stays controlled and below threshold; easy stays easy.
- Match the examples' length. If the coach writes short, write short. Don't add explanations the coach wouldn't write;
  a short "why" belongs in notes only if the coach's examples use notes that way.
- Empty string for a field the coach wouldn't use for this kind of session.

Reply with ONLY a JSON object: {"workouts": [{"date": "yyyy-MM-dd", "title": "", "description": "", "warmup": "", "cooldown": "", "notes": "",
"titleEn": "", "descriptionEn": "", "warmupEn": "", "cooldownEn": "", "notesEn": ""}]} -- one per session given, same dates, same order.`
}

/** The plan days as the model reads them: what to write, with the exact numbers. */
export function daysText(days: PlanDay[]): string {
  return days.map((d) => [
    `date ${d.date} (${d.weekday}) -- ${workoutTypeFor(d)}: ${d.title}`,
    [d.km ? `${d.km} km` : '', d.minutes ? `${Math.round(d.minutes)} min` : ''].filter(Boolean).join(', '),
    d.summary ? `summary: ${d.summary}` : '',
    ...(d.steps || []).map((s) => `  ${s.kind}: ${describeStep(s)}`),
    d.why ? `why (from the method): ${d.why}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
}

export function parseWritten(text: string, days: PlanDay[]): WrittenWorkout[] | null {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end < 0) return null
  let parsed: any
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  const list: any[] = Array.isArray(parsed?.workouts) ? parsed.workouts : []
  const byDate = new Map(list.filter((w) => w && typeof w.date === 'string').map((w) => [w.date, w]))
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const out = days.map((d) => {
    const w = byDate.get(d.date!) || {}
    return {
      date: d.date!,
      title: str(w.title) || d.title, description: str(w.description), warmup: str(w.warmup), cooldown: str(w.cooldown), notes: str(w.notes),
      titleEn: str(w.titleEn) || d.title, descriptionEn: str(w.descriptionEn), warmupEn: str(w.warmupEn), cooldownEn: str(w.cooldownEn), notesEn: str(w.notesEn),
    }
  })
  return out.some((w, i) => byDate.has(days[i].date!)) ? out : null
}

