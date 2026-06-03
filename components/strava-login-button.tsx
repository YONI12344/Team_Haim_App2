'use client'

import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'

export function StravaLoginButton() {
  const [isLoading, setIsLoading] = useState(false)

  const handleStravaConnect = async () => {
    setIsLoading(true)
    try {
      const clientId = process.env.NEXT_PUBLIC_STRAVA_CLIENT_ID
      const redirectUri = `${window.location.origin}/api/strava/callback`

      const params = new URLSearchParams({
        client_id: clientId || '',
        response_type: 'code',
        redirect_uri: redirectUri,
        scope: 'read,activity:read_all',
        approval_prompt: 'force',
      })

      window.location.href = `https://www.strava.com/oauth/authorize?${params.toString()}`
    } catch (error) {
      console.error('Strava login error:', error)
      setIsLoading(false)
    }
  }

  return (
    <Button
      onClick={handleStravaConnect}
      disabled={isLoading}
      className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-medium transition-luxury"
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
      ) : (
        <span>🚴</span>
      )}
      Connect with Strava
    </Button>
  )
}
