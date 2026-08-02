import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  buildBlockSystemPrompt,
  buildBlockToolDefinition,
  buildBlockUserMessage,
  type PlanAthleteContext,
  type BlockRequest,
} from '@/lib/bakken/plan-prompt'

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-5'
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS ?? 8192)

// Generates ONE ~14-day block at a time (see components/coach/bakken-plan-panel.tsx,
// which loops this once per block to cover a full season). Uses forced
// tool-use so the response is already a parsed object — no free-text JSON
// to fail to parse, which is what broke the earlier single-shot version.
export async function POST(req: NextRequest) {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY || ''
    if (!apiKey) {
      return NextResponse.json({ error: 'No ANTHROPIC_API_KEY set' }, { status: 500 })
    }

    const body = await req.json()
    const athlete: PlanAthleteContext = body.athlete
    const block: BlockRequest = body.block
    if (!athlete?.name || !block?.startDate || !block?.endDate) {
      return NextResponse.json({ error: 'athlete and block are required' }, { status: 400 })
    }

    const client = new Anthropic({ apiKey })
    const tool = buildBlockToolDefinition()
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: buildBlockSystemPrompt(),
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: buildBlockUserMessage(athlete, block) }],
    })

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name,
    )
    if (!toolUse) {
      console.error('Bakken block: no tool_use block in response', JSON.stringify(response.content).slice(0, 500))
      return NextResponse.json({ error: 'Model did not call submit_training_block' }, { status: 502 })
    }

    return NextResponse.json({ plan: toolUse.input })
  } catch (err) {
    console.error('Bakken generate-plan error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
