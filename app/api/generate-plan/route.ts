import { NextRequest, NextResponse } from 'next/server'

const SYSTEM_PROMPT = `You are Team Haim running coach AI. Generate a 14-day training plan following Team Haim methodology.

PERIODIZATION: Build backwards from goal race. Phases: Transition->Preparation->Base(1,2,3)->Build(1,2)->Peak->Race. Use 3:1 or 2:1 loading/recovery cycles.

TRAINING ZONES: Z1(66-85%)=Recovery, Z2(86-90%)=Easy/LSD, Z3(91-95%)=Intensive, Z4(96-99%)=Tempo, Z5a(100-101%)=Threshold intervals, Z5b(102-105%)=Intense intervals.

HR RANGES: Recovery 113-146bpm, LSD 113-154bpm, Tempo 171bpm, Wide intervals 171-173bpm, Intense intervals 175-180bpm.

RULES: Never 2 hard days back to back. LSD on weekend. 1-2 rest days/week. Beginners Z1-Z2 only. Never increase volume more than 10% per week. If recent effort 7-10/10 reduce load. If effort 1-4/10 can increase.

VOLUMES: Marathon max 70km/wk, Half max 45km/wk, 10K max 25km/wk, 5K max 12km/wk.

Return ONLY valid JSON with this structure, no other text:
{"planSummary":{"seasonPhase":"string","weeksToGoalRace":null,"week1TotalKm":0,"week2TotalKm":0,"keyFocus":"string","rationale":"string"},"workouts":[{"dayOffset":0,"type":"easy","title":"string","description":"string","duration":45,"distance":8,"warmup":"string","mainSet":"string","cooldown":"string","notes":"string"}]}

Include exactly 14 workouts (dayOffset 0-13). Use type rest for rest days.`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const userMessage = body.userMessage || ''
    const apiKey = process.env.GROQ_API_KEY || ''

    if (!apiKey) {
      return NextResponse.json({ error: 'No GROQ_API_KEY set', text: '' }, { status: 500 })
    }

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ],
        temperature: 0.3,
        max_tokens: 4000,
        response_format: { type: 'json_object' },
      }),
    })

    const data = await response.json()

    if (data.error) {
      console.error('Groq error:', JSON.stringify(data.error))
      return NextResponse.json({ error: data.error.message, text: '' }, { status: 500 })
    }

    const text = data.choices?.[0]?.message?.content || ''
    console.log('Success, length:', text.length)
    return NextResponse.json({ text })
  } catch (err) {
    console.error('Route error:', err)
    return NextResponse.json({ error: String(err), text: '' }, { status: 500 })
  }
}
