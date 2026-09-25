'use client'

import { auth } from '@/lib/firebase'

/** Fired (detail: { athleteId }) after the AI changes an athlete's schedule, so open planners reload. */
export const AI_SCHEDULE_CHANGED_EVENT = 'ai-coach:schedule-changed'

/**
 * POSTs to an /api/ai-coach/* route with the signed-in user's Firebase ID
 * token. Every AI route re-verifies that token server-side and only serves
 * the coach account (lib/ai-coach/verify-coach.ts), so these calls fail for
 * athletes even if they find the URL. Never throws — errors come back as
 * { error } so callers handle them like a model failure.
 */
export async function aiCoachFetch(path: string, body: unknown): Promise<any> {
  try {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return { error: 'Not signed in' }
    const res = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    })
    const text = await res.text()
    try {
      const data = JSON.parse(text)
      if (!res.ok && !data.error) return { error: `HTTP ${res.status}` }
      return data
    } catch {
      return { error: `HTTP ${res.status}: ${text.slice(0, 200)}` }
    }
  } catch (err) {
    return { error: String(err) }
  }
}
