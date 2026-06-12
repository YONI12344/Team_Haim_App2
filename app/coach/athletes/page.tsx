import { CoachLayout } from '@/components/coach/coach-layout'
import { AthleteRoster } from '@/components/coach/athlete-roster'

export default function AthletesPage() {
  return (
    <CoachLayout>
      <AthleteRoster />
    </CoachLayout>
  )
}
