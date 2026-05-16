'use client'

import { useEffect, useState } from 'react'
import { Loader2, Compass } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { useAuth } from '@/contexts/auth-context'
import { listJourneys } from '@/lib/journey'
import { JourneyTimeline } from '@/components/journey/journey-timeline'
import type { JourneyDoc } from '@/lib/types'
import { toast } from 'sonner'

export function AthleteJourneyView() {
  const { user } = useAuth()
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
        toast.error('Failed to load your journey')
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
            Season Journey
          </h1>
          <p className="text-muted-foreground">Your road to the next goal race.</p>
        </div>
        <Card className="rounded-2xl border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="rounded-full bg-coral-light p-3">
              <Compass className="h-6 w-6 text-coral" />
            </div>
            <p className="font-medium text-navy">No journey set up yet</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Your coach will build a season journey for you with stages, key workouts,
              and your goal race. Check back soon.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold text-navy md:text-3xl">
          Season Journey
        </h1>
        <p className="text-muted-foreground">Your road to the next goal race.</p>
      </div>
      {journeys.map((j) => (
        <JourneyTimeline key={j.id} journey={j} />
      ))}
    </div>
  )
}
