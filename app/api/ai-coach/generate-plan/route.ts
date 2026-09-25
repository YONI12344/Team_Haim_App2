import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  buildBlockSystemPrompt,
  buildBlockToolDefinition,
  buildBlockUserMessage,
  type PlanAthleteContext,
  type BlockRequest,
} from '@/lib/ai-coach-brain/plan-prompt'
import { requireCoach } from '@/lib/ai-coach/verify-coach'

export const maxDuration = 300

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-5'
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS_PLAN ?? 16000)

// Same string every call, so the brain inside it is served from the prompt
// cache for every block after the first in a season.
const SYSTEM_PROMPT = buildBlockSystemPrompt()

// Fills one ~14-day block of a season from the 18-chapter brain. Called
// block by block from lib/ai-coach/season-pipeline.ts (coach only).
export async function POST(req: NextRequest) {
  const denied = await requireCoach(req)
  if (denied) return denied
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
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: buildBlockUserMessage(athlete, block) }],
    })

    if (response.stop_reason === 'max_tokens') {
      console.error('AI Coach block: hit max_tokens before finishing, input likely truncated')
      return NextResponse.json(
        { error: 'Model response was cut off (max_tokens) before finishing this block — try again.' },
        { status: 500 },
      )
    }

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name,
    )
    if (!toolUse) {
      console.error('AI Coach block: no tool_use block in response', JSON.stringify(response.content).slice(0, 500))
      return NextResponse.json({ error: 'Model did not call submit_training_block' }, { status: 500 })
    }

    let input = toolUse.input as { blockSummary?: unknown; workouts?: unknown }

    if (typeof input.workouts === 'string') {
      try {
        const unwrapped = JSON.parse(input.workouts)
        if (Array.isArray(unwrapped)) {
          // workouts itself was stringified directly (bare array), not
          // wrapped in an object -- the shape actually seen in practice
          // with the much larger brain-driven prompt.
          console.warn('AI Coach block: recovered double-encoded workouts array')
          input = { blockSummary: input.blockSummary, workouts: unwrapped }
        } else if (unwrapped && typeof unwrapped === 'object' && Array.isArray(unwrapped.workouts)) {
          console.warn('AI Coach block: recovered double-encoded tool input')
          input = { blockSummary: unwrapped.blockSummary ?? input.blockSummary, workouts: unwrapped.workouts }
        }
      } catch {
        // fall through to the validation error below
      }
    }

    if (!Array.isArray(input.workouts)) {
      console.error('AI Coach block: tool input missing workouts[]', JSON.stringify(toolUse.input).slice(0, 500))
      return NextResponse.json({ error: 'Model returned an incomplete block (missing workouts) — try again.' }, { status: 500 })
    }

    return NextResponse.json({ plan: input })
  } catch (err) {
    console.error('AI Coach generate-plan error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
