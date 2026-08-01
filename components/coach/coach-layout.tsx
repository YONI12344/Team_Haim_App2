'use client'

import { useAuth } from '@/contexts/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { CoachNav } from './coach-nav'
import { CoachBottomNav } from './coach-bottom-nav'
import { Loader2 } from 'lucide-react'
import { isCoachEmail } from '@/lib/constants'

export function CoachLayout({ children, hideNav }: { children: ReactNode; hideNav?: boolean }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  // Every /coach/* page renders through this layout — until now this only
  // checked "is someone logged in", never "is this the coach", so any
  // signed-in athlete could open any coach URL directly and see it. This
  // is the page-level half of the fix; firestore.rules covers the
  // data-level half (some collections had no owner/coach scoping either).
  const isCoach = isCoachEmail(user?.email)

  useEffect(() => {
    if (loading) return
    if (!user) { router.push('/'); return }
    if (!isCoach) { router.push('/athlete'); return }
  }, [user, loading, isCoach, router])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  if (!user) {
    return null
  }

  if (!isCoach) {
    return null
  }

  return (
    <div className="min-h-screen bg-background">
      {!hideNav && <CoachNav />}
      {/* Bottom nav is a fixed h-16 bar (mobile only, md:hidden) — without
          matching bottom padding here it covers the last ~4rem of every
          page's content instead of just sitting below it. */}
      <main className={hideNav ? "" : "container mx-auto px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pt-8 md:pb-8"}>
        {children}
      </main>
      {!hideNav && <CoachBottomNav />}
    </div>
  )
}
