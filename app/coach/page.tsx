import { CoachLayout } from '@/components/coach/coach-layout'
import { CoachDashboard } from '@/components/coach/coach-dashboard'

export default function CoachPage() {
  return (
    <CoachLayout>
      <CoachDashboard />
    </CoachLayout>
  )
}
