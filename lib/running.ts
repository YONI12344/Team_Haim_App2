/**
 * lib/running.ts
 *
 * Pace-zone and heart-rate-zone computations for distance running.
 *
 * The pace-zone math is based on Jack Daniels' VDOT model
 * (see "Daniels' Running Formula", 4th ed.). We implement the standard
 * Daniels/Gilbert formulas directly so we don't need to pull in a heavy
 * tables library.
 *
 *   1. Compute %VO2max sustainable for a given race duration `t` (minutes):
 *
 *        %VO2max(t) = 0.8 + 0.1894393 * exp(-0.012778 * t)
 *                       + 0.2989558 * exp(-0.1932605 * t)
 *
 *   2. Compute the VO2 cost of running at a given velocity `v` (m/min):
 *
 *        VO2(v) = -4.60 + 0.182258 * v + 0.000104 * v^2
 *
 *   3. The athlete's VO2max is then:  VO2(v_race) / %VO2max(t_race)
 *
 *   4. Each training zone has a known %VO2max anchor (Easy ~70%,
 *      Marathon ~84%, Threshold ~88%, Interval ~98%, Repetition ~105%).
 *      We invert the cost equation to recover the pace for each zone.
 *
 * HR zones use Karvonen reserve when restingHR + maxHR are available, else
 * %maxHR fallback (Z1 50-60, Z2 60-70, Z3 70-80, Z4 80-90, Z5 90-100).
 *
 * All functions are pure and exhaustively tested in
 * `lib/__tests__/running.test.mjs`.
 */

// -------------------- time helpers --------------------

/** Parse "mm:ss", "h:mm:ss" or plain seconds into total seconds. Returns NaN on failure. */
export function parseTimeToSeconds(input: string | number | undefined | null): number {
  if (input == null) return NaN
  if (typeof input === 'number') return input
  const trimmed = input.trim()
  if (!trimmed) return NaN
  // plain number => seconds
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed)
  const parts = trimmed.split(':').map((p) => p.trim())
  if (parts.some((p) => !/^\d+(\.\d+)?$/.test(p))) return NaN
  if (parts.length === 2) {
    const [m, s] = parts.map(Number)
    return m * 60 + s
  }
  if (parts.length === 3) {
    const [h, m, s] = parts.map(Number)
    return h * 3600 + m * 60 + s
  }
  return NaN
}

/** Format seconds as a pace string e.g. "5:30" (no units). */
export function formatPace(secondsPerKm: number): string {
  if (!isFinite(secondsPerKm) || secondsPerKm <= 0) return '—'
  const m = Math.floor(secondsPerKm / 60)
  const s = Math.round(secondsPerKm - m * 60)
  // handle rollover (e.g. 5:60 -> 6:00)
  if (s === 60) return `${m + 1}:00`
  return `${m}:${s.toString().padStart(2, '0')}`
}

/** Format a pace as "mm:ss/km". */
export function formatPaceKm(secondsPerKm: number): string {
  return `${formatPace(secondsPerKm)}/km`
}

// -------------------- known race distances --------------------

/**
 * Common race distances in metres. Used to map an event name (e.g. "5K",
 * "Half Marathon") to a distance for VDOT calculation.
 */
export const RACE_DISTANCES_M: Record<string, number> = {
  '800m': 800,
  '1500m': 1500,
  mile: 1609.34,
  '1mile': 1609.34,
  '3000m': 3000,
  '5k': 5000,
  '5000m': 5000,
  '10k': 10000,
  '10000m': 10000,
  '15k': 15000,
  '10mile': 16093.4,
  '20k': 20000,
  half: 21097.5,
  halfmarathon: 21097.5,
  'half marathon': 21097.5,
  marathon: 42195,
  full: 42195,
  'full marathon': 42195,
}

/** Best-effort mapping of an event string to a distance in metres. */
export function eventToDistanceMeters(event: string): number | undefined {
  const k = event.trim().toLowerCase().replace(/\s+/g, '')
  if (RACE_DISTANCES_M[k] != null) return RACE_DISTANCES_M[k]
  if (RACE_DISTANCES_M[event.trim().toLowerCase()] != null) {
    return RACE_DISTANCES_M[event.trim().toLowerCase()]
  }
  // try "5k", "10k", "21.1k", "42.2k"
  const km = k.match(/^([\d.]+)k(m)?$/)
  if (km) return Math.round(parseFloat(km[1]) * 1000)
  const m = k.match(/^([\d.]+)m$/)
  if (m) return Math.round(parseFloat(m[1]))
  return undefined
}

// -------------------- VDOT core math --------------------

/** %VO2max sustainable for a race lasting `t` minutes (Daniels/Gilbert). */
export function percentVO2maxForDuration(tMinutes: number): number {
  return (
    0.8 +
    0.1894393 * Math.exp(-0.012778 * tMinutes) +
    0.2989558 * Math.exp(-0.1932605 * tMinutes)
  )
}

/** Aerobic cost (ml/kg/min) of running at velocity `v` (metres/minute). */
export function vo2CostForVelocity(v: number): number {
  return -4.6 + 0.182258 * v + 0.000104 * v * v
}

/**
 * Invert vo2CostForVelocity: given a target VO2 (ml/kg/min) return the
 * velocity (m/min) that produces it. Solves a quadratic; takes the
 * positive root.
 */
export function velocityForVO2(targetVO2: number): number {
  // 0.000104 v^2 + 0.182258 v + (-4.6 - target) = 0
  const a = 0.000104
  const b = 0.182258
  const c = -4.6 - targetVO2
  const disc = b * b - 4 * a * c
  if (disc < 0) return NaN
  return (-b + Math.sqrt(disc)) / (2 * a)
}

/** Compute VDOT (VO2max in ml/kg/min) from a race distance + time. */
export function computeVDOT(distanceMeters: number, timeSeconds: number): number {
  if (!(distanceMeters > 0) || !(timeSeconds > 0)) return NaN
  const tMin = timeSeconds / 60
  const v = distanceMeters / tMin // metres per minute
  return vo2CostForVelocity(v) / percentVO2maxForDuration(tMin)
}

// -------------------- training zones --------------------

export interface PaceZone {
  key: 'easy' | 'marathon' | 'threshold' | 'threshold1' | 'threshold2' | 'interval' | 'repetition'
  label: string
  /** Lower bound in seconds per km (faster end of "easy" is the *lower* number). */
  lowSecPerKm: number
  /** Upper bound in seconds per km (slower end). For point-paces low === high. */
  highSecPerKm: number
  description: string
  effort: string
}

export interface TrainingZones {
  vdot: number
  reference: { event: string; distanceMeters: number; timeSeconds: number }
  zones: PaceZone[]
}

/**
 * Daniels-style %VO2max anchors per training zone. Easy/Long is a range;
 * everything else is a point or narrow range.
 */
const ZONE_ANCHORS: Array<{
  key: PaceZone['key']
  label: string
  lowPct: number
  highPct: number
  description: string
  effort: string
}> = [
  {
    key: 'easy',
    label: 'Easy / Long',
    lowPct: 0.74, // faster end
    highPct: 0.65, // slower end
    description: 'Conversational, base building',
    effort: 'RPE 4-5 · 65-79% HRmax',
  },
  {
    key: 'marathon',
    label: 'Marathon',
    lowPct: 0.84,
    highPct: 0.84,
    description: 'Marathon race pace',
    effort: 'RPE 6 · 80-85% HRmax',
  },
  {
    key: 'threshold1',
    label: 'Threshold T1',
    lowPct: 0.86,
    highPct: 0.86,
    description: 'Lower threshold (~60-min effort)',
    effort: 'RPE 7 · 85-88% HRmax',
  },
  {
    key: 'threshold',
    label: 'Threshold (T)',
    lowPct: 0.88,
    highPct: 0.88,
    description: 'Lactate threshold / tempo',
    effort: 'RPE 7-8 · 88-90% HRmax',
  },
  {
    key: 'threshold2',
    label: 'Threshold T2',
    lowPct: 0.9,
    highPct: 0.9,
    description: 'Upper threshold (~20-30 min effort)',
    effort: 'RPE 8 · 88-92% HRmax',
  },
  {
    key: 'interval',
    label: 'Interval (I)',
    lowPct: 0.98,
    highPct: 0.98,
    description: 'VO2max reps, 3-5 min hard',
    effort: 'RPE 9 · 95-100% HRmax',
  },
  {
    key: 'repetition',
    label: 'Repetition (R)',
    lowPct: 1.05,
    highPct: 1.05,
    description: 'Neuromuscular short reps',
    effort: 'RPE 10 · all-out short bouts',
  },
]

/**
 * Compute pace zones from a reference race. `event` is matched against
 * `RACE_DISTANCES_M`; pass a number to override.
 */
export function computeTrainingZones(input: {
  event: string
  timeSeconds: number
  distanceMeters?: number
}): TrainingZones | null {
  const distanceMeters =
    input.distanceMeters ?? eventToDistanceMeters(input.event) ?? NaN
  if (!(distanceMeters > 0) || !(input.timeSeconds > 0)) return null
  const vdot = computeVDOT(distanceMeters, input.timeSeconds)
  if (!isFinite(vdot) || vdot <= 0) return null

  const zones: PaceZone[] = ZONE_ANCHORS.map((z) => {
    const vLow = velocityForVO2(vdot * z.lowPct) // higher %VO2 => higher velocity => faster (lower sec/km)
    const vHigh = velocityForVO2(vdot * z.highPct)
    const lowSecPerKm = vLow > 0 ? 60000 / vLow : NaN
    const highSecPerKm = vHigh > 0 ? 60000 / vHigh : NaN
    return {
      key: z.key,
      label: z.label,
      lowSecPerKm,
      highSecPerKm,
      description: z.description,
      effort: z.effort,
    }
  })

  return {
    vdot,
    reference: {
      event: input.event,
      distanceMeters,
      timeSeconds: input.timeSeconds,
    },
    zones,
  }
}

// -------------------- heart-rate zones --------------------

export interface HRZone {
  key: 'z1' | 'z2' | 'z3' | 'z4' | 'z5'
  label: string
  lowBpm: number
  highBpm: number
  /** Matching pace bucket label, for display. */
  paceLabel: string
}

/**
 * 5-zone HR model. Uses Karvonen reserve (zone = resting + pct * (max - resting))
 * if `restingHR` is provided, else %maxHR fallback.
 */
export function computeHeartRateZones(input: {
  maxHR: number
  restingHR?: number
}): HRZone[] | null {
  const { maxHR, restingHR } = input
  if (!(maxHR > 0)) return null
  const useKarvonen = restingHR != null && restingHR > 0 && restingHR < maxHR

  const ranges: Array<{ key: HRZone['key']; label: string; low: number; high: number; paceLabel: string }> = [
    { key: 'z1', label: 'Z1 Recovery', low: 0.5, high: 0.6, paceLabel: 'Recovery / very easy' },
    { key: 'z2', label: 'Z2 Endurance', low: 0.6, high: 0.7, paceLabel: 'Easy / long' },
    { key: 'z3', label: 'Z3 Tempo', low: 0.7, high: 0.8, paceLabel: 'Marathon / steady' },
    { key: 'z4', label: 'Z4 Threshold', low: 0.8, high: 0.9, paceLabel: 'Threshold' },
    { key: 'z5', label: 'Z5 VO2max', low: 0.9, high: 1.0, paceLabel: 'Interval / repetition' },
  ]

  return ranges.map((r) => {
    let low: number
    let high: number
    if (useKarvonen) {
      const reserve = maxHR - (restingHR as number)
      low = (restingHR as number) + reserve * r.low
      high = (restingHR as number) + reserve * r.high
    } else {
      low = maxHR * r.low
      high = maxHR * r.high
    }
    return {
      key: r.key,
      label: r.label,
      lowBpm: Math.round(low),
      highBpm: Math.round(high),
      paceLabel: r.paceLabel,
    }
  })
}

/** Estimate max HR from age using Tanaka (208 − 0.7 × age). */
export function estimateMaxHRFromAge(age: number): number {
  if (!(age > 0) || age > 120) return NaN
  return Math.round(208 - 0.7 * age)
}
