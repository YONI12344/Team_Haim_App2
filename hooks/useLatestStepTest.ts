'use client'

/**
 * Fetches one athlete's most recent real step test (`lactateTests` doc with
 * `kind !== 'spot'`) and returns its raw `steps[]` — the same query already
 * duplicated in `athlete-workout-progress.tsx` and
 * `lactate-workout-gallery.tsx` for the "baseline" curve. Used wherever a
 * personalized target needs to interpolate at an arbitrary mmol value (see
 * `lib/physiology.ts` personalTargetRangeForLevel), not just the 3 points
 * pre-computed onto `users/{id}.physiology`.
 */

import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { LactateStep } from '@/lib/physiology'

export function useLatestStepTest(athleteId: string | undefined) {
  const [steps, setSteps] = useState<LactateStep[] | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!athleteId) { setLoading(false); return }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const snap = await getDocs(query(collection(db, 'lactateTests'), where('athleteId', '==', athleteId)))
        const stepTests = snap.docs
          .map(d => d.data() as any)
          .filter(t => t.kind !== 'spot' && Array.isArray(t.steps) && t.steps.length > 0)
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        if (!cancelled) setSteps(stepTests[0]?.steps ?? null)
      } catch (e) {
        console.error('useLatestStepTest:', e)
        if (!cancelled) setSteps(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [athleteId])

  return { steps, loading }
}
