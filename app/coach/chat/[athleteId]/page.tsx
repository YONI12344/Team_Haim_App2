'use client'

import { use, useEffect, useState } from 'react'
import { CoachLayout } from '@/components/coach/coach-layout'
import { ChatRoom } from '@/components/chat/chat-room'
import { useAuth } from '@/contexts/auth-context'
import { conversationId } from '@/lib/coach'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { Loader2 } from 'lucide-react'

interface AthleteSummary {
  id: string
  name: string
  photoURL?: string
}

export default function CoachAthleteChat({
  params,
}: {
  params: Promise<{ athleteId: string }>
}) {
  const { athleteId } = use(params)
  const { user } = useAuth()
  const [athlete, setAthlete] = useState<AthleteSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'users', athleteId))
        if (snap.exists()) {
          const data = snap.data()
          setAthlete({
            id: snap.id,
            name: data.name || data.email || 'Athlete',
            photoURL: data.photoURL,
          })
        } else {
          setNotFound(true)
        }
      } catch (err) {
        console.error('Error loading athlete:', err)
        setNotFound(true)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [athleteId])

  if (loading || !user) {
    return (
      <CoachLayout hideNav>
        <div className="flex items-center justify-center h-96">
          <Loader2 className="h-8 w-8 animate-spin text-gold" />
        </div>
      </CoachLayout>
    )
  }

  if (notFound || !athlete) {
    return (
      <CoachLayout>
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Athlete not found</p>
        </div>
      </CoachLayout>
    )
  }

  return (
    <CoachLayout hideNav>
      <ChatRoom
        chatId={conversationId(user.id, athlete.id)}
        currentUserId={user.id}
        currentUserName={user.name || user.email || 'Coach'}
        currentUserAvatar={user.photoURL}
        otherUserName={athlete.name}
        otherUserAvatar={athlete.photoURL}
        backLink="/coach/chat"
      />
    </CoachLayout>
  )
}
