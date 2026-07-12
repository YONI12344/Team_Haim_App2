'use client'

/**
 * Fetches one athlete's `users/{athleteId}.physiology` (a PhysiologySummary)
 * — shared by every place that needs to show that specific athlete's own
 * lactate thresholds outside the Lab itself (e.g. a personalized threshold-
 * workout target), so the read isn't duplicated per call site.
 */

import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { PhysiologySummary } from '@/lib/physiology'

export function usePhysiology(athleteId: string | undefined) {
  const [physiology, setPhysiology] = useState<PhysiologySummary | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!athleteId) { setLoading(false); return }
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const snap = await getDoc(doc(db, 'users', athleteId))
        const phys = snap.data()?.physiology as PhysiologySummary | undefined
        if (!cancelled) setPhysiology(phys ?? null)
      } catch (e) {
        console.error('usePhysiology:', e)
        if (!cancelled) setPhysiology(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [athleteId])

  return { physiology, loading }
}
