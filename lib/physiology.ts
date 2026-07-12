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
  vo2maxEst: number | null
  /** 'test' = computed from a lactate test; 'manual' = coach estimate */
  source: 'test' | 'manual'
  testDate?: string
  updatedAt?: unknown
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

/** Compute LT1 (2.0 mmol) and LT2 (4.0 mmol) from test steps. */
export function computeThresholds(steps: LactateStep[]): {
  lt1: ThresholdPoint | null
  lt2: ThresholdPoint | null
} {
  return {
    lt1: interpolateAtLactate(steps, 2.0),
    lt2: interpolateAtLactate(steps, 4.0),
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

// ── In-workout spot checks (quick lactate readings during interval sessions) ──

export interface SpotReading {
  /** which rep / point in the session, e.g. "אחרי חזרה 8" */
  label?: string
  /** pace of that rep, "M:SS" per km */
  pace: string
  hr?: number | null
  lactate: number
}

/**
 * Expected lactate at a given pace, from the athlete's baseline threshold
 * anchors (LT1 = 2.0 mmol, LT2 = 4.0 mmol). Linear between/beyond anchors —
 * a simplification, but plenty for spotting shape changes between tests.
 */
export function expectedLactateAtPace(
  paceSec: number,
  lt1Sec: number | null | undefined,
  lt2Sec: number | null | undefined,
): number | null {
  if (!lt2Sec) return null
  // Slope: mmol per sec/km. With only LT2 known, assume ~2 mmol per 20 sec/km.
  const slope = lt1Sec && lt1Sec > lt2Sec ? (4.0 - 2.0) / (lt1Sec - lt2Sec) : 2.0 / 20
  const expected = 4.0 + (lt2Sec - paceSec) * slope
  return Math.max(0.7, Math.round(expected * 10) / 10)
}

export type ShapeVerdict = 'improving' | 'stable' | 'tired'

export interface SpotAnalysis {
  expected: number
  delta: number
  verdict: ShapeVerdict
  verdictHe: string
  /** estimated "today's T2" pace (sec/km) given the reading */
  todayT2Sec: number | null
}

/**
 * Compare a spot reading against the baseline curve:
 * lower lactate than expected at that pace → shape improving;
 * higher → fatigue / declining shape. Also estimates where T2 sits today
 * by shifting the baseline curve through the measured point.
 */
export function analyzeSpotReading(
  paceSec: number,
  measured: number,
  lt1Sec: number | null | undefined,
  lt2Sec: number | null | undefined,
): SpotAnalysis | null {
  const expected = expectedLactateAtPace(paceSec, lt1Sec, lt2Sec)
  if (expected == null || !lt2Sec) return null
  const delta = Math.round((measured - expected) * 10) / 10
  const verdict: ShapeVerdict = delta <= -0.5 ? 'improving' : delta >= 0.5 ? 'tired' : 'stable'
  const verdictHe =
    verdict === 'improving' ? 'כושר משתפר 🔥 — לקטט נמוך מהצפוי'
    : verdict === 'tired' ? 'עייפות / ירידה ⚠️ — לקטט גבוה מהצפוי'
    : 'יציב ✓ — תואם את הספים הידועים'
  const slope = lt1Sec && lt1Sec > lt2Sec ? (4.0 - 2.0) / (lt1Sec - lt2Sec) : 2.0 / 20
  // Shift the curve through the measured point, read pace at 4.0 mmol
  const todayT2Sec = paceSec - (4.0 - measured) / slope
  return {
    expected, delta, verdict, verdictHe,
    todayT2Sec: isFinite(todayT2Sec) && todayT2Sec > 0 ? Math.round(todayT2Sec) : null,
  }
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
