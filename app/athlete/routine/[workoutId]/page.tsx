import { Suspense } from 'react'
import { AthleteLayout } from '@/components/athlete/athlete-layout'
import { RoutinePage } from '@/components/athlete/routine-page'

interface PageProps {
  params: Promise<{ workoutId: string }>
}

export default async function AthleteRoutinePage({ params }: PageProps) {
  const { workoutId } = await params

  return (
    <AthleteLayout>
      <Suspense fallback={null}>
        <RoutinePage workoutId={workoutId} />
      </Suspense>
    </AthleteLayout>
  )
}
