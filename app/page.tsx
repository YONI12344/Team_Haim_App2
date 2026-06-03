'use client'

import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { LanguageToggle } from '@/components/language-toggle'
import { StravaLoginButton } from '@/components/strava-login-button'
import { Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import type { UserRole } from '@/lib/types'

export default function LoginPage() {
  const { user, loading, signInWithGoogle, updateUserRole, canBeCoach } = useAuth()
  const { t } = useLanguage()
  const router = useRouter()
  const [isSigningIn, setIsSigningIn] = useState(false)
  const [showRoleSelection, setShowRoleSelection] = useState(false)
  const [selectedRole, setSelectedRole] = useState<UserRole | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!loading && user) {
      if (user.role) {
        router.push(user.role === 'coach' ? '/coach' : '/athlete')
      } else {
        setShowRoleSelection(true)
      }
    }
  }, [user, loading, router])

  const handleGoogleSignIn = async () => {
    setIsSigningIn(true)
    setError(null)
    try {
      await signInWithGoogle()
      setShowRoleSelection(true)
    } catch (error) {
      console.error('Sign in error:', error)
      setError('Failed to sign in. Please try again.')
    } finally {
      setIsSigningIn(false)
    }
  }

  const handleRoleSelection = async (role: UserRole) => {
    setError(null)
    if (role === 'coach' && !canBeCoach) {
      setError('Only the registered coach can access coach features.')
      return
    }
    setSelectedRole(role)
    try {
      await updateUserRole(role)
      router.push(role === 'coach' ? '/coach' : '/athlete')
    } catch (err) {
      setError('Failed to set role. Please try again.')
      setSelectedRole(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-navy" />
      </div>
    )
  }

  return (
    <div className="min-h-screen flex flex-col bg-navy-radial">
      <div className="w-full flex justify-end px-4 pt-4">
        <LanguageToggle variant="outline" />
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-4 py-12">
        <div className="mb-12 text-center">
          <div className="inline-flex items-center justify-center w-24 h-24 mb-6 rounded-2xl bg-white shadow-md ring-1 ring-navy/10">
            <img
              src="/team-haim-logo.png?v=3"
              alt={t.teamHaim}
              width={96}
              height={96}
              className="w-20 h-20 object-contain"
            />
          </div>
          <h1 className="font-display-serif text-4xl md:text-5xl font-bold text-navy mb-3 text-balance">
            {t.teamHaim}
          </h1>
          <div className="navy-rule mb-3" aria-hidden />
          <p className="text-navy-light text-lg font-medium">
            {t.eliteAthletic}
          </p>
        </div>

        {!showRoleSelection ? (
          <Card className="w-full max-w-md border-navy/15 shadow-lg bg-white">
            <CardHeader className="text-center pb-2">
              <CardTitle className="font-display text-2xl text-navy">{t.welcome}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t.signInDescription}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              <Button
                onClick={handleGoogleSignIn}
                disabled={isSigningIn}
                className="w-full h-12 bg-navy hover:bg-navy-light text-white font-medium transition-luxury"
              >
                {isSigningIn ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <svg className="h-5 w-5 mr-2" viewBox="0 0 24 24">
                    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                )}
                {t.continueWithGoogle}
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-navy/10" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-white px-2 text-muted-foreground">or</span>
                </div>
              </div>

              <StravaLoginButton />

              <p className="text-xs text-center text-muted-foreground pt-2">
                🚴 Strava login is optional — for athletes who want to sync workouts automatically
              </p>

              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <div className="mt-2 text-center">
                <p className="text-sm text-muted-foreground">
                  {t.termsNotice}
                </p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="w-full max-w-md border-navy/15 shadow-lg bg-white">
            <CardHeader className="text-center pb-2">
              <CardTitle className="font-display text-2xl text-navy">{t.selectYourRole}</CardTitle>
              <CardDescription className="text-muted-foreground">
                {t.chooseHowYoull}
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-6 space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-sm text-red-700">{error}</p>
                </div>
              )}

              <button
                onClick={() => handleRoleSelection('athlete')}
                disabled={selectedRole !== null}
                className="w-full p-6 rounded-lg border-2 border-border hover:border-navy hover:bg-navy-tint transition-luxury text-start group disabled:opacity-50"
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-full bg-navy/10 flex items-center justify-center group-hover:bg-navy/20 transition-luxury">
                    <svg className="w-6 h-6 text-navy" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="font-display font-semibold text-navy text-lg">{t.athlete}</h3>
                    <p className="text-sm text-muted-foreground">{t.athleteRoleDesc}</p>
                  </div>
                </div>
              </button>

              <button
                onClick={() => handleRoleSelection('coach')}
                disabled={selectedRole !== null || !canBeCoach}
                className={`w-full p-6 rounded-lg border-2 transition-luxury text-start group ${
                  !canBeCoach
                    ? 'border-gray-200 opacity-50 cursor-not-allowed'
                    : 'border-border hover:border-navy hover:bg-navy-tint'
                }`}
              >
                <div className="flex items-center gap-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center transition-luxury ${
                    !canBeCoach ? 'bg-gray-100' : 'bg-navy/10 group-hover:bg-navy/20'
                  }`}>
                    <svg className={`w-6 h-6 ${!canBeCoach ? 'text-gray-400' : 'text-navy'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                    </svg>
                  </div>
                  <div>
                    <h3 className={`font-display font-semibold text-lg ${!canBeCoach ? 'text-gray-400' : 'text-navy'}`}>
                      {t.coach}
                    </h3>
                    <p className={`text-sm ${!canBeCoach ? 'text-gray-400' : 'text-muted-foreground'}`}>
                      {!canBeCoach ? '🔒 Coach access restricted' : t.coachRoleDesc}
                    </p>
                  </div>
                </div>
              </button>

              {selectedRole && (
                <div className="flex items-center justify-center pt-4">
                  <Loader2 className="h-5 w-5 animate-spin text-navy mr-2" />
                  <span className="text-muted-foreground">{t.settingUpAccount}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <div className="mt-16 grid grid-cols-1 md:grid-cols-3 gap-8 max-w-4xl w-full px-4">
          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-navy/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-navy" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <h3 className="font-display font-semibold text-navy mb-2">{t.trackProgress}</h3>
            <p className="text-sm text-muted-foreground">{t.trackProgressDesc}</p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-navy/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-navy" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="font-display font-semibold text-navy mb-2">{t.smartScheduling}</h3>
            <p className="text-sm text-muted-foreground">{t.smartSchedulingDesc}</p>
          </div>

          <div className="text-center">
            <div className="w-12 h-12 rounded-full bg-navy/10 flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-navy" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            <h3 className="font-display font-semibold text-navy mb-2">{t.directCommunication}</h3>
            <p className="text-sm text-muted-foreground">{t.directCommunicationDesc}</p>
          </div>
        </div>
      </div>

      <footer className="py-6 text-center border-t border-navy/10">
        <p className="text-sm text-muted-foreground">
          &copy; {new Date().getFullYear()} {t.teamHaim}. {t.allRightsReserved}
        </p>
      </footer>
    </div>
  )
}
