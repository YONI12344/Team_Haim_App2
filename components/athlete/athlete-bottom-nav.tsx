'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Calendar, BarChart2, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'

export function AthleteBottomNav() {
  const pathname = usePathname()
  const { isRTL } = useLanguage()

  const tabs = [
    { href: '/athlete', label: isRTL ? 'בית' : 'Home', icon: Home, exact: true },
    { href: '/athlete/schedule', label: isRTL ? 'לוח' : 'Plan', icon: Calendar, exact: false },
    { href: '/athlete/stats', label: isRTL ? 'סטטס' : 'Stats', icon: BarChart2, exact: false },
    { href: '/athlete/profile', label: isRTL ? 'פרופיל' : 'Profile', icon: User, exact: false },
  ]

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 md:hidden bg-white border-t border-gray-100 shadow-[0_-4px_24px_rgba(0,0,0,0.07)]"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <div className="flex justify-around h-20">
        {tabs.map((tab) => {
          const isActive = tab.exact
            ? pathname === tab.href
            : pathname.startsWith(tab.href)
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                'relative flex flex-1 flex-col items-center justify-center gap-1.5 transition-colors',
                isActive ? 'text-[#c9a84c]' : 'text-gray-400'
              )}
            >
              {isActive && (
                <span className="absolute top-0 inset-x-5 h-[2px] bg-[#c9a84c] rounded-b-full" />
              )}
              <tab.icon
                className={cn(
                  'h-6 w-6 transition-all',
                  isActive ? 'stroke-[2]' : 'stroke-[1.5]'
                )}
              />
              <span
                className={cn(
                  'text-xs font-semibold leading-none tracking-wide',
                  isActive ? 'text-[#c9a84c]' : 'text-gray-400'
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
