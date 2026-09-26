// Dev check (not imported by the app): the TypeScript brain must build the same calibration weeks and
// decisions as the Python brain did for the six test athletes. Run:
//   npx jiti lib/haim-brain/__parity__.ts "<path to TeamHaim AI Brain (Local App)>/app/data/athletes"
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { runPipeline } from './pipeline'
import { buildCalibration } from './calibration'
import { normalizePlan } from './plan'

const dir = process.argv[2]
let failures = 0
for (const key of ['noa', 'sam', 'dana', 'lior', 'ari', 'tal']) {
  const base = join(dir, `test-${key}`)
  const profile = JSON.parse(readFileSync(join(base, 'profile.json'), 'utf8'))
  const py = JSON.parse(readFileSync(join(base, 'calibration.json'), 'utf8'))
  const start = new Date(py.start_date + 'T00:00:00')
  const pipe = runPipeline(profile)
  const ts = normalizePlan(buildCalibration(profile, pipe.trace[2].result, pipe.planRequest.category, start), start, 1)
  const row = (d: any) => `${d.weekday.slice(0, 3)} ${d.type}:${d.title}:${d.minutes ?? ''}:${d.km ?? ''}`
  const a = py.weeks[0].days.map(row), b = ts.weeks[0].days.map(row)
  const sameWeek = JSON.stringify(a) === JSON.stringify(b)
  const pyChoices = (py.choices || []).map((c: any) => c.choice)
  const tsChoices = pipe.choices.map((c) => c.choice)
  const sameChoices = JSON.stringify(pyChoices) === JSON.stringify(tsChoices)
  const samePaces = JSON.stringify(py.paces) === JSON.stringify(ts.paces)
  console.log(`${key}: week ${sameWeek ? 'same' : 'DIFF'}, paces ${samePaces ? 'same' : 'DIFF'}, decisions ${sameChoices ? 'same' : 'DIFF'}`)
  if (!sameWeek) { console.log('  py:', a.join(' | ')); console.log('  ts:', b.join(' | ')) }
  if (!samePaces) { console.log('  py:', py.paces); console.log('  ts:', ts.paces) }
  if (!sameChoices) { console.log('  py:', pyChoices.join(' / ')); console.log('  ts:', tsChoices.join(' / ')) }
  failures += Number(!sameWeek) + Number(!samePaces) + Number(!sameChoices)
}
process.exit(failures ? 1 : 0)
