'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { useAthleteUser, useViewAs } from '@/contexts/view-as-context'
import { isCoachEmail } from '@/lib/constants'

/**
 * Whether the rehab platform is open for the athlete on screen
 * (users.rehabVisibleToAthlete, coach-set, off by default). The coach on
 * their own account always sees it; in athlete view the coach sees exactly
 * what that athlete sees. null while loading.
 */
export function useRehabVisible(): boolean | null {
  const { user } = useAuth()
  const viewAs = useViewAs()
  const athlete = useAthleteUser()
  const [visible, setVisible] = useState<boolean | null>(null)

  useEffect(() => {
    if (!athlete?.id) return
    if (isCoachEmail(user?.email) && !viewAs) { setVisible(true); return }
    getDoc(doc(db, 'users', athlete.id))
      .then((snap) => setVisible(snap.data()?.rehabVisibleToAthlete === true))
      .catch(() => setVisible(false))
  }, [athlete?.id, user?.email, viewAs])

  return visible
}
