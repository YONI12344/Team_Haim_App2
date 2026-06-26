'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Users, Dumbbell, MessageCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'

export function CoachBottomNav() {
  const pathname = usePathname()
  const { t } = useLanguage()

  const tabs = [
    { href: '/coach', label: t.navHome, icon: Home, exact: true },
    { href: '/coach/athletes', label: t.athletes, icon: Users, exact: false },
    { href: '/coach/workouts', label: t.workouts, icon: Dumbbell, exact: false },
    { href: '/coach/chat', label: t.chat, icon: MessageCircle, exact: false },
  ]

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-gray-100/80"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex h-16">
        {tabs.map((tab) => {
          const isActive = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'relative flex-1 flex flex-col items-center justify-center gap-1 transition-colors active:scale-95',
                isActive ? 'text-[#0a1628]' : 'text-gray-400'
              )}
            >
              {isActive && (
                <span className="absolute top-0 inset-x-6 h-0.5 bg-[#c9a84c] rounded-b-full" />
              )}
              <tab.icon
                className={cn(
                  'h-[22px] w-[22px] transition-all',
                  isActive ? 'stroke-[2.2]' : 'stroke-[1.5]'
                )}
              />
              <span
                className={cn(
                  'text-[10px] font-semibold tracking-wide leading-none transition-colors',
                  isActive ? 'text-[#0a1628]' : 'text-gray-400'
                )}
              >
                {tab.label}
              </span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
