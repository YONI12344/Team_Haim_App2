'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { Activity, ChevronDown, Info, Heart, Gauge } from 'lucide-react'
import {
  computeTrainingZones,
  computeHeartRateZones,
  formatPace,
  parseTimeToSeconds,
  eventToDistanceMeters,
} from '@/lib/running'
import type { PersonalRecord } from '@/lib/types'

interface Props {
  /** Use to seed the reference race; we pick the most-recent supported PR. */
  personalRecords?: PersonalRecord[]
  /** Manual override reference race (used when PRs are missing/unsupported). */
  referenceEvent?: string
  referenceTime?: string
  restingHR?: number
  maxHR?: number
  /** True for coach view: show the "How is this calculated?" details. */
  showFormula?: boolean
}

function pickReferencePR(prs?: PersonalRecord[]): PersonalRecord | undefined {
  if (!prs?.length) return undefined
  // Prefer PRs whose event maps to a known distance, then most-recent date.
  const eligible = prs.filter((p) => eventToDistanceMeters(p.event) != null)
  if (!eligible.length) return undefined
  return [...eligible].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0]
}

export function TrainingZonesCard({
  personalRecords,
  referenceEvent,
  referenceTime,
  restingHR,
  maxHR,
  showFormula = false,
}: Props) {
  const reference = useMemo(() => {
    if (referenceEvent && referenceTime) {
      return { event: referenceEvent, time: referenceTime }
    }
    const pr = pickReferencePR(personalRecords)
    return pr ? { event: pr.event, time: pr.time } : null
  }, [personalRecords, referenceEvent, referenceTime])

  const zones = useMemo(() => {
    if (!reference) return null
    const secs = parseTimeToSeconds(reference.time)
    if (!isFinite(secs) || secs <= 0) return null
    return computeTrainingZones({ event: reference.event, timeSeconds: secs })
  }, [reference])

  const hrZones = useMemo(() => {
    if (!maxHR) return null
    return computeHeartRateZones({ maxHR, restingHR })
  }, [maxHR, restingHR])

  const [open, setOpen] = useState(true)
  const [openFormula, setOpenFormula] = useState(false)

  return (
    <Card className="rounded-2xl">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Gauge className="h-5 w-5 text-navy" />
              Training Zones
            </CardTitle>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" aria-label="Toggle zones">
                <ChevronDown
                  className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`}
                />
              </Button>
            </CollapsibleTrigger>
          </div>
          {reference && zones ? (
            <p className="text-sm text-muted-foreground">
              Calculated from{' '}
              <span className="font-medium text-foreground">
                {reference.event} {reference.time}
              </span>
              {' · '}
              <span className="font-medium text-foreground">VDOT {zones.vdot.toFixed(1)}</span>
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              Add a recent PR (e.g. 5K, 10K) to compute your training paces.
            </p>
          )}
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-6">
            {zones ? (
              <div className="grid gap-2 sm:grid-cols-2">
                {zones.zones.map((z) => {
                  const isRange = Math.abs(z.lowSecPerKm - z.highSecPerKm) > 1
                  const fast = formatPace(Math.min(z.lowSecPerKm, z.highSecPerKm))
                  const slow = formatPace(Math.max(z.lowSecPerKm, z.highSecPerKm))
                  return (
                    <div
                      key={z.key}
                      className="rounded-xl border border-border bg-navy-tint/40 p-3"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-semibold text-navy">{z.label}</span>
                        <span className="font-mono text-sm text-foreground">
                          {isRange ? `${fast}–${slow}` : fast}
                          <span className="text-muted-foreground"> /km</span>
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">{z.description}</p>
                      <p className="text-xs text-muted-foreground">{z.effort}</p>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center rounded-xl border border-dashed border-border py-8 text-sm text-muted-foreground">
                <Activity className="mr-2 h-4 w-4" />
                No reference race yet — add a PR or set one manually in your profile.
              </div>
            )}

            {hrZones && (
              <div>
                <div className="mb-2 flex items-center gap-2">
                  <Heart className="h-4 w-4 text-coral" />
                  <h4 className="text-sm font-semibold text-navy">Heart-rate zones</h4>
                  <Badge variant="outline" className="ml-1 text-[10px] uppercase">
                    {restingHR ? 'Karvonen' : '% max HR'}
                  </Badge>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {hrZones.map((hz) => (
                    <div
                      key={hz.key}
                      className="flex items-center justify-between rounded-xl border border-border p-3 text-sm"
                    >
                      <div>
                        <p className="font-semibold text-navy">{hz.label}</p>
                        <p className="text-xs text-muted-foreground">{hz.paceLabel}</p>
                      </div>
                      <p className="font-mono text-sm">
                        {hz.lowBpm}–{hz.highBpm} <span className="text-muted-foreground">bpm</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {showFormula && zones && (
              <Collapsible open={openFormula} onOpenChange={setOpenFormula}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="px-0 text-muted-foreground">
                    <Info className="mr-2 h-4 w-4" />
                    How is this calculated?
                    <ChevronDown
                      className={`ml-1 h-3 w-3 transition-transform ${openFormula ? 'rotate-180' : ''}`}
                    />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="mt-2 space-y-2 rounded-xl bg-muted/40 p-4 text-xs text-muted-foreground leading-relaxed">
                    <p>
                      We use Jack Daniels&apos; VDOT model. Given the athlete&apos;s reference
                      race ({reference?.event} in {reference?.time}, distance{' '}
                      {zones.reference.distanceMeters} m), we derive their VO₂max:
                    </p>
                    <p className="font-mono">
                      %VO2max(t) = 0.8 + 0.1894393·e^(-0.012778·t) + 0.2989558·e^(-0.1932605·t)
                      <br />
                      VO2(v) = -4.60 + 0.182258·v + 0.000104·v²
                      <br />
                      VDOT = VO2(v_race) / %VO2max(t_race)
                    </p>
                    <p>
                      Each zone has a target %VO2max (Easy ~70%, Marathon ~84%, Threshold
                      ~88%, Interval ~98%, Repetition ~105%). We invert the cost equation
                      to find the pace that matches each anchor.
                    </p>
                    {hrZones && (
                      <p>
                        Heart-rate zones use the Karvonen reserve formula when resting HR
                        is known: <code>zone = resting + pct × (max − resting)</code>;
                        otherwise we fall back to %max HR.
                      </p>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  )
}
