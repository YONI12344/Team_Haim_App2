// Lightweight runtime test for lib/running.ts.
//
// Run with:
//     npx --yes tsx lib/__tests__/running.test.mjs
//
// (Node alone cannot import .ts files without a loader; tsx is the lightest
// option and isn't a project dependency we need to commit.)

import assert from 'node:assert/strict'
import {
  parseTimeToSeconds,
  formatPace,
  formatPaceKm,
  eventToDistanceMeters,
  percentVO2maxForDuration,
  vo2CostForVelocity,
  velocityForVO2,
  computeVDOT,
  computeTrainingZones,
  computeHeartRateZones,
  estimateMaxHRFromAge,
} from '../running.ts'

let failures = 0
function it(name, fn) {
  try {
    fn()
    console.log('  \u2713', name)
  } catch (e) {
    failures++
    console.error('  \u2717', name)
    console.error('   ', e && e.message ? e.message : e)
  }
}

console.log('lib/running.ts')

it('parses mm:ss / h:mm:ss / plain seconds', () => {
  assert.equal(parseTimeToSeconds('20:00'), 1200)
  assert.equal(parseTimeToSeconds('1:30:00'), 5400)
  assert.equal(parseTimeToSeconds('45'), 45)
  assert.ok(Number.isNaN(parseTimeToSeconds('not-a-time')))
})

it('formats pace seconds back to mm:ss', () => {
  assert.equal(formatPace(330), '5:30')
  assert.equal(formatPace(359.6), '6:00')
  assert.equal(formatPaceKm(330), '5:30/km')
  assert.equal(formatPace(0), '\u2014')
})

it('maps common event names to distance in metres', () => {
  assert.equal(eventToDistanceMeters('5K'), 5000)
  assert.equal(eventToDistanceMeters('10k'), 10000)
  assert.equal(eventToDistanceMeters('Half Marathon'), 21097.5)
  assert.equal(eventToDistanceMeters('marathon'), 42195)
  assert.equal(eventToDistanceMeters('800m'), 800)
})

it('VDOT for 20:00 5K is in expected range (~49 in Daniels tables)', () => {
  const vdot = computeVDOT(5000, 20 * 60)
  assert.ok(vdot > 47 && vdot < 51, `vdot=${vdot}`)
})

it('VDOT for marathon 3:30 is in expected range', () => {
  const vdot = computeVDOT(42195, 3 * 3600 + 30 * 60)
  assert.ok(vdot > 40 && vdot < 50, `vdot=${vdot}`)
})

it('velocityForVO2 inverts vo2CostForVelocity', () => {
  for (const v of [180, 240, 300, 360]) {
    const cost = vo2CostForVelocity(v)
    const back = velocityForVO2(cost)
    assert.ok(Math.abs(back - v) < 0.01, `v=${v} back=${back}`)
  }
})

it('percentVO2maxForDuration is monotone decreasing', () => {
  let prev = Infinity
  for (const t of [3, 10, 20, 60, 120, 180]) {
    const p = percentVO2maxForDuration(t)
    assert.ok(p < prev, `not decreasing at t=${t}`)
    prev = p
  }
})

it('zones for 5K @ 20:00 produce paces in the expected ballpark', () => {
  const z = computeTrainingZones({ event: '5K', timeSeconds: 1200 })
  assert.ok(z, 'zones not null')
  const byKey = Object.fromEntries(z.zones.map((zz) => [zz.key, zz]))
  assert.ok(
    byKey.threshold.lowSecPerKm > 230 && byKey.threshold.lowSecPerKm < 280,
    `T=${formatPace(byKey.threshold.lowSecPerKm)}`,
  )
  assert.ok(byKey.easy.highSecPerKm > byKey.threshold.lowSecPerKm,
    'easy should be slower than threshold')
  assert.ok(byKey.repetition.lowSecPerKm < byKey.interval.lowSecPerKm,
    'rep should be faster than interval')
})

it('returns null for invalid inputs', () => {
  assert.equal(computeTrainingZones({ event: 'unknown-event', timeSeconds: 0 }), null)
  assert.equal(computeTrainingZones({ event: '5K', timeSeconds: 0 }), null)
})

it('Karvonen HR zones use reserve when restingHR is given', () => {
  const z = computeHeartRateZones({ maxHR: 190, restingHR: 50 })
  assert.ok(z)
  const z2 = z.find((zz) => zz.key === 'z2')
  assert.equal(z2.lowBpm, 134) // 50 + 0.6*(140)
  assert.equal(z2.highBpm, 148) // 50 + 0.7*(140)
})

it('%maxHR fallback when no restingHR', () => {
  const z = computeHeartRateZones({ maxHR: 200 })
  const z5 = z.find((zz) => zz.key === 'z5')
  assert.equal(z5.lowBpm, 180)
  assert.equal(z5.highBpm, 200)
})

it('estimateMaxHRFromAge uses Tanaka', () => {
  assert.equal(estimateMaxHRFromAge(30), Math.round(208 - 21))
  assert.ok(Number.isNaN(estimateMaxHRFromAge(0)))
})

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`)
  process.exit(1)
} else {
  console.log('\nAll tests passed')
}
