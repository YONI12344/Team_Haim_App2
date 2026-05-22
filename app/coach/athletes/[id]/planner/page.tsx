import { AthletePlanner } from '@/components/coach/athlete-planner'

interface Props { params: Promise<{ id: string }> }

export default async function PlannerPage({ params }: Props) {
  const { id } = await params
  return <AthletePlanner athleteId={id} />
}
