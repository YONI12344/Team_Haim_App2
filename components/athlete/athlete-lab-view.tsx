'use client'

import { Loader2 } from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { AthletePhysiology } from '@/components/coach/athlete-physiology'

/**
 * Athlete's own view of their lab data (lactate tests, thresholds, derived
 * paces, HR zones) — the same component and full edit capability the coach
 * has, just scoped to the logged-in athlete's own id.
 */
export function AthleteLabView() {
  const { user } = useAuth()

  if (!user?.id) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#c9a84c]" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-[#0a1628]">מעבדה</h1>
        <p className="text-muted-foreground">ספי לקטט, קצבי אימון וטווחי דופק</p>
      </div>
      <AthletePhysiology athleteId={user.id} />
    </div>
  )
}
