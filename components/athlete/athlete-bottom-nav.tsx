'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, CalendarDays, BarChart2, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'

/** Poster caption-bar tab bar: ink slab, stock caps, ochre underline on the active tab. */
export function AthleteBottomNav() {
  const pathname = usePathname()
  const { t } = useLanguage()

  const tabs = [
    { href: '/athlete', label: t.navHome, icon: Home, exact: true },
    { href: '/athlete/schedule', label: t.navPlan, icon: CalendarDays, exact: false },
    { href: '/athlete/stats', label: t.navStats, icon: BarChart2, exact: false },
    { href: '/athlete/profile', label: t.profile, icon: User, exact: false },
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
