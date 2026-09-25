import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  buildSkeletonSystemPrompt,
  buildSkeletonToolDefinition,
  buildSkeletonUserMessage,
  type PlanAthleteContext,
  type SkeletonRequest,
} from '@/lib/ai-coach-brain/plan-prompt'
import { requireCoach } from '@/lib/ai-coach/verify-coach'

export const maxDuration = 300

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-5'
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS_SKELETON ?? 4096)

// One-shot season skeleton (phases, weeks, volume ramp) from the 18-chapter
// brain. Called from lib/ai-coach/season-pipeline.ts (coach only).
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
    const skeleton: SkeletonRequest = body.skeleton
    if (!athlete?.name || !skeleton?.totalWeeksAvailable) {
      return NextResponse.json({ error: 'athlete and skeleton are required' }, { status: 400 })
    }

    const client = new Anthropic({ apiKey })
    const tool = buildSkeletonToolDefinition()
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: [{ type: 'text', text: buildSkeletonSystemPrompt(), cache_control: { type: 'ephemeral' } }],
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: buildSkeletonUserMessage(athlete, skeleton) }],
    })

    if (response.stop_reason === 'max_tokens') {
      console.error('AI Coach skeleton: hit max_tokens before finishing, input likely truncated')
      return NextResponse.json(
        { error: 'Model response was cut off (max_tokens) before finishing the skeleton — try again.' },
        { status: 500 },
      )
    }

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name,
    )
    if (!toolUse) {
      console.error('AI Coach skeleton: no tool_use block in response', JSON.stringify(response.content).slice(0, 500))
      return NextResponse.json({ error: 'Model did not call submit_season_skeleton' }, { status: 500 })
    }

    let input = toolUse.input as { title?: unknown; stages?: unknown }

    if (typeof input.stages === 'string') {
      try {
        const unwrapped = JSON.parse(input.stages)
        if (Array.isArray(unwrapped)) {
          console.warn('AI Coach skeleton: recovered double-encoded stages array')
          input = { title: input.title, stages: unwrapped }
        } else if (unwrapped && typeof unwrapped === 'object' && Array.isArray(unwrapped.stages)) {
          console.warn('AI Coach skeleton: recovered double-encoded tool input')
          input = { title: unwrapped.title ?? input.title, stages: unwrapped.stages }
        }
      } catch {
        // fall through to the validation error below
      }
    }

    if (!Array.isArray(input.stages) || input.stages.length === 0) {
      console.error('AI Coach skeleton: tool input missing stages[]', JSON.stringify(toolUse.input).slice(0, 500))
      return NextResponse.json({ error: 'Model returned an incomplete skeleton (missing stages) — try again.' }, { status: 500 })
    }

    return NextResponse.json({ skeleton: input })
  } catch (err) {
    console.error('AI Coach generate-skeleton error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
