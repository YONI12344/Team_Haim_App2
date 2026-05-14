'use client'

import { CoachLayout } from '@/components/coach/coach-layout'
import { CoachChatHub } from '@/components/coach/coach-chat-hub'
import { useAuth } from '@/contexts/auth-context'
import { Loader2 } from 'lucide-react'

export default function CoachChatPage() {
  const { user } = useAuth()

  return (
    <CoachLayout>
      {!user ? (
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-gold" />
        </div>
      ) : (
        <CoachChatHub coachId={user.id} />
      )}
    </CoachLayout>
  )
}
