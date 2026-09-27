// Dev check (not imported by the app): one real "In my words" rewrite of 3 plan days into the coach's
// sets structure (about $0.05).   npx jiti lib/coach-voice/__smoke__.ts
import Anthropic from '@anthropic-ai/sdk'
import { daysText, parseWritten, setText, voiceSystem, type CoachExample } from './write'
import type { PlanDay } from '../haim-brain/plan'

try { process.loadEnvFile('.env.local') } catch { /* needs ANTHROPIC_API_KEY */ }

const examples: CoachExample[] = [
  { type: 'threshold', title: '6X6 דק\' סף', warmup: '15 ד\' קל', cooldown: '10 ד\' שחרור', notes: 'לא לרוץ מהר מדי בחזרה הראשונה!',
    sets: [{ reps: 6, duration: "6 ד'", durationSec: 360, pace: 'סף', restBetweenReps: "דקה הליכה/ריצה קלה" }] },
  { type: 'easy', title: 'קל 8 ק"מ + סטרייד', description: '8 ק"מ קל ונעים',
    sets: [{ reps: 1, distance: '8 ק"מ', distanceMeters: 8000, pace: 'קל' }, { reps: 6, distance: "100 מ'", distanceMeters: 100, pace: 'סטרייד', restBetweenReps: 'הליכה חזרה' }] },
  { type: 'recovery', title: 'ריצה/הליכה', sets: [{ reps: 8, intervals: [{ duration: "2 ד' ריצה", durationSec: 120, pace: 'קל' }, { duration: "1 ד' הליכה", durationSec: 60 }] }] },
]
const days: PlanDay[] = [
  { date: '2026-09-29', weekday: 'Tuesday', type: 'golden', zone: 'golden', measure: 'time', title: '5 x 6 min Golden Zone', minutes: 55,
    steps: [{ kind: 'warmup', label: 'Warm-up jog', minutes: 15 }, { kind: 'reps', label: '6 min reps', reps: 5, minutes: 6, pace: '3:53-4:00 /km', rest: '60 s easy jog' },
      { kind: 'cooldown', label: 'Cool-down jog', minutes: 10 }] },
  { date: '2026-09-30', weekday: 'Wednesday', type: 'easy', zone: 'easy', measure: 'distance', title: 'Easy 9 km + 6 strides', km: 9,
    steps: [{ kind: 'steady', label: 'Easy run', km: 9, pace: '4:45-5:20 /km' }, { kind: 'reps', label: 'Strides', reps: 6, km: 0.1, pace: 'fast, relaxed', rest: 'walk back' }] },
  { date: '2026-10-01', weekday: 'Thursday', type: 'easy', zone: 'easy', measure: 'time', title: 'Easy 60 min', minutes: 60,
    steps: [{ kind: 'steady', label: 'Easy run', minutes: 60, pace: 'conversational' }] },
]

async function main() {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.stream({
    model: process.env.HAIM_BRAIN_MODEL || 'claude-opus-5', max_tokens: 8000,
    system: voiceSystem(examples, { firstName: 'Dana', gender: 'female' }),
    messages: [{ role: 'user', content: `Write these ${days.length} sessions:\n\n${daysText(days)}` }],
  }).finalMessage()
  const text = msg.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('\n')
  const out = parseWritten(text, days)
  console.log(`cost ~$${((msg.usage.input_tokens * 5 + msg.usage.output_tokens * 25) / 1e6).toFixed(3)}`)
  for (const w of out || []) {
    console.log(`\n=== ${w.date}: ${w.title}\n${w.description}\n[warmup] ${w.warmup} [cooldown] ${w.cooldown}`)
    for (const st of w.sets) console.log(`  set: ${setText(st)} | meters=${st.distanceMeters ?? '-'} sec=${st.durationSec ?? '-'}`)
    console.log(`  mismatches: ${w.mismatches.length ? w.mismatches.join(', ') : 'none'}`)
  }
  if (!out) console.log('UNPARSEABLE:\n' + text)
}
main()
