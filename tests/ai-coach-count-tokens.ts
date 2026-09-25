// Validates the AI coach's request shapes against the real API and reports
// their size, using the free token-counting endpoint (no model call, no
// cost). Run: npx tsx --env-file=.env.local tests/ai-coach-count-tokens.ts
import Anthropic from '@anthropic-ai/sdk'
import { buildCoachAgentSystemPrompt } from '@/lib/ai-coach-brain/system-prompt'
import { AGENT_TOOLS } from '@/lib/ai-coach/agent-tools'
import { buildBlockSystemPrompt, buildBlockToolDefinition, buildSkeletonSystemPrompt, buildSkeletonToolDefinition } from '@/lib/ai-coach-brain/plan-prompt'

const model = process.env.CLAUDE_MODEL ?? 'claude-sonnet-5'
const client = new Anthropic()
const messages: Anthropic.MessageParam[] = [{ role: 'user', content: 'Review the last 2 weeks.' }]

async function main() {
  const agent = await client.messages.countTokens({
    model,
    system: [{ type: 'text', text: buildCoachAgentSystemPrompt(), cache_control: { type: 'ephemeral', ttl: '1h' } }],
    tools: AGENT_TOOLS,
    messages,
  })
  const block = await client.messages.countTokens({
    model,
    system: [{ type: 'text', text: buildBlockSystemPrompt() }],
    tools: [buildBlockToolDefinition()],
    messages,
  })
  const skeleton = await client.messages.countTokens({
    model,
    system: [{ type: 'text', text: buildSkeletonSystemPrompt() }],
    tools: [buildSkeletonToolDefinition()],
    messages,
  })
  console.log(`model: ${model}`)
  console.log(`agent request prefix:   ${agent.input_tokens} tokens`)
  console.log(`block request prefix:   ${block.input_tokens} tokens`)
  console.log(`skeleton request prefix: ${skeleton.input_tokens} tokens`)
}

main().catch((e) => { console.error(e); process.exit(1) })
