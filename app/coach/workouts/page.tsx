'use client'
import { Suspense } from 'react'
import { CoachLayout } from '@/components/coach/coach-layout'
import { WorkoutLibrary } from '@/components/coach/workout-library'
import { CoachPlanningHub } from '@/components/coach/coach-planning-hub'
import { ExerciseLibraryManager } from '@/components/coach/exercise-library-manager'
import { WorkoutBankManager } from '@/components/coach/workout-bank-manager'
import { BankCleanup } from '@/components/coach/bank-cleanup'
import { RestoreAssignedWorkouts } from '@/components/coach/restore-assigned-workouts'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useSearchParams } from 'next/navigation'

function WorkoutsContent() {
  const searchParams = useSearchParams()
  const tab = searchParams.get('tab') || 'restore'
  return (
    <Tabs defaultValue={tab} className="space-y-6">
      <TabsList className="flex gap-1 h-auto">
        <TabsTrigger value="library">ספריית אימונים</TabsTrigger>
        <TabsTrigger value="bank">בנק אימונים</TabsTrigger>
        <TabsTrigger value="cleanup">ניקוי וארגון</TabsTrigger>
        <TabsTrigger value="restore" className="text-red-600 data-[state=active]:text-red-700">שחזור אימונים</TabsTrigger>
        <TabsTrigger value="exercises">ספריית תרגילים</TabsTrigger>
        <TabsTrigger value="planning">מרכז תכנון</TabsTrigger>
      </TabsList>
      <TabsContent value="library"><WorkoutLibrary /></TabsContent>
      <TabsContent value="bank"><WorkoutBankManager /></TabsContent>
      <TabsContent value="cleanup"><BankCleanup /></TabsContent>
      <TabsContent value="restore"><RestoreAssignedWorkouts /></TabsContent>
      <TabsContent value="exercises"><ExerciseLibraryManager /></TabsContent>
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
