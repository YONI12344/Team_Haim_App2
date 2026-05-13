import { CoachLayout } from "@/components/coach/coach-layout"
import { CoachChatHub } from "@/components/coach/coach-chat-hub"

export default function CoachChatPage() {
  return (
    <CoachLayout>
      <CoachChatHub coachId="coach-1" />
    </CoachLayout>
  )
}
