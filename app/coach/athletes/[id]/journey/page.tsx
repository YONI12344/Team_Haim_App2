import { CoachLayout } from '@/components/coach/coach-layout'
import { CoachJourneyEditor } from '@/components/coach/coach-journey-editor'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CoachAthleteJourneyPage({ params }: PageProps) {
  const { id } = await params
  return (
    <CoachLayout>
      <CoachJourneyEditor athleteId={id} />
    </CoachLayout>
  )
}
