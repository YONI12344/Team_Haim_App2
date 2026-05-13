import { CoachLayout } from '@/components/coach/coach-layout'
import { AthleteDetail } from '@/components/coach/athlete-detail'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AthleteDetailPage({ params }: PageProps) {
  const { id } = await params
  
  return (
    <CoachLayout>
      <AthleteDetail athleteId={id} />
    </CoachLayout>
  )
}
