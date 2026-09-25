'use client'

import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { LanguageToggle } from '@/components/language-toggle'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  LayoutDashboard,
  Calendar,
  User,
  BarChart3,
  MessageCircle,
  LogOut,
  ChevronDown,
  Compass,
  FileText,
} from 'lucide-react'

export function AthleteNav() {
  const { user, signOut } = useAuth()
  const { t } = useLanguage()
  const pathname = usePathname()
  const router = useRouter()

  const athleteNavItems = [
    { href: '/athlete', label: t.dashboard, icon: LayoutDashboard },
    { href: '/athlete/schedule', label: t.schedule, icon: Calendar },
    { href: '/athlete/journey', label: t.journey, icon: Compass },
    { href: '/athlete/profile', label: t.profile, icon: User },
    { href: '/athlete/stats', label: t.statistics, icon: BarChart3 },
    { href: '/athlete/chat', label: t.chat, icon: MessageCircle },
    { href: '/athlete/documents', label: 'מסמכים', icon: FileText },
  ]

  const handleSignOut = async () => {
    await signOut()
    router.push('/')
  }

  const getInitials = (name: string | undefined | null) => {
    const safeName = name || 'U'
    return safeName
      .split(' ')
      .map((n) => n[0] || '')
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'U'
  }

  return (
    <header className="sticky top-0 z-50 w-full bg-stock border-b-2 border-ink">
      <div className="container flex h-14 items-center justify-between px-4">
        {/* Masthead: TH monogram + wordmark in poster caps */}
        <Link href="/athlete" className="flex items-center gap-2.5">
          <span className="block w-9 h-9">
            {/* To change the in-app logo, replace /public/team-haim-logo.png */}
            <img
              src="/team-haim-logo.png?v=3"
              alt=""
              width={36}
              height={36}
              className="w-9 h-9 object-contain"
            />
          </span>
          <span className="poster-caps text-[26px] text-ink" dir="ltr">Team Haim</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {athleteNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/athlete' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={cn(
                  'flex items-center gap-2 px-3 py-1.5 rounded-md poster-caps text-[18px] transition-colors duration-200',
                  isActive
                    ? 'bg-ink text-stock'
                    : 'text-ink/70 hover:text-ink hover:bg-stock-deep'
                )}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </nav>

        {/* User Menu */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden sm:block">
            <LanguageToggle />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="flex items-center gap-2 px-2">
                <Avatar className="h-8 w-8 ring-2 ring-ink">
                  <AvatarImage src={user?.photoURL} alt={user?.name} />
                  <AvatarFallback className="bg-ink text-stock text-sm font-semibold">
                    {getInitials(user?.name)}
                  </AvatarFallback>
                </Avatar>
                <span className="hidden sm:block text-sm font-medium text-foreground">
                  {(user?.name || user?.email?.split('@')[0] || 'User').split(' ')[0]}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem asChild>
                <Link href="/athlete/profile" className="cursor-pointer">
                  <User className="h-4 w-4 mr-2" />
                  {t.profile}
                </Link>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="cursor-pointer text-destructive">
                <LogOut className="h-4 w-4 mr-2" />
                {t.signOut}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

        </div>
      </div>
    </header>
  )
}
