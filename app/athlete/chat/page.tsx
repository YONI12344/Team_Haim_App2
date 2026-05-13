import { AthleteLayout } from "@/components/athlete/athlete-layout"
import { ChatRoom } from "@/components/chat/chat-room"

export default function AthleteChatPage() {
  return (
    <AthleteLayout hideNav>
      <ChatRoom
        chatId="coach-coach-1-athlete-athlete-1"
        currentUserId="athlete-1"
        currentUserName="Sarah Johnson"
        currentUserAvatar="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150"
        otherUserName="Coach Thompson"
        backLink="/athlete"
      />
    </AthleteLayout>
  )
}
