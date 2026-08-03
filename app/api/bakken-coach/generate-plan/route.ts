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
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS_PLAN ?? 16000)

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

    if (response.stop_reason === 'max_tokens') {
      console.error('Bakken block: hit max_tokens before finishing, input likely truncated')
      return NextResponse.json(
        { error: 'Model response was cut off (max_tokens) before finishing this block — try again.' },
        { status: 500 },
      )
    }

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name,
    )
    if (!toolUse) {
      console.error('Bakken block: no tool_use block in response', JSON.stringify(response.content).slice(0, 500))
      return NextResponse.json({ error: 'Model did not call submit_training_block' }, { status: 500 })
    }

    let input = toolUse.input as { blockSummary?: unknown; workouts?: unknown }

    // Same recovery as generate-skeleton: the model occasionally wraps its
    // whole answer as a JSON string inside one field instead of returning
    // the object directly. Recover instead of failing outright.
    if (typeof input.workouts === 'string') {
      try {
        const unwrapped = JSON.parse(input.workouts)
        if (unwrapped && typeof unwrapped === 'object' && Array.isArray(unwrapped.workouts)) {
          console.warn('Bakken block: recovered double-encoded tool input')
          input = { blockSummary: unwrapped.blockSummary ?? input.blockSummary, workouts: unwrapped.workouts }
        }
      } catch {
        // fall through to the validation error below
      }
    }

    if (!Array.isArray(input.workouts)) {
      console.error('Bakken block: tool input missing workouts[]', JSON.stringify(toolUse.input).slice(0, 500))
      return NextResponse.json({ error: 'Model returned an incomplete block (missing workouts) — try again.' }, { status: 500 })
    }

    return NextResponse.json({ plan: input })
  } catch (err) {
    console.error('Bakken generate-plan error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
