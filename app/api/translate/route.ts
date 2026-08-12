import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-5'

const SYSTEM_PROMPT = `You translate short pieces of text written by a running/strength coach (in Hebrew) into natural, simple, plain English — the way the coach would actually say it out loud, not formal or literary language. This is workout titles, coach comments, exercise names, and exercise instructions for a running-coaching app.

Rules:
- Translate what the coach MEANT, not word-for-word. Rephrase if needed so it reads naturally in English.
- The coach writes in shorthand. Convert it to correct English units/wording, not a literal transliteration:
  - ד' / דק' / דקות = minutes (e.g. "2 ד'" -> "2 min")
  - שנ' / שניות = seconds
  - ק"מ / קמ / קילומטר = km
  - מ' (after a number) / מטר = meters
  - סט / סטים = set / sets
  - חזרות = reps
  - סופרסט = superset
  - מנוחה = rest
- Keep numbers exactly as given — only change the unit label/wording, never the value.
- Keep it short. Match the length and tone of the original; a one-line comment stays a one-line comment.
- If the input is empty or not meaningful Hebrew text, return it unchanged.

Return ONLY a JSON array, no markdown fences, no commentary, in this exact shape and the same order as the input:
[{"id": "<id>", "text": "<english translation>"}]`

interface TranslateItem {
  id: string
  text: string
}

export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'No ANTHROPIC_API_KEY set' }, { status: 500 })
    }

    const body = await req.json()
    const items: TranslateItem[] = (body.items ?? []).filter((it: TranslateItem) => it?.text?.trim())

    if (items.length === 0) {
      return NextResponse.json({ translations: [] })
    }

    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: JSON.stringify(items) }],
    })

    const raw = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
      .trim()

    const jsonText = raw.replace(/^```json\s*|^```\s*|```\s*$/g, '').trim()
    const translations: TranslateItem[] = JSON.parse(jsonText)

    return NextResponse.json({ translations })
  } catch (err) {
    console.error('Translate error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
