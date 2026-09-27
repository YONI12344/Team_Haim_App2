// Dev check (not imported by the app): one real "In my words" rewrite of 3 plan days (about $0.05).
//   npx jiti lib/coach-voice/__smoke__.ts
import Anthropic from '@anthropic-ai/sdk'
import { daysText, parseWritten, voiceSystem } from './write'
import type { PlanDay } from '@/lib/haim-brain/plan'

try { process.loadEnvFile('.env.local') } catch { /* needs ANTHROPIC_API_KEY */ }

const examples = [
  { type: 'threshold', title: '6X6 דק\' סף', description: '15 ד\' חימום קל\n6X6 ד\' בקצב סף, דקה מנוחה בהליכה/ריצה קלה\n10 ד\' שחרור', notes: 'לא לרוץ מהר מדי בחזרה הראשונה!' },
  { type: 'easy', title: 'ריצה קלה 8 ק"מ', description: '8 ק"מ קל ונעים, דופק נמוך' },
]
const days: PlanDay[] = [
  { date: '2026-09-29', weekday: 'Tuesday', type: 'golden', zone: 'golden', title: '5 x 6 min Golden Zone', minutes: 55, km: null,
    summary: 'Controlled threshold reps.', steps: [
      { kind: 'warmup', label: 'Warm-up jog', minutes: 15, pace: '4:45-5:20 /km' },
      { kind: 'reps', label: '6 min reps', reps: 5, minutes: 6, pace: '3:53-4:00 /km', rest: '60 s easy jog' },
      { kind: 'cooldown', label: 'Cool-down jog', minutes: 10, pace: 'Very easy' }],
    why: 'Medium reps just under threshold (Ch. 3).' },
  { date: '2026-09-30', weekday: 'Wednesday', type: 'easy', zone: 'easy', title: 'Easy 9 km', km: 9, minutes: null,
    steps: [{ kind: 'steady', label: 'Easy run', km: 9, pace: '4:45-5:20 /km' }] },
  { date: '2026-10-03', weekday: 'Saturday', type: 'x', zone: 'above', title: 'Hill X-session: 8 x 70 s', minutes: 50, km: null,
    steps: [{ kind: 'warmup', label: 'Warm-up jog', minutes: 20 }, { kind: 'reps', label: 'Hill reps', reps: 8, minutes: 70 / 60, pace: 'Strong uphill', rest: 'jog down' },
      { kind: 'cooldown', label: 'Cool-down', minutes: 10 }] },
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
  const cost = (msg.usage.input_tokens * 5 + msg.usage.output_tokens * 25) / 1e6
  console.log(`cost ~$${cost.toFixed(3)}`)
  for (const w of out || []) console.log(`\n=== ${w.date}\n${w.title}\n${w.description}\n[warmup] ${w.warmup}\n[cooldown] ${w.cooldown}\n[notes] ${w.notes}\n[EN] ${w.titleEn} | ${w.descriptionEn}`)
  if (!out) console.log('UNPARSEABLE:\n' + text)
}
main()
