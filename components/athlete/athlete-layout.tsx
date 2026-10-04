'use client'

import { useAuth } from '@/contexts/auth-context'
import { usePathname, useRouter } from 'next/navigation'
import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import { AthleteNav } from './athlete-nav'
import { AthleteBottomNav } from './athlete-bottom-nav'
import { Eye, Loader2, X } from 'lucide-react'
import { doc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { isCoachEmail } from '@/lib/constants'
import { ViewAsProvider, readViewAs, stopViewAs, type ViewAsAthlete } from '@/contexts/view-as-context'

// Screens that stay the coach's own in athlete view: the athlete's chat is
// the coach's chat with them, and onboarding is the athlete's to fill in.
const COACH_SIDE_ONLY: Record<string, (id: string) => string> = {
  '/athlete/chat': (id) => `/coach/chat/${id}`,
  '/athlete/onboarding': (id) => `/coach/athletes/${id}`,
}

export function AthleteLayout({ children, hideNav }: { children: ReactNode; hideNav?: boolean }) {
  const { user, loading } = useAuth()
  const router = useRouter()
  const pathname = usePathname()
  // Coach "athlete view" (contexts/view-as-context.tsx) — read after mount,
  // sessionStorage only exists in the browser.
  const [viewAs, setViewAs] = useState<ViewAsAthlete | null>(null)

  useEffect(() => {
    if (!loading && !user) {
      router.push('/')
    }
  }, [user, loading, router])

  useEffect(() => {
    if (isCoachEmail(user?.email)) setViewAs(readViewAs())
  }, [user?.email])

  // Save athlete's timezone once per session so reminders fire at the right local time
  useEffect(() => {
    if (!user?.id) return
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!tz) return
    setDoc(doc(db, 'users', user.id), { timezone: tz }, { merge: true }).catch(() => {})
  }, [user?.id])

  if (loading) {
    return (
      <div className="poster-world min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-ochre" />
      </div>
    )
  }

  if (!user) {
    return null
  }

  const exitViewAs = () => {
    const id = viewAs?.id
    stopViewAs()
    setViewAs(null)
    router.push(id ? `/coach/athletes/${id}` : '/coach')
  }
  const coachSide = viewAs ? Object.entries(COACH_SIDE_ONLY).find(([p]) => pathname?.startsWith(p)) : undefined

  // .poster-world scopes the athlete app's WPA-poster look (globals.css).
  return (
    <ViewAsProvider athlete={viewAs}>
      <div className="poster-world min-h-screen">
        {viewAs && (
          <div dir="rtl" className="flex items-center gap-3 bg-rust px-4 py-2 text-stock">
            <Eye className="h-4 w-4 shrink-0" />
            <p className="min-w-0 flex-1 text-sm leading-tight">
              <span className="font-bold">תצוגת ספורטאי: {viewAs.name}.</span>{' '}
              <span className="text-stock/85">רואים בדיוק את מה שהוא רואה, בזמן אמת. שינויים כאן נשמרים אצלו.</span>
            </p>
            <button
              type="button"
              onClick={exitViewAs}
              className="flex h-8 shrink-0 items-center gap-1 rounded-md bg-stock px-2.5 text-xs font-bold text-ink"
            >
              <X className="h-3.5 w-3.5" />חזרה לתצוגת מאמן
            </button>
          </div>
        )}
        {!hideNav && <AthleteNav />}
        {/* Bottom nav is a fixed bar (mobile only, md:hidden) — without
            matching bottom padding here it covers the last ~5rem of every
            page's content instead of just sitting below it. */}
        <main className={hideNav ? "min-h-screen" : "container mx-auto px-4 pt-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))] md:pt-6 md:pb-10"}>
          {coachSide && viewAs ? (
            <div dir="rtl" className="poster-plate mx-auto max-w-md space-y-3 p-5 text-center">
              <p className="text-sm">את המסך הזה רואים מהצד של המאמן.</p>
              <Link href={coachSide[1](viewAs.id)} className="poster-caps inline-flex h-11 items-center rounded-md bg-ink px-4 text-[19px] text-stock">
                פתיחה בתצוגת מאמן
              </Link>
            </div>
          ) : children}
        </main>
        {!hideNav && <AthleteBottomNav />}
      </div>
    </ViewAsProvider>
  )
}
