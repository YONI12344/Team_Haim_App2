import { CoachLayout } from '@/components/coach/coach-layout'
import { WorkoutBuilder } from '@/components/coach/workout-builder'

export default function NewWorkoutPage() {
  return (
    <CoachLayout>
      <WorkoutBuilder />
    </CoachLayout>
  )
}
