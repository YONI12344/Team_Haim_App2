'use client'

import { useEffect, useState } from 'react'
import { Loader2, Compass, Plus } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth-context'
import {
  listJourneys,
  newEmptyJourney,
  newEmptyStage,
  saveJourney,
} from '@/lib/journey'
import { JourneyTimeline } from '@/components/journey/journey-timeline'
import {
  StageActions,
  StageEditor,
} from '@/components/journey/journey-stage-editor'
import type { JourneyDoc, JourneyStage } from '@/lib/types'
import { toast } from 'sonner'

export function AthleteJourneyView() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [journeys, setJourneys] = useState<JourneyDoc[]>([])
  const [editingStageId, setEditingStageId] = useState<string | null>(null)
  const [editingJourneyId, setEditingJourneyId] = useState<string | null>(null)
  // Empty-state form for first-time create.
  const [newGoalEvent, setNewGoalEvent] = useState('')
  const [newGoalDate, setNewGoalDate] = useState('')

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

  const persist = async (journey: JourneyDoc) => {
    if (!user?.id) return
    try {
      await saveJourney(user.id, journey)
      setJourneys((js) =>
        js.some((j) => j.id === journey.id)
          ? js.map((j) => (j.id === journey.id ? journey : j))
          : [...js, journey],
      )
    } catch (err) {
      console.error('Error saving journey:', err)
      toast.error('Failed to save journey')
    }
  }

  const handleCreateJourney = async () => {
    if (!user?.id) return
    if (!newGoalDate) {
      toast.error('Pick a goal race date first')
      return
    }
    const today = new Date().toISOString().slice(0, 10)
    const journey = newEmptyJourney(
      {
        startDate: today,
        goalRaceDate: newGoalDate,
        createdBy: user.id,
      },
      newGoalEvent.trim() || 'My Season',
    )
    journey.goalRaceEvent = newGoalEvent.trim()
    await persist(journey)
    toast.success('Journey created — add your first stage')
  }

  const handleAddStage = async (journey: JourneyDoc) => {
    const lastStage = journey.stages[journey.stages.length - 1]
    const stage = newEmptyStage(lastStage)
    const next: JourneyDoc = { ...journey, stages: [...journey.stages, stage] }
    setEditingJourneyId(journey.id)
    setEditingStageId(stage.id)
    await persist(next)
  }

  const handleSaveStage = async (journey: JourneyDoc, stage: JourneyStage) => {
    const next: JourneyDoc = {
      ...journey,
      stages: journey.stages.map((s) => (s.id === stage.id ? stage : s)),
    }
    await persist(next)
    setEditingStageId(null)
    setEditingJourneyId(null)
    toast.success('Stage saved')
  }

  const handleDeleteStage = async (journey: JourneyDoc, stageId: string) => {
    const next: JourneyDoc = {
      ...journey,
      stages: journey.stages.filter((s) => s.id !== stageId),
    }
    await persist(next)
    if (editingStageId === stageId) {
      setEditingStageId(null)
      setEditingJourneyId(null)
    }
  }

  const renderJourney = (journey: JourneyDoc) => {
    const stageById = new Map(journey.stages.map((s) => [s.id, s]))
    const editing =
      editingJourneyId === journey.id && editingStageId
        ? stageById.get(editingStageId) || null
        : null

    return (
      <div key={journey.id} className="space-y-4">
        <JourneyTimeline
          journey={journey}
          renderStageActions={(stage) => (
            <StageActions
              onEdit={() => {
                setEditingJourneyId(journey.id)
                setEditingStageId(stage.id)
              }}
              onRemove={() => handleDeleteStage(journey, stage.id)}
            />
          )}
        />

        {editing && (
          <Card className="rounded-2xl">
            <CardContent className="pt-5">
              <StageEditor
                stage={editing}
                onSave={(s) => handleSaveStage(journey, s)}
                onCancel={() => {
                  setEditingStageId(null)
                  setEditingJourneyId(null)
                }}
              />
            </CardContent>
          </Card>
        )}

        <div className="flex justify-end">
          <Button
            onClick={() => handleAddStage(journey)}
            className="bg-gold hover:bg-gold/90 text-navy"
          >
            <Plus className="h-4 w-4 mr-1" /> Add stage
          </Button>
        </div>
      </div>
    )
  }

  // (length is O(1); no useMemo needed)

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
          <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
            <div className="rounded-full bg-coral-light p-3">
              <Compass className="h-6 w-6 text-coral" />
            </div>
            <p className="font-medium text-navy">Start your season journey</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              Plan your road to your next goal race. You can add and update
              stages and milestones any time.
            </p>
            <div className="grid w-full max-w-md gap-3 sm:grid-cols-2 text-left">
              <div className="space-y-1">
                <Label htmlFor="goal-event" className="text-xs">Goal race</Label>
                <Input
                  id="goal-event"
                  placeholder="e.g. Tel Aviv Half"
                  value={newGoalEvent}
                  onChange={(e) => setNewGoalEvent(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="goal-date" className="text-xs">Goal race date</Label>
                <Input
                  id="goal-date"
                  type="date"
                  value={newGoalDate}
                  onChange={(e) => setNewGoalDate(e.target.value)}
                />
              </div>
            </div>
            <Button
              onClick={handleCreateJourney}
              className="bg-gold hover:bg-gold/90 text-navy"
              disabled={!newGoalDate}
            >
              <Plus className="h-4 w-4 mr-1" /> Create my journey
            </Button>
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
        <p className="text-muted-foreground">
          Your road to the next goal race. Distances are in km, paces in min/km.
        </p>
      </div>
      {journeys.map(renderJourney)}
    </div>
  )
}

