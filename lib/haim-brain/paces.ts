// Pace maths from Chapter 2 of the brain (no AI): race result -> VDOT -> training paces.
// Ported from the TeamHaim brain's paces.py so both give identical numbers.

/** Python's round(): halves go to the even neighbour (2.5 -> 2, 3.5 -> 4). Keeps numbers identical to the
 *  Python brain, which Math.round (halves always up) would not. */
export function pyRound(x: number, digits = 0): number {
  const m = 10 ** digits
  const v = x * m
  const r = Math.round(v)
  return (Math.abs(v % 1) === 0.5 ? (r % 2 === 0 ? r : r - 1) : r) / m
}

export function paceToS(p: unknown): number | null {
  if (typeof p === 'number') return p
  const m = String(p ?? '').match(/^\s*(\d{1,2}):(\d{2})\s*$/)
  return m ? Number(m[1]) * 60 + Number(m[2]) : null
}

export function sToPace(s: number): string {
  const r = Math.round(s)
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`
}

export function timeToS(t: unknown): number | null {
  const parts = String(t ?? '').trim().split(':')
  const nums = parts.map(Number)
  if (nums.some((n) => Number.isNaN(n))) return null
  if (nums.length === 2) return nums[0] * 60 + nums[1]
  if (nums.length === 3) return nums[0] * 3600 + nums[1] * 60 + nums[2]
  return null
}

/** Daniels & Gilbert oxygen-power equations (the model behind the VDOT tables, Ch. 2). */
export function vdot(distanceM: number, seconds: number): number {
  const t = seconds / 60
  const v = distanceM / t
  const vo2 = -4.6 + 0.182258 * v + 0.000104 * v * v
  const pct = 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t)
  return vo2 / pct
}

export function velocityAt(vo2: number): number {
  const a = 0.000104, b = 0.182258, c = -4.6 - vo2
  return (-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a) // m/min
}

/** Golden Zone by rep length: short +0..7, medium +7..14, long +14..21 s/km slower than T-pace (Ch. 2). */
export function goldenFromThreshold(tPaceS: number) {
  return {
    golden_short: `${sToPace(tPaceS)}-${sToPace(tPaceS + 7)} /km`,
    golden_medium: `${sToPace(tPaceS + 7)}-${sToPace(tPaceS + 14)} /km`,
    golden_long: `${sToPace(tPaceS + 14)}-${sToPace(tPaceS + 21)} /km`,
  }
}

export function pacesFromRace(distanceKm: number, seconds: number) {
  const vd = vdot(distanceKm * 1000, seconds)
  const tPace = (1000 / velocityAt(0.88 * vd)) * 60
  const easyFast = (1000 / velocityAt(0.7 * vd)) * 60
  const easySlow = (1000 / velocityAt(0.59 * vd)) * 60
  return {
    vdot: Math.round(vd * 10) / 10,
    t_pace: `${sToPace(tPace)} /km`,
    paces: { ...goldenFromThreshold(tPace), easy: `${sToPace(easyFast)}-${sToPace(easySlow)} /km` } as Record<string, string>,
    race_pace: `${sToPace(seconds / distanceKm)} /km`,
  }
}

const DISTANCES: [RegExp, number][] = [
  [/half[\s-]*marathon|\bhalf\b|\bhm\b|21\.1\s*k|half_marathon/g, 21.0975],
  [/marathon|42\.2\s*k/g, 42.195],
  [/\b10\s*k(m)?\b|\b10,?000\s*m?\b/g, 10],
  [/\b5\s*k(m)?\b|\b5,?000\s*m?\b/g, 5],
  [/\b15\s*k(m)?\b/g, 15],
  [/\b8\s*k(m)?\b/g, 8],
  [/\b3\s*k(m)?\b|\b3,?000\s*m\b/g, 3],
  [/\bmile\b/g, 1.609],
  [/\b1500\s*m?\b/g, 1.5],
]
const TIME = /(\d{1,2}:\d{2}(?::\d{2})?)/

export interface RaceResult { distance_km: number; seconds: number; text: string }

/** First "<distance> ... <time>" pair in free text, e.g. "5K 15:48" or "half marathon 1:45:10". */
export function findRaceResult(texts: unknown[]): RaceResult | null {
  for (const raw of texts) {
    const text = String(raw ?? '').toLowerCase()
    if (!text.trim()) continue
    for (const [pat, km] of DISTANCES) {
      pat.lastIndex = 0
      let m: RegExpExecArray | null
      while ((m = pat.exec(text))) {
        const after = text.slice(m.index + m[0].length, m.index + m[0].length + 30)
        const before = text.slice(Math.max(0, m.index - 20), m.index)
        const t = after.match(TIME) || before.match(TIME)
        if (!t) continue
        let secs = timeToS(t[1])
        if (!secs) continue
        // "1:45" for a half marathon means hours:minutes, not minutes:seconds.
        if (km > 15 && secs < 600) secs *= 60
        const v = vdot(km * 1000, secs)
        if (v >= 20 && v <= 90) return { distance_km: km, seconds: secs, text: `${m[0].trim()} ${t[1]}` }
      }
    }
  }
  return null
}

export function rangeMid(paceStr: unknown): number | null {
  const nums = (String(paceStr ?? '').match(/\d{1,2}:\d{2}/g) || []).map(paceToS).filter((n): n is number => !!n && n < 900)
  return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null
}
