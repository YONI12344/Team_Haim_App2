'use client'

import { useEffect, useState } from 'react'
import { Loader2, Compass } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { listJourneys } from '@/lib/journey'
import { JourneyTimeline } from '@/components/journey/journey-timeline'
import type { JourneyDoc } from '@/lib/types'
import { toast } from 'sonner'

// Read-only for the athlete on purpose — this is the coach's season plan
// for them, not something they build themselves. Editing/deleting stages
// (and creating the journey in the first place) is coach-only, done from
// components/coach/coach-journey-editor.tsx; giving the athlete the same
// pencil/trash icons here risked them accidentally rewriting or deleting a
// stage the coach had carefully planned, with no coach oversight.
export function AthleteJourneyView() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [loading, setLoading] = useState(true)
  const [journeys, setJourneys] = useState<JourneyDoc[]>([])

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const list = await listJourneys(user.id)
        if (!cancelled) setJourneys(list)
      } catch (err) {
        console.error('Error loading journeys:', err)
        toast.error(t.toastLoadJourneyFailed)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [user?.id])

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  if (journeys.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-navy md:text-3xl">
            {t.seasonJourneyHeading}
          </h1>
          <p className="text-muted-foreground">{t.roadToGoalRace}</p>
        </div>
        <Card className="rounded-2xl border-dashed">
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="rounded-full bg-coral-light p-3">
              <Compass className="h-6 w-6 text-coral" />
            </div>
            <p className="font-medium text-navy">{t.coachNotSetup}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy md:text-3xl">
          {t.seasonJourneyHeading}
        </h1>
        <p className="text-muted-foreground">
          {t.roadToGoalRaceLong}
        </p>
      </div>
      {journeys.map((journey) => (
        <JourneyTimeline key={journey.id} journey={journey} />
      ))}
    </div>
  )
}

