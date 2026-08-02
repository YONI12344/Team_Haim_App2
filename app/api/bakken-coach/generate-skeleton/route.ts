import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import {
  buildSkeletonSystemPrompt,
  buildSkeletonToolDefinition,
  buildSkeletonUserMessage,
  type PlanAthleteContext,
  type SkeletonRequest,
} from '@/lib/bakken/plan-prompt'

const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-5'
const MAX_TOKENS = Number(process.env.CLAUDE_MAX_TOKENS ?? 4096)

// One-shot season periodization call — decides phase lengths/volumes/key
// workout types for the whole season, using the same Bakken brain as the
// per-block content generator (app/api/bakken-coach/generate-plan). Only
// the resulting week-counts are used by the caller to compute real
// calendar dates; the model never does date arithmetic itself.
export async function POST(req: NextRequest) {
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
      system: buildSkeletonSystemPrompt(),
      tools: [tool],
      tool_choice: { type: 'tool', name: tool.name },
      messages: [{ role: 'user', content: buildSkeletonUserMessage(athlete, skeleton) }],
    })

    const toolUse = response.content.find(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === tool.name,
    )
    if (!toolUse) {
      console.error('Bakken skeleton: no tool_use block in response', JSON.stringify(response.content).slice(0, 500))
      return NextResponse.json({ error: 'Model did not call submit_season_skeleton' }, { status: 502 })
    }

    return NextResponse.json({ skeleton: toolUse.input })
  } catch (err) {
    console.error('Bakken generate-skeleton error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
