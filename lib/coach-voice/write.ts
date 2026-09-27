// "In my words": rewrites the brain's plan days the way the coach writes workouts in the app for this
// athlete -- the coach's language and shorthand, the athlete's name, Hebrew grammatical gender only when the
// profile states it, and the coach's own SETS structure (reps x distance-or-time, pace, rest between reps /
// after the set, intervals for things like run/walk) -- so the coach can review, edit and approve before
// anything reaches the athlete.
// Kept apart from the brain (lib/haim-brain): the brain decides the training, this only changes the words
// and the layout. Numbers never change here: distance, duration, reps, rest and paces come from the plan.

import type { PlanDay } from '../haim-brain/plan'
import { describeStep, workoutTypeFor } from '../haim-brain/plan'

/** The app's workout set, as the coach's workout builder writes it (lib/types.ts WorkoutSet). */
export interface SetRow {
  reps?: number
  distance?: string; duration?: string // display text, in the coach's words ("400 מ'", "2 ד'")
  distanceMeters?: number | null; durationSec?: number | null // exactly one of these, like the builder
  pace?: string; restBetweenReps?: string; restAfterSet?: string; notes?: string; rest?: string
  intervals?: SetRow[]
}

export interface CoachExample {
  title?: string; description?: string; warmup?: string; cooldown?: string; notes?: string
  type?: string; distance?: number; duration?: number
  sets?: SetRow[]
}

export interface WrittenWorkout {
  date: string
  title: string; description: string; warmup: string; cooldown: string; notes: string
  titleEn: string; descriptionEn: string; warmupEn: string; cooldownEn: string; notesEn: string
  sets: (SetRow & { id: string })[]
  /** Plan reps whose numbers weren't found in the sets -- shown to the coach as a check. */
  mismatches: string[]
}

const setText = (s: SetRow): string => [
  `${s.reps || 1} x ${s.distance || s.duration || (s.distanceMeters ? `${s.distanceMeters} m` : s.durationSec ? `${s.durationSec} s` : '?')}`,
  s.pace && `pace ${s.pace}`, s.restBetweenReps && `rest between reps ${s.restBetweenReps}`, s.restAfterSet && `rest after set ${s.restAfterSet}`,
  s.intervals?.length ? `intervals: ${s.intervals.map((iv) => `${iv.distance || iv.duration || ''}${iv.pace ? ` @ ${iv.pace}` : ''}${iv.rest ? ` / ${iv.rest}` : ''}`).join(' + ')}` : '',
].filter(Boolean).join(', ')

export function voiceSystem(examples: CoachExample[], athlete: { firstName: string; gender?: string; language?: string }): string {
  const gender = athlete.gender === 'female' ? 'female: use feminine Hebrew forms (e.g. תרוצי, תעשי)'
    : athlete.gender === 'male' ? 'male: use masculine Hebrew forms (e.g. תרוץ, תעשה)'
    : 'not stated: use gender-neutral Hebrew (infinitives or plural, e.g. לרוץ / ריצה) and never guess a gender'
  const shown = examples.slice(0, 15).map((e, i) => `Example ${i + 1} [${e.type || '?'}${e.distance ? `, ${e.distance} km` : ''}${e.duration ? `, ${e.duration} min` : ''}]\n`
    + [...Object.entries({ title: e.title, description: e.description, warmup: e.warmup, cooldown: e.cooldown, notes: e.notes })
      .filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k}: ${String(v).slice(0, 600)}`),
      ...(e.sets?.length ? [`sets: ${JSON.stringify(e.sets.slice(0, 8))}`] : [])].join('\n')).join('\n\n')
  return `You rewrite training-plan sessions so they read and are BUILT exactly like the TeamHaim coach's own workouts in the coaching app.

The coach's real workouts (their style, language, shorthand, length, structure and tone -- copy it closely, including how they use sets):
${shown || '(no examples on file: write in short, clear coach Hebrew, the way a running coach texts an athlete)'}

Rules:
- Main fields (title, description, warmup, cooldown, notes) in the language the coach writes in the examples (Hebrew if unclear).
  Use the coach's shorthand the way the examples do (e.g. ד' / דק' for minutes, ק"מ for km, חזרות, מנוחה).
- The *En fields are the same workout in natural, plain English (for athletes who read the app in English).
- The athlete's first name is "${athlete.firstName}". Use it only where the coach's examples address the athlete by name.
- Hebrew grammatical gender for this athlete: ${gender}.
- Keep EVERY number exactly as given: distances, minutes, reps, rest times, paces, heart rates. Never add or remove work.
- Time OR distance, never both, for the session and for every set or interval: if the plan gives minutes, it's a time; if it
  gives km or metres, it's a distance. Don't add a distance to a timed run or a time to a distance run.
- SETS: build the structured part of the session as sets, the way the coach does in the examples. Each set:
  {"reps": n, "durationSec": seconds OR "distanceMeters": metres (only one), "duration" or "distance": the same in the coach's
  words (e.g. "6 ד'", "400 מ'"), "pace": "...", "restBetweenReps": "...", "restAfterSet": "...", "notes": "..."}.
  Repeated reps are ONE set with reps > 1 (5 x 6 min = one set, reps 5, durationSec 360). Strides are a set of strides.
  Alternating segments repeated together (run/walk, 2 min on / 1 min off) are one set with reps and "intervals":
  [{"durationSec" or "distanceMeters", "duration" or "distance", "pace", "rest"}]. Warm-up and cool-down go where the coach's
  examples put them (usually the warmup / cooldown text fields). A plain easy or long run is one set with reps 1.
- Keep the method's meaning: Golden Zone / threshold work stays controlled and below threshold; easy stays easy.
- Match the examples' length. If the coach writes short, write short. Don't add explanations the coach wouldn't write;
  a short "why" belongs in notes only if the coach's examples use notes that way.
- Empty string for a text field the coach wouldn't use for this kind of session.

Reply with ONLY a JSON object: {"workouts": [{"date": "yyyy-MM-dd", "title": "", "description": "", "warmup": "", "cooldown": "", "notes": "",
"titleEn": "", "descriptionEn": "", "warmupEn": "", "cooldownEn": "", "notesEn": "", "sets": [ ... ]}]} -- one per session given, same dates, same order.`
}

/** The plan days as the model reads them: what to write, with the exact numbers. */
export function daysText(days: PlanDay[]): string {
  return days.map((d) => [
    `date ${d.date} (${d.weekday}) -- ${workoutTypeFor(d)}: ${d.title}`,
    d.measure === 'distance' && d.km ? `by distance: ${d.km} km` : d.minutes ? `by time: ${Math.round(d.minutes)} min` : d.km ? `by distance: ${d.km} km` : '',
    d.summary ? `summary: ${d.summary}` : '',
    ...(d.steps || []).map((s) => `  ${s.kind}: ${describeStep(s)}`),
    d.why ? `why (from the method): ${d.why}` : '',
  ].filter(Boolean).join('\n')).join('\n\n')
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null)
const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

/** One row the way the builder saves it: exactly one of distanceMeters / durationSec, the other side cleared. */
function cleanRow(r: any, keepRest: boolean): SetRow {
  let meters = num(r?.distanceMeters)
  let sec = num(r?.durationSec)
  if (meters && sec) { // never both: a row whose text reads as a time is a time
    if (/דק|ד'|min|שנ|sec/i.test(str(r.duration) || str(r.distance))) meters = null
    else sec = null
  }
  const row: SetRow = {
    distance: meters ? str(r.distance) || `${meters} m` : '',
    duration: sec ? str(r.duration) || `${Math.round(sec / 60) || sec} ${sec >= 60 ? 'min' : 's'}` : '',
    distanceMeters: meters ? Math.round(meters) : null,
    durationSec: sec ? Math.round(sec) : null,
    pace: str(r?.pace),
  }
  if (keepRest) row.rest = str(r?.rest)
  return row
}

function cleanSets(raw: unknown): (SetRow & { id: string })[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((s) => s && typeof s === 'object').slice(0, 20).map((s: any, i: number) => ({
    id: `set-${i}`,
    reps: Math.max(1, Math.min(100, Math.round(num(s.reps) || 1))),
    ...cleanRow(s, false),
    restBetweenReps: str(s.restBetweenReps), restAfterSet: str(s.restAfterSet), notes: str(s.notes),
    intervals: (Array.isArray(s.intervals) ? s.intervals : []).filter((iv: any) => iv && typeof iv === 'object').slice(0, 10)
      .map((iv: any, j: number) => ({ id: `int-${i}-${j}`, ...cleanRow(iv, true) })),
  }))
}

/** Every repeated rep in the plan (e.g. 5 x 6 min) should show up in the sets with the same count and size. */
function checkNumbers(day: PlanDay, sets: SetRow[]): string[] {
  const rows = sets.flatMap((s) => [s, ...(s.intervals || []).map((iv) => ({ ...iv, reps: s.reps }))])
  return (day.steps || []).filter((st) => st.reps && st.reps > 1 && (st.minutes || st.km)).flatMap((st) => {
    const sec = st.minutes ? Math.round(st.minutes * 60) : null
    const m = st.km ? Math.round(st.km * 1000) : null
    const found = rows.some((r) => (r.reps || 1) === st.reps
      && ((sec && r.durationSec && Math.abs(r.durationSec - sec) <= 1) || (m && r.distanceMeters && Math.abs(r.distanceMeters - m) <= 1)))
    return found ? [] : [`${st.reps} x ${st.minutes ? `${st.minutes} min` : `${st.km} km`}`]
  })
}

export function parseWritten(text: string, days: PlanDay[]): WrittenWorkout[] | null {
  const start = text.indexOf('{'), end = text.lastIndexOf('}')
  if (start < 0 || end < 0) return null
  let parsed: any
  try { parsed = JSON.parse(text.slice(start, end + 1)) } catch { return null }
  const list: any[] = Array.isArray(parsed?.workouts) ? parsed.workouts : []
  const byDate = new Map(list.filter((w) => w && typeof w.date === 'string').map((w) => [w.date, w]))
  const out = days.map((d) => {
    const w = byDate.get(d.date!) || {}
    const sets = cleanSets(w.sets)
    return {
      date: d.date!,
      title: str(w.title) || d.title, description: str(w.description), warmup: str(w.warmup), cooldown: str(w.cooldown), notes: str(w.notes),
      titleEn: str(w.titleEn) || d.title, descriptionEn: str(w.descriptionEn), warmupEn: str(w.warmupEn), cooldownEn: str(w.cooldownEn), notesEn: str(w.notesEn),
      sets, mismatches: checkNumbers(d, sets),
    }
  })
  return out.some((w, i) => byDate.has(days[i].date!)) ? out : null
}

export { setText }
