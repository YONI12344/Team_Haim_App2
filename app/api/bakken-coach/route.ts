import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { buildSystemPrompt } from '@/lib/bakken/system-prompt'

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-5'
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS ?? 2048)

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

// Test-only endpoint for trying out the Bakken/Almgren Norwegian Method
// coaching engine inside the Team Haim app shell. Not wired into any
// athlete-facing flow.
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'No ANTHROPIC_API_KEY set' }, { status: 500 })
    }

    const body = await req.json()
    const messages: ChatMessage[] = body.messages ?? []

    if (messages.length === 0) {
      return NextResponse.json({ error: 'messages[] is required' }, { status: 400 })
    }

    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildSystemPrompt(),
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    })

    const text = response.content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map((block) => block.text)
      .join('\n')

    return NextResponse.json({ reply: text })
  } catch (err) {
    console.error('Bakken coach error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
