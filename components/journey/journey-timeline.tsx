'use client'

import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Calendar, Flag, MapPin, Target, Trophy } from 'lucide-react'
import { format, isValid, parseISO } from 'date-fns'
import { cn } from '@/lib/utils'
import { computeJourneyProgress, computeStageProgress } from '@/lib/journey'
import type { JourneyDoc, JourneyStage, JourneyStageType } from '@/lib/types'

const stageColors: Record<JourneyStageType, string> = {
  base: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  build: 'bg-blue-100 text-blue-700 border-blue-200',
  peak: 'bg-amber-100 text-amber-700 border-amber-200',
  taper: 'bg-purple-100 text-purple-700 border-purple-200',
  race_week: 'bg-coral-light text-coral border-coral/40',
  recovery: 'bg-teal-100 text-teal-700 border-teal-200',
  custom: 'bg-muted text-muted-foreground border-border',
}

function fmt(d: string): string {
  if (!d) return '—'
  const parsed = parseISO(d)
  return isValid(parsed) ? format(parsed, 'MMM d, yyyy') : d
}

interface Props {
  journey: JourneyDoc
  renderStageActions?: (stage: JourneyStage, index: number) => React.ReactNode
  className?: string
}

export function JourneyTimeline({ journey, renderStageActions, className }: Props) {
  const progress = useMemo(() => computeJourneyProgress(journey), [journey])

  return (
    <div className={cn('space-y-6', className)}>
      <Card className="rounded-2xl bg-hero-navy">
        <CardContent className="space-y-4 pt-6">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                Season Journey
              </p>
              <h2 className="font-serif text-2xl font-semibold text-navy">
                {journey.title || 'My Season'}
              </h2>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Flag className="h-3.5 w-3.5" /> {journey.goalRaceEvent || 'Goal race'}
                </span>
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> {fmt(journey.goalRaceDate)}
                </span>
                {journey.goalRaceTarget && (
                  <span className="flex items-center gap-1">
                    <Target className="h-3.5 w-3.5" /> Target {journey.goalRaceTarget}
                  </span>
                )}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Badge className="bg-coral text-white">
                {progress.daysToRace} days to race
              </Badge>
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-xs text-muted-foreground">
              <span>Progress</span>
              <span>{progress.percent}%</span>
            </div>
            <Progress value={progress.percent} className="h-2" />
          </div>
          {progress.activeStage && (
            <p className="text-sm">
              <span className="text-muted-foreground">Currently in </span>
              <span className="font-semibold text-navy">{progress.activeStage.name}</span>
              {progress.nextStage && (
                <span className="text-muted-foreground">
                  {' · next: '}
                  <span className="font-medium text-foreground">
                    {progress.nextStage.name}
                  </span>{' '}
                  on {fmt(progress.nextStage.startDate)}
                </span>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      <div className="relative pl-6">
        <div aria-hidden className="absolute left-2 top-2 bottom-2 w-px bg-border" />
        <ul className="space-y-4">
          {journey.stages.length === 0 && (
            <li>
              <Card className="rounded-2xl border-dashed">
                <CardContent className="py-10 text-center text-sm text-muted-foreground">
                  No stages yet.{' '}
                  {renderStageActions
                    ? 'Use “Add stage” to begin.'
                    : 'Your coach hasn’t set this up yet.'}
                </CardContent>
              </Card>
            </li>
          )}
          {journey.stages.map((stage, i) => {
            const stagePct = computeStageProgress(stage)
            const active = progress.activeStage?.id === stage.id
            return (
              <li key={stage.id} className="relative">
                <span
                  aria-hidden
                  className={cn(
                    'absolute -left-[18px] top-5 h-3 w-3 rounded-full border-2 bg-background',
                    active ? 'border-coral' : 'border-navy-light',
                  )}
                />
                <Card
                  className={cn(
                    'rounded-2xl transition-luxury',
                    active && 'border-coral/40 shadow-md',
                  )}
                >
                  <CardContent className="space-y-3 pt-5">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-base font-semibold text-navy">{stage.name}</h3>
                          <Badge
                            variant="outline"
                            className={cn('capitalize', stageColors[stage.type])}
                          >
                            {stage.type.replace('_', ' ')}
                          </Badge>
                          {active && <Badge className="bg-coral text-white">Now</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {fmt(stage.startDate)} → {fmt(stage.endDate)}
                          {stage.weeklyVolumeKm ? ` · ~${stage.weeklyVolumeKm} km/wk` : ''}
                        </p>
                      </div>
                      {renderStageActions && (
                        <div className="flex gap-1">{renderStageActions(stage, i)}</div>
                      )}
                    </div>

                    {stage.focus && <p className="text-sm text-foreground">{stage.focus}</p>}

                    {stage.keyWorkouts.length > 0 && (
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Key workouts
                        </p>
                        <ul className="mt-1 flex flex-wrap gap-1.5">
                          {stage.keyWorkouts.map((k, idx) => (
                            <li key={idx}>
                              <Badge variant="secondary" className="bg-navy-tint text-navy">
                                {k}
                              </Badge>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {stage.milestones && stage.milestones.length > 0 && (
                      <div>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          Milestones
                        </p>
                        <ul className="mt-1 space-y-1 text-sm">
                          {stage.milestones.map((m, idx) => (
                            <li key={idx} className="flex items-center gap-2">
                              <MapPin className="h-3 w-3 text-coral" />
                              {m}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {active && (
                      <div>
                        <div className="mb-1 flex justify-between text-xs text-muted-foreground">
                          <span>Stage progress</span>
                          <span>{stagePct}%</span>
                        </div>
                        <Progress value={stagePct} className="h-1.5" />
                      </div>
                    )}

                    {stage.notes && (
                      <p className="text-xs text-muted-foreground">{stage.notes}</p>
                    )}
                  </CardContent>
                </Card>
              </li>
            )
          })}

          <li className="relative">
            <span
              aria-hidden
              className="absolute -left-[20px] top-5 h-4 w-4 rounded-full border-2 border-coral bg-coral"
            />
            <Card className="rounded-2xl border-coral/40 bg-coral-light/40">
              <CardContent className="flex items-center justify-between gap-4 pt-5">
                <div>
                  <p className="text-xs uppercase tracking-wide text-coral">Goal race</p>
                  <h3 className="font-serif text-lg font-semibold text-navy">
                    {journey.goalRaceEvent || 'Race day'}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {fmt(journey.goalRaceDate)}
                    {journey.goalRaceTarget ? ` · target ${journey.goalRaceTarget}` : ''}
                  </p>
                </div>
                <Trophy className="h-8 w-8 text-coral" />
              </CardContent>
            </Card>
          </li>
        </ul>
      </div>
    </div>
  )
}
