'use client'

import { useEffect, useState } from 'react'
import { AthleteLayout } from '@/components/athlete/athlete-layout'
import { ChatRoom } from '@/components/chat/chat-room'
import { useAuth } from '@/contexts/auth-context'
import { conversationId, getCoachInfo, type CoachInfo } from '@/lib/coach'
import { Loader2 } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useLanguage } from '@/contexts/language-context'

export default function AthleteChatPage() {
  const { user } = useAuth()
  const { t, isRTL } = useLanguage()
  const [coach, setCoach] = useState<CoachInfo | null>(null)
  const [loading, setLoading] = useState(true)

  // Mark messages as read when chat opens
  useEffect(() => {
    if (!user?.id || !coach?.uid) return
    const chatId = conversationId(coach.uid, user.id)
    const lastReadKey = `lastRead_${chatId}_${user.id}`
    localStorage.setItem(lastReadKey, Date.now().toString())
  }, [user?.id, coach?.uid])

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
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-8" dir={isRTL ? 'rtl' : 'ltr'}>
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center max-w-sm w-full">
            <p className="text-[#0a1628] font-semibold text-lg mb-2">{t.coachNotJoinedTitle}</p>
            <p className="text-gray-400 text-sm">{t.tryAgainLaterText}</p>
          </div>
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
