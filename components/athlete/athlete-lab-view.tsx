'use client'

import { useEffect, useState } from 'react'
import { Loader2, FlaskConical } from 'lucide-react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { AthletePhysiology } from '@/components/coach/athlete-physiology'

/**
 * Athlete's own view of their lab data (lactate tests, thresholds, derived
 * paces, HR zones) — the same component and full edit capability the coach
 * has, just scoped to the logged-in athlete's own id. Gated on
 * labVisibleToAthlete, which the coach turns on per athlete — this checks
 * it directly (not just hiding the nav buttons) so visiting the URL
 * without the coach having enabled it yet doesn't show anything.
 */
export function AthleteLabView() {
  const { user } = useAuth()
  const [visible, setVisible] = useState<boolean | null>(null)

  useEffect(() => {
    if (!user?.id) return
    getDoc(doc(db, 'users', user.id))
      .then(snap => setVisible(snap.exists() && snap.data().labVisibleToAthlete === true))
      .catch(() => setVisible(false))
  }, [user?.id])

  if (!user?.id || visible === null) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#c9a84c]" />
      </div>
    )
  }

  if (!visible) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[300px] text-center gap-3">
        <div className="w-14 h-14 rounded-2xl bg-[#0a1628]/5 flex items-center justify-center">
          <FlaskConical className="h-7 w-7 text-[#0a1628]/40" />
        </div>
        <p className="text-sm text-muted-foreground max-w-xs">
          המעבדה עוד לא הופעלה עבורך — דבר עם המאמן שלך כדי להתחיל במעקב בדיקות לקטט
        </p>
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
