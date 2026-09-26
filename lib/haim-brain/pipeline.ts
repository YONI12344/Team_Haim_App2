// The athlete pipeline: turns an athlete's data into the plan decisions by stepping through the
// brain's protocol rules in order -- plain code, no AI, every step traceable.
// Ported from the TeamHaim brain's pipeline.py; keep the two in step.

import sessionCatalog from './data/protocols/session_catalog_and_matching.json'
import paceProtocol from './data/protocols/pace_and_readiness_protocol.json'
import { findRaceResult, pacesFromRace } from './paces'

export const BEGINNER = 'Beginner (building a base)'

/** The brain's profile shape (the onboarding answers it was built on). */
export type BrainProfile = Record<string, string | undefined>

export interface Step { step: string; source: string; result: Record<string, any>; reasoning: string }
export interface Choice { topic: string; choice: string; why: string }

const step = (name: string, source: string, result: Record<string, any>, reasoning: string): Step =>
  ({ step: name, source, result, reasoning })

export function parseKm(value: unknown): number | null {
  const m = String(value ?? '').match(/(\d+(?:\.\d+)?)/)
  if (!m) return null
  const v = Number(m[1])
  return /\bmi(les?)?\b/.test(String(value).toLowerCase()) ? Math.round(v * 1.609 * 10) / 10 : v
}

export type HillAccess = 'good' | 'short' | 'treadmill' | 'none' | 'unknown'

export function hillAccess(profile: BrainProfile): HillAccess {
  const ans = (profile.hill_access || '').toLowerCase()
  if (ans) {
    if (ans.startsWith('yes')) return 'good'
    if (ans.includes('short')) return 'short'
    if (ans.includes('treadmill')) return 'treadmill'
    return 'none'
  }
  const env = (profile.training_environment || '').toLowerCase()
  if (/\bhills?\b|hilly|mountain|trail/.test(env)) return 'good'
  if (env.includes('treadmill') || (profile.equipment_access || '').toLowerCase().includes('treadmill')) return 'treadmill'
  return 'unknown'
}

const isPastInjury = (injury: string) => /\b(ago|healed|old|past|previous)\b/.test(injury)

export function categorizeAthlete(profile: BrainProfile): Step {
  const experience = (profile.running_experience || '').toLowerCase()
  const hours = (profile.weekly_hours_available || '').toLowerCase()
  const consistency = (profile.training_consistency_last_year || '').toLowerCase()
  const weekly = parseKm(profile.weekly_mileage)
  let category: string
  let reasoning: string
  if (experience.includes('elite')) {
    category = 'Elite / sub-elite'
    reasoning = "running_experience is 'Elite / collegiate / professional'."
  } else if (experience.includes('just starting') || consistency.includes('just getting') || (weekly !== null && weekly < 15)) {
    category = BEGINNER
    reasoning = 'New to running, just (re)starting, or under 15 km a week -- no base yet for the three-key-session structure.'
  } else if (experience.includes('competitive') && (hours === '6-8 hours' || hours === '8+ hours')) {
    category = 'Ambitious (roughly 6-8+ hours / week)'
    reasoning = `running_experience is Competitive AND weekly_hours_available is '${profile.weekly_hours_available}'.`
  } else {
    category = 'Recreational (roughly 4-6 hours / week)'
    reasoning = "Default category -- doesn't meet the Ambitious or Elite signal thresholds."
  }
  const cats = (sessionCatalog as any).step_1_match_athlete_to_a_category?.categories || []
  let matched = cats.find((c: any) => c.category === category) || {}
  if (category === BEGINNER) {
    matched = {
      structure: 'Mostly easy running to build the base. At most one short, gentle Golden Zone session a week (total threshold time capped at 20-25 min, the cautious-entry rule), no X-session and no double threshold until 3+ weeks of consistent running.',
      source_chapter: '5',
    }
  }
  return step('1. Categorize athlete', 'session_catalog_and_matching.json -> step_1',
    { category, structure_note: matched.structure || '', source_chapter: matched.source_chapter || '' }, reasoning)
}

export function structureDoubleThreshold(cat: Step, profile: BrainProfile): Step {
  const category: string = cat.result.category
  const returning = (profile.returning_from_layoff || '').toLowerCase().startsWith('yes')
  const longBreaks = (profile.training_consistency_last_year || '').toLowerCase().includes('long break')
  const src = 'session_catalog_and_matching.json -> step_1 (category structure notes), Chapters 6 & 7'
  const eligible = category.includes('Ambitious') || category.includes('Elite')
  if (eligible && (returning || longBreaks)) {
    return step('1b. Double-threshold structuring', src, { applies: false, result: null, deferred: true },
      `${category} would normally use double threshold, but the athlete is returning from a break -- rebuild single sessions first.`)
  }
  if (!eligible) {
    return step('1b. Double-threshold structuring', src, { applies: false, result: null },
      `Skipped -- only Ambitious and Elite athletes use double threshold; this athlete is '${category}'.`)
  }
  const structure = category.includes('Ambitious')
    ? 'Session 2 (support quality) becomes a double-threshold day -- a second, shorter threshold session added later the same day.'
    : '2-3 double-threshold sessions per week as the general load, lactate-guided -- see chapter 7 for the full protocol.'
  return step('1b. Double-threshold structuring', src, { applies: true, structure },
    `${category} athletes use double threshold per the book's own structure notes for this level.`)
}

export function resolvePace(profile: BrainProfile, extraTexts: unknown[] = []): Step {
  const known = (profile.known_threshold_pace || '').trim().toLowerCase()
  const equipment = (profile.equipment_access || '').toLowerCase()
  const experience = (profile.running_experience || '').toLowerCase()
  const recentPr = (profile.recent_pr || '').trim().toLowerCase()
  if (known && !['unknown', 'none', 'no idea'].includes(known)) {
    return step('2. Resolve pace', 'pace_and_readiness_protocol.json -> step_1 (athlete-reported)',
      { status: 'known', value: profile.known_threshold_pace, method: 'athlete-reported' },
      'A known threshold pace was given -- use it and cross-check informally rather than re-testing from scratch.')
  }
  const levelKey = experience.includes('elite') ? 'Elite / sub-elite'
    : experience.includes('competitive') ? 'Ambitious (roughly 6-8+ hours/week)' : 'Recreational (roughly 4-6 hours/week)'
  const byLevel = (paceProtocol as any).step_1_estimate_the_golden_zone_pace?.how_to_choose_a_method_by_athlete_level || []
  let method: string = byLevel.find((e: any) => e.level === levelKey)?.start_with || '30-minute time trial + talk test'
  let reasoning: string
  if (method.toLowerCase().includes('lactate') && !equipment.includes('lactate meter')) {
    method = 'Three-point method (field test + extended talk test + heart-rate method) -- no lactate meter available'
    reasoning = `Level is ${levelKey}, protocol recommends lactate, but there is no lactate meter -- falling back to the three-point method.`
  } else if (method.toLowerCase().includes('vdot') && !recentPr) {
    method = '30-minute time trial + talk test (VDOT unavailable -- no recent race result)'
    reasoning = `Level is ${levelKey}, protocol recommends VDOT from a recent race, but no recent race result was given.`
  } else {
    reasoning = `Level is ${levelKey} -- using the protocol's default starting method for that level.`
  }
  const result: Record<string, any> = { status: 'needs_test', method }
  const race = findRaceResult([profile.recent_pr, profile.known_threshold_pace, ...extraTexts])
  if (race) {
    const est = pacesFromRace(race.distance_km, race.seconds)
    result.race_estimate = { from: race.text, vdot: est.vdot, t_pace: est.t_pace, paces: est.paces, race_pace: est.race_pace }
    reasoning += ` Provisional paces from the race result '${race.text}' (VDOT ${est.vdot}) until the test confirms them.`
  }
  return step('2. Resolve pace', 'pace_and_readiness_protocol.json -> step_1 (by-level method selection)', result, reasoning)
}

export function decideStrength(profile: BrainProfile): Step {
  const age = Number(profile.age) || null
  const injury = (profile.injury_history || '').toLowerCase()
  const goal = (profile.primary_goal || '').toLowerCase()
  const reasons: string[] = []
  let verdict = 'probably_not_necessary'
  if (['stress fracture', 'bone density', 'osteopenia', 'osteoporosis'].some((k) => injury.includes(k))) {
    verdict = 'yes_definitely'
    reasons.push("Injury history mentions bone stress / low bone density -- the book's explicit 'yes definitely' criterion.")
  } else if (injury && !['none', 'no', 'n/a', 'no injuries', 'none current'].includes(injury)) {
    verdict = 'worth_considering'
    reasons.push(age && age > 50 ? "Over 50 with an injury history -- both 'worth considering' criteria met."
      : "Has a notable injury history -- 'worth considering', after checking for a recent load spike.")
  } else if (age && age > 50) {
    verdict = 'worth_considering'
    reasons.push('Over 50 -- strength work is worth considering to preserve muscle mass.')
  } else if (goal.includes('plateau')) {
    verdict = 'worth_considering'
    reasons.push("Describes a performance plateau -- one of the book's 'worth considering' criteria.")
  } else {
    reasons.push("Under 50, no significant injury history, no plateau -- the book's default is NOT to prescribe strength work.")
  }
  return step('3. Decide on strength training', 'injury_and_strength_protocol.json -> step_1',
    { verdict, placement_if_yes: verdict !== 'probably_not_necessary' ? 'Model C -- same day as the X-session' : null }, reasons.join(' '))
}

export function assembleSkeleton(cat: Step): Step {
  const three = (sessionCatalog as any).step_2_the_three_key_sessions || {}
  const template = (sessionCatalog as any).step_4_reference_weekly_template || {}
  const keySessions: Record<string, string> = {}
  for (const [k, v] of Object.entries(three)) if (v && typeof v === 'object') keySessions[k] = (v as any).definition ?? v
  return step('5. Assemble session skeleton', 'session_catalog_and_matching.json -> step_2/step_4',
    { three_key_sessions: keySessions, reference_week: template.week || [] },
    `Three-key-session framework and reference week for category: ${cat.result.category}.`)
}

export function decideXSession(cat: Step, profile: BrainProfile): Step {
  const category: string = cat.result.category
  const access = hillAccess(profile)
  const src = "Chapters 5 & 6 (hill training, X-session), applied to the athlete's hill access"
  const flat = {
    build_phase: '30/30 or 45/15 blocks on the flat (Ch. 6 alternative to hill sessions)',
    specific_phase: 'Race-pace-specific work (Ch. 5-6)',
  }
  if (category === BEGINNER) {
    return step('6. X-session & hills', src, { hills: false, access, form: null,
      why: "No hill sessions yet: the base comes first, and hills are an X-session tool -- the extra piece that comes after the easy running is solid." },
      'Beginner branch has no X-session, so no hill work regardless of access.')
  }
  const injury = (profile.injury_history || '').toLowerCase()
  if (/achilles|calf|plantar|soleus/.test(injury) && !isPastInjury(injury)) {
    return step('6. X-session & hills', src, { hills: false, access, form: null, ...flat,
      why: 'No hills for now: uphill running loads the Achilles and calf hardest, and this one needs calm first. Flat 30/30 or 45/15 blocks do the job until running is pain-free, then hills can come in (a TeamHaim safety rule).' },
      'Current Achilles/calf/foot injury: hill work deferred regardless of access.')
  }
  const build: Record<string, string> = {
    good: 'Hill session: 8-10 x 60-75 s uphill (Ch. 6), or 10 x 200 m building toward 10 x 300 m over the weeks (Ch. 5), jog down to recover',
    short: 'Short hill sprints: 8-10 x 60-100 m uphill, walk/jog back down (Ch. 6 periodized hills, short-hill week)',
    treadmill: 'Treadmill hills: 8-10 x 60-75 s at a steep incline, easy flat jog between -- a stand-in for a real hill',
  }
  if (build[access]) {
    const why: Record<string, string> = {
      good: 'Hills are in the build phase. Running uphill is strength work built into the running itself, at lower speed and lower injury risk (Bakken, Ch. 5-6). Closer to the race they alternate with flat race-pace work, then give way to race-specific sessions.',
      short: 'The hills are short, so short hill sprints replace the long-rep version: the strength stimulus without needing a 2-3 minute climb.',
      treadmill: 'No outdoor hill, so hill reps happen on the treadmill incline. A stand-in for a real hill (a TeamHaim adaptation, not a protocol from the book).',
    }
    return step('6. X-session & hills', src, { hills: true, access, build_phase: build[access],
      specific_phase: 'Alternate: hills one week, flat race-pace work (e.g. 45/15 or race-pace reps) the next (Ch. 5)',
      last_3_weeks: 'Flat, race-specific X-session only; no hills', why: why[access] },
      `Hill access is '${access}', so the X-session uses hills in the build phase.`)
  }
  const why = access === 'unknown'
    ? "No hill sessions, because the app doesn't say whether this athlete has a hill. The X-session uses 30/30 or 45/15 blocks on the flat, the book's alternative (Ch. 6). Set hill access on this page to bring them in."
    : "No hill sessions: no hill to train on. The same muscular load comes from 30/30 or 45/15 blocks on the flat, which the book lists as the alternative to hill sessions (Ch. 6)."
  return step('6. X-session & hills', src, { hills: false, access, ...flat, why }, `Hill access is '${access}' -- flat alternatives instead of hills.`)
}

export function explainChoices(steps: Step[]): Choice[] {
  const [cat, dt, pace, strength, , xs] = steps
  const category: string = cat.result.category
  const short = category.split(' (')[0].split(' /')[0]
  const levelWhy: Record<string, string> = {
    Beginner: "New to running or building back up, so the plan starts with mostly easy running and brings in Golden Zone work gently.",
    Recreational: 'About 4-6 hours a week. At this level the book builds the week around three key sessions, with every other run easy (Bakken, Ch. 5).',
    Ambitious: 'Races regularly and trains 6-8+ hours a week: the same three key sessions, with more threshold volume (Bakken, Ch. 6).',
    Elite: 'Elite or collegiate level: two to three double-threshold days a week, guided by lactate (Bakken, Ch. 6-7 and 13).',
  }
  const out: Choice[] = [{ topic: 'Level', choice: short, why: levelWhy[short] || cat.reasoning }]
  const r = dt.result
  if (r.applies) out.push({ topic: 'Double threshold', choice: 'Yes', why: 'At this training volume the book uses double threshold: two shorter Golden Zone sessions on the same day instead of one long one, so more threshold time with less strain per session (Bakken, Ch. 6-7).' })
  else if (r.deferred) out.push({ topic: 'Double threshold', choice: 'Not yet', why: 'The level would use it, but the athlete is coming back from a break. Rebuild single sessions first, then add the second session of the day.' })
  else out.push({ topic: 'Double threshold', choice: 'No', why: 'Double threshold is for runners training about 6-8+ hours a week (Bakken, Ch. 6-7). At this level, three well-run key sessions give the best return.' })
  out.push({ topic: 'Hills', choice: xs.result.hills ? 'Yes' : 'No', why: xs.result.why })
  const v = strength.result.verdict
  const strengthWhy: Record<string, string> = {
    yes_definitely: "Bone-stress history, the book's clearest case for strength training. It goes on the same day as the X-session, the placement runners tolerated best (Bakken, Ch. 10).",
    worth_considering: 'Age or injury history is one of the cases where the book says strength work pays off. Short sessions on hard days, never at the cost of the running.',
  }
  out.push({ topic: 'Strength training', choice: v === 'yes_definitely' ? 'Yes' : v === 'worth_considering' ? 'Worth considering' : 'Not needed now',
    why: strengthWhy[v] || 'For a healthy runner under 50 with no plateau, the book says more running gives a better return than strength work.' })
  const p = pace.result
  const method = String(p.method || '').split(' -- ')[0].split(' (VDOT')[0].toLowerCase()
  if (p.status === 'known') out.push({ topic: 'Paces', choice: 'From known threshold', why: 'A threshold pace is on file, so the plan uses it and checks it against how sessions feel.' })
  else if (p.race_estimate) out.push({ topic: 'Paces', choice: 'From race, test to confirm', why: `The ${p.race_estimate.from} gives starting paces (VDOT ${p.race_estimate.vdot}, Bakken Ch. 2). The first week's test confirms or corrects them: ${method}.` })
  else out.push({ topic: 'Paces', choice: 'Test first', why: `No recent race on file, so the first week's test sets the paces: ${method}.` })
  return out
}

export function runPipeline(profile: BrainProfile, extraTexts: unknown[] = []) {
  const s1 = categorizeAthlete(profile)
  const s1b = structureDoubleThreshold(s1, profile)
  const s2 = resolvePace(profile, extraTexts)
  const s3 = decideStrength(profile)
  const s4 = step('4. Assess current shape', 'adaptive_progression_protocol.json', { overall_state: 'unknown' },
    'Shape is read from logged sessions by the coach; start at the category default.')
  const s5 = assembleSkeleton(s1)
  const s6 = decideXSession(s1, profile)
  return {
    trace: [s1, s1b, s2, s3, s4, s5, s6],
    planRequest: {
      category: s1.result.category, double_threshold: s1b.result, pace: s2.result, strength_decision: s3.result,
      shape_adjustment: s4.result, session_skeleton: s5.result, x_session_and_hills: s6.result,
    },
    choices: explainChoices([s1, s1b, s2, s3, s4, s6]),
  }
}
