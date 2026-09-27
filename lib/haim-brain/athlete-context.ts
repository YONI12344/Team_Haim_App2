// Turns one athlete's data from the app (users/{id}, logs, assignedWorkouts, injuries, days off)
// into (a) the brain's profile answers, which its pipeline and calibration builder run on, and
// (b) a readable summary the AI reads. Pure functions: the page collects the data, the API route
// runs these on the server.

import { format } from 'date-fns'
import type { BrainProfile } from './pipeline'

export type HillChoice = '' | 'Yes, a good hill nearby' | 'Only short hills (under a minute)' | 'No hill, but a treadmill with incline' | 'No hills at all'

export interface AthleteSnapshot {
  athleteId: string
  profile: Record<string, any> // users/{id}, dates as ISO strings
  logs: { date: string; workoutTitle?: string; actualDistance?: number; actualPace?: string; effort?: number | null;
    comment?: string; averageHeartRate?: number; durationMin?: number; activityType?: string; source?: string }[]
  schedule: { scheduledDate: string; title: string; type: string; distance?: number; duration?: number; status: string }[]
  injuries: { title?: string; bodyPart?: string; status?: string; notes?: string; startDate?: string; date?: string }[]
  daysOff: { date?: string; startDate?: string; endDate?: string; reason?: string }[]
  overrides: { hill_access?: HillChoice }
  today: string // yyyy-MM-dd, the coach's local date
}

const DAY_KEYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

function ageFrom(dob?: string, today?: string): number | null {
  if (!dob) return null
  const b = new Date(dob), t = today ? new Date(today) : new Date()
  if (Number.isNaN(b.getTime())) return null
  let age = t.getFullYear() - b.getFullYear()
  if (t < new Date(t.getFullYear(), b.getMonth(), b.getDate())) age--
  return age > 5 && age < 100 ? age : null
}

// Local-date formatting on purpose: toISOString() would shift dates a day back east of UTC (Israel).
const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

function isoWeekStart(ds: string): string {
  const d = new Date(ds + 'T00:00:00')
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return ymd(d)
}

/** km per week from logged runs, most recent week last. */
export function weeklyVolumes(s: AthleteSnapshot): { week: string; km: number; runs: number }[] {
  const by: Record<string, { km: number; runs: number }> = {}
  for (const l of s.logs) {
    if (!l.date || l.date > s.today) continue
    const w = isoWeekStart(l.date)
    by[w] ??= { km: 0, runs: 0 }
    by[w].km += Number(l.actualDistance) || 0
    by[w].runs += 1
  }
  return Object.entries(by).sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, km: Math.round(v.km * 10) / 10, runs: v.runs }))
}

export function toBrainProfile(s: AthleteSnapshot): BrainProfile {
  const p = s.profile || {}
  const vols = weeklyVolumes(s)
  const thisWeek = isoWeekStart(s.today)
  const full = vols.filter((v) => v.week < thisWeek).slice(-3)
  const loggedWeekly = full.length ? Math.round(full.reduce((a, v) => a + v.km, 0) / full.length) : null
  const since = new Date(s.today + 'T00:00:00'); since.setDate(since.getDate() - 21)
  const recent = s.logs.filter((l) => l.date >= ymd(since) && l.date <= s.today)
  const longest = recent.reduce((m, l) => Math.max(m, Number(l.actualDistance) || 0), 0)

  const experience = ({
    beginner: 'Just starting out (less than 1 year of consistent running)',
    intermediate: 'Recreational (1-3 years, running for fitness/enjoyment)',
    advanced: 'Competitive (3+ years, racing regularly)',
    professional: 'Elite / collegiate / professional',
  } as Record<string, string>)[p.experienceLevel] || ''
  const weekly = p.weeklyMileage || loggedWeekly
  const hoursNum = Number(p.weeklyTrainingHours) || (weekly ? weekly / 10 : 0)
  const hours = hoursNum >= 8 ? '8+ hours' : hoursNum >= 6 ? '6-8 hours' : hoursNum >= 4 ? '4-6 hours' : hoursNum > 0 ? 'Under 4 hours' : ''

  const trainDays = p.weekSchedule
    ? DAY_KEYS.filter((d) => p.weekSchedule[d] && !['rest', 'off'].includes(p.weekSchedule[d])).map(cap)
    : (p.preferredDays || []).map((d: string) => cap(String(d).toLowerCase()))

  const details: string[] = p.injuryHistoryDetail || []
  const injuryParts = [p.injuryHistory,
    details.includes('currently_nursing') && 'currently nursing an injury',
    details.includes('stress_fracture_history') && 'stress fracture history',
    details.includes('low_bone_density') && 'low bone density',
    details.includes('recurring_asymmetric') && 'recurring one-sided injuries',
    ...s.injuries.filter((i) => (i.status || '').toLowerCase() !== 'resolved').map((i) => [i.title || i.bodyPart, i.notes].filter(Boolean).join(': ')),
  ].filter(Boolean)

  const records = [...(p.personalRecords || []), ...(p.seasonBests || [])]
    .filter((r: any) => r?.event && r?.time)
    .sort((a: any, b: any) => String(b.date || '').localeCompare(String(a.date || '')))
  const recentPr = [
    p.testRaceDistance && p.testRaceEvent ? `${p.testRaceDistance} ${p.testRaceEvent} (${p.testRaceDate || ''})` : '',
    ...records.slice(0, 3).map((r: any) => `${r.event} ${r.time}${r.date ? ` (${r.date})` : ''}`),
  ].filter(Boolean).join('; ')

  const goalDist = String(p.goalRaceDistance || '')
  const goal = /marathon/.test(goalDist) ? (goalDist.includes('half') ? 'Improve my half marathon time' : 'Improve my marathon time')
    : goalDist ? 'Improve my 5K/10K time' : ''

  const equipment = [
    (p.stravaConnected || p.maxHR || p.restingHR) && 'GPS running watch, Heart rate monitor',
    p.accessToLactateMeter === 'have_one' && 'Lactate meter',
  ].filter(Boolean).join(', ')

  const shape = String(p.currentShape || '')
  // The week template's first rest day, and the days of the coach's recurring strength sessions.
  const restDay = p.weekSchedule
    ? cap(DAY_KEYS.find((d) => p.weekSchedule[d] === 'rest') || DAY_KEYS.find((d) => p.weekSchedule[d] === 'off') || '')
    : ''
  const gymDays = [...new Set<string>((p.recurringActivities || [])
    .filter((a: any) => a?.type === 'strength' && a?.dayOfWeek)
    .map((a: any) => cap(String(a.dayOfWeek).toLowerCase())))]
  return {
    name: p.name,
    age: String(ageFrom(p.dateOfBirth, s.today) ?? ''),
    running_experience: experience,
    primary_goal: goal,
    target_race: goalDist ? `${p.goalRaceEvent || goalDist.replace('_', ' ')} on ${p.goalRaceDate || 'date not set'}` : 'none yet',
    target_time: p.goalRaceTarget || '',
    weekly_mileage: weekly ? String(weekly) : '',
    longest_run_last_3_weeks: longest ? `${Math.round(longest * 10) / 10} km` : '',
    training_consistency_last_year: shape === 'just_starting' ? 'Just getting (re)started -- not much of a base yet'
      : shape === 'returning' || p.priorTrainingInterruptions === 'multiple_times' ? 'One or more long breaks (injury, burnout, time off)'
      : shape ? 'Very consistent, no major gaps' : '',
    returning_from_layoff: details.includes('currently_nursing') ? 'Yes, returning from injury'
      : shape === 'returning' ? 'Yes, returning after general time off' : 'No, training has been consistent',
    injury_history: injuryParts.join('; ') || 'none',
    recent_pr: recentPr,
    known_threshold_pace: '',
    days_per_week: p.daysPerWeek ? String(p.daysPerWeek) : trainDays.length ? String(trainDays.length) : '',
    training_days_preference: trainDays.join(', '),
    weekly_hours_available: hours,
    equipment_access: equipment,
    training_environment: '',
    hill_access: s.overrides.hill_access || '',
    // Schedule anchors and volume, as the brain's code-checked rules read them.
    long_run_day: p.longRunDay ? cap(String(p.longRunDay).toLowerCase()) : '',
    rest_day: restDay,
    gym_days: gymDays.join(', '),
    volume_goal: p.weeklyKmRange?.max ? `${p.weeklyKmRange.max} km` : '',
  }
}

const secToPace = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')} /km` : '')

/** What the AI reads about the athlete. Only data that's in the app -- nothing invented. */
export function contextText(s: AthleteSnapshot, profile: BrainProfile): string {
  const p = s.profile || {}
  const lines: string[] = [`Today is ${s.today}. Athlete: ${p.name || 'unnamed'}.`]
  const add = (label: string, v: unknown) => { if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) lines.push(`- ${label}: ${v}`) }
  lines.push('Profile (from the app):')
  add('Age', profile.age)
  add('Experience level', p.experienceLevel)
  add('Disciplines / events', [...(p.discipline || []), ...(p.events || [])].join(', '))
  add('Goal race', p.goalRaceDistance && `${p.goalRaceEvent || ''} ${p.goalRaceDistance} on ${p.goalRaceDate || '?'}, target ${p.goalRaceTarget || 'not set'}`)
  add('Goals', (p.goals || []).filter((g: any) => g.status === 'active').map((g: any) => [g.title, g.targetTime, g.targetDate].filter(Boolean).join(' ')).join('; '))
  add('Weekly km (profile)', p.weeklyMileage)
  add('Target weekly km range', p.weeklyKmRange && `${p.weeklyKmRange.min}-${p.weeklyKmRange.max}`)
  add('Weekly training hours', p.weeklyTrainingHours)
  add('Days per week', p.daysPerWeek)
  add('Training days', profile.training_days_preference)
  add('Rest day (week template)', profile.rest_day)
  add('Gym days (recurring strength)', profile.gym_days)
  add('Long run', [p.longRunDay, p.longRunMinutes && `${p.longRunMinutes} min`].filter(Boolean).join(', '))
  add('Current shape', p.currentShape)
  add('Resting / max HR', [p.restingHR, p.maxHR].some(Boolean) ? `${p.restingHR || '?'} / ${p.maxHR || '?'}` : '')
  add('Lab thresholds', p.physiology && `T1 ${secToPace(p.physiology.lt1PaceSec)} @ ${p.physiology.lt1Hr || '?'} bpm, T2 ${secToPace(p.physiology.lt2PaceSec)} @ ${p.physiology.lt2Hr || '?'} bpm (${p.physiology.source}, ${p.physiology.testDate || 'no date'})`)
  add('Training paces on file', (p.trainingPaces || []).map((t: any) => `${t.type} ${t.pace}`).join(', '))
  add('Race results', profile.recent_pr)
  add('Injuries', profile.injury_history)
  add('Lactate meter', p.accessToLactateMeter)
  add('Hill access (set by coach on this page)', profile.hill_access || 'unknown')
  add("Coach's private notes", p.coachPrivateNotes)

  const vols = weeklyVolumes(s).slice(-8)
  if (vols.length) {
    lines.push('Logged volume by week (Monday start):')
    for (const v of vols) lines.push(`- ${v.week}: ${v.km} km over ${v.runs} logged sessions`)
  }
  const recentLogs = s.logs.filter((l) => l.date <= s.today).sort((a, b) => a.date.localeCompare(b.date)).slice(-20)
  if (recentLogs.length) {
    lines.push('Recent logged sessions (oldest first):')
    for (const l of recentLogs) {
      lines.push(`- ${l.date}: ${[l.workoutTitle || l.activityType || 'session', l.actualDistance && `${l.actualDistance} km`,
        l.actualPace && `pace ${l.actualPace}`, l.durationMin && `${l.durationMin} min`, l.averageHeartRate && `avg HR ${l.averageHeartRate}`,
        l.effort && `effort ${l.effort}/10`, l.comment && `"${String(l.comment).slice(0, 160)}"`].filter(Boolean).join(', ')}`)
    }
  } else lines.push('No logged sessions in the last 8 weeks.')
  const past = s.schedule.filter((w) => w.scheduledDate < s.today)
  if (past.length) {
    const done = past.filter((w) => w.status === 'completed').length
    const skipped = past.filter((w) => w.status === 'skipped').length
    lines.push(`Planned sessions in the last 8 weeks: ${past.length} (${done} completed, ${skipped} skipped).`)
  }
  const upcoming = s.schedule.filter((w) => w.scheduledDate >= s.today).sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate)).slice(0, 21)
  if (upcoming.length) {
    lines.push('Already on the schedule (coming up):')
    for (const w of upcoming) lines.push(`- ${w.scheduledDate}: ${w.title} [${w.type}]${w.distance ? ` ${w.distance} km` : ''}${w.duration ? ` ${w.duration} min` : ''}`)
  } else lines.push('Nothing on the schedule yet from today on.')
  const off = s.daysOff.map((d) => [d.date || d.startDate, d.endDate && `to ${d.endDate}`, d.reason].filter(Boolean).join(' ')).filter(Boolean)
  if (off.length) lines.push(`Days off recorded: ${off.join('; ')}`)
  return lines.join('\n')
}
