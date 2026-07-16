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

/** Best-effort meters from a free-text rep distance field (e.g. "1000m",
 *  "1600"). The coach always writes these in meters (same convention
 *  inferThresholdDistance relies on elsewhere) — returns null for a
 *  duration-based rep (e.g. "5 דק'"/"5 min") where there's no distance to
 *  match against at all. */
export function parseRepMeters(raw: string | undefined): number | null {
  if (!raw) return null
  if (/דק|min/i.test(raw)) return null
  const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10)
  return Number.isFinite(n) && n > 0 ? n : null
}

/** The expected per-rep distance (meters, or null for a duration-based rep)
 *  for every rep of a workout template, in order — the same structure
 *  components/athlete/workout-log-form.tsx seeds its splitLogs rows from,
 *  but derived directly from the template so it can be used before any
 *  splitLogs state exists (e.g. scoring candidate Strava activities before
 *  a log has even been opened). */
export function expectedRepMetersForWorkout(
  workout: { sets?: { reps?: number; distance?: string; duration?: string; intervals?: { distance?: string; duration?: string }[] }[] } | null | undefined,
): (number | null)[] {
  if (!workout?.sets?.length) return []
  const out: (number | null)[] = []
  for (const set of workout.sets) {
    const reps = set.reps || 1
    const intervals = set.intervals
    if (intervals && intervals.length > 0) {
      for (let r = 0; r < reps; r++) {
        for (const iv of intervals) out.push(parseRepMeters(iv.distance || iv.duration))
      }
    } else {
      for (let r = 0; r < reps; r++) out.push(parseRepMeters(set.distance || set.duration))
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
  // "10×800") — a lap under 40% of that is too short to be a real rep no
  // matter how fast it was run, so it must be a stride/fragment instead.
  const targets = expectedMeters.filter((m): m is number => m != null && m > 0)
  const minTarget = targets.length ? Math.min(...targets) : null
  const isFiller = (p: typeof parsed[number]) =>
    minTarget != null && p.meters != null && p.meters < minTarget * 0.4

  const pushRest = (p: typeof parsed[number]) => {
    rows.push({ kind: 'rest', time: p.sec != null ? secToPace(p.sec) : '—', heartRate: p.heartRate, distanceMeters: p.meters })
  }

  const rows: DisplayRow[] = []
  let li = 0
  let repIndex = 0
  for (const target of expectedMeters) {
    while (li < parsed.length && (isRest(parsed[li]) || isFiller(parsed[li]))) {
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
      if (isRest(p)) break // reached recovery — this rep's laps are done
      if (isFiller(p)) { li++; continue } // stride/fragment — skip, don't break
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
