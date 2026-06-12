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
  Users, 
  Dumbbell, 
  MessageCircle,
  Menu,
  LogOut,
  ChevronDown,
  User,
  Settings,
} from 'lucide-react'
import { useState } from 'react'

export function CoachNav() {
  const { user, signOut } = useAuth()
  const { t } = useLanguage()
  const pathname = usePathname()
  const router = useRouter()
  const [mobileOpen, setMobileOpen] = useState(false)

  const coachNavItems = [
    { href: '/coach', label: t.dashboard, icon: LayoutDashboard },
    { href: '/coach/athletes', label: t.athletes, icon: Users },
    { href: '/coach/workouts', label: t.workouts, icon: Dumbbell },
    { href: '/coach/chat', label: t.chat, icon: MessageCircle },
    { href: '/coach/settings', label: t.settings, icon: Settings },
  ]

  const handleSignOut = async () => {
    await signOut()
    router.push('/')
  }

  const getInitials = (name: string | undefined | null) => {
    const safeName = name || 'C'
    return safeName
      .split(' ')
      .map((n) => n[0] || '')
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'C'
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-navy/10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      {/* Slim navy accent stripe — mostly white surface, with a clear
          Team Haim navy band at the top. */}
      <div className="h-1 bg-navy-gradient" aria-hidden />
      <div className="container flex h-16 items-center justify-between px-4">
        {/* Logo */}
        <Link href="/coach" className="flex items-center gap-3">
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
          <div className="hidden sm:block">
            <span className="font-display-serif font-semibold text-navy text-lg">
              {t.teamHaim}
            </span>
            <span className="text-xs text-muted-foreground block -mt-1">{t.coachPortal}</span>
          </div>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {coachNavItems.map((item) => {
            const isActive = pathname === item.href || (item.href !== '/coach' && pathname.startsWith(item.href))
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
                  {(user?.name || user?.email?.split('@')[0] || 'Coach').split(' ')[0]}
                </span>
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem className="text-muted-foreground cursor-default">
                <User className="h-4 w-4 mr-2" />
                {t.coach}
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
                      <p className="text-sm text-muted-foreground">{t.coach}</p>
                    </div>
                  </div>
                </div>
                <nav className="flex-1 p-4 space-y-1">
                  {coachNavItems.map((item) => {
                    const isActive = pathname === item.href || (item.href !== '/coach' && pathname.startsWith(item.href))
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
