import { AthletePlannerTabs } from '@/components/coach/athlete-planner-tabs'
import { CoachLayout } from '@/components/coach/coach-layout'

interface Props { params: Promise<{ id: string }> }

export default async function PlannerPage({ params }: Props) {
  const { id } = await params
  return (
    <CoachLayout>
      <AthletePlannerTabs athleteId={id} />
    </CoachLayout>
  )
}
