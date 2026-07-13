'use client'

import { useAuth } from '@/contexts/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { CoachNav } from './coach-nav'
import { CoachBottomNav } from './coach-bottom-nav'
import { Loader2 } from 'lucide-react'

export function CoachLayout({ children, hideNav }: { children: ReactNode; hideNav?: boolean }) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && !user) {
      router.push('/')
    }
  }, [user, loading, router])

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

  return (
    <div className="min-h-screen bg-background">
      {!hideNav && <CoachNav />}
      {/* Bottom nav is a fixed h-16 bar (mobile only, md:hidden) — without
          matching bottom padding here it covers the last ~4rem of every
          page's content instead of just sitting below it. */}
      <main className={hideNav ? "" : "container px-4 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pt-8 md:pb-8"}>
        {children}
      </main>
      {!hideNav && <CoachBottomNav />}
    </div>
  )
}
