'use client'

/**
 * Records every AI coach API call's token usage + real USD cost, so the
 * coach can see what the AI is actually costing (Settings -> AI usage).
 * Written by the coach's own browser (coach-only Firestore collection,
 * see firestore.rules aiUsage) right after each API response — no server
 * credential needed, same spirit as the rest of this feature.
 */

import { addDoc, collection, doc, getDoc, getDocs, orderBy, query, serverTimestamp, setDoc, Timestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { costFor, type AnthropicUsage } from '@/lib/ai-coach/pricing'

export type AiRoute = 'agent' | 'generate-skeleton' | 'generate-plan'

export interface AiUsageEntry {
  id: string
  route: AiRoute
  model: string
  athleteId: string | null
  coachId: string
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  costUsd: number
  createdAt: Date
}

/** Fire-and-forget — a logging failure must never break the AI response it's logging. */
export function logAiUsage(opts: {
  route: AiRoute
  model: string
  athleteId: string | null
  coachId: string
  usage: AnthropicUsage | undefined | null
}): void {
  const { costUsd, inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens } = costFor(opts.model, opts.usage)
  addDoc(collection(db, 'aiUsage'), {
    route: opts.route,
    model: opts.model,
    athleteId: opts.athleteId,
    coachId: opts.coachId,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    costUsd,
    createdAt: serverTimestamp(),
  }).catch((err) => console.error('logAiUsage failed:', err))
}

/** Usage entries from the last `days` days, newest first — for the Settings summary. */
export async function loadAiUsage(days: number): Promise<AiUsageEntry[]> {
  const since = Timestamp.fromMillis(Date.now() - days * 86400000)
  const snap = await getDocs(
    query(collection(db, 'aiUsage'), where('createdAt', '>=', since), orderBy('createdAt', 'desc')),
  )
  return snap.docs.map((d) => {
    const data = d.data() as any
    return {
      id: d.id,
      route: data.route,
      model: data.model,
      athleteId: data.athleteId ?? null,
      coachId: data.coachId,
      inputTokens: data.inputTokens ?? 0,
      outputTokens: data.outputTokens ?? 0,
      cacheWriteTokens: data.cacheWriteTokens ?? 0,
      cacheReadTokens: data.cacheReadTokens ?? 0,
      costUsd: data.costUsd ?? 0,
      createdAt: data.createdAt?.toDate?.() ?? new Date(),
    }
  })
}

/** Sum of costUsd for entries from the start of the current calendar month. */
export async function loadAiUsageThisMonth(): Promise<{ costUsd: number; tokens: number; calls: number }> {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const entries = await loadAiUsage(Math.ceil((Date.now() - monthStart.getTime()) / 86400000) + 1)
  const inMonth = entries.filter((e) => e.createdAt >= monthStart)
  return inMonth.reduce(
    (acc, e) => ({
      costUsd: acc.costUsd + e.costUsd,
      tokens: acc.tokens + e.inputTokens + e.outputTokens + e.cacheWriteTokens + e.cacheReadTokens,
      calls: acc.calls + 1,
    }),
    { costUsd: 0, tokens: 0, calls: 0 },
  )
}

const BUDGET_DOC = 'settings/aiBudget'

/** The coach's own monthly AI spend target — a locally-tracked budget, not
 *  Anthropic's real account limit (there's no way to read that from the
 *  client). Null means no budget has been set yet. */
export async function getAiBudget(): Promise<number | null> {
  const snap = await getDoc(doc(db, BUDGET_DOC))
  const v = snap.exists() ? (snap.data() as any).monthlyUsd : null
  return typeof v === 'number' && v > 0 ? v : null
}

export async function setAiBudget(monthlyUsd: number): Promise<void> {
  await setDoc(doc(db, BUDGET_DOC), { monthlyUsd, updatedAt: serverTimestamp() }, { merge: true })
}
