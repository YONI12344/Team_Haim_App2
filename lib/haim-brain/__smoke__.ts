// Dev check (not imported by the app): runs the AI Coach brain on a made-up athlete in the app's own
// data format, without the page or the coach sign-in. Free by default; --ai adds one question and a
// short 3-week build with --build (about $0.10 and $0.50).
//   npx jiti lib/haim-brain/__smoke__.ts [--ai] [--build]
import { runCoachAI } from './coach-ai'
import type { AthleteSnapshot } from './athlete-context'
import { format } from 'date-fns'

try { process.loadEnvFile('.env.local') } catch { /* no local env: the free part still runs */ }

const today = '2026-09-26'
const logs: AthleteSnapshot['logs'] = []
const plan = [['Easy', 10], ['6 x 6 min threshold', 13], ['Easy', 9], ['3 x 10 min threshold', 14], ['Easy', 8], ['20 x 45/15', 12], ['Long run', 18]] as const
for (let w = 3; w >= 1; w--) {
  plan.forEach(([title, km], i) => {
    const d = new Date(2026, 8, 21 - w * 7 + i) // Mondays: Aug 31, Sep 7, Sep 14
    if (i === 0) return // Monday rest
    logs.push({ date: format(d, 'yyyy-MM-dd'), workoutTitle: title, actualDistance: km, effort: title === 'Easy' ? 3 : 7,
      comment: w === 1 && i === 5 ? 'Legs heavy, last reps got hard' : '' })
  })
}
const snapshot: AthleteSnapshot = {
  athleteId: 'smoke-test',
  profile: {
    name: 'Smoke Test Runner', dateOfBirth: '1999-04-02', experienceLevel: 'advanced', weeklyMileage: 65, weeklyTrainingHours: 7,
    daysPerWeek: 6, weekSchedule: { monday: 'rest', tuesday: 'workout', wednesday: 'easy', thursday: 'workout', friday: 'easy', saturday: 'workout', sunday: 'long_run' },
    goalRaceDistance: '10k', goalRaceEvent: 'City 10K', goalRaceDate: '2026-11-29', goalRaceTarget: '35:30',
    personalRecords: [{ event: '5k', time: '17:30', date: '2026-09-05' }], currentShape: 'consistent', maxHR: 192, restingHR: 48, injuryHistory: 'none',
  },
  logs,
  schedule: [{ scheduledDate: '2026-09-29', title: '6 x 6 min threshold', type: 'threshold', status: 'scheduled' }],
  injuries: [], daysOff: [], overrides: { hill_access: 'Yes, a good hill nearby' }, today,
}

async function main() {
  const a: any = await runCoachAI({ action: 'analyze', snapshot, startDate: '2026-09-28' })
  console.log('Decisions:', a.choices.map((c: any) => `${c.topic}=${c.choice}`).join(' | '))
  console.log('Calibration:', a.calibration.weeks[0].days.map((d: any) => `${d.weekday.slice(0, 3)} ${d.title}${d.km ? ` ${d.km}km` : ''}`).join(' | '))
  console.log('Profile read:', JSON.stringify({ weekly: a.profile.weekly_mileage, days: a.profile.training_days_preference, pr: a.profile.recent_pr, longest: a.profile.longest_run_last_3_weeks, hours: a.profile.weekly_hours_available }))

  if (process.argv.includes('--ai')) {
    const q: any = await runCoachAI({ action: 'ask', snapshot, message: 'How has this athlete trained the last 3 weeks, and anything I should watch?' })
    console.log(`\nASK ($${q.cost.toFixed(3)}):\n${q.reply}`)
  }
  if (process.argv.includes('--build')) {
    const b: any = await runCoachAI({ action: 'build', snapshot, startDate: '2026-09-28', plan: a.calibration,
      message: 'Build 3 weeks from Monday. Keep week 1 as the calibration tests, then build. Keep it compact.' })
    console.log(`\nBUILD ($${b.cost.toFixed(3)}): ${b.error || ''}\n${b.reply}`)
    for (const w of b.plan?.weeks || []) console.log(`W${w.week} ${w.phase}: ` + w.days.map((d: any) => `${d.weekday.slice(0, 3)} ${d.title}`).join(' | '))
  }
}

main()
