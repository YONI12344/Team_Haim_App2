// Calibration week without AI: a template per athlete level, fitted to the athlete in code.
// Costs nothing. Ported from the TeamHaim brain's calibration.py; keep the two in step.

import { BEGINNER, type BrainProfile, hillAccess, parseKm } from './pipeline'
import { rangeMid, sToPace } from './paces'
import type { PlanDay, PlanStep, BrainPlan } from './plan'

export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
const DEFAULT_DAYS: Record<number, string[]> = {
  2: ['Tuesday', 'Saturday'],
  3: ['Tuesday', 'Thursday', 'Sunday'],
  4: ['Tuesday', 'Thursday', 'Saturday', 'Sunday'],
  5: ['Tuesday', 'Wednesday', 'Thursday', 'Saturday', 'Sunday'],
  6: ['Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
  7: WEEKDAYS,
}
// Typical easy pace per level, only to turn minutes into km when there's no race result.
const FALLBACK_EASY_S: Record<string, number> = { beginner: 420, recreational: 360, ambitious: 295, elite: 260 }

type Level = 'beginner' | 'recreational' | 'ambitious' | 'elite'
const levelOf = (category: string): Level =>
  category === BEGINNER ? 'beginner' : category.includes('Elite') ? 'elite' : category.includes('Ambitious') ? 'ambitious' : 'recreational'

/** Monday-based weekday name of a yyyy-MM-dd date (local, no timezone drift). */
export function weekdayOf(date: Date): string {
  return WEEKDAYS[(date.getDay() + 6) % 7]
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + n)
  return d
}

export function trainingDays(profile: BrainProfile): { days: Set<string>; source: string } {
  const names = String(profile.training_days_preference || '').split(/[,\s/]+/)
  const days = names.map((n) => n.trim()).map((n) => n.charAt(0).toUpperCase() + n.slice(1).toLowerCase()).filter((n) => WEEKDAYS.includes(n))
  if (days.length) return { days: new Set(days), source: 'the chosen training days' }
  const n = Math.min(Math.max(Math.round(parseKm(profile.days_per_week) || 4), 2), 7)
  return { days: new Set(DEFAULT_DAYS[n]), source: `${n} days a week` }
}

const easy = (minutes: number, pace: string | undefined, kind: 'easy' | 'long' = 'easy'): PlanDay => {
  const long = kind === 'long'
  return {
    type: long ? 'long' : 'easy', zone: 'easy', title: long ? 'Long easy run' : 'Easy run',
    summary: long ? 'The longest run this week, fully easy.' : 'Relaxed and conversational the whole way.',
    minutes,
    steps: [{ kind: 'steady', label: long ? 'Long easy run' : 'Easy run', minutes, pace: pace || 'Conversational: below 70% of max HR',
      detail: long ? 'Stay fully easy; if in doubt, slower.' : null }],
    why: long ? 'Kept fully easy. It holds endurance steady while the tests measure you.'
      : 'Easy means easy: below 70% of max heart rate (Bakken, Ch. 3). It keeps the legs fresh for the test.',
    chapter: '3',
  }
}

const timeTrial = (easyPace?: string): PlanDay => ({
  type: 'test', zone: 'golden', title: '30-minute time trial',
  summary: 'Pace test: 30 minutes at the fastest steady effort you can hold.',
  steps: [
    { kind: 'warmup', label: 'Warm-up jog', minutes: 15, pace: easyPace || 'Easy' },
    { kind: 'test', label: '30-minute trial', minutes: 30, pace: 'Fastest steady pace you can hold for 30 minutes',
      detail: 'Flat route or treadmill, chest-strap HR if possible. Ignore the first 10 minutes; log the average heart rate and pace of the last 20.' },
    { kind: 'cooldown', label: 'Cool-down jog', minutes: 10, pace: 'Very easy' },
  ],
  why: 'The 30-minute trial finds threshold heart rate: the average of the last 20 minutes, minus 4-7 beats, is the Golden Zone heart rate (Bakken, Ch. 2).',
  chapter: '2',
})

const talkTest = (reps: number, startPace: string | null, easyPace: string | undefined, asTest: boolean): PlanDay => ({
  type: asTest ? 'test' : 'golden', zone: 'golden', title: `Talk test: ${reps} x 3 min`,
  summary: 'Progressive 3-minute reps. Recite a text at the end of each one and score it.',
  steps: [
    { kind: 'note', label: 'Pick your text', detail: 'Choose a 30-100 word text you know by heart. Use the same one every time.' },
    { kind: 'warmup', label: 'Warm-up jog', minutes: 15, pace: easyPace || 'Easy' },
    { kind: 'reps', label: '3 min reps, building', reps, minutes: 3, pace: startPace || 'Start easy-steady, a little faster each rep', rest: '60 s easy jog',
      detail: "In the last 30-40 s of each rep, recite the text aloud and score it: 'Yes' / 'Yes, but...' / 'No'. Stop building at the first clear 'No'." },
    { kind: 'cooldown', label: 'Cool-down jog', minutes: 12, pace: 'Very easy' },
  ],
  why: "The extended talk test (Bakken, Ch. 2): the Golden Zone sits between the first 'Yes, but...' and just under the 'No'. No equipment needed, and it cross-checks the other test.",
  chapter: '2',
})

const hillMaxHr = (easyPace?: string): PlanDay => ({
  type: 'test', zone: 'above', title: 'Hill max heart rate: 3 efforts',
  summary: 'Three hard climbs to find the real max heart rate.',
  steps: [
    { kind: 'warmup', label: 'Warm-up jog', minutes: 20, pace: easyPace || 'Easy' },
    { kind: 'test', label: 'Hill efforts', reps: 3, minutes: 2.5, pace: '1: controlled hard. 2: hard, all-out the last 30 s. 3: hard from the start',
      rest: '3-4 min, jog back down', detail: 'A steady hill that takes 2-3 minutes to climb. The highest heart rate across the three is close to true max.' },
    { kind: 'cooldown', label: 'Cool-down jog', minutes: 10, pace: 'Very easy' },
  ],
  why: "Three hill efforts find the real max heart rate. Don't trust 220 minus age: the book puts its error at 10-12 beats (Bakken, Ch. 2).",
  chapter: '2',
})

const lactateTest = (easyPace?: string): PlanDay => ({
  type: 'test', zone: 'golden', title: 'Lactate step test',
  summary: '5-minute steps, a little faster each time, with a lactate reading after each.',
  steps: [
    { kind: 'warmup', label: 'Warm-up jog', minutes: 15, pace: easyPace || 'Easy' },
    { kind: 'test', label: '5 min steps', reps: 7, minutes: 5, pace: 'Start easy, about 10-15 s/km faster each step', rest: '30 s: measure lactate',
      detail: 'Same route or treadmill every time; last hard session 4+ days before. Dry, clean skin; wipe the first drop.' },
    { kind: 'cooldown', label: 'Cool-down jog', minutes: 10, pace: 'Very easy' },
  ],
  why: 'The lactate curve shows the Golden Zone as a range, typically 2.3-3.0 mmol/L (Bakken, Ch. 2 & 13).',
  chapter: '13',
})

const gentleGolden = (reps: number, minutes: number, pace: string | undefined, easyPace?: string): PlanDay => ({
  type: 'golden', zone: 'golden', title: `${reps} x ${minutes} min Golden Zone`,
  summary: 'First Golden Zone reps: short, controlled, finishing with more in the tank.',
  steps: [
    { kind: 'warmup', label: 'Warm-up jog', minutes: 12, pace: easyPace || 'Easy' },
    { kind: 'reps', label: `${minutes} min Golden Zone reps`, reps, minutes, pace: pace || 'Comfortably hard: short sentences, not full ones', rest: '60 s easy jog' },
    { kind: 'cooldown', label: 'Cool-down jog', minutes: 10, pace: 'Very easy' },
  ],
  why: "A first taste of the Golden Zone. Total threshold time stays under 20-25 minutes, the book's cautious-entry rule (Bakken, Ch. 5).",
  chapter: '5',
})

const rest = (): PlanDay => ({ type: 'rest', zone: 'rest', title: 'Rest', summary: 'Recovery day.', steps: [], why: 'Not a training day.', chapter: null })

export function sessionMinutes(day: PlanDay): number {
  let total = 0
  for (const s of day.steps || []) {
    const m = s.minutes || 0
    const reps = s.reps || 1
    total += m * reps
    if (reps > 1) {
      const sec = String(s.rest || '').match(/(\d+)\s*s/)
      const min = String(s.rest || '').match(/(\d+)(?:-\d+)?\s*min/)
      total += (reps - 1) * (sec ? Number(sec[1]) / 60 : min ? Number(min[1]) : 0)
    }
  }
  return Math.round(total)
}

function* permutations<T>(items: T[], k: number, prefix: T[] = []): Generator<T[]> {
  if (prefix.length === k) { yield prefix; return }
  for (const it of items) if (!prefix.includes(it)) yield* permutations(items, k, [...prefix, it])
}

export function buildCalibration(profile: BrainProfile, paceResult: Record<string, any>, category: string, start: Date): BrainPlan {
  const level = levelOf(category)
  const { days, source: daysSource } = trainingDays(profile)
  const equipment = (profile.equipment_access || '').toLowerCase()
  const hasHr = equipment.includes('heart rate') || equipment.includes('watch')
  const hills = hillAccess(profile)
  const injury = (profile.injury_history || '').trim().toLowerCase()
  const past = /\b(ago|healed|old|past|previous|years? back|last year)\b/.test(injury)
  const injured = !!injury && !['none', 'no', 'n/a', 'no injuries', 'none current'].includes(injury) && !past
  const returning = (profile.returning_from_layoff || '').toLowerCase().startsWith('yes')
  const adjustments: string[] = []

  const est = paceResult.race_estimate
  const paces: Record<string, string> = est ? { ...est.paces } : {}
  const easyPace = paces.easy
  const easyS = rangeMid(easyPace) || FALLBACK_EASY_S[level]
  let talkStart: string | null = null
  if (est) {
    talkStart = `Start ~${sToPace((rangeMid(paces.golden_long) || easyS) + 12)} /km, ~5 s/km faster each rep`
    adjustments.push(`Paces from the ${est.from} (VDOT ${est.vdot}); provisional until the test confirms them.`)
  } else {
    adjustments.push('No recent race result, so this week runs on effort and the test sets the paces.')
  }

  // 1. The template: which hard sessions this level gets, in priority order.
  let hard: [string, PlanDay][]
  let template: string
  const hillTest = hasHr && (hills === 'good' || hills === 'treadmill')
  if (level === 'beginner') {
    hard = [['talk', talkTest(5, talkStart, easyPace, true)]]
    template = 'Beginner: one gentle talk test, everything else easy'
  } else if (level === 'recreational') {
    hard = [[hasHr ? 'tt' : 'talk', hasHr ? timeTrial(easyPace) : talkTest(6, talkStart, easyPace, true)], ['golden', gentleGolden(6, 2, paces.golden_short, easyPace)]]
    template = hasHr ? 'Recreational: 30-min time trial + one short Golden Zone session' : 'Recreational (no HR monitor): talk test + one short Golden Zone session'
  } else {
    let first: [string, PlanDay]
    if (level === 'elite' && equipment.includes('lactate')) {
      first = ['lactate', lactateTest(easyPace)]
      template = 'Elite: lactate step test + talk test'
    } else {
      first = hasHr ? ['tt', timeTrial(easyPace)] : ['talk', talkTest(6, talkStart, easyPace, true)]
      template = `${level === 'elite' ? 'Elite' : 'Ambitious'}: three-point method (field test + talk test${hillTest ? ' + hill max HR' : ''})`
    }
    hard = [first]
    if (first[0] !== 'talk') hard.push(['talk', talkTest(5, talkStart, easyPace, false)])
    if (hillTest) hard.push(['hill', hillMaxHr(easyPace)])
  }

  // 2. Fit to the athlete.
  if ((returning || injured) && hard.length > 1) {
    hard = hard.slice(0, 1)
    adjustments.push('Coming back from a break or carrying an injury: only the pace test this week, no extra hard session.')
  }
  let slots = [0, 1, 2, 3, 4, 5, 6].filter((i) => days.has(weekdayOf(addDays(start, i))))
  if (!slots.length) slots = [1, 3, 5]
  const maxHard = slots.length <= 3 ? 1 : slots.length === 4 ? 2 : hard.length
  if (hard.length > maxHard) {
    adjustments.push(`Only ${slots.length} training days, so ${hard.length - maxHard} hard session(s) left out to keep easy days between.`)
    hard = hard.slice(0, maxHard)
  }
  const useLong = slots.length >= 3
  const items = [...hard.map(([k]) => k), ...(useLong ? ['long'] : [])]
  let best: Record<string, number> = {}
  let bestScore: number | null = null
  for (const perm of permutations(slots, items.length)) {
    const pos: Record<string, number> = {}
    items.forEach((k, i) => { pos[k] = perm[i] })
    const hardPos = hard.map(([k]) => pos[k])
    let score = 0
    for (let a = 0; a < hardPos.length; a++) for (let b = a + 1; b < hardPos.length; b++) if (Math.abs(hardPos[a] - hardPos[b]) === 1) score -= 10
    if ('long' in pos) {
      // A test the day after the long run measures tired legs; the day before matters less.
      score -= hardPos.filter((h) => h - pos.long === 1).length * 6
      score -= hardPos.filter((h) => pos.long - h === 1).length * 2
      const wd = weekdayOf(addDays(start, pos.long))
      score += wd === 'Saturday' || wd === 'Sunday' ? 1 : 0
      score -= pos.long === 0 ? 2 : 0
    }
    score -= hardPos.includes(0) ? 3 : 0 // the first day together is an easy one
    score -= hardPos.length > 1 && hardPos[0] > hardPos[1] ? 1 : 0
    if (bestScore === null || score > bestScore) { best = pos; bestScore = score }
  }
  const restDays = [0, 1, 2, 3, 4, 5, 6].filter((i) => !slots.includes(i)).map((i) => weekdayOf(addDays(start, i)).slice(0, 3))
  if (restDays.length) adjustments.push(`Rest on ${restDays.join(', ')} (${daysSource}).`)

  // 3. Volume: 90% of current weekly km (75% when returning) so the test lands on fresh legs.
  const weekly = parseKm(profile.weekly_mileage)
  const week: (PlanDay | null)[] = Array(7).fill(null)
  for (const [k, session] of hard) week[best[k]] = session
  const easyIdx = slots.filter((i) => week[i] === null && !(useLong && i === best.long))
  if (weekly && level !== 'beginner') {
    const factor = returning || injured ? 0.75 : 0.9
    const target = weekly * factor
    adjustments.push(`About ${Math.round(target)} km this week: ${Math.round(factor * 100)}% of the current ${Math.round(weekly)} km, so the test finds fresh legs.`)
    const hardKm = hard.reduce((a, [, s]) => a + (sessionMinutes(s) * 60) / easyS, 0)
    const longest = parseKm(profile.longest_run_last_3_weeks)
    const longKm = useLong ? Math.min(longest || target * 0.3, target * 0.3) : 0
    const left = Math.max(target - hardKm - longKm, 0)
    let easyKm = easyIdx.length ? left / easyIdx.length : 0
    easyKm = Math.max(Math.min(easyKm, longKm ? longKm * 0.8 : easyKm), 4)
    const toMin = (km: number) => Math.max(20, Math.round((km * easyS) / 60 / 5) * 5)
    const floor: Record<string, number> = { recreational: 30, ambitious: 40, elite: 50 }
    if (useLong) week[best.long] = easy(toMin(Math.max(longKm, easyKm)), easyPace, 'long')
    for (const i of easyIdx) week[i] = easy(Math.max(toMin(easyKm), floor[level] || 30), easyPace)
  } else {
    const base = level === 'beginner' ? 25 : 35
    adjustments.push('Easy runs set by time, not distance: ' + (level === 'beginner' ? 'run/walk is completely fine.' : 'no weekly volume on file.'))
    if (useLong) week[best.long] = easy(base + 15, easyPace, 'long')
    for (const i of easyIdx) week[i] = easy(base, easyPace)
  }
  const day0 = week[0]
  if (slots.includes(0) && day0 && day0.type === 'easy') day0.why = 'First day together, nothing to prove. ' + day0.why

  const out: PlanDay[] = week.map((d) => {
    const day = d ?? rest()
    if (day.type !== 'rest') {
      day.minutes = sessionMinutes(day)
      day.km = day.type === 'easy' || day.type === 'long' ? Math.round((day.minutes * 60 / easyS) * 2) / 2 : null
    }
    return day
  })
  if (injured) adjustments.push(`Injury noted ('${profile.injury_history}'): stop any session that makes it worse.`)
  if (!['good', 'short', 'treadmill'].includes(hills) && (level === 'ambitious' || level === 'elite')) {
    adjustments.push('No hill test: no hill on file to run the max heart rate protocol on.')
  }

  const testName = hard[0][1].title.toLowerCase()
  return {
    title: 'Calibration week',
    summary: `One week to measure before the season: the ${testName} sets the Golden Zone, and every other run stays easy so the numbers are honest.`,
    paces,
    pace_source: est ? `Provisional Golden Zone paces from the ${est.from} (VDOT ${est.vdot}, Bakken Ch. 2). The test confirms or corrects them.`
      : 'No paces yet: the test sets them. Run by effort until then.',
    phases: [{ name: 'Calibration', weeks: '1', focus: 'Measure the Golden Zone' }],
    weeks: [{ week: 1, phase: 'Calibration', focus: 'Measure, then build', days: out }],
    notes: ['Log every run and how it felt. That, plus the test, is what the full season is built from.'],
    template: { name: template, level, adjustments, cost_usd: 0 },
  }
}

export type { PlanStep }
