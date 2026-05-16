'use client'

import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { UserRole } from '@/lib/types'

export default function LoginPage() {
  const { user, loading, signInWithGoogle, updateUserRole } = useAuth()
  const router = useRouter()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [showRoleSelection, setShowRoleSelection] = useState(false)
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null)

  useEffect(() => {
    if (!loading && user) {
      // If user has a role already, redirect to their dashboard
      if (user.role) {
        router.push(user.role === 'coach' ? '/coach' : '/athlete')
      } else {
        setShowRoleSelection(true)
      }
    }
  }, [user, loading, router])

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true)
    try {
      await signInWithGoogle()
      setShowRoleSelection(true)
    } catch (error) {
      console.error('Sign in error:', error)
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleRoleSelection = async (role: UserRole) => {
    setSelectedRole(role)
    await updateUserRole(role)
    router.push(role === 'coach' ? '/coach' : '/athlete')
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Hero Section */}
      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        {/* Logo */}
        <div className="mb-12 text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 rounded-full overflow-hidden mb-6 bg-navy">
            {/* To change the launcher / hero logo, replace /public/team-haim-logo.svg */}
            <img
              src="/team-haim-logo.svg?v=2"
              alt="Team Haim"
              width={96}
              height={96}
              className="w-24 h-24 object-cover"
            />
          </div>
          <h1 className="text-4xl md:text-5xl font-serif font-bold text-navy mb-2 text-balance">
            Team Haim
          </h1>
          <p className="text-muted-foreground text-lg">
            Elite Athletic Performance
          </p>
        </div>

        {/* Login Card */}
        {!showRoleSelection ? (
          <Card className="w-full max-w-md border-border/50 shadow-lg">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl font-serif text-navy">Welcome</CardTitle>
              <CardDescription className="text-muted-foreground">
                Sign in to access your training dashboard
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6">
              <Button
                onClick={handleGoogleSignIn}
                disabled={isSigningIn}
                className="w-full h-12 bg-navy hover:bg-navy-light text-white font-medium transition-luxury"
              >
                {isSigningIn ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                    <path
                      fill="currentColor"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="currentColor"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                    />
                    <path
                      fill="currentColor"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                    />
                  </svg>
                )}
                Continue with Google
              </Button>
              
              <div className="mt-6 text-center">
                <p className="text-sm text-muted-foreground">
                  By signing in, you agree to our Terms of Service and Privacy Policy
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full max-w-md border-border/50 shadow-lg">
            <CardHeader className="text-center pb-2">
              <CardTitle className="text-2xl font-serif text-navy">Select Your Role</CardTitle>
              <CardDescription className="text-muted-foreground">
                Choose how you&apos;ll use Team Haim
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <button
                onClick={() => handleRoleSelection('athlete')}
                disabled={selectedRole !== null}
                className="w-full p-6 rounded-lg border-2 border-border hover:border-gold hover:bg-accent transition-luxury text-left group disabled:opacity-50"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center group-hover:bg-gold/20 transition-luxury">
                    <svg className="w-6 h-6 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-navy text-lg">Athlete</h3>
                    <p className="text-sm text-muted-foreground">View workouts, track progress, chat with coach</p>
                  </div>
                </div>
              </button>
              
              <button
                onClick={() => handleRoleSelection('coach')}
                disabled={selectedRole !== null}
                className="w-full p-6 rounded-lg border-2 border-border hover:border-gold hover:bg-accent transition-luxury text-left group disabled:opacity-50"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center group-hover:bg-gold/20 transition-luxury">
                    <svg className="w-6 h-6 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-semibold text-navy text-lg">Coach</h3>
                    <p className="text-sm text-muted-foreground">Manage athletes, create workouts, track team</p>
                  </div>
                </div>
              </button>
              
              {selectedRole && (
                <div className="flex items-center justify-center pt-4">
                  <Loader2 className="h-5 w-5 animate-spin text-gold mr-2" />
                  <span className="text-muted-foreground">Setting up your account...</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Features Preview */}
        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl w-full px-4">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-navy mb-2">Track Progress</h3>
            <p className="text-sm text-muted-foreground">Monitor your performance with detailed statistics and PR tracking</p>
          </div>
          
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-semibold text-navy mb-2">Smart Scheduling</h3>
            <p className="text-sm text-muted-foreground">View and manage workouts with weekly and monthly calendars</p>
          </div>
          
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-gold/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-gold" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="font-semibold text-navy mb-2">Direct Communication</h3>
            <p className="text-sm text-muted-foreground">Real-time chat between athletes and coaches</p>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="py-6 text-center border-t border-border">
        <p className="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} Team Haim. All rights reserved.
        </p>
      </footer>
    </div>
  )
}
