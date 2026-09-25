'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, CalendarDays, BarChart2, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'

/** Bottom tab bar (mobile): white bar, gold active state with an underline
 *  that slides via `transform`, not layout — see emil-design-eng. */
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
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex h-16 justify-around">
        {tabs.map((tab) => {
          const isActive = tab.exact ? pathname === tab.href : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-1 transition-colors duration-150',
                isActive ? 'text-navy' : 'text-muted-foreground active:text-navy',
              )}
            >
              <tab.icon className={cn('h-[22px] w-[22px]', isActive && 'stroke-[2.2]')} />
              <span className="text-[11px] font-medium">{tab.label}</span>
              <span
                aria-hidden
                className={cn(
                  'absolute top-0 h-[2.5px] w-8 rounded-full bg-gold transition-transform duration-200 ease-out',
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
