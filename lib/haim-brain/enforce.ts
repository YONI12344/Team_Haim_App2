// The training-plan rules checked in code after the AI writes a plan (training_plan_rules.json,
// enforced_by 'code'). They only ever make a plan safer: fewer workouts, lower volume, easier days.
// Ported line for line from the TeamHaim brain's athlete_api.py enforcers; keep the two in step.

import rulesFile from './data/protocols/training_plan_rules.json'
import { parseKm, type BrainProfile } from './pipeline'
import { paceToS, pyRound } from './paces'
import type { BrainPlan, PlanDay } from './plan'

type Rule = { id: string; rule: string; applies_to: string; enforced_by: 'plan' | 'code' | 'coach' }
const RULES = (rulesFile as { rules: Rule[] }).rules

/** The brain's rules as prompt text, e.g. rulesText(['plan', 'code']) for plan writing. */
export function rulesText(kinds: Rule['enforced_by'][]): string {
  return RULES.filter((r) => kinds.includes(r.enforced_by))
    .map((r) => `[${r.id}] ${r.rule}` + (r.applies_to !== 'all' ? ` (applies to: ${r.applies_to})` : ''))
    .join('\n')
}

export const VOLUME_LAWS = [
  'Week 1 starts where the athlete is: at most 5% above their recent weekly average.',
  'A build week goes up at most 10% on the build week before it, and never by more than 8 km.',
  'Every 4th week is easier (every 3rd when coming back from a break or injury): at least 20% fewer km.',
  'Never above the weekly goal; without a goal, never above the biggest week of the past year (or 20% above where the athlete is now, if unknown).',
  'To keep current kilometres, every week stays within 5% of them: the progress comes from the sessions.',
  'Taper weeks never go up.',
]

type Cycle = '3:1' | '2:1' | '1:1'
export type SafePlan = BrainPlan
type Safety = NonNullable<BrainPlan['safety']>

const QUALITY_TYPES = ['golden', 'x']
const HARD_TYPES = ['golden', 'x', 'test', 'race']
const KEEP = ['date', 'weekday', 'id'] as const
const isNum = (v: unknown): v is number => typeof v === 'number' && !Number.isNaN(v)

function easySeconds(plan: BrainPlan): number {
  const first = (String(plan.paces?.easy || '').match(/\d{1,2}:\d{2}/g) || []).map(paceToS).find((x) => x)
  return first || 330
}

function addNotes(plan: SafePlan, notes: string[]) {
  if (!notes.length) return
  plan.safety ??= { adjustments: [] } as unknown as Safety
  plan.safety.adjustments ??= []
  plan.safety.adjustments.push(...notes)
}

export function volumeCeiling(profile: BrainProfile, baseline: number | null): [number | null, string] {
  const goal = String(profile.volume_goal || '').toLowerCase()
  if (/keep|same|maintain|current/.test(goal) && baseline) return [baseline * 1.05, 'keep']
  const target = /\d/.test(goal) ? parseKm(goal) : null
  if (target) return [target, 'target']
  const peak = parseKm(profile.peak_weekly_mileage_last_year)
  if (peak && baseline && peak >= baseline) return [peak, 'peak']
  return [baseline ? baseline * 1.2 : null, 'default']
}

export function progressionCycle(profile: BrainProfile, nWeeks: number): [Cycle, string] {
  const returning = String(profile.returning_from_layoff || '').toLowerCase().startsWith('yes')
  const injury = String(profile.injury_history || '').toLowerCase()
  const current = !!injury && !['none', 'no', 'n/a'].includes(injury) && !/\b(ago|healed|old|past|previous)\b/.test(injury)
  if (returning || current) return ['2:1', '2 build weeks, then 1 recovery week (coming back from a break or injury)']
  if (nWeeks <= 6) return ['1:1', 'build and recovery weeks alternate (short block close to racing)']
  return ['3:1', '3 build weeks, then 1 recovery week']
}

export const isRecoveryWeek = (cycle: Cycle, i: number) => ({ '3:1': i % 4 === 0, '2:1': i % 3 === 0, '1:1': i % 2 === 0 })[cycle]

function dayKm(d: PlanDay, easyS: number): number {
  if (d.type === 'rest') return 0
  if (isNum(d.km) && d.km > 0) return d.km
  return isNum(d.minutes) ? (d.minutes * 60) / easyS : 0
}

function scaleDay(d: PlanDay, f: number) {
  for (const key of ['km', 'minutes'] as const) if (isNum(d[key])) d[key] = Math.max(1, pyRound((d[key] as number) * f)) // whole km and minutes
  if ((d.type === 'easy' || d.type === 'long') && isNum(d.km)) d.title = (d.title || '').replace(/\b\d+(\.\d+)?\s*km\b/, `${d.km} km`)
  if ((d.type === 'easy' || d.type === 'long') && isNum(d.minutes)) d.title = (d.title || '').replace(/\b\d+\s*min\b/, `${d.minutes} min`)
  for (const st of d.steps || []) {
    if (isNum(st.minutes) && ['steady', 'warmup', 'cooldown'].includes(st.kind)) st.minutes = pyRound(st.minutes * f, 1)
  }
}

type EasySize = { km?: number | null; minutes?: number | null }

/** An easy run of the given size: by time when the week's easy runs are by time, else by distance. */
function easyVersion(d: PlanDay, size: EasySize | number, paces: Record<string, string> | undefined) {
  const { km, minutes } = typeof size === 'number' ? { km: size, minutes: null } : size
  const byTime = !km && !!minutes
  Object.assign(d, {
    type: 'easy', zone: 'easy', measure: byTime ? 'time' : 'distance',
    title: byTime ? `Easy ${minutes} min` : `Easy ${km} km`, km: byTime ? null : km, minutes: byTime ? minutes : null,
    summary: 'Relaxed and conversational the whole way.',
    steps: [{ kind: 'steady', label: 'Easy run', km: byTime ? null : km, minutes: byTime ? minutes : null, pace: paces?.easy || 'Conversational: below 70% of max HR' }],
    why: 'An easy day, so the legs are fresh for the next Golden Zone session (Bakken, Ch. 3).', chapter: '3',
  })
}

/** The size of the week's first easy run (its km, or its minutes when it's a time-based run). */
function weekEasySize(days: PlanDay[]): EasySize | null {
  const e = days.find((d) => d.type === 'easy' && (d.km || d.minutes))
  return e ? (e.km ? { km: e.km } : { minutes: e.minutes }) : null
}

/** Swap two days' sessions; each day keeps its own date, weekday and id. */
function swapDays(days: PlanDay[], a: number, b: number) {
  const strip = (d: PlanDay) => Object.fromEntries(Object.entries(d).filter(([k]) => !(KEEP as readonly string[]).includes(k)))
  const keep = (d: PlanDay) => Object.fromEntries(KEEP.filter((k) => k in d).map((k) => [k, (d as any)[k]]))
  const da = strip(days[a]), db = strip(days[b])
  days[a] = { ...keep(days[a]), ...db } as PlanDay
  days[b] = { ...keep(days[b]), ...da } as PlanDay
}

/** [WEEK-1] At most maxQuality workouts a week. Extra ones, X-session first, become easy runs. */
export function enforceSessionBudget(plan: SafePlan, maxQuality?: number | null): SafePlan {
  if (!maxQuality) return plan
  const notes: string[] = []
  for (const w of plan.weeks) {
    const quality = w.days.filter((d) => QUALITY_TYPES.includes(d.type))
    if (quality.length <= maxQuality) continue
    // X-sessions first, then single sessions before double-threshold days.
    const rank = (d: PlanDay) => (d.type !== 'x' ? 2 : 0) + (/double/i.test(d.title || '') ? 1 : 0)
    quality.sort((a, b) => rank(a) - rank(b))
    const easyKm = w.days.find((d) => d.type === 'easy' && d.km)?.km
    const easySize = easyKm ? { km: easyKm } : weekEasySize(w.days)
    for (const d of quality.slice(0, quality.length - maxQuality)) {
      const size = easySize || (d.km || !d.minutes ? { km: Math.max(3, pyRound((d.km || 8) * 0.8)) } : { minutes: Math.max(20, pyRound(d.minutes * 0.8)) })
      easyVersion(d, size, plan.paces)
      notes.push(`[WEEK-1] Week ${w.week}: ${d.weekday} changed to an easy run (at most ${maxQuality} workouts a week).`)
    }
  }
  addNotes(plan, notes)
  return plan
}

/** [DT-1] Double-threshold days per week: recreational at most 1, ambitious/elite at most 2, beginners none. */
export function enforceDoubleDays(plan: SafePlan, category: string): SafePlan {
  const limit = category.includes('Beginner') ? 0 : category.includes('Recreational') ? 1 : 2
  const notes: string[] = []
  for (const w of plan.weeks) {
    const doubles = w.days.filter((d) => d.type === 'golden' && /double/i.test(d.title || ''))
    for (const d of doubles.slice(limit)) {
      d.title = 'Golden Zone session'
      d.steps = (d.steps || []).filter((st) => !/^(pm|evening|afternoon)/i.test(String(st.label || '')))
      d.summary = 'One Golden Zone session today (single, not double).'
      notes.push(`[DT-1] Week ${w.week}: ${d.weekday} kept as a single session (at most ${limit} double day(s) a week).`)
    }
  }
  addNotes(plan, notes)
  return plan
}

/** [VOL-3] No run grows more than 10% beyond the longest run so far. [LONG-1] 5K/10K long runs cap at 90 min. */
export function enforceLongRuns(plan: SafePlan, profile: BrainProfile, recentLongest: number | null): SafePlan {
  const easyS = easySeconds(plan)
  const goal = `${profile.primary_goal || ''} ${profile.target_race || ''}`.toLowerCase()
  const cap90 = /half|marathon|21|42/.test(goal) ? null : pyRound((90 * 60) / easyS)
  let longest = recentLongest
  const notes: string[] = []
  for (const w of plan.weeks) {
    for (const d of w.days) {
      // Time-based easy and long runs count too, by their time at the easy pace.
      const timed = !isNum(d.km) && isNum(d.minutes) && (d.type === 'easy' || d.type === 'long')
      let km = isNum(d.km) ? d.km : timed ? ((d.minutes as number) * 60) / easyS : null
      if (!km || d.type === 'race' || d.type === 'rest') continue
      let limit = longest ? pyRound(longest * 1.1) : null
      if (d.type === 'long' && cap90) limit = limit ? Math.min(limit, cap90) : cap90
      if (limit && km > limit) {
        scaleDay(d, limit / km)
        const rule = cap90 && limit === cap90 ? '[LONG-1] long run up to 90 minutes for a 5K/10K goal' : '[VOL-3] at most 10% over the longest recent run'
        notes.push(timed
          ? `Week ${w.week}: ${d.title} (${d.weekday}) cut to ${d.minutes} min (${rule}).`
          : `Week ${w.week}: ${d.title} (${d.weekday}) ${km} -> ${d.km} km (${rule}).`)
        km = timed ? ((d.minutes as number) * 60) / easyS : (d.km as number)
      }
      longest = Math.max(longest || 0, km)
    }
  }
  addNotes(plan, notes)
  return plan
}

/** The volume law: only ever lowers volume. Easy and long runs absorb the cut first, so the quality sessions stay. */
export function enforceProgression(plan: SafePlan, profile: BrainProfile, baseline: number | null, baselineSrc: string): SafePlan {
  const easyS = easySeconds(plan)
  const weeks = plan.weeks
  const [cycle, cycleText] = progressionCycle(profile, weeks.length)
  const [ceiling, ceilingKind] = volumeCeiling(profile, baseline)
  const notes: string[] = []
  const totals: number[] = []
  let prevBuild = baseline
  weeks.forEach((w, idx) => {
    const i = idx + 1
    let km = w.days.reduce((a, d) => a + dayKm(d, easyS), 0)
    const taper = /taper|race/i.test(String(w.phase || '')) || i === weeks.length
    const recovery = !taper && isRecoveryWeek(cycle, i)
    let cap: number | null = null
    if (prevBuild) {
      cap = recovery ? prevBuild * 0.8 : taper ? prevBuild : i === 1 ? prevBuild * 1.05 : Math.min(prevBuild * 1.1, prevBuild + 8)
      if (ceiling && !recovery) cap = Math.min(cap, ceiling)
    }
    if (cap && km > cap + 0.5) {
      const easy = w.days.filter((d) => d.type === 'easy' || d.type === 'long')
      const easyKm = easy.reduce((a, d) => a + dayKm(d, easyS), 0)
      const cut = km - cap
      if (easyKm > cut) easy.forEach((d) => scaleDay(d, (easyKm - cut) / easyKm))
      else w.days.forEach((d) => scaleDay(d, cap! / km))
      const why = recovery ? '[CYC-1] easier week: at least 20% under the week before'
        : taper ? '[TAPER-3] taper: no increase' : i === 1 ? '[VOL-1] week 1 starts at the current level'
        : ceiling && Math.abs(cap - ceiling) < 0.5 ? '[VOL-4] the weekly ceiling' : '[VOL-2] at most +10% and +8 km on the week before'
      notes.push(`Week ${i}: ${pyRound(km)} -> ${pyRound(cap)} km (${why}).`)
      km = cap
    }
    if (recovery) {
      if (!/recover/i.test(String(w.focus || ''))) w.focus = `${w.focus || ''} · recovery week`
    } else if (!taper) {
      prevBuild = km // the next build week is measured against this one
    }
    totals.push(pyRound(km))
  })
  for (const w of weeks) for (const d of w.days) if (isNum(d.km) && d.km > 0) d.km = Math.max(1, pyRound(d.km)) // whole km
  plan.safety = {
    cycle, cycle_text: cycleText, laws: VOLUME_LAWS,
    baseline_km: baseline ? pyRound(baseline) : null, baseline_source: baselineSrc,
    ceiling_km: ceiling ? pyRound(ceiling) : null, ceiling_kind: ceilingKind,
    weekly_km: totals, adjustments: [...(plan.safety?.adjustments || []), ...notes],
  }
  plan.volume_story = volumeStory(plan, profile)
  return plan
}

/** The kilometres explained in plain words, from the numbers (no AI). Coach-facing wording. */
export function volumeStory(plan: SafePlan, profile: BrainProfile): string {
  const sf = plan.safety!
  const km = sf.weekly_km
  if (!km.length) return ''
  const base = sf.baseline_km
  const peak = Math.max(...km)
  const peakWeek = km.indexOf(peak) + 1
  const firstDrop = km.slice(1).some((b, n) => b < km[n] * 0.85)
  const goal = String(profile.volume_goal || '').toLowerCase()
  const easier = ({ '3:1': 'every 4th week', '2:1': 'every 3rd week', '1:1': 'every other week' } as Record<string, string>)[sf.cycle] || 'every 4th week'
  const parts: string[] = []
  if (base) parts.push(`Recent volume is about ${base} km a week, so that's where the season starts.`)
  if (/keep|same|maintain|current/.test(goal)) {
    parts.push(`Kilometres stay around ${base} km: the progress comes from the Golden Zone sessions getting better, not from running more.`)
  } else if (base && peak > base) {
    const rises: number[] = []
    let lastBuild = base
    for (const k of km) { // build week against build week; coming back after an easier week isn't a rise
      if (k < lastBuild * 0.85) continue
      if (k > lastBuild) rises.push(k - lastBuild)
      lastBuild = k
    }
    const stepUp = rises.length ? Math.max(...rises) : 0
    parts.push(`It builds to ${peak} km in week ${peakWeek}, never adding more than ${stepUp} km in a week: a small rise the body absorbs beats a big one it has to recover from.`)
  }
  if (firstDrop) parts.push(`${easier.charAt(0).toUpperCase()}${easier.slice(1)} is lighter, so the work from the weeks before actually lands.`)
  if (/taper|race/i.test(String(plan.weeks[plan.weeks.length - 1]?.phase || ''))) parts.push(`The last weeks come down to ${km[km.length - 1]} km for a fresh race.`)
  return parts.join(' ')
}

/** [CYC-1] An easier week also has one workout fewer than a normal week (never fewer than one). */
export function enforceEasierWeekWorkouts(plan: SafePlan, maxQuality?: number | null): SafePlan {
  if (!maxQuality || maxQuality <= 1 || !plan.safety?.cycle) return plan
  const notes: string[] = []
  plan.weeks.forEach((w, idx) => {
    if (!/recovery/i.test(String(w.focus || ''))) return
    const quality = w.days.filter((d) => QUALITY_TYPES.includes(d.type)).sort((a, b) => Number(a.type !== 'x') - Number(b.type !== 'x'))
    for (const d of quality.slice(0, Math.max(0, quality.length - (maxQuality - 1)))) {
      const size = weekEasySize(w.days) || { km: 6 }
      const title = d.title
      easyVersion(d, size, plan.paces)
      notes.push(`[CYC-1] Week ${idx + 1}: ${title} on ${d.weekday} became an easy run (easier week: one workout fewer).`)
    }
  })
  addNotes(plan, notes)
  return plan
}

/** Rest day and long-run day are the athlete's; where the plan put them elsewhere, the days swap. */
export function enforceAnchors(plan: SafePlan, profile: BrainProfile): SafePlan {
  const rest = profile.rest_day, longDay = profile.long_run_day
  const notes: string[] = []
  for (const w of plan.weeks) {
    const days = w.days
    const idx: Record<string, number> = {}
    days.forEach((d, n) => { if (d.weekday) idx[d.weekday] = n })
    if (longDay && longDay in idx) {
      const longs = days.map((d, n) => (d.type === 'long' ? n : -1)).filter((n) => n >= 0)
      if (longs.length && days[idx[longDay]].type !== 'long') {
        swapDays(days, longs[0], idx[longDay])
        notes.push(`[anchor] Week ${w.week}: long run moved to ${longDay}.`)
      }
    }
    if (rest && rest in idx && days[idx[rest]].type !== 'rest') {
      const rests = days.map((d, n) => (d.type === 'rest' && n !== (longDay ? idx[longDay] : undefined) ? n : -1)).filter((n) => n >= 0)
      if (rests.length) {
        swapDays(days, rests[0], idx[rest])
        notes.push(`[anchor] Week ${w.week}: rest moved to ${rest}.`)
      }
    }
  }
  addNotes(plan, notes)
  return plan
}

/** [WEEK-2] No hard day directly after another: the second moves to an easy day with easy days around it,
 *  or becomes an easy run when there's no such day. */
export function enforceSpacing(plan: SafePlan): SafePlan {
  const notes: string[] = []
  for (const w of plan.weeks) {
    const days = w.days
    const hard = (n: number) => n >= 0 && n < days.length && HARD_TYPES.includes(days[n].type)
    for (let n = 1; n < days.length; n++) {
      if (!(hard(n) && hard(n - 1)) || days[n].type === 'race') continue
      const spot = days.findIndex((d, j) => d.type === 'easy' && !hard(j - 1) && !hard(j + 1) && j !== n && j !== n - 1)
      if (spot >= 0) {
        const a = days[n], b = days[spot]
        swapDays(days, n, spot)
        notes.push(`[WEEK-2] Week ${w.week}: ${a.title} moved from ${a.weekday} to ${b.weekday} (no hard days back to back).`)
      } else {
        const size = weekEasySize(days) || { km: 6 }
        const title = days[n].title
        easyVersion(days[n], size, plan.paces)
        notes.push(`[WEEK-2] Week ${w.week}: ${title} on ${days[n].weekday} became an easy run (it followed a hard day).`)
      }
    }
  }
  addNotes(plan, notes)
  return plan
}

/** All code-checked rules, in the brain's order. */
export function enforceAll(plan: SafePlan, opts: {
  profile: BrainProfile; category: string; maxQuality?: number | null
  baseline: number | null; baselineSrc: string; recentLongest: number | null
}): SafePlan {
  let p = enforceSessionBudget(plan, opts.maxQuality)
  p = enforceDoubleDays(p, opts.category)
  p = enforceLongRuns(p, opts.profile, opts.recentLongest)
  p = enforceProgression(p, opts.profile, opts.baseline, opts.baselineSrc)
  p = enforceEasierWeekWorkouts(p, opts.maxQuality)
  p = enforceAnchors(p, opts.profile)
  return enforceSpacing(p)
}
