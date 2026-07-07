import { AthletePlanner } from '@/components/coach/athlete-planner'
import { AthletePlannerView } from '@/components/athlete/athlete-planner-view'
import { AthletePhysiology } from '@/components/coach/athlete-physiology'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CoachLayout } from '@/components/coach/coach-layout'

interface Props { params: Promise<{ id: string }> }

export default async function PlannerPage({ params }: Props) {
  const { id } = await params
  return (
    <CoachLayout>
      <Tabs defaultValue="coach" className="space-y-4">
        <TabsList>
          <TabsTrigger value="coach">תצוגת מאמן</TabsTrigger>
          <TabsTrigger value="athlete">תצוגת אתלט</TabsTrigger>
          <TabsTrigger value="lab">מעבדה 🧪</TabsTrigger>
        </TabsList>
        <TabsContent value="coach">
          <AthletePlanner athleteId={id} />
        </TabsContent>
        <TabsContent value="athlete">
          <AthletePlannerView overrideAthleteId={id} />
        </TabsContent>
        <TabsContent value="lab">
          <AthletePhysiology athleteId={id} />
        </TabsContent>
      </Tabs>
    </CoachLayout>
  )
}
