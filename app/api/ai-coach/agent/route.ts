import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { format } from 'date-fns'
import { buildCoachAgentSystemPrompt } from '@/lib/ai-coach-brain/system-prompt'
import { AGENT_TOOLS } from '@/lib/ai-coach/agent-tools'
import { requireCoach } from '@/lib/ai-coach/verify-coach'

// One model step of the coach's AI assistant. The loop lives in the coach's
// browser (components/coach/ai-coach-agent.tsx): it sends the conversation
// here, gets back Claude's turn, runs any tool calls against Firestore with
// the coach's own permissions, and posts the results back — so this route
// never needs a service-account credential and never touches the database.

export const maxDuration = 300

const MODEL = process.env.CLAUDE_COACH_MODEL ?? 'claude-opus-5-5'
const MAX_TOKENS = 16000
const MAX_MESSAGES = 200

// Built once per server instance: byte-identical across requests, which is
// what lets the ~180K-token brain be served from the prompt cache.
const SYSTEM_PROMPT = buildCoachAgentSystemPrompt()

export async function POST(req: NextRequest) {
  const denied = await requireCoach(req)
  if (denied) return denied

  const apiKey = process.env.ANTHROPIC_API_KEY || ''
  if (!apiKey) return NextResponse.json({ error: 'No ANTHROPIC_API_KEY set' }, { status: 500 })

  let messages: Anthropic.MessageParam[]
  let coachFeedback: string[] = []
  try {
    const body = await req.json()
    messages = body.messages
    coachFeedback = Array.isArray(body.coachFeedback) ? body.coachFeedback : []
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!Array.isArray(messages) || messages.length === 0 || messages[0]?.role !== 'user') {
    return NextResponse.json({ error: 'messages[] must start with a user message' }, { status: 400 })
  }
  if (messages.length > MAX_MESSAGES) {
    return NextResponse.json({ error: 'This conversation is too long — start a new one.' }, { status: 400 })
  }

  const client = new Anthropic({ apiKey })
  try {
    const stream = client.messages.stream({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Cost: medium effort is plenty for a coaching conversation; the
      // heavy lifting (season generation) runs through its own routes.
      output_config: { effort: 'medium' },
      tools: AGENT_TOOLS,
      system: [
        // Brain + instructions: identical for every athlete, cached for an
        // hour so switching between athletes' threads keeps hitting it.
        { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral', ttl: '1h' } },
        // Volatile, tiny, after the breakpoint.
        {
          type: 'text',
          text: coachFeedback.length > 0
            ? `Today is ${format(new Date(), 'EEEE yyyy-MM-dd')}.\n\nCOACH-TAUGHT LESSONS (standing instructions from Yoni himself, from him correcting or approving real past output -- treat these as binding, they override this prompt's own defaults wherever they conflict):\n${coachFeedback.map((f) => `- ${f}`).join('\n')}`
            : `Today is ${format(new Date(), 'EEEE yyyy-MM-dd')}.`,
        },
      ],
      // Also cache the conversation so far, so each follow-up turn only pays
      // full price for what's new.
      cache_control: { type: 'ephemeral' },
      messages,
    })
    const response = await stream.finalMessage()

    if (response.stop_reason === 'refusal') {
      return NextResponse.json({ error: 'The model declined this request.' }, { status: 422 })
    }

    const u = response.usage
    console.log(
      `AI coach agent: in=${u.input_tokens} cache_read=${u.cache_read_input_tokens ?? 0} cache_write=${u.cache_creation_input_tokens ?? 0} out=${u.output_tokens} stop=${response.stop_reason}`,
    )

    return NextResponse.json({
      content: response.content,
      stop_reason: response.stop_reason,
      usage: u,
      model: MODEL,
    })
  } catch (err) {
    if (err instanceof Anthropic.RateLimitError) {
      return NextResponse.json({ error: 'Rate limited — wait a moment and try again.' }, { status: 429 })
    }
    if (err instanceof Anthropic.APIError) {
      console.error('AI coach agent API error:', err.status, err.message)
      return NextResponse.json({ error: `AI error ${err.status}: ${err.message}` }, { status: 502 })
    }
    console.error('AI coach agent error:', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
