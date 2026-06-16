'use client'

import { useAuth } from '@/contexts/auth-context'
import { useRouter } from 'next/navigation'
import { useEffect, type ReactNode } from 'react'
import { AthleteNav } from './athlete-nav'
import { AthleteBottomNav } from './athlete-bottom-nav'
import { Loader2 } from 'lucide-react'

export function AthleteLayout({ children, hideNav }: { children: ReactNode; hideNav?: boolean }) {
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
    <div className="min-h-screen bg-gray-50">
      {!hideNav && <AthleteNav />}
      <main className={hideNav ? "min-h-screen bg-gray-50" : "container px-4 py-4 md:py-6"}>
        {children}
      </main>
      {!hideNav && <AthleteBottomNav />}
    </div>
  )
}
