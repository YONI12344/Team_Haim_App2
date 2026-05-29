import { CoachLayout } from '@/components/coach/coach-layout'
import { WorkoutLibrary } from '@/components/coach/workout-library'
import { CoachPlanningHub } from '@/components/coach/coach-planning-hub'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

export default function WorkoutsPage() {
  return (
    <CoachLayout>
      <Tabs defaultValue="library" className="space-y-6">
        <TabsList className="flex gap-1 h-auto">
          <TabsTrigger value="library">ספריית אימונים</TabsTrigger>
          <TabsTrigger value="planning">מרכז תכנון</TabsTrigger>
        </TabsList>
        <TabsContent value="library">
          <WorkoutLibrary />
        </TabsContent>
        <TabsContent value="planning">
          <CoachPlanningHub />
        </TabsContent>
      </Tabs>
    </CoachLayout>
  )
}
