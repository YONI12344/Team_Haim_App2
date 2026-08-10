// Deterministic post-generation backstops for the Bakken plan generator.
// Framework-free (no React, no Firebase) so both the client-side coach
// panel (components/coach/bakken-plan-panel.tsx) and any server-side code
// (e.g. an API route for local preview generation) can call the exact same
// logic — no manually-synced duplicate copies.
//
// Every function here exists because the equivalent instruction in
// plan-prompt.ts, even phrased as an explicit "hard rule", was verified in
// practice to not be reliable enough on its own — see each function's own
// comment for the specific violation that was found and how it was
// verified (real API test, or a live athlete's actual plan).

import { format, addDays, parseISO, startOfWeek } from 'date-fns'
import type { BlockStageInfo } from './plan-prompt'
import safetyRules from './safety-rules.json'

export interface BlockWorkoutOut {
  date: string
  session?: 'am' | 'pm' | 'other'
  type: string
  title: string
  description: string
  warmup?: string | null
  cooldown?: string | null
  notes?: string | null
  duration?: number | null
  distance?: number | null
  targetThresholdLevel?: 'T1' | 'T2' | 'T3' | null
  bakkenLactateMin?: number | null
  bakkenLactateMax?: number | null
  comparisonGroup?: string | null
  thresholdDistance?: number | null
  sets?: Array<{
    reps: number
    distanceMeters?: number | null
    durationSec?: number | null
    restBetweenReps?: string | null
    restAfterSet?: string | null
    notes?: string | null
    intervals?: Array<{
      distanceMeters?: number | null
      durationSec?: number | null
      notes?: string | null
    }>
  }>
}

export type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
export type DayType = 'workout' | 'rest' | 'off'
export const DAY_ORDER: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
export const DAY_INDEX: Record<DayKey, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}

const addDaysStr = (dateStr: string, n: number) => format(addDays(parseISO(dateStr), n), 'yyyy-MM-dd')
const dateMin = (a: string, b: string) => (a < b ? a : b)
const weekKeyOf = (dateStr: string) => format(startOfWeek(parseISO(dateStr), { weekStartsOn: 0 }), 'yyyy-MM-dd')

// Coach-set fixed weekly sessions (AthleteProfile.recurringActivities) are a
// hard rule in the prompt (rule 2b), but per this session's established
// pattern, a "hard rule" phrased in prose alone isn't reliable enough to
// skip a code-level safety net for — same reasoning as every other
// backstop here. Verified in a real test run this needed two real fixes
// beyond the basic insert: (1) a bare "duration: null" placeholder violates
// the schema's own expectation that every non-rest type has a duration —
// defaults to 45min, a reasonable typical gym/yoga length; (2) inserting
// it ALONGSIDE an existing "rest" entry (rather than replacing it) created
// a same-date pair where neither side is tagged am/pm — enforceSameDay
// SessionTags correctly leaves that alone since neither side has a real
// signal, so the ambiguity survived. A rest day getting a real activity
// isn't a genuine two-session day, it's just "this day became a gym day"
// — so a rest-only day gets overwritten in place instead of added to.
// Otherwise additive (never replaces a REAL existing session) — only
// skips a date already at 2 real entries (e.g. a double-threshold pair),
// since forcing a 3rd same-date entry isn't a case the rest of the app's
// same-day rendering is built to handle.
const RECURRING_ACTIVITY_DEFAULT_MINUTES = 45
export const enforceRecurringActivities = (
  workouts: BlockWorkoutOut[],
  recurringActivities: Array<{
    dayOfWeek: DayKey
    frequency: 'every_week' | 'every_other_week'
    type: string
    title: string
    notes?: string
  }> | undefined,
  seasonStartDate: string,
  language: 'en' | 'he',
): BlockWorkoutOut[] => {
  if (!recurringActivities || recurringActivities.length === 0) return workouts
  const seasonWeekStart = weekKeyOf(seasonStartDate)
  const weeksPresent = new Set(workouts.map((w) => weekKeyOf(w.date)))
  for (const activity of recurringActivities) {
    for (const weekStart of weeksPresent) {
      const weekNumber = Math.floor(
        (parseISO(weekStart).getTime() - parseISO(seasonWeekStart).getTime()) / (7 * 86400000),
      ) + 1
      if (activity.frequency === 'every_other_week' && weekNumber % 2 === 0) continue
      const targetDate = addDaysStr(weekStart, DAY_INDEX[activity.dayOfWeek])
      const dayEntries = workouts.filter((w) => w.date === targetDate)
      if (dayEntries.some((w) => w.type === activity.type && w.title === activity.title)) continue

      const restEntries = dayEntries.filter((w) => w.type === 'rest')
      if (restEntries.length > 0 && restEntries.length === dayEntries.length) {
        // The whole day is currently just rest placeholder(s) — overwrite
        // the first one in place and drop any extras, rather than adding a
        // second, ambiguous same-date entry next to a day that's really
        // just "nothing happening here."
        const target = restEntries[0]
        target.type = activity.type
        target.title = activity.title
        target.description = activity.notes || (language === 'he' ? 'אימון קבוע שבועי.' : 'Standing weekly session.')
        target.duration = RECURRING_ACTIVITY_DEFAULT_MINUTES
        target.distance = null
        target.sets = []
        for (const extra of restEntries.slice(1)) {
          const idx = workouts.indexOf(extra)
          if (idx >= 0) workouts.splice(idx, 1)
        }
        continue
      }

      if (dayEntries.length >= 2) continue
      workouts.push({
        date: targetDate,
        session: dayEntries.length === 1
          ? (dayEntries[0].session === 'am' ? 'pm' : dayEntries[0].session === 'pm' ? 'am' : 'other')
          : 'other',
        type: activity.type,
        title: activity.title,
        description: activity.notes || (language === 'he' ? 'אימון קבוע שבועי.' : 'Standing weekly session.'),
        duration: RECURRING_ACTIVITY_DEFAULT_MINUTES,
        distance: null,
        sets: [],
      })
    }
  }
  return workouts
}

// The model asking it to "check the weekly sum" in the prompt (see rule 3 in
// plan-prompt.ts) isn't reliable enough on its own — weekly totals kept
// drifting well off the stage's weeklyVolumeKm target in practice. This is
// the deterministic backstop: after generation, actually sum each calendar
// week's distance and rescale if it's off by more than 15%, instead of
// trusting the model's arithmetic. Only touches flexible-distance sessions
// (easy/long_run/recovery) — never the rep structure (sets/intervals) on a
// structured session, so "5x6min" stays "5x6min". Rescales `duration`
// alongside `distance` by the same factor so pace stays what it was —
// distance-only rescaling used to silently turn a normal-paced long run
// into an impossibly fast one once its distance got stretched.
// Every Nth week within a base/build/peak stage gets its flexible-volume
// target cut by 25% — a standard cutback/deload week so fatigue can
// actually absorb into fitness instead of accumulating in one uninterrupted
// ramp for the whole stage. Nothing in the brain or the prompt handled this
// at all before (verified: no "cutback"/"deload"/"recovery week" mention
// anywhere in brain.json or plan-prompt.ts) — this is a genuine gap, not a
// prompt-reliability issue, so it's implemented directly here rather than
// left to the model to remember across every block-generation call.
// Beginners/recreational athletes cut back more often (every 3rd week,
// less fatigue tolerance) than everyone else (every 4th).
const CUTBACK_STAGE_TYPES = new Set(['base', 'build', 'peak'])
export const isCutbackWeek = (
  weekStart: string,
  stage: BlockStageInfo,
  experienceLevel: string | undefined,
): boolean => {
  if (!CUTBACK_STAGE_TYPES.has(stage.type)) return false
  const interval = experienceLevel === 'beginner'
    ? safetyRules.cutbackWeek.intervalWeeksBeginner
    : safetyRules.cutbackWeek.intervalWeeksDefault
  const weeksSinceStageStart = Math.floor(
    (parseISO(weekStart).getTime() - parseISO(stage.startDate).getTime()) / (7 * 86400000),
  )
  const weekNumber = weeksSinceStageStart + 1 // 1-indexed
  return weekNumber > 0 && weekNumber % interval === 0
}

// No cap at all existed for a plain "easy"/"recovery" day (only long_run
// had longRunMinutesCap) — verified in practice: when a week has very few
// flexible-distance days left to absorb that week's volume target, ALL of
// it can land on a single easy day, producing something like a 300min/40km
// "easy" run. Same safety idea as the long-run cap, just no per-athlete
// preset the way there is for long runs — scaled by level instead: a
// beginner/recreational easy day realistically never needs to exceed an
// hour, while an advanced/professional athlete's daily easy runs (not
// their actual long run) can legitimately run 90-120min at real volume.
export const easyDayMinutesCap = (experienceLevel: string | undefined): number => {
  if (experienceLevel === 'beginner') return safetyRules.easyDayMinutesCap.beginner
  if (experienceLevel === 'advanced' || experienceLevel === 'professional') return safetyRules.easyDayMinutesCap.advancedPlus
  return safetyRules.easyDayMinutesCap.intermediate // intermediate, or unset
}

export const normalizeWeeklyVolume = (
  workouts: BlockWorkoutOut[],
  stagesForBlock: BlockStageInfo[],
  seasonStartDate: string,
  goalRaceDate: string,
  longRunMinutesCap?: number,
  experienceLevel?: string,
): BlockWorkoutOut[] => {
  // Weeks are standard Sunday-Saturday calendar weeks — matching the km-per-
  // week widgets and week view everywhere else in the app (they all default
  // to weekStartsOn: 0). A season that doesn't start on a Sunday still gets
  // a short first calendar week (and block boundaries in generate() are
  // aligned to Sunday too, so that short week is never split across two
  // separate block-generation calls) — its target here is prorated by how
  // many of its 7 days actually fall within the season, not the full
  // 7-day target, so a 4-day stub week isn't held to a whole week's km.
  const weekKeyOf = (dateStr: string) => format(startOfWeek(parseISO(dateStr), { weekStartsOn: 0 }), 'yyyy-MM-dd')
  const weeks = new Map<string, BlockWorkoutOut[]>()
  for (const w of workouts) {
    const key = weekKeyOf(w.date)
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key)!.push(w)
  }
  // Only "easy"/"long_run"/"recovery" days have a genuinely flexible
  // distance — run a bit longer or shorter and the session is still
  // exactly what it says. tempo/threshold/intervals/hill_repeats/fartlek
  // are the OPPOSITE: their distance is a fixed consequence of a specific
  // rep count at a specific pace (e.g. 5x6min at threshold pace is
  // whatever km that comes out to, not a number you can freely dial up or
  // down without changing the actual structure). Rescaling those distances
  // to hit a weekly total produced physically impossible sessions in
  // practice — verified: a 5x6min threshold session and an 8x(1min/1min)
  // fartlek both got inflated to ~19km, nothing close to what those reps
  // actually cover. So the weekly-volume gap is only ever closed by
  // adjusting the flexible-distance days; structured session distances are
  // never touched here (they should already be realistic from the prompt
  // — see rule 12b in plan-prompt.ts — and if the model gets one wrong,
  // that's a prompt-accuracy problem, not something to paper over by
  // silently stretching an interval session into an impossible distance).
  const FLEXIBLE_DISTANCE_TYPES = new Set(['easy', 'long_run', 'recovery'])
  // A beginner run/walk "easy" session (rule 5c) and a quality long run
  // (rule 12's long_run guidance, intervals[]-based) both have a REAL fixed
  // rep structure even though their top-level type is 'easy'/'long_run' —
  // found via local-bakken-test.ts: rescaling their top-level
  // distance/duration while leaving that structure untouched produced a
  // session whose badge said "90min/12km" while its actual sets[] was
  // still "6 reps of 40s run" (a real ~16min session) — the two numbers
  // had nothing to do with each other. Only a session with NO sets[] at
  // all (a plain continuous run) is genuinely free to stretch or shrink.
  const hasFixedStructure = (w: BlockWorkoutOut) => (w.sets || []).length > 0
  for (const [weekStart, items] of weeks) {
    const midweek = addDaysStr(weekStart, 3)
    const stage = stagesForBlock.find((s) => midweek >= s.startDate && midweek <= s.endDate)
    if (!stage?.weeklyVolumeKm) continue
    const weekEnd = addDaysStr(weekStart, 6)
    const rangeStart = weekStart < seasonStartDate ? seasonStartDate : weekStart
    const rangeEnd = dateMin(weekEnd, goalRaceDate)
    const daysInSeason = Math.max(0, Math.min(7,
      Math.floor((parseISO(rangeEnd).getTime() - parseISO(rangeStart).getTime()) / 86400000) + 1))
    const cutback = isCutbackWeek(weekStart, stage, experienceLevel)
    const target = stage.weeklyVolumeKm * (daysInSeason / 7) * (cutback ? safetyRules.cutbackWeek.volumeMultiplier : 1)
    if (target <= 0) continue

    const flexibleItems = items.filter((w) => FLEXIBLE_DISTANCE_TYPES.has(w.type) && !hasFixedStructure(w))
    const fixedTotal = items
      .filter((w) => !FLEXIBLE_DISTANCE_TYPES.has(w.type) || hasFixedStructure(w))
      .reduce((sum, w) => sum + (w.distance || 0), 0)
    const flexibleTarget = target - fixedTotal
    if (flexibleTarget <= 0) continue // fixed-structure sessions alone already meet/exceed target — nothing to add via easy days

    const flexibleActual = flexibleItems.reduce((sum, w) => sum + (w.distance || 0), 0)
    if (flexibleActual <= 0) continue
    const ratio = flexibleActual / flexibleTarget
    if (ratio > 1.15 || ratio < 0.85) {
      const scale = flexibleTarget / flexibleActual
      for (const w of flexibleItems) {
        if (w.distance == null) continue
        // Scale duration by the SAME factor as distance so the implied pace
        // stays what it was — scaling distance alone (the old behavior)
        // left duration untouched, which silently turned a normal ~5:00/km
        // long run into something like 3:34/km once its distance got
        // stretched to close a weekly-volume gap. Verified in production:
        // a 100min long run scaled to 28km this way, an impossible pace for
        // a session described as "very relaxed".
        const originalDuration = w.duration
        w.distance = Math.max(1, Math.round(w.distance * scale))
        if (originalDuration != null) {
          w.duration = Math.max(5, Math.round((originalDuration * scale) / 5) * 5)
        }
      }
    }
  }

  // Unconditional safety cap — a rescale above only clamps things it
  // actually touched, so a day whose RAW model output was already over
  // cap (no rescale needed since the week's total already happened to be
  // within tolerance) sailed straight through uncapped. Verified in
  // practice: an advanced profile's easy day came out at 135min/22km
  // straight from the model, no rescale involved at all. Runs over every
  // flexible-distance, non-structured day regardless of whether it was
  // touched above.
  const easyCap = easyDayMinutesCap(experienceLevel)
  for (const w of workouts) {
    if (hasFixedStructure(w) || w.duration == null || w.distance == null || w.duration <= 0) continue
    const pace = w.distance / w.duration
    if (w.type === 'long_run' && longRunMinutesCap && w.duration > longRunMinutesCap) {
      w.duration = longRunMinutesCap
      w.distance = Math.max(1, Math.round(pace * longRunMinutesCap))
    } else if (FLEXIBLE_DISTANCE_TYPES.has(w.type) && w.type !== 'long_run' && w.duration > easyCap) {
      w.duration = easyCap
      w.distance = Math.max(1, Math.round(pace * easyCap))
    }
  }

  return workouts
}

// Found via local-bakken-test.ts across multiple profiles: the model
// sometimes emits type:"off" (not a valid workout type — the schema only
// has "rest") for a day the coach's weekSchedule tagged "off", bleeding
// weekSchedule's own vocabulary ('off'/'rest'/'workout') into the
// workout's type field. This is worse than it looks: enforceWeekSchedule
// below only swaps DATES for misplaced content, it never corrects a
// bogus type — so an "off" entry that got matched with a real workout day
// during that swap just relocates the invalid data instead of fixing it.
// Runs first, before any other backstop, since "off" is never valid
// content regardless of which date it lands on.
export const normalizeInvalidTypes = (workouts: BlockWorkoutOut[], language: 'en' | 'he'): BlockWorkoutOut[] => {
  for (const w of workouts) {
    if (w.type !== 'off') continue
    w.type = 'rest'
    w.title = language === 'he' ? 'יום מנוחה' : 'Rest Day'
    w.description = ''
    w.duration = null
    w.distance = null
    w.sets = []
    w.bakkenLactateMin = null
    w.bakkenLactateMax = null
    w.targetThresholdLevel = null
    w.comparisonGroup = null
    w.thresholdDistance = null
  }
  return workouts
}

// The prompt tells the model 'rest'/'off' days in weekSchedule are a hard
// rule (see rule 2 in plan-prompt.ts), but verified in practice it still
// trains on them anyway — same unreliability as longRunDay below.
// Deterministic backstop: find every day where the model put real
// training on a rest/off day, and every day where it left a *workout* day
// empty (typed "rest" when weekSchedule said the athlete could train) —
// pair them up and swap dates, so the actual training content just moves
// to the correct day instead of being lost. Only forces an outright
// conversion to "rest" (nulling out the session) when there are more
// misplaced-training days than empty-workout-days to swap with, which
// shouldn't normally happen since both counts are driven by the same
// 7-day week.
export const enforceWeekSchedule = (workouts: BlockWorkoutOut[], weekSchedule: Record<DayKey, DayType> | undefined, language: 'en' | 'he'): BlockWorkoutOut[] => {
  if (!weekSchedule) return workouts
  const dayTypeOf = (dateStr: string): DayType => weekSchedule[DAY_ORDER[parseISO(dateStr).getDay()]]
  const isRestDay = (dateStr: string) => dayTypeOf(dateStr) !== 'workout'

  const misplacedTraining = workouts.filter((w) => w.type !== 'rest' && isRestDay(w.date))
  const emptyWorkoutDays = workouts.filter((w) => w.type === 'rest' && !isRestDay(w.date))

  const swapCount = Math.min(misplacedTraining.length, emptyWorkoutDays.length)
  for (let i = 0; i < swapCount; i++) {
    const a = misplacedTraining[i]
    const b = emptyWorkoutDays[i]
    const aDate = a.date
    a.date = b.date
    b.date = aDate
  }

  for (let i = swapCount; i < misplacedTraining.length; i++) {
    const w = misplacedTraining[i]
    w.type = 'rest'
    w.title = language === 'he' ? 'יום מנוחה' : 'Rest Day'
    w.description = ''
    w.duration = null
    w.distance = null
    w.sets = []
    w.bakkenLactateMin = null
    w.bakkenLactateMax = null
    w.targetThresholdLevel = null
    w.comparisonGroup = null
    w.thresholdDistance = null
  }

  return workouts
}

// Coach-defined day->type skeleton per stage (AthleteProfile.
// stageDayTypeTemplates, rule 2c) is another prose "hard rule" that
// verified in a real test run to drift — 5 of 6 weeks matched exactly,
// but the last week swapped which day got which type (threshold landed
// on Thursday instead of Tuesday, fartlek on Tuesday instead of Thursday).
// Deterministic backstop: for each week, if the day the template
// designates doesn't have the required type, look for ANOTHER day that
// same week which DOES have that type and swap their full content (not
// just dates) — this fixes exactly the observed failure mode ("right
// content, wrong day") without inventing session content from scratch.
// If no same-week day has the required type at all, there's nothing safe
// to swap into place (synthesizing a whole valid threshold/fartlek
// session's structure here would mean re-implementing significant AI
// logic in plain code) — left alone in that case, same trade-off
// enforceLongRunDay makes when there's no long_run to work with at all.
export const enforceDayTypeTemplate = (
  workouts: BlockWorkoutOut[],
  stagesForBlock: BlockStageInfo[],
): BlockWorkoutOut[] => {
  const weeks = new Map<string, BlockWorkoutOut[]>()
  for (const w of workouts) {
    const key = weekKeyOf(w.date)
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key)!.push(w)
  }
  for (const [weekStart, items] of weeks) {
    const midweek = addDaysStr(weekStart, 3)
    const stage = stagesForBlock.find((s) => midweek >= s.startDate && midweek <= s.endDate)
    if (!stage?.dayTypeTemplate) continue
    for (const [dayKey, requiredRaw] of Object.entries(stage.dayTypeTemplate)) {
      if (!requiredRaw) continue
      // A day can require ONE type (the original behavior) or TWO (e.g.
      // "lift + easy run" or double threshold) — same two-sessions-in-a-day
      // mechanism already used for double threshold (rule 11), capped at 2
      // since that's all a single date's am/pm slots can hold anywhere else
      // in the app.
      const requiredTypes = (Array.isArray(requiredRaw) ? requiredRaw : [requiredRaw]).filter(Boolean).slice(0, 2)
      if (requiredTypes.length === 0) continue
      const targetDate = addDaysStr(weekStart, DAY_INDEX[dayKey as DayKey])
      const targetItems = items.filter((w) => w.date === targetDate)
      const claimed = new Set<BlockWorkoutOut>()
      for (const requiredType of requiredTypes) {
        const satisfied = targetItems.find((w) => w.type === requiredType)
        if (satisfied) { claimed.add(satisfied); continue }
        // Repurpose whichever of this date's slots isn't already claimed
        // and isn't itself satisfying one of this day's OTHER required
        // types — the same "right content, wrong day" swap as before, just
        // per-slot instead of assuming there's only one slot to fix.
        const targetItem = targetItems.find((w) => !claimed.has(w) && !requiredTypes.includes(w.type))
        if (!targetItem) continue // no free slot this date — leave unrepaired, same trade-off as no donor found
        const candidate = items.find((w) => w !== targetItem && w.date !== targetDate && w.type === requiredType)
        if (!candidate) continue
        claimed.add(targetItem)
        const targetDateStr = targetItem.date
        const candidateDateStr = candidate.date
        const targetCopy: BlockWorkoutOut = { ...targetItem }
        const candidateCopy: BlockWorkoutOut = { ...candidate }
        Object.assign(targetItem, candidateCopy, { date: targetDateStr })
        Object.assign(candidate, targetCopy, { date: candidateDateStr })
      }
      // A genuine two-type day is a same-date pair by definition — tag it
      // am/pm ourselves rather than leaving it to chance. Verified in
      // practice: whichever pair got here via a fresh swap above usually
      // inherited a usable tag from its donor, but a pair the model already
      // got right on its own (both types correct from the start, no swap
      // needed) can still arrive with neither side tagged, and
      // enforceSameDaySessionTags deliberately won't guess when neither
      // side has a tag. enforceAmPmOrder (runs right after this) then
      // corrects am/pm ORDER by lactate — this only needs to guarantee
      // both sides have SOME am/pm tag to fix order on.
      if (requiredTypes.length === 2) {
        const first = targetItems.find((w) => w.type === requiredTypes[0])
        const second = targetItems.find((w) => w.type === requiredTypes[1] && w !== first)
        if (first && second && first.session !== 'am' && first.session !== 'pm' && second.session !== 'am' && second.session !== 'pm') {
          first.session = 'am'
          second.session = 'pm'
        }
      }
    }
  }
  return workouts
}

// The prompt tells the model longRunDay is a hard rule (see rule 2 in
// plan-prompt.ts), but in practice it still occasionally misses a week —
// same story as weekly volume. Deterministic backstop: for each Sun-Sat
// week, exactly one long_run should exist, on longRunDay.
//   - 2+ long_run entries in the same week (a real bug seen in practice —
//     the model duplicated it onto a second day): keep whichever one is
//     already on longRunDay (or the first one if none is), demote every
//     other long_run that week to a plain easy day instead of leaving two
//     long runs in the same week.
//   - exactly 1 long_run, wrong day: swap dates with whatever's currently
//     on longRunDay (full session content moves with it, only the two
//     dates trade places).
//   - 0 long_run: nothing safe to do, skip (can't invent a session).
// Skips the date-swap step if the target weekday isn't present in this
// block's data at all (only happens at a season/goal-race boundary).
// Rule 11 says AM is always the easier, T1-anchored half of a double-
// threshold day and PM is the harder one (T1-ish early season, sharpening
// toward T2 later) — this is the hard invariant the coach actually cares
// about (confirmed explicitly: "keep the AM easier T1 and PM can be T1 or
// faster around T2"). Verified in testing that duration is NOT a safe proxy
// for this — the model sometimes picks a PM rep-format that happens to run
// a few minutes longer than AM's even though the ZONE (T1 vs T2) was
// already correct; swapping on duration in that case would flip a correct
// T1-AM/T2-PM pairing into a wrong T2-AM/T1-PM one, which is worse, not
// better. Swap on LACTATE instead — the actual thing that must stay
// correct: if AM's assigned lactate ends up higher than PM's (i.e. AM
// somehow became the harder session), swap which full session sits in
// which slot so AM always ends up the lower-lactate (easier) one.
export const enforceAmPmOrder = (workouts: BlockWorkoutOut[]): BlockWorkoutOut[] => {
  const byDate = new Map<string, { am?: BlockWorkoutOut; pm?: BlockWorkoutOut }>()
  for (const w of workouts) {
    if (w.session !== 'am' && w.session !== 'pm') continue
    if (!byDate.has(w.date)) byDate.set(w.date, {})
    byDate.get(w.date)![w.session] = w
  }
  for (const { am, pm } of byDate.values()) {
    if (!am || !pm) continue
    if (am.bakkenLactateMin == null || pm.bakkenLactateMin == null) continue
    if (am.bakkenLactateMin <= pm.bakkenLactateMin) continue
    const amDate = am.date
    const pmDate = pm.date
    const amCopy: BlockWorkoutOut = { ...am }
    const pmCopy: BlockWorkoutOut = { ...pm }
    Object.assign(am, pmCopy, { date: amDate, session: 'am' as const })
    Object.assign(pm, amCopy, { date: pmDate, session: 'pm' as const })
  }
  return workouts
}

// Found via local-bakken-test.ts testing the elite double-threshold level
// against the new brain (which, unlike the old one, explicitly calls for
// genuine AM+PM easy runs on non-quality days too, not just Tue/Thu quality
// double-threshold — see rule 8 in plan-prompt.ts): verified the model
// mostly tags these pairs correctly (13 of 14 same-date pairs across a real
// 3-block run), but occasionally leaves one side of a pair as "other"
// while correctly tagging the other "am"/"pm" — e.g. an untagged
// hill_repeats sharing a date with a properly "pm"-tagged easy run. Cheap,
// safe backstop: whenever exactly one side of a same-date pair already has
// a definitive am/pm tag, force the other side to the opposite tag rather
// than leaving it ambiguous (the app's same-day multi-workout rendering
// keys off this field). Deliberately does nothing when NEITHER side is
// tagged — there's no real signal to decide which is which in that case.
export const enforceSameDaySessionTags = (workouts: BlockWorkoutOut[]): BlockWorkoutOut[] => {
  const byDate = new Map<string, BlockWorkoutOut[]>()
  for (const w of workouts) {
    if (!byDate.has(w.date)) byDate.set(w.date, [])
    byDate.get(w.date)!.push(w)
  }
  for (const items of byDate.values()) {
    if (items.length !== 2) continue
    const [a, b] = items
    if (a.session === 'am' && b.session !== 'pm') b.session = 'pm'
    else if (a.session === 'pm' && b.session !== 'am') b.session = 'am'
    else if (b.session === 'am' && a.session !== 'pm') a.session = 'pm'
    else if (b.session === 'pm' && a.session !== 'am') a.session = 'am'
  }
  return workouts
}

// Verified against the real API that the prompt's "no two big days back to
// back" instruction (rule 9 in plan-prompt.ts) is not reliable on its own —
// a real test run produced 3 violations across 2 blocks, including right
// at the block boundary (the exact case the rule calls a hard-rule
// violation). Deterministic backstop, same pattern as enforceLongRunDay:
// demote one of any two adjacent "big" days to easy, preferring to keep
// whichever one lands on the athlete's actual long-run day.
export const BIG_WORKOUT_TYPES = new Set(['long_run', 'tempo', 'threshold', 'intervals', 'hill_repeats', 'fartlek'])
const demoteToEasyRun = (w: BlockWorkoutOut, language: 'en' | 'he', description?: string) => {
  w.type = 'easy'
  w.title = language === 'he' ? 'ריצה קלה' : 'Easy Run'
  w.description = description ?? (language === 'he'
    ? 'ריצה קלה ורגועה — יום התאוששות בין שני אימונים מאתגרים.'
    : 'Easy, relaxed running — a recovery day between two demanding sessions.')
  w.sets = []
  w.bakkenLactateMin = 1.0
  w.bakkenLactateMax = 1.2
  w.targetThresholdLevel = null
  w.comparisonGroup = null
  w.thresholdDistance = null
}
export const enforceNoBackToBackBigDays = (
  workouts: BlockWorkoutOut[],
  previousBlockTail: Array<{ date: string; type: string; title: string }> | undefined,
  longRunDay: DayKey | undefined,
  language: 'en' | 'he',
): BlockWorkoutOut[] => {
  const sorted = [...workouts].sort((a, b) => a.date.localeCompare(b.date))
  const dayGap = (a: string, b: string) => Math.round((parseISO(b).getTime() - parseISO(a).getTime()) / 86400000)
  const isProtectedLongRun = (w: BlockWorkoutOut) =>
    w.type === 'long_run' && !!longRunDay && DAY_ORDER[parseISO(w.date).getDay()] === longRunDay

  // Block-boundary case: the tail's last day already happened (written in a
  // prior generate() call) and can't be changed — only this block's own
  // first day can be fixed, even if it happens to be the long-run day
  // (a missed long run this one week beats stacking two hard days).
  if (previousBlockTail && previousBlockTail.length > 0 && sorted.length > 0) {
    const lastTail = previousBlockTail[previousBlockTail.length - 1]
    const first = sorted[0]
    if (dayGap(lastTail.date, first.date) === 1 && BIG_WORKOUT_TYPES.has(lastTail.type) && BIG_WORKOUT_TYPES.has(first.type)) {
      demoteToEasyRun(first, language)
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]
    const cur = sorted[i]
    if (dayGap(prev.date, cur.date) !== 1) continue
    if (!BIG_WORKOUT_TYPES.has(prev.type) || !BIG_WORKOUT_TYPES.has(cur.type)) continue
    // Re-check type in case a prior iteration already demoted `prev`.
    if (!BIG_WORKOUT_TYPES.has(prev.type) || !BIG_WORKOUT_TYPES.has(cur.type)) continue
    if (isProtectedLongRun(cur) && !isProtectedLongRun(prev)) {
      demoteToEasyRun(prev, language)
    } else {
      demoteToEasyRun(cur, language)
    }
  }
  return workouts
}

export const enforceLongRunDay = (workouts: BlockWorkoutOut[], longRunDay: DayKey | undefined, language: 'en' | 'he'): BlockWorkoutOut[] => {
  if (!longRunDay) return workouts
  const weekKeyOf = (dateStr: string) => format(startOfWeek(parseISO(dateStr), { weekStartsOn: 0 }), 'yyyy-MM-dd')
  const weeks = new Map<string, BlockWorkoutOut[]>()
  for (const w of workouts) {
    const key = weekKeyOf(w.date)
    if (!weeks.has(key)) weeks.set(key, [])
    weeks.get(key)!.push(w)
  }
  for (const [weekStart, items] of weeks) {
    const longRuns = items.filter((w) => w.type === 'long_run')
    if (longRuns.length === 0) continue
    if (longRuns.length > 1) {
      const targetDate = addDaysStr(weekStart, DAY_INDEX[longRunDay])
      const keeper = longRuns.find((w) => w.date === targetDate) ?? longRuns[0]
      for (const extra of longRuns) {
        if (extra === keeper) continue
        extra.type = 'easy'
        extra.title = language === 'he' ? 'ריצה קלה' : 'Easy Run'
        extra.description = language === 'he'
          ? 'ריצה קלה ורגועה, מתחת לסף T1.'
          : 'Easy, relaxed running, below your T1 threshold.'
        extra.sets = []
        extra.bakkenLactateMin = 1.0
        extra.bakkenLactateMax = 1.2
        extra.targetThresholdLevel = null
        extra.comparisonGroup = null
        extra.thresholdDistance = null
      }
    }
    const lr = longRuns.find((w) => w.type === 'long_run') // re-check after any demotions above
    if (!lr) continue
    const targetDate = addDaysStr(weekStart, DAY_INDEX[longRunDay])
    if (lr.date === targetDate) continue
    const targetItem = items.find((w) => w.date === targetDate && w !== lr)
    if (!targetItem) continue
    const lrDate = lr.date
    lr.date = targetItem.date
    targetItem.date = lrDate
  }
  return workouts
}

// One-off calendar events (AthleteProfile.specialEvents — a flight, a
// wedding, an exam) are a hard rule in the prompt (rule 2d: no hard/big
// session on the event date), same reliability caveat as every other rule
// here. Deterministic backstop: any BIG_WORKOUT_TYPES session that landed
// exactly on a flagged date gets demoted to easy, same mechanism as
// enforceNoBackToBackBigDays.
export const enforceSpecialEvents = (
  workouts: BlockWorkoutOut[],
  specialEvents: Array<{ date: string; label: string; notes?: string }> | undefined,
  language: 'en' | 'he',
): BlockWorkoutOut[] => {
  if (!specialEvents || specialEvents.length === 0) return workouts
  const eventDates = new Map(specialEvents.map((e) => [e.date, e]))
  for (const w of workouts) {
    const event = eventDates.get(w.date)
    if (!event || !BIG_WORKOUT_TYPES.has(w.type)) continue
    demoteToEasyRun(w, language, language === 'he'
      ? `ריצה קלה — שומרים על זה קליל היום בגלל ${event.label}.`
      : `Easy run — keeping it light today because of ${event.label}.`)
  }
  return workouts
}
