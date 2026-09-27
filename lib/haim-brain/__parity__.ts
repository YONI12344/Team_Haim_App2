// Dev check (not imported by the app): the TypeScript brain must match the Python brain it was ported
// from. Reads a reference file the Python brain wrote (calibration weeks, decisions, and seasons run
// through the code-checked rules) and compares. No AI, $0.
//   npx jiti lib/haim-brain/__parity__.ts <path to py_reference.json>
import { readFileSync } from 'node:fs'
import { runPipeline } from './pipeline'
import { buildCalibration } from './calibration'
import { normalizePlan, type BrainPlan } from './plan'
import { enforceAll } from './enforce'

const ref = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const start = new Date(2026, 8, 28)
// Titles compared without their minute count: the TS rules keep "Long easy run 68 min" in step with the
// shortened run, where the Python brain leaves the original "80 min" in the title.
const dayRow = (d: any) => `${String(d.weekday || '').slice(0, 3)} ${d.type}:${String(d.title).replace(/\b\d+\s*min\b/, 'N min')}:${d.minutes ?? ''}:${d.km ?? ''}`
const tags = (notes: string[] = []) => notes.map((n) => `${(n.match(/\[[A-Z0-9-]+\]|\[anchor\]/) || ['?'])[0]} ${(n.match(/Week \d+/) || [''])[0]}`).sort()
let failures = 0
const check = (label: string, a: unknown, b: unknown) => {
  const same = JSON.stringify(a) === JSON.stringify(b)
  if (!same) { failures++; console.log(`  ${label} DIFF\n    py: ${JSON.stringify(a)}\n    ts: ${JSON.stringify(b)}`) }
  return same
}

for (const [key, r] of Object.entries<any>(ref)) {
  const pipe = runPipeline(r.profile)
  const cal = normalizePlan(buildCalibration(r.profile, pipe.trace[2].result, pipe.planRequest.category, start), start, 1)
  // The TS calibration prescribes its easy runs by time only (never time and distance together).
  for (const d of r.calibration.weeks[0].days) if (d.type === 'easy' || d.type === 'long') d.measure = 'time'
  const pyCal = normalizePlan(r.calibration, start, 1)
  const ok = [
    check('calibration week', pyCal.weeks[0].days.map(dayRow), cal.weeks[0].days.map(dayRow)),
    check('paces', r.calibration.paces, cal.paces),
    check('adjustments', r.calibration.template.adjustments.length, cal.template!.adjustments.length),
    check('decisions', r.choices.map((c: any) => c.choice.replace('From your race', 'From race').replace('From your data', 'From known threshold')), pipe.choices.map((c) => c.choice)),
    check('workouts a week', r.max_quality, pipe.planRequest.weekly_structure.max_quality_sessions),
  ]
  if (r.season_raw) {
    const plan = enforceAll(structuredClone(r.season_raw) as BrainPlan, {
      profile: r.profile, category: pipe.planRequest.category, maxQuality: pipe.planRequest.weekly_structure.max_quality_sessions,
      baseline: r.baseline, baselineSrc: 'your weekly km', recentLongest: r.longest,
    })
    const py = r.season_enforced
    ok.push(
      check('enforced season days', py.weeks.map((w: any) => w.days.map(dayRow)), plan.weeks.map((w) => w.days.map(dayRow))),
      check('weekly km', py.safety.weekly_km, plan.safety!.weekly_km),
      check('rule changes', tags(py.safety.adjustments), tags(plan.safety!.adjustments)),
      check('cycle', py.safety.cycle, plan.safety!.cycle),
    )
  }
  console.log(`${key}: ${ok.every(Boolean) ? 'same' : 'DIFFERENT'}${r.season_raw ? ` (incl. season: ${r.season_enforced.safety.weekly_km.join('/')} km)` : ''}`)
}
process.exit(failures ? 1 : 0)
