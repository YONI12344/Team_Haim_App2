'use client'

/**
 * One AI-assistant conversation per athlete, stored at
 * aiCoachThreads/{athleteId}/messages — coach-only in firestore.rules.
 * Deliberately NOT under users/{athleteId}: user docs are readable by every
 * signed-in user, and these threads hold the coach's private reasoning
 * about the athlete.
 *
 * Each message is stored exactly as the Claude API needs it back
 * (role + content blocks, including tool calls/results and thinking
 * blocks), serialized to a string: Firestore rejects nested arrays and
 * some block shapes contain them.
 */

import {
  collection,
  addDoc,
  getDocs,
  query,
  orderBy,
  writeBatch,
  doc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore'
import type Anthropic from '@anthropic-ai/sdk'
import { db } from '@/lib/firebase'

export interface StoredMessage {
  id: string
  seq: number
  message: Anthropic.MessageParam
}

const messagesCol = (athleteId: string) => collection(db, 'aiCoachThreads', athleteId, 'messages')

export async function loadThread(athleteId: string): Promise<StoredMessage[]> {
  const snap = await getDocs(query(messagesCol(athleteId), orderBy('seq', 'asc')))
  const out: StoredMessage[] = []
  for (const d of snap.docs) {
    const data = d.data() as { seq: number; json: string }
    try {
      out.push({ id: d.id, seq: data.seq, message: JSON.parse(data.json) })
    } catch {
      // A corrupt entry would poison every future request — skip it.
      console.error('AI coach thread: unreadable message', d.id)
    }
  }
  return out
}

export async function appendMessage(athleteId: string, seq: number, message: Anthropic.MessageParam): Promise<string> {
  const ref = await addDoc(messagesCol(athleteId), {
    seq,
    role: message.role,
    json: JSON.stringify(message),
    createdAt: serverTimestamp(),
  })
  // Parent doc so the coach can later list which athletes have threads.
  await setDoc(doc(db, 'aiCoachThreads', athleteId), { athleteId, updatedAt: serverTimestamp() }, { merge: true })
  return ref.id
}

/** Deletes the whole conversation (the athlete's schedule is untouched). */
export async function clearThread(athleteId: string): Promise<void> {
  const snap = await getDocs(messagesCol(athleteId))
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = writeBatch(db)
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref))
    await batch.commit()
  }
}
