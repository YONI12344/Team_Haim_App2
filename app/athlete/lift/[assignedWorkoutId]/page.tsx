import { AthleteLayout } from '@/components/athlete/athlete-layout'
import { LiftMode } from '@/components/athlete/lift-mode'

interface PageProps {
  params: Promise<{ assignedWorkoutId: string }>
}

export default async function LiftModePage({ params }: PageProps) {
  const { assignedWorkoutId } = await params

  return (
    <AthleteLayout>
      <LiftMode assignedWorkoutId={assignedWorkoutId} />
    </AthleteLayout>
  )
}
