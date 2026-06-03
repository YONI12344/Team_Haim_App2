'use client'

import { useAuth } from '@/contexts/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { CoachNav } from './coach-nav'
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
      <main className={hideNav ? "" : "container px-4 py-6 md:py-8"}>
        {children}
      </main>
    </div>
  )
}
