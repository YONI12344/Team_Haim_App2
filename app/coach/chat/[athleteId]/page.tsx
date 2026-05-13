"use client"

import { use } from "react"
import { CoachLayout } from "@/components/coach/coach-layout"
import { ChatRoom } from "@/components/chat/chat-room"
import { mockAthletes } from "@/lib/mock-data"

export default function CoachAthleteChat({ params }: { params: Promise<{ athleteId: string }> }) {
  const { athleteId } = use(params)
  const athlete = mockAthletes.find((a) => a.id === athleteId)

  if (!athlete) {
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
        chatId={`coach-coach-1-athlete-${athleteId}`}
        currentUserId="coach-1"
        currentUserName="Coach Thompson"
        otherUserName={athlete.name}
        otherUserAvatar={athlete.avatar}
        backLink="/coach/chat"
      />
    </CoachLayout>
  )
}
