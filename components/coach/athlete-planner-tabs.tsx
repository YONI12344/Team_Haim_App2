'use client'

import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AthletePlanner } from '@/components/coach/athlete-planner'
import { AthletePlannerView } from '@/components/athlete/athlete-planner-view'
import { AthletePhysiology } from '@/components/coach/athlete-physiology'

/** Controls the active tab via the `?tab=` URL param, so other views
 *  (e.g. the lab summary card in AthletePlanner) can deep-link into a
 *  specific tab instead of just pointing at this page. */
export function AthletePlannerTabs({ athleteId }: { athleteId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams?.get('tab') || 'coach'

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString())
    params.set('tab', value)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  return (
    <Tabs value={tab} onValueChange={setTab} className="space-y-4">
      <TabsList>
        <TabsTrigger value="coach">תצוגת מאמן</TabsTrigger>
        <TabsTrigger value="athlete">תצוגת אתלט</TabsTrigger>
        <TabsTrigger value="lab">מעבדה 🧪</TabsTrigger>
      </TabsList>
      <TabsContent value="coach">
        <AthletePlanner athleteId={athleteId} />
      </TabsContent>
      <TabsContent value="athlete">
        <AthletePlannerView overrideAthleteId={athleteId} />
      </TabsContent>
      <TabsContent value="lab">
        <AthletePhysiology athleteId={athleteId} />
      </TabsContent>
    </Tabs>
  )
}
