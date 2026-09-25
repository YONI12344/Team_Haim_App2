/**
 * USD cost of one AI coach API call, from its token usage. Prices are
 * Anthropic's first-party per-model rates (checked 2026-09): base input/
 * output, cache write at 1.25x base input, cache read at 0.1x base input —
 * Anthropic's standard cache multipliers, applied per model below. Update
 * this table if CLAUDE_MODEL changes or Anthropic reprices.
 */

export interface AnthropicUsage {
  input_tokens?: number
  output_tokens?: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

interface ModelRate {
  /** USD per million tokens. */
  input: number
  output: number
}

const RATES: Record<string, ModelRate> = {
  'claude-sonnet-5': { input: 2.0, output: 10.0 },
  'claude-opus-5': { input: 5.0, output: 25.0 },
  // Assumed same as Opus 5 — confirm against the Anthropic pricing page.
  'claude-opus-5-5': { input: 5.0, output: 25.0 },
  'claude-haiku-4-5': { input: 1.0, output: 5.0 },
}
const DEFAULT_RATE: ModelRate = RATES['claude-sonnet-5']

export interface CostBreakdown {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  /** Total tokens actually processed this call (what the "context size" was). */
  totalTokens: number
  costUsd: number
}

export function costFor(model: string, usage: AnthropicUsage | undefined | null): CostBreakdown {
  const rate = RATES[model] ?? DEFAULT_RATE
  const inputTokens = usage?.input_tokens ?? 0
  const outputTokens = usage?.output_tokens ?? 0
  const cacheWriteTokens = usage?.cache_creation_input_tokens ?? 0
  const cacheReadTokens = usage?.cache_read_input_tokens ?? 0

  const costUsd =
    (inputTokens / 1_000_000) * rate.input +
    (outputTokens / 1_000_000) * rate.output +
    (cacheWriteTokens / 1_000_000) * rate.input * 1.25 +
    (cacheReadTokens / 1_000_000) * rate.input * 0.1

  return {
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    totalTokens: inputTokens + outputTokens + cacheWriteTokens + cacheReadTokens,
    costUsd,
  }
}

export function formatUsd(usd: number): string {
  if (usd === 0) return '$0.00'
  if (usd < 0.01) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}
