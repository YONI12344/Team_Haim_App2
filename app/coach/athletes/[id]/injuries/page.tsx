import { CoachLayout } from '@/components/coach/coach-layout'
import { AthleteInjuriesManager } from '@/components/coach/athlete-injuries-manager'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AthleteInjuriesPage({ params }: PageProps) {
  const { id } = await params
  return (
    <CoachLayout>
      <AthleteInjuriesManager athleteId={id} />
    </CoachLayout>
  )
}
