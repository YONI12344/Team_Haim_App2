/**
 * lib/physiology.ts
 *
 * Lactate-test math for the coach "lab":
 * - interpolate LT1 (aerobic threshold, ~2.0 mmol/L) and LT2 (anaerobic
 *   threshold, ~4.0 mmol/L) pace + heart rate from test steps
 * - estimate VO2max from threshold pace
 * - derive training-pace bands anchored on the measured thresholds
 * - heart-rate zones anchored on LT1/LT2 HR (better than %max when available)
 *
 * Stored data:
 * - `lactateTests` collection: { athleteId, date, notes, steps[], computed{} }
 * - users/{id}.physiology: latest summary the athlete views
 */

export interface LactateStep {
  /** pace as "M:SS" per km */
  pace: string
  /** heart rate bpm at end of step (optional) */
  hr?: number | null
  /** lactate mmol/L */
  lactate: number
}

export interface ThresholdPoint {
  paceSecPerKm: number
  hr: number | null
}

export interface PhysiologySummary {
  /** LT1 / aerobic threshold ("T1") */
  lt1PaceSec: number | null
  lt1Hr: number | null
  /** LT2 / anaerobic threshold ("T2") */
  lt2PaceSec: number | null
  lt2Hr: number | null
  /** LT3 / deep anaerobic marker ("T3", 4.5 mmol/L) */
  lt3PaceSec?: number | null
  lt3Hr?: number | null
  vo2maxEst: number | null
  /** 'test' = computed from a lactate test; 'manual' = coach estimate */
  source: 'test' | 'manual'
  testDate?: string
  updatedAt?: unknown
}

/** Fixed lactate anchors (mmol/L) for the three markers used throughout the
 *  Lab (real step-test analysis: "Current thresholds" card, chart reference
 *  lines/dots) — unaffected by the workout-target ranges below. */
export const LT1_TARGET = 2.0
export const LT2_TARGET = 4.0
export const LT3_TARGET = 4.5

/**
 * Deliberately different, wider mmol ranges used only for a 'threshold'
 * workout's target (not the Lab's single-point thresholds above) — a
 * workout target is a training zone to hold, not a precise lab marker.
 */
export const WORKOUT_TARGET_RANGES: Record<'T1' | 'T2' | 'T3', { min: number; max: number }> = {
  T1: { min: 2.0, max: 2.5 },
  T2: { min: 3.0, max: 4.0 },
  T3: { min: 4.0, max: 5.0 },
}

export interface PersonalTargetRange {
  /** [fast, slow] seconds/km — fast (lower sec) corresponds to the range's higher mmol end. */
  paceRangeSec: [number, number]
  /** [low, high] bpm, or null when the test steps didn't record HR. */
  hrRange: [number, number] | null
  lactateRange: [number, number]
  /** Midpoint mmol — the "primary" reference value within the range. */
  lactateMid: number
  /** true when this range is projected from the baseline test's local
   *  slope through a single workout measurement, rather than read/interpolated
   *  directly from the workout's own data (see personalTargetRangeWithBaseline). */
  extrapolated?: boolean
}

/**
 * The athlete's own pace/HR *range* for a given threshold level, interpolated
 * from their real step-test steps at both ends of that level's mmol range
 * (WORKOUT_TARGET_RANGES) — so a 'threshold' workout shows each assigned
 * athlete their personal range instead of one fixed number baked into the
 * template. Returns null when the athlete's tested lactate range doesn't
 * cover both ends (e.g. never took a step test, or the test didn't reach
 * that intensity) rather than a misleading partial range.
 */
export function personalTargetRangeForLevel(
  steps: LactateStep[] | null | undefined,
  level: 'T1' | 'T2' | 'T3',
): PersonalTargetRange | null {
  if (!steps || steps.length === 0) return null
  const { min, max } = WORKOUT_TARGET_RANGES[level]

  // Prefer true interpolation across a graduated spread of efforts (a step
  // test, or a workout with genuinely different paces) — most accurate
  // when the data actually spans this level's mmol window.
  if (steps.length >= 2) {
    const atLow = interpolateAtLactate(steps, min)
    const atHigh = interpolateAtLactate(steps, max)
    if (atLow && atHigh) {
      // Higher mmol ⇒ faster pace (lower sec/km) — order the pair fast→slow regardless.
      const paceRangeSec: [number, number] = atHigh.paceSecPerKm <= atLow.paceSecPerKm
        ? [atHigh.paceSecPerKm, atLow.paceSecPerKm]
        : [atLow.paceSecPerKm, atHigh.paceSecPerKm]
      const hrRange: [number, number] | null = atLow.hr != null && atHigh.hr != null
        ? [Math.min(atLow.hr, atHigh.hr), Math.max(atLow.hr, atHigh.hr)]
        : null
      return {
        paceRangeSec,
        hrRange,
        lactateRange: [min, max],
        lactateMid: Math.round((min + max) * 10 / 2) / 10,
      }
    }
  }

  // Fallback: a constant-pace workout (e.g. reps all held at roughly the
  // same effort) has no slope to interpolate — but if the measured lactate
  // itself already falls inside this level's target window, that
  // measurement directly tells us today's pace/HR for that level. Use it
  // instead of discarding real data just because there's no second effort
  // to interpolate against.
  const inRange = steps
    .map(s => ({ pace: paceToSec(s.pace), hr: s.hr ?? null, lac: Number(s.lactate) }))
    .filter((p): p is { pace: number; hr: number | null; lac: number } => p.pace != null && isFinite(p.lac) && p.lac > 0)
    .filter(p => p.lac >= min && p.lac <= max)
  if (inRange.length === 0) return null
  const paces = inRange.map(p => p.pace)
  const hrs = inRange.map(p => p.hr).filter((h): h is number => h != null)
  const avgLac = Math.round((inRange.reduce((s, p) => s + p.lac, 0) / inRange.length) * 10) / 10
  return {
    paceRangeSec: [Math.min(...paces), Math.max(...paces)],
    hrRange: hrs.length ? [Math.min(...hrs), Math.max(...hrs)] : null,
    lactateRange: [min, max],
    lactateMid: avgLac,
  }
}

interface ZonePoint { paceSec: number; hr: number | null; lac: number }
interface ZoneSlope { paceSecPerMmol: number; hrPerMmol: number | null }

/**
 * The baseline test's own three physiological zones, per the coach's own
 * fixed lab markers (2.0/4.0/4.5 mmol): "rest" (the test's own first/lowest
 * measured step — there's no true resting sample, so the easiest real step
 * stands in for it), T1, T2, T3. Each zone (rest→T1, T1→T2, T2→T3) gets its
 * OWN slope, since a real lactate curve's steepness changes markedly
 * between zones — using one slope for the whole curve would misrepresent
 * how much pace/HR actually move per mmol within a specific zone.
 */
function baselineZones(baselineSteps: LactateStep[]): { rest: ZonePoint; t1: ZonePoint; t2: ZonePoint; t3: ZonePoint } | null {
  const pts = baselineSteps
    .map(s => ({ pace: paceToSec(s.pace), hr: s.hr ?? null, lac: Number(s.lactate) }))
    .filter((p): p is { pace: number; hr: number | null; lac: number } => p.pace != null && isFinite(p.lac) && p.lac > 0)
    .sort((a, b) => a.lac - b.lac)
  if (pts.length < 2) return null
  const rest: ZonePoint = { paceSec: pts[0].pace, hr: pts[0].hr, lac: pts[0].lac }
  const t1 = interpolateAtLactate(baselineSteps, LT1_TARGET)
  const t2 = interpolateAtLactate(baselineSteps, LT2_TARGET)
  const t3 = interpolateAtLactate(baselineSteps, LT3_TARGET)
  if (!t1 || !t2 || !t3) return null
  return {
    rest,
    t1: { paceSec: t1.paceSecPerKm, hr: t1.hr, lac: LT1_TARGET },
    t2: { paceSec: t2.paceSecPerKm, hr: t2.hr, lac: LT2_TARGET },
    t3: { paceSec: t3.paceSecPerKm, hr: t3.hr, lac: LT3_TARGET },
  }
}

function zoneSlope(a: ZonePoint, b: ZonePoint): ZoneSlope | null {
  if (b.lac === a.lac) return null
  return {
    paceSecPerMmol: (b.paceSec - a.paceSec) / (b.lac - a.lac),
    hrPerMmol: a.hr != null && b.hr != null ? (b.hr - a.hr) / (b.lac - a.lac) : null,
  }
}

interface WorkoutValidStep { paceSec: number; hr: number | null; lac: number }

/** The workout's own valid real points, sorted by lactate ascending. */
function workoutValidSteps(workoutSteps: LactateStep[]): WorkoutValidStep[] {
  return workoutSteps
    .map(s => ({ paceSec: paceToSec(s.pace)!, hr: s.hr ?? null, lac: Number(s.lactate) }))
    .filter((p): p is WorkoutValidStep => p.paceSec != null && isFinite(p.lac) && p.lac > 0)
    .sort((a, b) => a.lac - b.lac)
}

/**
 * Which of the workout's own real points to project a given target lactate
 * FROM — always the workout's own nearest real endpoint (its lowest point
 * when projecting toward a lower mmol, its highest when projecting toward
 * a higher one), never an averaged/synthetic point. This is what makes the
 * projected line visibly continue the workout's own real dots instead of
 * anchoring somewhere between them that doesn't correspond to any actual
 * measurement — the projection should look like it's ON the workout curve.
 */
function nearestWorkoutAnchor(valid: WorkoutValidStep[], targetLac: number): WorkoutValidStep {
  return targetLac <= valid[0].lac ? valid[0] : valid[valid.length - 1]
}

/**
 * Projects pace/HR at `targetLac`, walking from the workout's own anchor
 * point through the baseline's zone boundaries (T1=2.0, T2=4.0) one
 * segment at a time, applying that SPECIFIC zone's slope to each segment —
 * a proper piecewise-linear continuation of the workout's line using the
 * baseline's own shape, instead of one blended slope across zones with
 * very different real steepness.
 */
function projectAtLactate(
  anchor: { paceSec: number; hr: number | null; lac: number },
  targetLac: number,
  zones: { rest: ZonePoint; t1: ZonePoint; t2: ZonePoint; t3: ZonePoint },
  m1: ZoneSlope | null, m2: ZoneSlope | null, m3: ZoneSlope | null,
): { paceSec: number; hr: number | null } | null {
  const slopeForZone = (midLac: number) => midLac < zones.t1.lac ? m1 : midLac < zones.t2.lac ? m2 : m3
  if (Math.abs(targetLac - anchor.lac) < 1e-9) return { paceSec: anchor.paceSec, hr: anchor.hr }
  const dir = targetLac > anchor.lac ? 1 : -1
  const boundaries = [zones.t1.lac, zones.t2.lac].filter(b =>
    dir > 0 ? b > anchor.lac && b < targetLac : b < anchor.lac && b > targetLac
  )
  const stops = [anchor.lac, ...boundaries.sort((a, b) => dir > 0 ? a - b : b - a), targetLac]
  let lac = anchor.lac, paceSec = anchor.paceSec, hr: number | null = anchor.hr
  for (let i = 1; i < stops.length; i++) {
    const next = stops[i]
    const m = slopeForZone((lac + next) / 2)
    if (!m) return null
    paceSec += m.paceSecPerMmol * (next - lac)
    if (hr != null && m.hrPerMmol != null) hr += m.hrPerMmol * (next - lac)
    else hr = null
    lac = next
  }
  return paceSec > 0 ? { paceSec, hr } : null
}

/**
 * Same result as personalTargetRangeForLevel, but when the workout's own
 * data can't reach a level directly (e.g. a constant-pace workout that only
 * ever sampled one narrow lactate band), projects it instead: anchor on the
 * workout's own nearest REAL point (its lowest measured lactate when
 * projecting downward, its highest when projecting upward — never an
 * averaged, synthetic point that doesn't correspond to any actual
 * measurement), then walk to the target lactate through the baseline
 * test's own per-zone slopes (rest→T1, T1→T2, T2→T3) — not the baseline's
 * absolute pace, which could be stale, only its shape, zone by zone. This
 * is how a coach would eyeball it: "their slowest rep was 3:49 at 2.3 mmol
 * today — on their usual curve shape between T1 and T2, 2.0 mmol is
 * probably just a touch slower than that, starting from where they
 * actually were." Marked `extrapolated: true` so callers can show it's a
 * projection, not a direct reading.
 */
export function personalTargetRangeWithBaseline(
  workoutSteps: LactateStep[] | null | undefined,
  baselineSteps: LactateStep[] | null | undefined,
  level: 'T1' | 'T2' | 'T3',
): PersonalTargetRange | null {
  const direct = personalTargetRangeForLevel(workoutSteps, level)
  if (direct) return direct
  if (!workoutSteps || workoutSteps.length === 0 || !baselineSteps || baselineSteps.length < 2) return null

  const { min, max } = WORKOUT_TARGET_RANGES[level]
  const valid = workoutValidSteps(workoutSteps)
  const zones = baselineZones(baselineSteps)
  if (valid.length === 0 || !zones) return null
  const m1 = zoneSlope(zones.rest, zones.t1)
  const m2 = zoneSlope(zones.t1, zones.t2)
  const m3 = zoneSlope(zones.t2, zones.t3)

  const atMin = projectAtLactate(nearestWorkoutAnchor(valid, min), min, zones, m1, m2, m3)
  const atMax = projectAtLactate(nearestWorkoutAnchor(valid, max), max, zones, m1, m2, m3)
  if (!atMin || !atMax) return null

  const paceRangeSec: [number, number] = atMax.paceSec <= atMin.paceSec ? [atMax.paceSec, atMin.paceSec] : [atMin.paceSec, atMax.paceSec]
  const hrRange: [number, number] | null = atMin.hr != null && atMax.hr != null
    ? [Math.round(Math.min(atMin.hr, atMax.hr)), Math.round(Math.max(atMin.hr, atMax.hr))]
    : null

  return {
    paceRangeSec,
    hrRange,
    lactateRange: [min, max],
    lactateMid: Math.round((min + max) * 10 / 2) / 10,
    extrapolated: true,
  }
}

/**
 * The actual line behind personalTargetRangeWithBaseline's numbers — the
 * workout's own real points, PLUS a piecewise-linear extension before the
 * lowest one and after the highest one, using the baseline's per-zone
 * slopes (see projectAtLactate). Drawn as one continuous dashed trendline
 * on the graph (components/coach/lactate-multi-curve-chart.tsx) that
 * visibly passes through the workout's actual dots and extends outward
 * from them — not a separate line anchored on an averaged point that
 * doesn't correspond to anything actually measured, which could end up
 * sitting anywhere near the baseline instead of visibly continuing the
 * workout's own curve. Extended ±2 mmol past the workout's own real range
 * (comfortably covers T1–T3, since a workout's own measured lactate is
 * normally itself already close to that 2.0–4.5 neighborhood).
 */
export function projectWorkoutTrend(
  workoutSteps: LactateStep[] | null | undefined,
  baselineSteps: LactateStep[] | null | undefined,
): LactateStep[] | null {
  if (!workoutSteps || workoutSteps.length === 0 || !baselineSteps || baselineSteps.length < 2) return null
  const valid = workoutValidSteps(workoutSteps)
  const zones = baselineZones(baselineSteps)
  if (valid.length === 0 || !zones) return null
  const m1 = zoneSlope(zones.rest, zones.t1)
  const m2 = zoneSlope(zones.t1, zones.t2)
  const m3 = zoneSlope(zones.t2, zones.t3)

  const minPt = valid[0]
  const maxPt = valid[valid.length - 1]

  // Extend only as far as actually needed to reach T1 (2.0) / T3 (5.0), not
  // a generic ±2 mmol — sweeping further than that (especially below the
  // workout's own lowest point, down toward rest) runs so far along the
  // baseline's own slope that it visually reads as a copy of the baseline
  // curve instead of a short, clearly-workout-anchored extension.
  const before: LactateStep[] = []
  const lo = Math.max(0.5, Math.min(minPt.lac, WORKOUT_TARGET_RANGES.T1.min) - 0.3)
  for (let lac = lo; lac < minPt.lac - 0.05; lac += 0.5) {
    const p = projectAtLactate(minPt, lac, zones, m1, m2, m3)
    if (p) before.push({ pace: secToPace(p.paceSec), hr: p.hr != null ? Math.round(p.hr) : null, lactate: Math.round(lac * 10) / 10 })
  }
  const after: LactateStep[] = []
  const hi = Math.max(maxPt.lac, WORKOUT_TARGET_RANGES.T3.max) + 0.3
  for (let lac = maxPt.lac + 0.5; lac <= hi + 0.001; lac += 0.5) {
    const p = projectAtLactate(maxPt, lac, zones, m1, m2, m3)
    if (p) after.push({ pace: secToPace(p.paceSec), hr: p.hr != null ? Math.round(p.hr) : null, lactate: Math.round(lac * 10) / 10 })
  }
  const real: LactateStep[] = valid.map(p => ({ pace: secToPace(p.paceSec), hr: p.hr, lactate: p.lac }))
  const all = [...before, ...real, ...after]
  return all.length >= 2 ? all : null
}

/**
 * "🎯 4:05 (3:55–4:15) · ♥170 (165–178) · 3.5 mmol/L" — shared rendering for
 * a personalized (or coach-overridden) workout target range, filtered to
 * whichever metrics the coach picked for that workout.
 */
export function formatTargetRange(
  range: { paceRangeSec: [number, number]; hrRange: [number, number] | null },
  metrics: ('pace' | 'hr' | 'lactate')[],
  lactateMid?: number,
  /** false = just the midpoint number, no "(min–max)" — for showing the
   *  target inline on a set's own line, where the full range is clutter;
   *  the range itself still belongs in the badge above the sets. */
  showRange = true,
): string {
  const parts: string[] = []
  if (metrics.includes('pace')) {
    const mid = Math.round((range.paceRangeSec[0] + range.paceRangeSec[1]) / 2)
    parts.push(showRange
      ? `${secToPace(mid)} (${secToPace(range.paceRangeSec[0])}–${secToPace(range.paceRangeSec[1])})`
      : secToPace(mid))
  }
  if (metrics.includes('hr') && range.hrRange) {
    const lo = Math.round(range.hrRange[0]), hi = Math.round(range.hrRange[1])
    const mid = Math.round((lo + hi) / 2)
    parts.push(showRange ? `♥${mid} (${lo}–${hi})` : `♥${mid}`)
  }
  if (metrics.includes('lactate') && lactateMid != null) {
    parts.push(`${lactateMid} mmol/L`)
  }
  return parts.join(' · ')
}

/** "4:30" → 270 (sec/km). Returns null when unparseable. */
export function paceToSec(p: string | null | undefined): number | null {
  if (!p) return null
  const m = String(p).trim().replace('/km', '').match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const sec = parseInt(m[1], 10) * 60 + parseInt(m[2], 10)
  return sec > 0 ? sec : null
}

/** 270 → "4:30" */
export function secToPace(sec: number | null | undefined): string {
  if (sec == null || !isFinite(sec) || sec <= 0) return '—'
  const s = Math.round(sec)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Linear interpolation of the pace (and HR) at a target lactate value.
 * Steps must have valid paces; sorted internally by lactate ascending.
 * Returns null when the target is outside the measured lactate range.
 */
export function interpolateAtLactate(steps: LactateStep[], target: number): ThresholdPoint | null {
  const pts = steps
    .map(s => ({ pace: paceToSec(s.pace), hr: s.hr ?? null, lac: Number(s.lactate) }))
    .filter(p => p.pace != null && isFinite(p.lac) && p.lac > 0)
    .sort((a, b) => a.lac - b.lac) as { pace: number; hr: number | null; lac: number }[]
  if (pts.length < 2) return null
  if (target < pts[0].lac || target > pts[pts.length - 1].lac) return null

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (target >= a.lac && target <= b.lac) {
      const f = b.lac === a.lac ? 0 : (target - a.lac) / (b.lac - a.lac)
      const paceSecPerKm = a.pace + (b.pace - a.pace) * f
      const hr = a.hr != null && b.hr != null ? Math.round(a.hr + (b.hr - a.hr) * f) : (b.hr ?? a.hr)
      return { paceSecPerKm, hr }
    }
  }
  return null
}

/**
 * Estimate a lactate value from HR using the athlete's real baseline step
 * test's own HR→lactate relationship (linear interpolation between the two
 * bracketing measured points) — used when a threshold workout rep has HR
 * but wasn't tested for lactate, so it can still be placed on the real
 * lactate curve (with T1/T2/T3 markers) instead of being dropped from it.
 * Clamps to the nearest endpoint's lactate for an HR outside the
 * baseline's own tested range — still directionally useful, unlike
 * returning null and losing the point entirely.
 */
export function estimateLactateFromHr(baselineSteps: LactateStep[], hr: number): number | null {
  const pts = baselineSteps
    .map(s => ({ hr: s.hr, lac: Number(s.lactate) }))
    .filter((p): p is { hr: number; lac: number } => p.hr != null && isFinite(p.lac) && p.lac > 0)
    .sort((a, b) => a.hr - b.hr)
  if (pts.length < 2) return null
  if (hr <= pts[0].hr) return pts[0].lac
  if (hr >= pts[pts.length - 1].hr) return pts[pts.length - 1].lac
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (hr >= a.hr && hr <= b.hr) {
      const f = b.hr === a.hr ? 0 : (hr - a.hr) / (b.hr - a.hr)
      return Math.round((a.lac + (b.lac - a.lac) * f) * 10) / 10
    }
  }
  return null
}

export interface ThresholdTriple {
  lt1: ThresholdPoint | null
  lt2: ThresholdPoint | null
  lt3: ThresholdPoint | null
}

/** Compute LT1 (2.0 mmol), LT2 (4.0 mmol) and LT3 (4.5 mmol) from test steps. */
export function computeThresholds(steps: LactateStep[]): ThresholdTriple {
  return {
    lt1: interpolateAtLactate(steps, LT1_TARGET),
    lt2: interpolateAtLactate(steps, LT2_TARGET),
    lt3: interpolateAtLactate(steps, LT3_TARGET),
  }
}

/**
 * Inverse of interpolateAtLactate: linear interpolation of lactate at a
 * target heart rate. Used to compare two curves "at the same effort" (HR)
 * rather than at the same lactate value — e.g. "at 165 bpm, lactate went
 * from 2.4 to 2.0". Steps without an `hr` are ignored; returns null when
 * fewer than two usable points or the target HR falls outside the tested
 * range.
 */
export function interpolateAtHr(steps: LactateStep[], targetHr: number): number | null {
  const pts = steps
    .map(s => ({ hr: s.hr ?? null, lac: Number(s.lactate) }))
    .filter((p): p is { hr: number; lac: number } => p.hr != null && isFinite(p.lac) && p.lac > 0)
    .sort((a, b) => a.hr - b.hr)
  if (pts.length < 2) return null
  if (targetHr < pts[0].hr || targetHr > pts[pts.length - 1].hr) return null

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1]
    if (targetHr >= a.hr && targetHr <= b.hr) {
      const f = b.hr === a.hr ? 0 : (targetHr - a.hr) / (b.hr - a.hr)
      return Math.round((a.lac + (b.lac - a.lac) * f) * 100) / 100
    }
  }
  return null
}

/**
 * Rough VO2max estimate from LT2 pace: threshold velocity ≈ 88% of vVO2max,
 * and VO2max ≈ vVO2max (km/h) × 3.5. Clearly an estimate — label it so.
 */
export function estimateVo2max(lt2PaceSec: number | null): number | null {
  if (!lt2PaceSec || lt2PaceSec <= 0) return null
  const thresholdKmh = 3600 / lt2PaceSec
  const vVo2maxKmh = thresholdKmh / 0.88
  return Math.round(vVo2maxKmh * 3.5 * 10) / 10
}

export interface DerivedPaceBand {
  key: string
  labelHe: string
  /** slower bound (sec/km) */
  lowSec: number
  /** faster bound (sec/km) */
  highSec: number
  noteHe: string
}

/**
 * Training-pace bands anchored on the measured LT2 pace (sec/km), with LT1
 * used for the easy ceiling when available. Offsets follow common
 * threshold-anchored practice (Daniels/Seiler style).
 */
export function derivePaceBands(lt2Sec: number, lt1Sec?: number | null): DerivedPaceBand[] {
  const easyHigh = lt1Sec != null ? lt1Sec + 10 : lt2Sec + 45
  return [
    { key: 'recovery',  labelHe: 'התאוששות',        lowSec: easyHigh + 45, highSec: easyHigh + 20, noteHe: 'ריצה קלה מאוד, שיחה חופשית' },
    { key: 'easy',      labelHe: 'קל / אירובי',      lowSec: easyHigh + 20, highSec: easyHigh - 15, noteHe: lt1Sec != null ? 'מתחת לסף האירובי (T1)' : 'הערכה מ-T2' },
    { key: 'marathon',  labelHe: 'קצב מרתון',        lowSec: lt2Sec + 20,  highSec: lt2Sec + 12,  noteHe: 'בין T1 ל-T2' },
    { key: 'threshold', labelHe: 'סף (T2)',          lowSec: lt2Sec + 3,   highSec: lt2Sec - 3,   noteHe: 'קצב סף חומצת חלב' },
    { key: 'interval',  labelHe: 'אינטרוולים (VO2)', lowSec: lt2Sec - 15,  highSec: lt2Sec - 25,  noteHe: 'קטעים 2–5 דק׳' },
    { key: 'reps',      labelHe: 'חזרות מהירות',     lowSec: lt2Sec - 30,  highSec: lt2Sec - 40,  noteHe: 'קטעים קצרים, מהירות' },
  ]
}


export interface HrZone {
  key: string
  labelHe: string
  lowBpm: number
  highBpm: number
  noteHe: string
}

/**
 * Heart-rate zones. When LT1/LT2 HRs are known (from a test) the zones are
 * anchored on them — much more individual than %max. Falls back to %maxHR.
 */
export function physiologyHrZones(opts: {
  maxHr?: number | null
  lt1Hr?: number | null
  lt2Hr?: number | null
}): { zones: HrZone[]; anchored: boolean } | null {
  const { maxHr, lt1Hr, lt2Hr } = opts
  if (lt1Hr && lt2Hr && lt2Hr > lt1Hr) {
    const top = maxHr && maxHr > lt2Hr + 8 ? maxHr : lt2Hr + 15
    return {
      anchored: true,
      zones: [
        { key: 'z1', labelHe: 'Z1 התאוששות', lowBpm: 0, highBpm: lt1Hr - 12, noteHe: 'מתחת לסף האירובי' },
        { key: 'z2', labelHe: 'Z2 אירובי',   lowBpm: lt1Hr - 11, highBpm: lt1Hr, noteHe: 'עד T1 — בסיס הנפח' },
        { key: 'z3', labelHe: 'Z3 טמפו',     lowBpm: lt1Hr + 1, highBpm: lt2Hr - 6, noteHe: 'בין הספים' },
        { key: 'z4', labelHe: 'Z4 סף',       lowBpm: lt2Hr - 5, highBpm: lt2Hr + 4, noteHe: 'סביב T2' },
        { key: 'z5', labelHe: 'Z5 מקסימלי',  lowBpm: lt2Hr + 5, highBpm: top, noteHe: 'מעל הסף — VO2max' },
      ],
    }
  }
  if (maxHr && maxHr > 100) {
    const pct = (p: number) => Math.round(maxHr * p)
    return {
      anchored: false,
      zones: [
        { key: 'z1', labelHe: 'Z1 התאוששות', lowBpm: pct(0.50), highBpm: pct(0.60), noteHe: '50–60% מדופק מקס׳' },
        { key: 'z2', labelHe: 'Z2 אירובי',   lowBpm: pct(0.60), highBpm: pct(0.70), noteHe: '60–70%' },
        { key: 'z3', labelHe: 'Z3 טמפו',     lowBpm: pct(0.70), highBpm: pct(0.80), noteHe: '70–80%' },
        { key: 'z4', labelHe: 'Z4 סף',       lowBpm: pct(0.80), highBpm: pct(0.90), noteHe: '80–90%' },
        { key: 'z5', labelHe: 'Z5 מקסימלי',  lowBpm: pct(0.90), highBpm: maxHr, noteHe: '90–100%' },
      ],
    }
  }
  return null
}
