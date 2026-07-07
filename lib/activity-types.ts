/**
 * lib/activity-types.ts
 *
 * Shared mapping of activity kinds (from Strava activity types or manual
 * athlete uploads) to bilingual labels, emoji icons, colors, and which
 * stats are relevant to show (distance/pace vs. duration only).
 *
 * Used by the athlete planner, workout log form, and coach dashboard so a
 * yoga session never renders like a 0-km run.
 */

export type ActivityKind =
  | 'run'
  | 'trail_run'
  | 'treadmill'
  | 'walk'
  | 'hike'
  | 'ride'
  | 'swim'
  | 'gym'
  | 'crossfit'
  | 'yoga'
  | 'pilates'
  | 'other'

export interface ActivityKindInfo {
  kind: ActivityKind
  labelHe: string
  labelEn: string
  emoji: string
  /** Tailwind classes for a small type badge */
  badgeClass: string
  /** Whether distance + pace are meaningful for this activity */
  hasDistance: boolean
}

export const ACTIVITY_KINDS: Record<ActivityKind, ActivityKindInfo> = {
  run:        { kind: 'run',        labelHe: 'ריצה',            labelEn: 'Run',            emoji: '🏃', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', hasDistance: true },
  trail_run:  { kind: 'trail_run',  labelHe: 'ריצת שטח',        labelEn: 'Trail Run',      emoji: '⛰️', badgeClass: 'bg-lime-50 text-lime-700 border-lime-200',          hasDistance: true },
  treadmill:  { kind: 'treadmill',  labelHe: 'ריצה במסילה',     labelEn: 'Treadmill',      emoji: '🏃', badgeClass: 'bg-emerald-50 text-emerald-700 border-emerald-200', hasDistance: true },
  walk:       { kind: 'walk',       labelHe: 'הליכה',           labelEn: 'Walk',           emoji: '🚶', badgeClass: 'bg-teal-50 text-teal-700 border-teal-200',          hasDistance: true },
  hike:       { kind: 'hike',       labelHe: 'טיול רגלי',       labelEn: 'Hike',           emoji: '🥾', badgeClass: 'bg-lime-50 text-lime-700 border-lime-200',          hasDistance: true },
  ride:       { kind: 'ride',       labelHe: 'רכיבת אופניים',   labelEn: 'Ride',           emoji: '🚴', badgeClass: 'bg-sky-50 text-sky-700 border-sky-200',             hasDistance: true },
  swim:       { kind: 'swim',       labelHe: 'שחייה',           labelEn: 'Swim',           emoji: '🏊', badgeClass: 'bg-cyan-50 text-cyan-700 border-cyan-200',          hasDistance: true },
  gym:        { kind: 'gym',        labelHe: 'חדר כושר',        labelEn: 'Gym',            emoji: '🏋️', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',      hasDistance: false },
  crossfit:   { kind: 'crossfit',   labelHe: 'קרוספיט',         labelEn: 'CrossFit',       emoji: '🏋️', badgeClass: 'bg-slate-100 text-slate-700 border-slate-200',      hasDistance: false },
  yoga:       { kind: 'yoga',       labelHe: 'יוגה',            labelEn: 'Yoga',           emoji: '🧘', badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',    hasDistance: false },
  pilates:    { kind: 'pilates',    labelHe: 'פילאטיס',         labelEn: 'Pilates',        emoji: '🧘', badgeClass: 'bg-purple-50 text-purple-700 border-purple-200',    hasDistance: false },
  other:      { kind: 'other',      labelHe: 'פעילות אחרת',     labelEn: 'Other Activity', emoji: '✨', badgeClass: 'bg-gray-100 text-gray-600 border-gray-200',         hasDistance: false },
}

/** Strava activity type strings → app activity kind */
const STRAVA_TYPE_TO_KIND: Record<string, ActivityKind> = {
  Run: 'run',
  VirtualRun: 'treadmill',
  Treadmill: 'treadmill',
  TrailRun: 'trail_run',
  Walk: 'walk',
  Hike: 'hike',
  Ride: 'ride',
  VirtualRide: 'ride',
  MountainBikeRide: 'ride',
  GravelRide: 'ride',
  EBikeRide: 'ride',
  Swim: 'swim',
  WeightTraining: 'gym',
  Workout: 'gym',
  Crossfit: 'crossfit',
  Yoga: 'yoga',
  Pilates: 'pilates',
}

/** Strava types that count toward running volume / run-workout matching */
export const STRAVA_RUNNING_TYPES = ['Run', 'VirtualRun', 'TrailRun', 'Treadmill']

/** Strava types that match strength / cross-training workouts */
export const STRAVA_GYM_TYPES = ['WeightTraining', 'Workout', 'Crossfit', 'Yoga', 'Pilates']

/** Manual-upload kinds counted as running */
export const RUNNING_KINDS: ActivityKind[] = ['run', 'trail_run', 'treadmill']

/** Manual-upload kinds that match strength / cross-training workouts */
export const GYM_KINDS: ActivityKind[] = ['gym', 'crossfit', 'yoga', 'pilates']

/**
 * Resolve a log's activity kind. Prefers an explicit manual `activityType`
 * (manual uploads), falls back to the Strava type string, defaults to 'run'
 * (legacy Strava logs saved before types were stored are runs).
 */
export function getActivityKind(log: { activityType?: string; stravaType?: string }): ActivityKind {
  if (log.activityType && log.activityType in ACTIVITY_KINDS) {
    return log.activityType as ActivityKind
  }
  if (log.stravaType) {
    return STRAVA_TYPE_TO_KIND[log.stravaType] || 'other'
  }
  return 'run'
}

export function getActivityInfo(log: { activityType?: string; stravaType?: string }): ActivityKindInfo {
  return ACTIVITY_KINDS[getActivityKind(log)]
}

/** Kind is a running activity (counts toward km totals + run matching) */
export function isRunningKind(kind: ActivityKind): boolean {
  return RUNNING_KINDS.includes(kind)
}

/** Kind matches strength / cross-training assigned workouts */
export function isGymKind(kind: ActivityKind): boolean {
  return GYM_KINDS.includes(kind)
}

/** Localized label for a kind */
export function activityLabel(kind: ActivityKind, isRTL: boolean): string {
  const info = ACTIVITY_KINDS[kind]
  return isRTL ? info.labelHe : info.labelEn
}

/** Format minutes as "1:05h" / "45 min" style display string */
export function formatDurationMin(min: number | null | undefined, isRTL: boolean): string | null {
  if (!min || min <= 0) return null
  if (min < 60) return isRTL ? `${min} דק'` : `${min} min`
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${String(m).padStart(2, '0')} ${isRTL ? "ש'" : 'h'}`
}

/** Manual "add activity" picker options, in display order */
export const MANUAL_ACTIVITY_KINDS: ActivityKind[] = [
  'run', 'trail_run', 'treadmill', 'gym', 'yoga', 'pilates', 'crossfit', 'ride', 'swim', 'walk', 'other',
]
