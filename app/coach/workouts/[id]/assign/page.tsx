import { CoachLayout } from '@/components/coach/coach-layout'
import { WorkoutAssign } from '@/components/coach/workout-assign'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AssignWorkoutPage({ params }: PageProps) {
  const { id } = await params
  
  return (
    <CoachLayout>
      <WorkoutAssign workoutId={id} />
    </CoachLayout>
  )
}
