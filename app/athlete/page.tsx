import { AthleteLayout } from '@/components/athlete/athlete-layout'
import { AthleteDashboard } from '@/components/athlete/athlete-dashboard'

export default function AthletePage() {
  return (
    <AthleteLayout>
      <AthleteDashboard />
    </AthleteLayout>
  )
}
