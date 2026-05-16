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
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { 
  LayoutDashboard, 
  Calendar, 
  User, 
  BarChart3, 
  MessageCircle,
  Menu,
  LogOut,
  ChevronDown,
  Compass,
} from 'lucide-react'
import { useState } from 'react'

export function AthleteNav() {
  const { user, signOut } = useAuth()
  const { t } = useLanguage()
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  const athleteNavItems = [
    { href: '/athlete', label: t.dashboard, icon: LayoutDashboard },
    { href: '/athlete/schedule', label: t.schedule, icon: Calendar },
    { href: '/athlete/journey', label: t.journey, icon: Compass },
    { href: '/athlete/profile', label: t.profile, icon: User },
    { href: '/athlete/stats', label: t.statistics, icon: BarChart3 },
    { href: '/athlete/chat', label: t.chat, icon: MessageCircle },
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
    <header className="sticky top-0 z-50 w-full border-b border-navy/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      {/* Slim navy accent stripe — keeps the page mostly white while
          adding a clear Team Haim navy band. */}
      <div className="h-1 bg-navy-gradient" aria-hidden />
      <div className="container flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <Link href="/athlete" className="flex items-center gap-3">
          <span className="block w-10 h-10">
            {/* To change the in-app logo, replace /public/team-haim-logo.png */}
            <img
              src="/team-haim-logo.png?v=3"
              alt={t.teamHaim}
              width={40}
              height={40}
              className="w-10 h-10 object-contain"
            />
          </span>
          <span className="hidden sm:block font-display-serif font-semibold text-navy text-lg">
            {t.teamHaim}
          </span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {athleteNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/athlete' && pathname.startsWith(item.href))
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-luxury',
                  isActive
                    ? 'bg-navy text-white shadow-sm'
                    : 'text-navy-light hover:text-navy hover:bg-navy-tint'
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
                <Avatar className="h-8 w-8">
                  <AvatarImage src={user?.photoURL} alt={user?.name} />
                  <AvatarFallback className="bg-navy/10 text-navy text-sm font-semibold">
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

          {/* Mobile Menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-64 p-0">
              <div className="flex flex-col h-full">
                <div className="p-4 border-b border-navy/10 bg-navy-soft">
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={user?.photoURL} alt={user?.name} />
                      <AvatarFallback className="bg-navy/10 text-navy font-semibold">
                        {getInitials(user?.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-navy">{user?.name}</p>
                      <p className="text-sm text-muted-foreground">{t.athlete}</p>
                    </div>
                  </div>
                </div>
                <nav className="flex-1 p-4 space-y-1">
                  {athleteNavItems.map((item) => {
                    const isActive = pathname === item.href || (item.href !== '/athlete' && pathname.startsWith(item.href))
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMobileOpen(false)}
                        className={cn(
                          'flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-luxury',
                          isActive
                            ? 'bg-navy text-white'
                            : 'text-navy-light hover:text-navy hover:bg-navy-tint'
                        )}
                      >
                        <item.icon className="h-5 w-5" />
                        {item.label}
                      </Link>
                    )
                  })}
                </nav>
                <div className="p-4 border-t border-navy/10 space-y-2">
                  <LanguageToggle variant="outline" className="w-full justify-center" />
                  <Button
                    variant="outline"
                    className="w-full justify-start text-destructive"
                    onClick={handleSignOut}
                  >
                    <LogOut className="h-4 w-4 mr-2" />
                    {t.signOut}
                  </Button>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  )
}
