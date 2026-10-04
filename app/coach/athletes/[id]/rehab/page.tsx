import { CoachLayout } from '@/components/coach/coach-layout'
import { CoachRehab } from '@/components/coach/coach-rehab'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function CoachAthleteRehabPage({ params }: PageProps) {
  const { id } = await params
  return (
    <CoachLayout>
      <CoachRehab athleteId={id} />
    </CoachLayout>
  )
}
