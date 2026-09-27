'use client'

// Saved "In my words" drafts per athlete, so a rewrite the coach paid for isn't lost when the page closes.
// Stored on aiCoachThreads/{athleteId} (coach-only in firestore.rules) under its own `coachVoiceDraft` field,
// separate from the AI Coach page's memory.

import { deleteField, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { WrittenWorkout } from './write'

const ref = (athleteId: string) => doc(db, 'aiCoachThreads', athleteId)

export async function loadDraft(athleteId: string): Promise<WrittenWorkout[]> {
  const raw = (await getDoc(ref(athleteId))).data()?.coachVoiceDraft?.json
  try { return raw ? JSON.parse(raw) : [] } catch { return [] }
}

export async function saveDraft(athleteId: string, workouts: WrittenWorkout[]): Promise<void> {
  await setDoc(ref(athleteId), { coachVoiceDraft: { json: JSON.stringify(workouts), updatedAt: serverTimestamp() } }, { merge: true })
}

export async function clearDraft(athleteId: string): Promise<void> {
  await setDoc(ref(athleteId), { coachVoiceDraft: deleteField() }, { merge: true })
}
