import { CoachLayout } from '@/components/coach/coach-layout'
import { WorkoutBuilder } from '@/components/coach/workout-builder'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function EditWorkoutPage({ params }: PageProps) {
  const { id } = await params

  return (
    <CoachLayout>
      <WorkoutBuilder workoutId={id} />
    </CoachLayout>
  )
}
