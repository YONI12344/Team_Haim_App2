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
export interface MatchedLap { pace: string; heartRate: number | null }

/**
 * Matches Strava laps to workout reps by DISTANCE, not by raw position.
 * Some watches auto-lap at a fixed round distance (e.g. every 1km)
 * regardless of the workout's actual rep length, so a 1.6km rep can come
 * back as two laps (1km + 0.6km) instead of one — matched 1:1 by index,
 * that desyncs every rep after it. This also still has to skip real
 * rest/recovery laps (much slower pace) so they don't get folded into a
 * work rep's distance by mistake.
 *
 * For each rep (in order), skips any rest laps AND any "filler" laps (much
 * shorter than the smallest rep distance in this workout — a warmup
 * stride, a GPS-blip fragment, etc.), then accumulates consecutive real
 * laps — summing their distance AND their time — until the total reaches
 * ~90% of that rep's expected distance. The rep's pace is then computed
 * from the COMBINED time ÷ COMBINED distance (not from any single lap's
 * own pace), and its HR is the time-weighted average across whichever laps
 * got combined. A rep with no known expected distance (a duration-based
 * rep) just takes the next single non-filler lap, same as before.
 *
 * Warmup/cooldown/strides are never explicitly labeled in Strava's lap
 * data, so they're inferred: a slow lap (jogging pace) is caught by the
 * rest-pace check below; a short fast one (a stride) isn't slow but is far
 * too short to be a real rep, caught by the filler-distance check instead.
 * Either way they're skipped from the rep-matching entirely — they still
 * count toward the session's overall distance/duration (that comes from
 * the whole Strava activity, untouched by this function), just never fill
 * a specific rep's pace.
 */
export function matchLapsToReps(laps: RawLap[], expectedMeters: (number | null)[]): (MatchedLap | null)[] {
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

  const results: (MatchedLap | null)[] = []
  let li = 0
  for (const target of expectedMeters) {
    while (li < parsed.length && (isRest(parsed[li]) || isFiller(parsed[li]))) li++
    if (li >= parsed.length) { results.push(null); continue }

    if (!target) {
      // Duration-based rep — no expected distance to match against, so
      // just take the next lap as-is (previous 1:1 behavior).
      const p = parsed[li]
      results.push(p.meters && p.sec ? { pace: secToPace(paceOf(p)), heartRate: p.heartRate } : null)
      li++
      continue
    }

    let accMeters = 0, accSec = 0, hrWeighted = 0, hrWeight = 0, used = 0
    while (li < parsed.length) {
      const p = parsed[li]
      if (isRest(p)) break // reached recovery — this rep's laps are done
      if (isFiller(p)) { li++; continue } // stride/fragment — skip, don't break
      if (p.meters == null || p.sec == null) { li++; continue }
      accMeters += p.meters
      accSec += p.sec
      if (p.heartRate != null) { hrWeighted += p.heartRate * p.sec; hrWeight += p.sec }
      used++
      li++
      if (accMeters >= target * 0.9) break
    }
    results.push(used > 0
      ? { pace: secToPace(accSec / (accMeters / 1000)), heartRate: hrWeight > 0 ? Math.round(hrWeighted / hrWeight) : null }
      : null)
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
