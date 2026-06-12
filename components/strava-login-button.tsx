'use client'

import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import { useState } from 'react'

export function StravaLoginButton() {
  const [isLoading, setIsLoading] = useState(false)

  const handleStravaConnect = () => {
    setIsLoading(true)
    const params = new URLSearchParams({
      client_id: '255142',
      response_type: 'code',
      redirect_uri: 'https://team-haim-app2.vercel.app/api/strava/callback',
      scope: 'read,activity:read_all',
      approval_prompt: 'force',
    })
    window.location.href = `https://www.strava.com/oauth/authorize?${params.toString()}`
  }

  return (
    <Button
      onClick={handleStravaConnect}
      disabled={isLoading}
      className="w-full h-12 bg-orange-500 hover:bg-orange-600 text-white font-medium"
    >
      {isLoading ? (
        <Loader2 className="h-5 w-5 animate-spin mr-2" />
      ) : (
        <span className="mr-2">🚴</span>
      )}
      Connect with Strava
    </Button>
  )
}
