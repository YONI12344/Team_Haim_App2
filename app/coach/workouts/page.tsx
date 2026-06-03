'use client'
import { Suspense } from 'react'
import { CoachLayout } from '@/components/coach/coach-layout'
import { WorkoutLibrary } from '@/components/coach/workout-library'
import { CoachPlanningHub } from '@/components/coach/coach-planning-hub'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSearchParams } from 'next/navigation'

function WorkoutsContent() {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') || 'library'
  return (
    <Tabs defaultValue={tab} className="space-y-6">
      <TabsList className="flex gap-1 h-auto">
        <TabsTrigger value="library">ספריית אימונים</TabsTrigger>
        <TabsTrigger value="planning">מרכז תכנון</TabsTrigger>
      </TabsList>
      <TabsContent value="library"><WorkoutLibrary /></TabsContent>
      <TabsContent value="planning"><CoachPlanningHub /></TabsContent>
    </Tabs>
  )
}

export default function WorkoutsPage() {
  return (
    <CoachLayout>
      <Suspense fallback={null}>
        <WorkoutsContent />
      </Suspense>
    </CoachLayout>
  )
}
