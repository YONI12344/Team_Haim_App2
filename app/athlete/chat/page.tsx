'use client'

import { useEffect, useState } from 'react'
import { AthleteLayout } from '@/components/athlete/athlete-layout'
import { ChatRoom } from '@/components/chat/chat-room'
import { useAuth } from '@/contexts/auth-context'
import { conversationId, getCoachInfo, type CoachInfo } from '@/lib/coach'
import { Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'

export default function AthleteChatPage() {
  const { user } = useAuth()
  const [coach, setCoach] = useState<CoachInfo | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const info = await getCoachInfo()
      if (!cancelled) {
        setCoach(info)
        setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AthleteLayout hideNav>
      {loading || !user ? (
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-gold" />
        </div>
      ) : !coach ? (
        <div className="p-8">
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">
                Your coach has not signed in yet. Please try again later.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : (
        <ChatRoom
          chatId={conversationId(coach.uid, user.id)}
          currentUserId={user.id}
          currentUserName={user.name || user.email || 'Athlete'}
          currentUserAvatar={user.photoURL}
          otherUserName={coach.name}
          otherUserAvatar={coach.photoURL}
          backLink="/athlete"
        />
      )}
    </AthleteLayout>
  )
}
