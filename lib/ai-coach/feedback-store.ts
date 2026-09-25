'use client'

/**
 * The AI doesn't retrain itself from usage -- no chat call updates the
 * model's weights. What actually makes it "learn" from the coach over time
 * is this: every lesson the coach explicitly teaches it (a note on what was
 * good or bad) gets saved here and re-sent on every future generate-plan /
 * generate-skeleton / agent call (see athlete_context.coachFeedback in
 * plan-schema.ts and the agent system prompt), so its output keeps shifting
 * toward what the coach actually wants. Coach-only, same spirit as
 * usage-log.ts.
 */

import { addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export interface CoachFeedbackEntry {
  id: string
  text: string
  createdAt: Date
}

const COLLECTION = 'aiCoachFeedback'
// Caps how much of this gets injected into every prompt -- recent lessons
// matter most, and this keeps the added token cost small and predictable.
const MAX_INJECTED = 30

export async function addCoachFeedback(text: string): Promise<void> {
  const trimmed = text.trim()
  if (!trimmed) return
  await addDoc(collection(db, COLLECTION), { text: trimmed, createdAt: serverTimestamp() })
}

export async function deleteCoachFeedback(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id))
}

/** All taught lessons, newest first -- for the Settings/teaching-log UI. */
export async function loadCoachFeedback(): Promise<CoachFeedbackEntry[]> {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy('createdAt', 'desc'), limit(100)))
  return snap.docs.map((d) => {
    const data = d.data() as any
    return { id: d.id, text: data.text ?? '', createdAt: data.createdAt?.toDate?.() ?? new Date() }
  })
}

/** Just the text, most-recent-first, capped -- what actually gets sent to the model. */
export async function loadCoachFeedbackForPrompt(): Promise<string[]> {
  const snap = await getDocs(query(collection(db, COLLECTION), orderBy('createdAt', 'desc'), limit(MAX_INJECTED)))
  return snap.docs.map((d) => (d.data() as any).text).filter(Boolean)
}
