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

/**
 * The local slope (Δpace/Δlactate, Δhr/Δlactate) of the athlete's real
 * step-test curve near a given lactate value — how fast pace/HR change per
 * mmol in that neighborhood. Used only as a SHAPE reference; never as an
 * absolute anchor, since the baseline test itself might be months old.
 */
function localSlope(baselineSteps: LactateStep[], atLactate: number): { paceSecPerMmol: number; hrPerMmol: number | null } | null {
  const pts = baselineSteps
    .map(s => ({ pace: paceToSec(s.pace), hr: s.hr ?? null, lac: Number(s.lactate) }))
    .filter((p): p is { pace: number; hr: number | null; lac: number } => p.pace != null && isFinite(p.lac) && p.lac > 0)
    .sort((a, b) => a.lac - b.lac)
  if (pts.length < 2) return null
  let i = pts.findIndex(p => p.lac >= atLactate)
  if (i <= 0) i = 1
  if (i >= pts.length) i = pts.length - 1
  const a = pts[i - 1], b = pts[i]
  if (b.lac === a.lac) return null
  return {
    paceSecPerMmol: (b.pace - a.pace) / (b.lac - a.lac),
    hrPerMmol: a.hr != null && b.hr != null ? (b.hr - a.hr) / (b.lac - a.lac) : null,
  }
}

/**
 * Same result as personalTargetRangeForLevel, but when the workout's own
 * data can't reach a level directly (e.g. a constant-pace workout that only
 * ever sampled one narrow lactate band), projects it instead: anchor on
 * today's actual measured point (average pace/HR/lactate across the
 * workout's reps), then walk outward using the athlete's real baseline
 * test's LOCAL SLOPE (how much pace/HR change per mmol near that level) —
 * not the baseline's absolute pace, which could be stale. This is how a
 * coach would eyeball it: "they're doing 3:49 at 2.3 mmol today; on their
 * usual curve shape, 2.0 mmol is probably just a touch slower than that."
 * Marked `extrapolated: true` so callers can show it's a projection, not a
 * direct reading.
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
  const valid = workoutSteps
    .map(s => ({ pace: paceToSec(s.pace), hr: s.hr ?? null, lac: Number(s.lactate) }))
    .filter((p): p is { pace: number; hr: number | null; lac: number } => p.pace != null && isFinite(p.lac) && p.lac > 0)
  if (valid.length === 0) return null

  const avgPace = valid.reduce((s, p) => s + p.pace, 0) / valid.length
  const avgLac = valid.reduce((s, p) => s + p.lac, 0) / valid.length
  const hrs = valid.map(p => p.hr).filter((h): h is number => h != null)
  const avgHr = hrs.length ? hrs.reduce((s, h) => s + h, 0) / hrs.length : null

  const slopeAtMin = localSlope(baselineSteps, min)
  const slopeAtMax = localSlope(baselineSteps, max)
  if (!slopeAtMin || !slopeAtMax) return null

  const paceAtMin = avgPace + slopeAtMin.paceSecPerMmol * (min - avgLac)
  const paceAtMax = avgPace + slopeAtMax.paceSecPerMmol * (max - avgLac)
  if (paceAtMin <= 0 || paceAtMax <= 0) return null
  const hrAtMin = avgHr != null && slopeAtMin.hrPerMmol != null ? Math.round(avgHr + slopeAtMin.hrPerMmol * (min - avgLac)) : null
  const hrAtMax = avgHr != null && slopeAtMax.hrPerMmol != null ? Math.round(avgHr + slopeAtMax.hrPerMmol * (max - avgLac)) : null

  const paceRangeSec: [number, number] = paceAtMax <= paceAtMin ? [paceAtMax, paceAtMin] : [paceAtMin, paceAtMax]
  const hrRange: [number, number] | null = hrAtMin != null && hrAtMax != null
    ? [Math.min(hrAtMin, hrAtMax), Math.max(hrAtMin, hrAtMax)]
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
 * "🎯 4:05 (3:55–4:15) · ♥170 (165–178) · 3.5 mmol/L" — shared rendering for
 * a personalized (or coach-overridden) workout target range, filtered to
 * whichever metrics the coach picked for that workout.
 */
export function formatTargetRange(
  range: { paceRangeSec: [number, number]; hrRange: [number, number] | null },
  metrics: ('pace' | 'hr' | 'lactate')[],
  lactateMid?: number,
): string {
  const parts: string[] = []
  if (metrics.includes('pace')) {
    const mid = Math.round((range.paceRangeSec[0] + range.paceRangeSec[1]) / 2)
    parts.push(`${secToPace(mid)} (${secToPace(range.paceRangeSec[0])}–${secToPace(range.paceRangeSec[1])})`)
  }
  if (metrics.includes('hr') && range.hrRange) {
    const mid = Math.round((range.hrRange[0] + range.hrRange[1]) / 2)
    parts.push(`♥${mid} (${range.hrRange[0]}–${range.hrRange[1]})`)
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
