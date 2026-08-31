import { CoachLayout } from '@/components/coach/coach-layout'
import { AssignPickAthlete } from '@/components/coach/assign-pick-athlete'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AssignWorkoutPage({ params }: PageProps) {
  const { id } = await params

  return (
    <CoachLayout>
      <AssignPickAthlete workoutId={id} />
    </CoachLayout>
  )
}
