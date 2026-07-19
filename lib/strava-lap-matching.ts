/**
 * lib/strava-lap-matching.ts
 *
 * Matches Strava lap data to a structured workout's own reps by distance
 * (not raw position), and scores how well a given Strava activity's laps
 * fit a workout's rep pattern at all — used both to fill a threshold
 * workout's per-rep splits (components/athlete/workout-log-form.tsx) and to
 * decide which of several same-day Strava activities is actually the
 * structured workout, when warmup/cooldown were recorded as separate
 * activities instead of laps within one (components/athlete/athlete-planner-view.tsx).
 */

import { paceToSec, secToPace } from '@/lib/physiology'

/** Workout types that are genuinely structured/repeated — reps with real
 *  rest between them, worth regrouping raw Strava laps into "one row per
 *  rep" for. A fartlek or tempo run can ALSO have a `sets` array defined
 *  (e.g. "8×2min pickups"), so `sets.length > 0` alone isn't a safe signal
 *  for "show rep-grouped splits" — an athlete's finished fartlek/tempo/easy
 *  run must keep showing its raw watch splits (pace/time exactly as
 *  recorded), not be forced through rep/rest regrouping meant for real
 *  interval sessions. hill_repeats is deliberately excluded too, even
 *  though it has genuine reps/rest — confirmed explicitly: a hill-repeats
 *  session must still show its Strava splits exactly as recorded, same as
 *  fartlek/tempo/easy. Includes the legacy 'interval'/'repetition' values
 *  old workout docs may still carry. Shared with
 *  hooks/useWorkoutComparisonGroups.ts so the two never define this
 *  differently. */
export const STRUCTURED_WORKOUT_TYPES = new Set(['intervals', 'threshold', 'time_trial', 'interval', 'repetition'])

/** Best-effort meters from a free-text rep distance field (e.g. "1000m",
 *  "1600"). The coach always writes these in meters (same convention
 *  inferThresholdDistance relies on elsewhere) — returns null for a
 *  duration-based rep (e.g. "5 דק'"/"5 min") where there's no distance to
 *  match against at all.
 *
 *  Reported directly, root-caused from real data: a fartlek's "2 min /
 *  1 min" duration reps, when the coach's UI stores the bare number ("2",
 *  "1") without the unit text baked into this exact string, don't match
 *  the /דק|min/i duration check above and fell through to being read as
 *  "2 meters" / "1 meter" — dividing a real ~2-minute lap's elapsed time
 *  by a 2-METER target exploded into an absurd computed pace ("1000:00"
 *  instead of a real ~4:30/km). No genuine running rep is ever
 *  programmed under 50m, so a parsed value below that is far more likely
 *  a duration whose unit text didn't survive into this string than a
 *  real distance — treated as "not a distance" (null) instead. */
export function parseRepMeters(raw: string | undefined): number | null {
  if (!raw) return null
  if (/דק|min/i.test(raw)) return null
  const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) && n >= 50 ? n : null
}

type RepDistanceSource = { distance?: string; duration?: string; distanceMeters?: number; durationSec?: number }

/** One rep's expected distance (meters), or null for a duration-based rep —
 *  prefers the workout builder's own explicit distanceMeters/durationSec
 *  fields (100% unambiguous, no guessing at all) when the coach entered
 *  them through the unit-aware builder inputs; only falls back to sniffing
 *  the legacy free-text distance/duration string (parseRepMeters, with all
 *  its "does this look like a duration" guesswork) for older workouts
 *  saved before those explicit fields existed. */
function repMeters(item: RepDistanceSource): number | null {
  if (item.distanceMeters != null && item.distanceMeters > 0) return item.distanceMeters
  if (item.durationSec != null && item.durationSec > 0) return null
  return parseRepMeters(item.distance || item.duration)
}

/** The expected per-rep distance (meters, or null for a duration-based rep)
 *  for every rep of a workout template, in order — the same structure
 *  components/athlete/workout-log-form.tsx seeds its splitLogs rows from,
 *  but derived directly from the template so it can be used before any
 *  splitLogs state exists (e.g. scoring candidate Strava activities before
 *  a log has even been opened). */
export function expectedRepMetersForWorkout(
  workout: { sets?: (RepDistanceSource & { reps?: number; intervals?: RepDistanceSource[] })[] } | null | undefined,
): (number | null)[] {
  if (!workout?.sets?.length) return []
  const out: (number | null)[] = []
  for (const set of workout.sets) {
    const reps = set.reps || 1
    const intervals = set.intervals
    if (intervals && intervals.length > 0) {
      for (let r = 0; r < reps; r++) {
        for (const iv of intervals) out.push(repMeters(iv))
      }
    } else {
      for (let r = 0; r < reps; r++) out.push(repMeters(set))
    }
  }
  return out
}

export interface RawLap { distanceKm?: number; time?: string; heartRate?: number | null }
export interface MatchedLap {
  pace: string
  heartRate: number | null
  /** Real combined elapsed time (seconds) across whichever laps made up this rep. */
  elapsedSec: number
  /** The workout's own planned distance for this rep (meters), if known — this is
   *  what pace above is actually computed from, not the device's own measured distance. */
  targetMeters: number | null
  /** The device's own summed/measured distance (meters) for these laps — kept around
   *  for display only (e.g. showing "~1.9km measured" alongside the trusted 2000m). */
  actualMeters: number | null
}

/** One row of a full, in-order rendering of a structured session's laps —
 *  either a matched work rep, or a rest/recovery lap kept as-is (not
 *  silently dropped) so the athlete still sees the recovery between reps. */
export type DisplayRow =
  | ({ kind: 'rep'; repIndex: number } & MatchedLap)
  | { kind: 'rest'; time: string; heartRate: number | null; distanceMeters: number | null }

/**
 * Walks a Strava activity's raw laps in order and classifies every single
 * one of them — either folded into a matched work rep, or kept as its own
 * "rest" row — so nothing from the recording is ever silently dropped.
 * matchLapsToReps (below) is just this same walk with the rest rows
 * filtered back out, for the one caller (workout-log-form.tsx) that only
 * wants the rep values themselves.
 *
 * Some watches auto-lap at a fixed round distance (e.g. every 1km)
 * regardless of the workout's actual rep length, so a 1.6km rep can come
 * back as two laps (1km + 0.6km) instead of one — matched 1:1 by index,
 * that desyncs every rep after it. This also still has to tell real
 * rest/recovery laps apart (much slower pace) so they don't get folded
 * into a work rep's distance by mistake.
 *
 * For each rep (in order), any rest laps encountered while looking for the
 * next work lap are emitted as their own 'rest' rows (not dropped), and any
 * "filler" laps (much shorter than the smallest rep distance in this
 * workout — a warmup stride, a GPS-blip fragment) are skipped entirely
 * (too short to be a real rep OR a meaningful rest). Real work laps are
 * then accumulated — summing their distance AND their time — until a rest
 * lap appears, the laps run out, or (once the total has reached ~90% of
 * that rep's expected distance) taking the next lap would push the total
 * clearly past the target (beyond ~110%), meaning that lap must be the
 * start of the NEXT rep instead. Reaching ~90% alone is deliberately NOT
 * enough to stop: athletes sometimes hit the lap button mid-rep on the
 * track just to check a split, so one continuous rep can come back as 2-3
 * consecutive real laps with no rest lap between them — all of those laps'
 * time must count toward THIS rep, or its pace (computed against the full
 * planned distance, see below) comes out impossibly fast. The device's own
 * per-lap distance is only trusted for THAT grouping decision, though —
 * the rep's actual pace is computed from the COMBINED time ÷ the rep's
 * PLANNED distance, not the device's summed distance. On a treadmill
 * there's no GPS at all, so the watch's distance-per-lap is just an
 * accelerometer estimate (its live pace readout is the part athletes
 * already know not to trust); on a track, short reps are exactly the case
 * where GPS distance is noisiest (satellite smoothing/lag matters more the
 * shorter the rep). Either way, the workout's own planned distance is the
 * one number we actually know is right — an athlete following the plan
 * runs to that distance and hits lap at the right moment, so combined
 * elapsed time ÷ planned distance is the true pace even when the device's
 * own distance for those same laps is off. Its HR is still the
 * time-weighted average across whichever laps got combined. A rep with no
 * known expected distance (a duration-based rep) just takes the next
 * single non-filler lap, same as before — there's no planned distance to
 * fall back on there.
 *
 * Warmup/cooldown/strides are never explicitly labeled in Strava's lap
 * data, so they're inferred: a slow lap (jogging pace) is caught by the
 * rest-pace check below; a short fast one (a stride) isn't slow but is far
 * too short to be a real rep, caught by the filler-distance check instead.
 */
export function buildRepDisplayRows(laps: RawLap[], expectedMeters: (number | null)[]): DisplayRow[] {
  const parsed = laps.map(l => ({
    meters: l.distanceKm != null ? l.distanceKm * 1000 : null,
    sec: paceToSec(l.time),
    heartRate: l.heartRate ?? null,
  }))
  const paceOf = (p: typeof parsed[number]) => (p.meters && p.sec) ? p.sec / (p.meters / 1000) : null
  const paceSecs = parsed.map(paceOf).filter((v): v is number => v != null)
  const fastestPace = paceSecs.length ? Math.min(...paceSecs) : null
  // Same 40% threshold as before: a recovery jog/walk reads dramatically
  // slower than the fastest real lap in the session.
  const isRest = (p: typeof parsed[number]) => {
    const pace = paceOf(p)
    return fastestPace != null && pace != null && pace > fastestPace * 1.4
  }

  // The smallest rep distance this workout actually calls for (e.g. 800 for
  // "10×800") — a lap under 15% of that is too short to be a meaningful
  // fragment of ANY rep (a warmup stride, a GPS blip), so it must be
  // filler. This was previously 40%, which sounds reasonable in the
  // abstract but is provably wrong against real data: a mile-repeat
  // session's own raw laps split a single 1.6km rep into legitimate
  // sub-laps around 400-1000m each (610m, 400m, 410m — an athlete lapping
  // mid-rep on the track to check a split, or the watch's own auto-lap
  // behavior) — every one of which is UNDER 40% of 1600m (640m) despite
  // being 100% real rep data, so they were silently discarded as "junk"
  // right alongside a genuine 20m/4-second glitch lap. That's what turned
  // a real ~5:14 mile rep into an impossible sub-2:00 one: the discarded
  // sub-laps carried most of the rep's actual elapsed time. 15% (240m for
  // a 1600m target) sits safely below every real sub-lap seen in that
  // data and comfortably above the actual junk (a few tens of meters).
  const targets = expectedMeters.filter((m): m is number => m != null && m > 0)
  const minTarget = targets.length ? Math.min(...targets) : null
  const isFiller = (p: typeof parsed[number]) =>
    minTarget != null && p.meters != null && p.meters < minTarget * 0.15

  // An accidental double-tap of the lap button mid-rep — reported directly:
  // "a lap of 4 sec in the middle of the workout by mistake". isFiller only
  // catches a short DISTANCE, but a glitch lap like this can still carry a
  // meaningful (GPS-smoothed/buffered) distance despite lasting only a
  // couple of seconds — no real rep fragment, at any pace a human can run,
  // takes under ~8 seconds, so this is a second, independent junk check by
  // TIME rather than distance. Only applied to distance-targeted reps
  // below, never the duration-based branch (a genuinely short rep, e.g. a
  // 15-second hill sprint, has its OWN duration as the target and must not
  // be filtered out here).
  const isGlitch = (p: typeof parsed[number]) => p.sec != null && p.sec < 8

  const pushRest = (p: typeof parsed[number]) => {
    rows.push({ kind: 'rest', time: p.sec != null ? secToPace(p.sec) : '—', heartRate: p.heartRate, distanceMeters: p.meters })
  }

  const rows: DisplayRow[] = []
  let li = 0
  let repIndex = 0
  for (const target of expectedMeters) {
    while (li < parsed.length && (isRest(parsed[li]) || isFiller(parsed[li]) || (target != null && isGlitch(parsed[li])))) {
      if (isRest(parsed[li])) pushRest(parsed[li])
      li++
    }
    if (li >= parsed.length) { repIndex++; continue }

    if (!target) {
      // Duration-based rep — no expected distance to match against, so
      // just take the next lap as-is (previous 1:1 behavior).
      const p = parsed[li]
      if (p.meters && p.sec) {
        rows.push({ kind: 'rep', repIndex, pace: secToPace(paceOf(p)), heartRate: p.heartRate, elapsedSec: p.sec, targetMeters: null, actualMeters: p.meters })
      }
      li++
      repIndex++
      continue
    }

    let accMeters = 0, accSec = 0, hrWeighted = 0, hrWeight = 0, used = 0
    while (li < parsed.length) {
      const p = parsed[li]
      if (isRest(p)) {
        // Only trust this as a REAL recovery period once the rep is
        // already mostly done — a slow-reading lap (GPS signal loss on
        // part of a track, a moment of dead legs mid-effort) can look just
        // as "restlike" by pace while the rep itself is still far from
        // finished. Breaking here unconditionally would end the rep with
        // only a small fraction of its true elapsed time counted, and
        // dividing that fraction by the FULL planned distance produces an
        // impossibly fast pace — confirmed: a mile-repeat session kept
        // showing sub-2:00/mile splits even after a full reset+resync,
        // because a mid-rep glitch lap was ending accumulation early every
        // single time, not a one-off stale-data issue.
        if (accMeters >= target * 0.7) break
        li++
        continue // treat as a glitch, not a real rest — keep looking for the rep's real continuation
      }
      if (isFiller(p)) { li++; continue } // stride/fragment — skip, don't break
      if (isGlitch(p)) { li++; continue } // accidental lap-button tap — skip, don't break
      if (p.meters == null || p.sec == null) { li++; continue }
      // Once the accumulated distance has already reached ~90% of this
      // rep's target, only keep consuming laps that still plausibly belong
      // to it (athletes sometimes hit lap MID-rep just to check a split, so
      // one rep can span several consecutive real laps with no rest lap
      // between them). A lap that would push the total clearly past the
      // target (beyond ~110%) can't be part of this rep anymore — it must
      // be the start of the NEXT rep, so stop here without consuming it.
      if (accMeters >= target * 0.9 && accMeters + p.meters > target * 1.1) break
      accMeters += p.meters
      accSec += p.sec
      if (p.heartRate != null) { hrWeighted += p.heartRate * p.sec; hrWeight += p.sec }
      used++
      li++
    }
    if (used > 0) {
      rows.push({
        kind: 'rep', repIndex,
        pace: secToPace(accSec / (target / 1000)),
        heartRate: hrWeight > 0 ? Math.round(hrWeighted / hrWeight) : null,
        elapsedSec: accSec, targetMeters: target, actualMeters: accMeters,
      })
    }
    repIndex++
  }
  // Anything left over after the last rep (a final rest/cooldown lap) —
  // show it too rather than dropping it silently.
  while (li < parsed.length) {
    if (isRest(parsed[li])) pushRest(parsed[li])
    li++
  }
  return rows
}

/** Just the matched rep values, one per expected rep (null where a rep
 *  couldn't be matched at all) — the shape workout-log-form.tsx's
 *  rep-entry pre-fill wants, with every rest row filtered back out. */
export function matchLapsToReps(laps: RawLap[], expectedMeters: (number | null)[]): (MatchedLap | null)[] {
  const results: (MatchedLap | null)[] = new Array(expectedMeters.length).fill(null)
  for (const row of buildRepDisplayRows(laps, expectedMeters)) {
    if (row.kind === 'rep') {
      const { kind, repIndex, ...rest } = row
      results[repIndex] = rest
    }
  }
  return results
}

/**
 * How well one Strava activity's own laps fit a structured workout's rep
 * pattern — the count of reps matchLapsToReps actually managed to fill
 * with a real lap (right distance, distinguishable from a continuous jog).
 * Used to pick which of several same-day activities IS the actual workout
 * when warmup/cooldown were recorded as separate activities (each often a
 * continuous few km) rather than laps inside one combined recording — a
 * warmup/cooldown jog won't have laps clustering near any rep distance, so
 * it scores near zero and loses to the real interval activity even when
 * its total distance happens to be closer to the workout's planned figure.
 * Returns 0 when the workout has no rep structure to score against at all
 * (a continuous workout — nothing to prefer this way, fall back to
 * distance-closeness instead).
 */
export function scoreActivityFitForReps(laps: RawLap[], expectedMeters: (number | null)[]): number {
  const targets = expectedMeters.filter((m): m is number => m != null && m > 0)
  if (targets.length === 0) return 0
  return matchLapsToReps(laps, expectedMeters).filter(m => m != null).length
}

export interface ResolvedRepRow {
  /** This rep's real combined elapsed time, e.g. "5:19". */
  time: string
  pace: string
  heartRate: number | null
  /** Rest immediately AFTER this rep, if any (e.g. "1:30"). */
  rest: string | null
  /** This rep's planned distance, already formatted (e.g. "1600m"), or the
   *  raw lap's own distance string for a continuous run with no rep
   *  structure — display-only. */
  distanceLabel: string
  /** This rep's distance in meters (numeric) when known — the rep's own
   *  planned target for a structured workout, the saved numeric distance
   *  for an already rep-shaped log, or the raw lap distance for a
   *  continuous run. Used to distance-weight an average pace across reps
   *  of different lengths (e.g. threshold's 2000m + 1000m) instead of
   *  averaging the pace values unweighted, which overweights the shorter
   *  rep. Null when the distance is a duration ("3 min") rather than a
   *  real distance, in which case callers fall back to an unweighted mean. */
  meters: number | null
}

/**
 * THE single place that turns a log's `splitLogs` (whatever shape it
 * happens to be in) into "one row per real rep" — shared by SplitsTable
 * (the Strava box / saved-workout view) and useWorkoutComparisonGroups
 * (the Lab's per-type session summaries), so there is exactly one
 * implementation of "detect raw-vs-rep-shaped, regroup if needed" instead
 * of two that can quietly drift apart. That drift already happened once:
 * the comparison gallery averaged raw splitLogs directly, reproducing the
 * exact wrong-pace bug already fixed for the Strava box, because an
 * interval-type (non-threshold) workout's splitLogs never go through the
 * Lab backfill and stay as raw, un-regrouped per-lap Strava data forever.
 *
 * splitLogs can arrive in either shape — see buildRepDisplayRows/SplitsTable
 * for the full reasoning: raw per-lap Strava data (always carries a numeric
 * `distanceKm`) gets regrouped via buildRepDisplayRows when the workout has
 * a known rep structure AND is a genuinely structured type
 * (STRUCTURED_WORKOUT_TYPES) — a fartlek/tempo/easy run can also define a
 * `sets` array (e.g. "8×2min pickups"), but a finished fartlek/tempo/easy
 * run must keep showing its raw watch splits exactly as recorded, not be
 * forced through rep/rest regrouping meant for real interval sessions.
 * Already rep-shaped data (from workout-log-form.tsx or the Lab backfill —
 * never carries `distanceKm`) is used as-is regardless of type, since it's
 * literally saved in that shape already, nothing to decide. A continuous
 * run (no rep structure, or a non-structured type) just returns its raw
 * splits, one row each.
 */
export function resolveSessionRepRows(splitLogs: any[], workout: { sets?: any[]; type?: string } | null | undefined): ResolvedRepRow[] {
  const expectedMeters = STRUCTURED_WORKOUT_TYPES.has(workout?.type || '') ? expectedRepMetersForWorkout(workout) : []
  const isRepShaped = splitLogs.length > 0 && splitLogs[0].distanceKm == null
  if (isRepShaped) {
    return splitLogs.map((s: any) => ({
      time: s.time || '', pace: s.pace || '', heartRate: s.avgHr ?? null, rest: s.rest || null, distanceLabel: s.distance || '',
      meters: typeof s.distance === 'number' ? s.distance : null,
    }))
  }
  if (expectedMeters.length > 0) {
    const rows = buildRepDisplayRows(
      splitLogs.map((s: any) => ({ distanceKm: s.distanceKm, time: s.time, heartRate: s.heartRate })),
      expectedMeters,
    )
    const result: ResolvedRepRow[] = []
    let lastRep: ResolvedRepRow | null = null
    for (const row of rows) {
      if (row.kind === 'rep') {
        lastRep = {
          time: secToPace(row.elapsedSec), pace: row.pace, heartRate: row.heartRate, rest: null,
          distanceLabel: row.targetMeters ? (row.targetMeters >= 1000 ? `${(row.targetMeters / 1000).toFixed(row.targetMeters % 1000 === 0 ? 0 : 1)}k` : `${row.targetMeters}m`) : '',
          meters: row.targetMeters,
        }
        result.push(lastRep)
      } else if (lastRep && !lastRep.rest) {
        lastRep.rest = row.time
      }
    }
    return result
  }
  // Continuous run — no rep structure at all; each raw split IS its own row.
  return splitLogs.map((s: any) => ({
    time: s.time || '', pace: s.pace || '', heartRate: s.heartRate ?? null, rest: null, distanceLabel: s.distance || '',
    meters: typeof s.distanceKm === 'number' ? s.distanceKm * 1000 : null,
  }))
}

/** Workout types worth trimming to their "main set" — a genuinely
 *  structured effort (intervals/threshold/etc.) or a tempo run can
 *  plausibly be recorded warmup+effort+cooldown as one Strava activity.
 *  Explicitly NOT every type: an easy run, fartlek, long run, recovery
 *  jog, or race (and hill_repeats, confirmed explicitly) has no "warmup
 *  vs main set" distinction to find in the first place, and must always
 *  use its full, untouched session data — trimming those risked the
 *  duration-only heuristic misfiring on an ordinary run's incidental
 *  lap-length variation (a traffic light, a GPS auto-lap). Shared by the
 *  Lab's session comparison AND the app's own workout-summary tiles
 *  (mainSetDisplayStats below) so the two never disagree about which
 *  types get trimmed. */
export const MAIN_SET_ELIGIBLE_TYPES = new Set(['intervals', 'interval', 'repetition', 'threshold', 'tempo'])

/**
 * Some athletes record an entire session — warmup jog, the actual fartlek/
 * tempo surges, cooldown jog, even an accidental pause — as ONE Strava
 * activity instead of stopping/restarting the watch. Reported directly: a
 * "Kenya fartlek" whose 29 raw laps were 2 warmup km-splits (~5:35/km),
 * one glitched pause lap (10:34 elapsed, 92bpm), 24 real work/recovery laps
 * alternating ~1:00/~2:00 with wildly different HR/pace, then a cooldown
 * lap (7:18). Averaging over ALL of that (Lab comparison, or the app's own
 * summary tiles) dilutes the actual effort with slow warmup/cooldown
 * minutes — this finds just the contiguous "main set" block so both can use
 * only that, while the Strava box's per-lap SPLITS TABLE still shows every
 * raw lap exactly as recorded (unchanged — only the headline totals, not
 * the lap list itself, get trimmed).
 *
 * Heuristic: real warmup/cooldown laps (jogged, often GPS-auto-lapped every
 * km) run noticeably LONGER than the short, repeating work/recovery laps of
 * an actual fartlek/interval block — using this session's own shortest real
 * lap as the yardstick avoids hardcoding any specific pace/duration and
 * adapts to how fast or slow this particular athlete's efforts are. Returns
 * null when no such block is confidently identifiable (laps too few, or the
 * whole activity is already uniform — e.g. a plain easy run — in which case
 * there's nothing to trim and the full session should be used as-is).
 */
export function detectMainSetRange(laps: RawLap[]): { start: number; end: number } | null {
  const durations = laps.map(l => paceToSec(l.time))
  const real = durations.filter((d): d is number => d != null && d >= 8) // drop glitch laps (<8s, same cutoff as isGlitch above)
  if (real.length < 6) return null
  const shortest = Math.min(...real)
  // A lap up to 4x this session's own shortest real lap still plausibly
  // belongs to the same short-interval block; a warmup/cooldown km jog or a
  // stuck-watch pause reads far longer than that in every case observed.
  const cap = shortest * 4
  const isMainCandidate = (d: number | null) => d != null && d >= 8 && d <= cap

  // Longest contiguous run of candidate laps.
  let bestStart = -1, bestLen = 0, curStart = -1, curLen = 0
  for (let i = 0; i < durations.length; i++) {
    if (isMainCandidate(durations[i])) {
      if (curLen === 0) curStart = i
      curLen++
      if (curLen > bestLen) { bestLen = curLen; bestStart = curStart }
    } else {
      curLen = 0
    }
  }
  // Require a real block (≥4 laps) that doesn't already span the entire
  // activity — if it does, there's no separate warmup/cooldown to trim.
  if (bestLen < 4 || bestLen >= durations.length) return null
  return { start: bestStart, end: bestStart + bestLen }
}

/** Distance/time/HR summed over just the detected main-set laps (see
 *  detectMainSetRange) — null when no trim-worthy block was found, meaning
 *  callers should fall back to the session's own full-activity totals. */
export function mainSetSummary(laps: RawLap[]): { distanceKm: number; durationSec: number; avgHr: number | null } | null {
  const range = detectMainSetRange(laps)
  if (!range) return null
  let distanceKm = 0, durationSec = 0, hrWeighted = 0, hrWeight = 0
  for (let i = range.start; i < range.end; i++) {
    const l = laps[i]
    const sec = paceToSec(l.time)
    if (l.distanceKm != null) distanceKm += l.distanceKm
    if (sec != null) {
      durationSec += sec
      if (l.heartRate != null) { hrWeighted += l.heartRate * sec; hrWeight += sec }
    }
  }
  if (durationSec <= 0) return null
  return { distanceKm, durationSec, avgHr: hrWeight > 0 ? Math.round(hrWeighted / hrWeight) : null }
}

/** Main-set-only distance/pace/HR for a completed session's SUMMARY
 *  numbers (the big stat tiles on the Strava box, and the Lab's
 *  session-over-session comparison) — null when the workout type isn't
 *  MAIN_SET_ELIGIBLE_TYPES, splitLogs aren't raw per-lap Strava data, or
 *  no genuine main set is found, meaning the caller should fall back to
 *  the log's own whole-activity fields (actualDistance/actualPace/
 *  averageHeartRate) exactly as before. */
export function mainSetDisplayStats(
  splitLogs: any[] | undefined,
  workoutType: string | undefined,
): { distance: number; pace: string; hr: number | null; durationMin: number } | null {
  if (!workoutType || !MAIN_SET_ELIGIBLE_TYPES.has(workoutType)) return null
  if (!splitLogs?.length || splitLogs[0].distanceKm == null) return null
  const main = mainSetSummary(splitLogs)
  if (!main || main.distanceKm <= 0) return null
  return {
    distance: Math.round(main.distanceKm * 100) / 100,
    pace: secToPace(Math.round(main.durationSec / main.distanceKm)),
    hr: main.avgHr,
    durationMin: Math.round(main.durationSec / 60),
  }
}
