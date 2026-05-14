import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { COACH_EMAIL } from '@/lib/constants'

export interface CoachInfo {
  uid: string
  name: string
  email: string
  photoURL?: string
}

let cachedCoach: CoachInfo | null = null

/**
 * Look up the single coach account in Firestore by the well-known
 * coach email. Result is cached in memory for the lifetime of the page.
 *
 * Returns null if the coach has not signed in yet (no users doc exists).
 */
export async function getCoachInfo(): Promise<CoachInfo | null> {
  if (cachedCoach) return cachedCoach

  try {
    const snap = await getDocs(
      query(
        collection(db, 'users'),
        where('email', '==', COACH_EMAIL),
        limit(1),
      ),
    )
    if (snap.empty) return null
    const docSnap = snap.docs[0]
    const data = docSnap.data()
    cachedCoach = {
      uid: docSnap.id,
      name: data.name || 'Coach',
      email: data.email || COACH_EMAIL,
      photoURL: data.photoURL,
    }
    return cachedCoach
  } catch (err) {
    console.error('Error loading coach info:', err)
    return null
  }
}

/**
 * Build a deterministic conversation ID from a coach UID and an athlete UID.
 * Used as a key under the Realtime Database `conversations/` path.
 */
export function conversationId(coachUid: string, athleteUid: string): string {
  return `${coachUid}_${athleteUid}`
}
