import { CoachLayout } from '@/components/coach/coach-layout'
import { WorkoutAssign } from '@/components/coach/workout-assign'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AssignAthleteWorkoutPage({ params }: PageProps) {
  const { id } = await params
  
  return (
    <CoachLayout>
      <WorkoutAssign athleteId={id} />
    </CoachLayout>
  )
}
