'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Users, Dumbbell, MessageCircle, UserPlus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'

/** Same poster tab bar as the athlete app: ink slab, stock caps, ochre underline on the active tab. */
export function CoachBottomNav() {
  const pathname = usePathname()
  const { t } = useLanguage()

  const tabs = [
    { href: '/coach', label: t.navHome, icon: Home, exact: true },
    { href: '/coach/athletes', label: t.athletes, icon: Users, exact: false },
    { href: '/coach/leads', label: t.leadsNav, icon: UserPlus, exact: false },
    { href: '/coach/workouts', label: t.workouts, icon: Dumbbell, exact: false },
    { href: '/coach/chat', label: t.chat, icon: MessageCircle, exact: false },
  ]

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-ink text-stock"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex justify-around h-[4.5rem]">
        {tabs.map((tab) => {
          const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-200',
                isActive ? 'text-stock' : 'text-stock/55 active:text-stock',
              )}
            >
              <tab.icon className={cn('h-[22px] w-[22px]', isActive ? 'stroke-[2.2]' : 'stroke-[1.7]')} />
              <span className="poster-caps text-[15px]">{tab.label}</span>
              <span
                aria-hidden
                className={cn(
                  'absolute bottom-2 h-[3px] w-7 rounded-full bg-ochre transition-transform duration-200',
                  isActive ? 'scale-x-100' : 'scale-x-0',
                )}
              />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
