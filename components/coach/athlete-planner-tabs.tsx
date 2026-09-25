'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { Bot, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTitle } from '@/components/ui/sheet'
import { AthletePlanner } from '@/components/coach/athlete-planner'
import { AthletePlannerView } from '@/components/athlete/athlete-planner-view'
import { AthletePhysiology } from '@/components/coach/athlete-physiology'
import { AiCoachAgent } from '@/components/coach/ai-coach-agent'

const WIDE_QUERY = '(min-width: 1280px)'
const PANEL_PREF_KEY = 'aiCoachPanelOpen'

function useIsWide() {
  const [wide, setWide] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia(WIDE_QUERY)
    const update = () => setWide(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return wide
}

/** Controls the active tab via the `?tab=` URL param, so other views
 *  (e.g. the lab summary card in AthletePlanner) can deep-link into a
 *  specific tab instead of just pointing at this page.
 *
 *  The coach's AI assistant for this athlete sits beside the schedule on
 *  wide screens (collapsible) and opens as a full-height sheet from a
 *  floating button everywhere else. Coach-only page; athletes never load it. */
export function AthletePlannerTabs({ athleteId }: { athleteId: string }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = searchParams?.get('tab') || 'coach'
  const { language } = useLanguage()
  const isHe = language !== 'en'
  const wide = useIsWide()
  const [athleteName, setAthleteName] = useState('')
  const [panelOpen, setPanelOpen] = useState(true)
  const [sheetOpen, setSheetOpen] = useState(false)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(PANEL_PREF_KEY)
      if (saved !== null) setPanelOpen(saved === '1')
    } catch {}
  }, [])

  useEffect(() => {
    let cancelled = false
    getDoc(doc(db, 'users', athleteId))
      .then((snap) => { if (!cancelled) setAthleteName((snap.data() as any)?.name || '') })
      .catch(() => {})
    return () => { cancelled = true }
  }, [athleteId])

  const togglePanel = () => {
    setPanelOpen((open) => {
      try { localStorage.setItem(PANEL_PREF_KEY, open ? '0' : '1') } catch {}
      return !open
    })
  }

  const setTab = (value: string) => {
    const params = new URLSearchParams(searchParams?.toString())
    params.set('tab', value)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }

  const name = athleteName || (isHe ? 'הספורטאי' : 'this athlete')
  const label = isHe ? 'מאמן AI' : 'AI coach'
  const showSide = wide && panelOpen

  return (
    <div className={cn(showSide && 'grid grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px] gap-5 items-start')}>
      <Tabs value={tab} onValueChange={setTab} className="space-y-4 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <TabsList>
            <TabsTrigger value="coach">תצוגת מאמן</TabsTrigger>
            <TabsTrigger value="athlete">תצוגת אתלט</TabsTrigger>
            <TabsTrigger value="lab">מעבדה 🧪</TabsTrigger>
          </TabsList>
          {wide && (
            <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={togglePanel} aria-pressed={panelOpen}>
              {panelOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
              {label}
            </Button>
          )}
        </div>
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

      {showSide && (
        <AiCoachAgent
          athleteId={athleteId}
          athleteName={name}
          className="sticky top-4 h-[calc(100dvh-2rem)] rounded-xl border shadow-sm overflow-hidden"
        />
      )}

      {!wide && (
        <>
          <Button
            onClick={() => setSheetOpen(true)}
            className="fixed z-40 end-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] md:bottom-6 h-11 gap-2 rounded-full bg-navy px-4 text-white shadow-lg shadow-navy/25 hover:bg-navy-light"
          >
            <Bot className="h-4 w-4" />
            {label}
          </Button>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            {/* The sheet's own corner X would sit on the panel title — the panel renders its own close button instead. */}
            <SheetContent side="bottom" className="h-[92dvh] p-0 gap-0 rounded-t-2xl flex flex-col [&>button:last-child]:hidden">
              <SheetTitle className="sr-only">{label}</SheetTitle>
              {sheetOpen && (
                <AiCoachAgent
                  athleteId={athleteId}
                  athleteName={name}
                  onClose={() => setSheetOpen(false)}
                  className="flex-1 min-h-0 rounded-t-2xl"
                />
              )}
            </SheetContent>
          </Sheet>
        </>
      )}
    </div>
  )
}
