import { CoachLayout } from '@/components/coach/coach-layout'
import { AthleteDocuments } from '@/components/coach/athlete-documents'

interface PageProps {
  params: Promise<{ id: string }>
}

export default async function AthleteDocumentsPage({ params }: PageProps) {
  const { id } = await params
  return (
    <CoachLayout>
      <AthleteDocuments athleteId={id} />
    </CoachLayout>
  )
}
