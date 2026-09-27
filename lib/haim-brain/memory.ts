'use client'

// What the AI Coach page remembers per athlete: the current plan, the conversation, the settings the
// coach chose, and which days were exported. Stored on aiCoachThreads/{athleteId} (already coach-only
// in firestore.rules) under one `haimBrain` field, merged so nothing else on that doc is touched.
// Plan and messages are JSON strings: Firestore rejects undefined values and some nested shapes.

import { doc, getDoc, serverTimestamp, setDoc, deleteField } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { BrainPlan } from './plan'
import type { HillChoice } from './athlete-context'

export interface BrainMsg { role: 'user' | 'assistant'; content: string; kind?: 'ask' | 'build'; cost?: number; at?: string }

export interface BrainMemory {
  plan: BrainPlan | null
  planSource: string
  startDate: string
  hill: HillChoice
  messages: BrainMsg[]
  exportedDates: string[]
  updatedAt?: string
}

const MAX_MESSAGES = 80
const ref = (athleteId: string) => doc(db, 'aiCoachThreads', athleteId)

export async function loadMemory(athleteId: string): Promise<BrainMemory | null> {
  const snap = await getDoc(ref(athleteId))
  const m = snap.data()?.haimBrain
  if (!m) return null
  try {
    return {
      plan: m.planJson ? JSON.parse(m.planJson) : null,
      planSource: m.planSource || '',
      startDate: m.startDate || '',
      hill: m.hill || '',
      messages: m.messagesJson ? JSON.parse(m.messagesJson) : [],
      exportedDates: Array.isArray(m.exportedDates) ? m.exportedDates : [],
      updatedAt: m.updatedAt?.toDate?.().toISOString(),
    }
  } catch {
    return null // unreadable memory: start fresh rather than break the page
  }
}

export async function saveMemory(athleteId: string, mem: BrainMemory): Promise<void> {
  await setDoc(ref(athleteId), {
    athleteId,
    updatedAt: serverTimestamp(),
    haimBrain: {
      planJson: mem.plan ? JSON.stringify(mem.plan) : '',
      planSource: mem.planSource,
      startDate: mem.startDate,
      hill: mem.hill,
      messagesJson: JSON.stringify(mem.messages.slice(-MAX_MESSAGES)),
      exportedDates: mem.exportedDates,
      updatedAt: serverTimestamp(),
    },
  }, { merge: true })
}

/** "Start over": forget this page's plan and conversation for the athlete (their schedule is untouched). */
export async function clearMemory(athleteId: string): Promise<void> {
  await setDoc(ref(athleteId), { haimBrain: deleteField() }, { merge: true })
}
