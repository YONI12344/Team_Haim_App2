'use client'

/**
 * components/coach/lactate-workout-gallery.tsx
 *
 * The Lab's "at a glance" comparison view: every distinct workout type that
 * has lactate data (e.g. "20×400", "2000×4") gets its own collapsed box
 * (T1/T2/T3 + a session-over-session pace trend) — click one to expand its
 * full graph/table, so the page shows a scannable list instead of every
 * chart rendered at once.
 */

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { ChevronDown, Loader2 } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { type LactateStep } from '@/lib/physiology'
import { useWorkoutLactateGroups, buildSessionCurves, currentWorkoutThresholds, averageRepMetrics, latestSessionRest, type WorkoutLactateGroup } from '@/hooks/useWorkoutLactateGroups'
import { LactateMultiCurveChart, curveThresholds, paceDelta, type CurveInput, type AxisMode } from '@/components/coach/lactate-multi-curve-chart'
import { WorkoutComparisonChart } from '@/components/coach/workout-comparison-chart'
import { type ComparisonPoint } from '@/hooks/useWorkoutComparisonGroups'
import { formatTargetRange, paceToSec } from '@/lib/physiology'
import { useLanguage } from '@/contexts/language-context'

/** Per-session pace/HR trend built from the group's raw logs (not the
 *  lactate curves) — used when a workout has been logged without any
 *  lactate testing at all, so there's nothing to plot on the pace/HR-vs
 *  -lactate axis, but pace/HR-over-time is still meaningful. */
function toTrendPoints(group: WorkoutLactateGroup): ComparisonPoint[] {
  return group.logs.map(log => {
    const { avgHr, avgPace } = averageRepMetrics(log.splitLogs || [])
    const paceSec = avgPace ? paceToSec(avgPace) : null
    return { logId: log.id, date: log.date, label: log.date, paceSec, pace: avgPace, hr: avgHr }
  })
}

const CURVE_COLOR_BASELINE = '#0a1628'

// One stable accent color per distinct workout inside a type-folder — a
// different concern from useWorkoutLactateGroups' SESSION_COLORS, which
// colors the sessions WITHIN one workout's own trend, not the workouts
// against each other.
const WORKOUT_COLORS = ['#0a6e5c', '#b5652f', '#3a5fb5', '#a13a7a', '#8a8a1f', '#2f8ab5', '#b53a4a', '#5c5cb5']

// One folder per workout `type` (the same field the coach picks in the
// workout builder) — in this fixed order, most-structured/specific first,
// with only the types actually present in this athlete's data rendered.
const FOLDER_ORDER = ['threshold', 'interval', 'repetition', 'tempo', 'easy', 'race', 'other'] as const
const FOLDER_LABEL: Record<typeof FOLDER_ORDER[number], (t: any) => string> = {
  threshold: t => t.labFolderThreshold,
  interval: t => t.labFolderInterval,
  repetition: t => t.labFolderRepetition,
  tempo: t => t.labFolderTempo,
  easy: t => t.labFolderEasy,
  race: t => t.labFolderRace,
  other: t => t.labFolderOther,
}

/** Compare the last two actual sessions of this workout (not the lab
 *  baseline) at whichever T-level both have data for, so the collapsed box
 *  can show "faster/slower than last time" without opening the graph. */
function sessionTrend(curves: CurveInput[]) {
  const sessions = curves.filter(c => c.sourceType === 'workout')
  if (sessions.length < 2) return null
  const prev = curveThresholds(sessions[sessions.length - 2].points)
  const last = curveThresholds(sessions[sessions.length - 1].points)
  for (const level of ['lt2', 'lt1', 'lt3'] as const) {
    if (last[level] && prev[level]) return paceDelta(last[level]!.paceSecPerKm, prev[level]!.paceSecPerKm)
  }
  return null
}

export function LactateWorkoutGallery({ athleteId }: { athleteId: string }) {
  const { t, isRTL } = useLanguage()
  const AXIS_OPTIONS = [
    ['paceVsLactate', t.labAxisPaceLactate],
    ['hrVsLactate', t.labAxisHrLactate],
    ['dual', t.labAxisTime],
  ] as const
  const { loading, grouped, workoutOptions } = useWorkoutLactateGroups(athleteId)
  const [axisModeById, setAxisModeById] = useState<Record<string, AxisMode>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showBaselineById, setShowBaselineById] = useState<Record<string, boolean | undefined>>({})
  const [openFolder, setOpenFolder] = useState<string | null>(null)
  const [baselineSteps, setBaselineSteps] = useState<LactateStep[] | null>(null)
  const [baselineLoading, setBaselineLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setBaselineLoading(true)
      try {
        const snap = await getDocs(query(collection(db, 'lactateTests'), where('athleteId', '==', athleteId)))
        const stepTests = snap.docs
          .map(d => d.data() as any)
          .filter(x => x.kind !== 'spot' && Array.isArray(x.steps) && x.steps.length > 0)
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        setBaselineSteps(stepTests[0]?.steps ?? null)
      } catch (e) { console.error(e); setBaselineSteps(null) }
      finally { setBaselineLoading(false) }
    }
    load()
  }, [athleteId])

  if (loading || baselineLoading) return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="h-6 w-6 animate-spin text-gold" />
    </div>
  )

  const baselineCurve: CurveInput | null = baselineSteps?.length ? {
    id: 'baseline', label: t.labBaselineTestShort, color: CURVE_COLOR_BASELINE, sourceType: 'test',
    points: baselineSteps.map(s => ({ pace: s.pace, hr: s.hr, lactate: s.lactate })),
  } : null

  type Card = { id: string; title: string; type?: string; color: string; curves: CurveInput[]; thresholds?: ReturnType<typeof currentWorkoutThresholds>; rest?: ReturnType<typeof latestSessionRest>; trend?: ReturnType<typeof paceDelta>; sessionCount?: number; trendPoints?: ComparisonPoint[] }
  const workoutCards: Card[] = workoutOptions.map((o, i) => {
    const group = grouped.get(o.id)!
    // baselineSteps lets an untested session's reps still land on this
    // curve — buildSessionCurves estimates lactate from HR via the
    // baseline's own HR→lactate relationship wherever a rep has no direct
    // reading (see estimateLactateFromHr in lib/physiology.ts).
    const curves = buildSessionCurves(group, baselineSteps).map(c => c.lactateEstimated
      ? { ...c, label: `${c.label}${t.labEstimateSuffix}` }
      : c)
    return {
      id: o.id,
      title: o.title,
      type: o.type,
      // One stable accent color per distinct workout within its folder, so
      // several workouts of the same type (e.g. two different threshold
      // distances) are visually distinguishable at a glance in the folder
      // header — separate from buildSessionCurves' own per-SESSION palette
      // used inside a single workout's own trend.
      color: WORKOUT_COLORS[i % WORKOUT_COLORS.length],
      curves,
      thresholds: currentWorkoutThresholds(group, baselineSteps),
      rest: latestSessionRest(group),
      trend: sessionTrend(curves),
      // Every logged session of this workout, tested or not — a group
      // that's only ever been logged without lactate testing still has a
      // real session count (used for the pace/HR trend chart below).
      sessionCount: group.logs.length,
      // Truly nothing to plot on the lactate axis (no direct reading AND
      // no baseline test to estimate from, or no HR either) — fall back
      // to the plain pace/HR-over-time trend built from the raw logs.
      trendPoints: curves.length === 0 ? toTrendPoints(group) : undefined,
    }
  })

  if (workoutCards.length === 0 && !baselineCurve) return (
    <div className="rounded-2xl border border-dashed border-border p-4 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
      <p className="text-sm font-semibold text-navy">{t.labNoGraphsYet}</p>
      <p className="text-xs text-muted-foreground mt-1">{t.labNoGraphsHint}</p>
    </div>
  )

  // One folder per workout `type` — the same field the coach picks when
  // building a workout template (easy/tempo/threshold/interval/repetition/
  // race), so folders map directly onto a category the coach already
  // thinks in, instead of inventing a second, overlapping classification.
  const folders = new Map<string, Card[]>()
  for (const card of workoutCards) {
    const key = card.type || 'other'
    if (!folders.has(key)) folders.set(key, [])
    folders.get(key)!.push(card)
  }
  const orderedFolders = FOLDER_ORDER
    .filter(key => folders.has(key))
    .map(key => ({ key, label: FOLDER_LABEL[key](t), cards: folders.get(key)! }))

  return (
    <div className="space-y-2" dir={isRTL ? 'rtl' : 'ltr'}>
      <h3 className="text-sm font-bold text-navy">{t.labWorkoutComparison}</h3>

      {baselineCurve && (
        <div className="space-y-2">
          {renderCard({ id: 'baseline', title: t.labBaselineTest, color: CURVE_COLOR_BASELINE, curves: [baselineCurve] } as Card)}
        </div>
      )}

      <div className="space-y-2">
        {orderedFolders.map(folder => (
          <div key={folder.key} className="rounded-2xl border border-border overflow-hidden">
            <button onClick={() => setOpenFolder(p => p === folder.key ? null : folder.key)}
              className="w-full px-3 py-2.5 flex items-center justify-between bg-muted/20 hover:bg-muted/30">
              <span className="text-xs font-bold text-navy flex items-center gap-1.5">
                📁 {folder.label}
                <span className="text-[10px] font-normal text-muted-foreground">({folder.cards.length})</span>
              </span>
              <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', openFolder === folder.key && 'rotate-180')} />
            </button>
            {openFolder === folder.key && (
              <div className="p-2 space-y-2 bg-white">
                {folder.cards.map(card => renderCard(card))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  function renderCard(card: Card) {
    const axisMode = axisModeById[card.id] ?? 'paceVsLactate'
    const isOpen = expandedId === card.id
    return (
      <Card key={card.id} className="min-w-0">
        <button onClick={() => setExpandedId(p => p === card.id ? null : card.id)}
          className="w-full text-right px-3 py-3 hover:bg-muted/20">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              {card.id !== 'baseline' && (
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: card.color }} />
              )}
              <span className="text-xs font-bold text-navy whitespace-nowrap">{card.title}</span>
              {card.trend ? (
                <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap',
                  card.trend.improved ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500')}>
                  {card.trend.improved ? '▲' : '▼'}{card.trend.label}
                </span>
              ) : card.id !== 'baseline' && (card.sessionCount ?? 0) < 2 && (
                <span className="text-[9px] font-medium text-muted-foreground whitespace-nowrap">
                  {t.labFirstWorkoutNoComparison}
                </span>
              )}
            </div>
            <ChevronDown className={cn('h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform', isOpen && 'rotate-180')} />
          </div>
          {/* Current T1/T2/T3 for THIS workout — from the athlete's
              most recent session of it (same source that drives the
              dynamic target shown when logging), not the real Lab
              thresholds. Always shown (with a placeholder per level
              when not yet computable) so it's clear this is "no data
              yet at that level" rather than the feature being broken. */}
          {card.id !== 'baseline' && card.curves.length > 0 && (
            <div className={cn('grid gap-1.5 mt-2', card.rest ? 'grid-cols-4' : 'grid-cols-3')}>
              {(['T1', 'T2', 'T3'] as const).map(level => {
                const r = card.thresholds?.[level] ?? null
                const colors = level === 'T1' ? 'bg-emerald-50 border-emerald-100 text-emerald-700'
                  : level === 'T2' ? 'bg-amber-50 border-amber-100 text-amber-700'
                  : 'bg-rose-50 border-rose-100 text-rose-700'
                return (
                  <div key={level} className={cn('rounded-lg border px-2 py-1.5 text-center', r ? colors : 'border-dashed border-border/50')}>
                    <p className={cn('text-[9px] font-semibold', r ? 'opacity-70' : 'text-muted-foreground')}>
                      {level}{r?.extrapolated ? t.labEstimateSuffix : ''}
                    </p>
                    <p className="text-[10px] font-bold" dir="ltr">{r ? formatTargetRange(r, ['pace', 'hr']) : '—'}</p>
                  </div>
                )
              })}
              {/* The reps' own rest/recovery, for comparison alongside the
                  work-rep levels above — separated out of the raw Strava
                  splits (see resolveRawSplits in useWorkoutLactateGroups.ts)
                  instead of being silently discarded or, worse, averaged in
                  as if it were itself a rep. */}
              {card.rest && (
                <div className="rounded-lg border px-2 py-1.5 text-center bg-slate-50 border-slate-100 text-slate-600">
                  <p className="text-[9px] font-semibold opacity-70">{t.labStatRest}</p>
                  <p className="text-[10px] font-bold" dir="ltr">{card.rest.time}{card.rest.hr ? ` · ♥${card.rest.hr}` : ''}</p>
                </div>
              )}
            </div>
          )}
          {card.id !== 'baseline' && card.curves.length === 0 && (
            <p className="text-[10px] text-muted-foreground mt-1.5">{t.labNoLactateYetTrend}</p>
          )}
        </button>

        {isOpen && card.id !== 'baseline' && card.curves.length === 0 && (
          <CardContent className="px-3 pb-3">
            <WorkoutComparisonChart points={card.trendPoints || []} kind="intervals" />
          </CardContent>
        )}

        {isOpen && (card.id === 'baseline' || card.curves.length > 0) && (() => {
          // Default the baseline overlay ON when this workout has an
          // estimated level (so the dashed projection that produced
          // it is visible right away) — otherwise off until toggled.
          const hasEstimate = card.thresholds && (['T1', 'T2', 'T3'] as const).some(l => card.thresholds![l]?.extrapolated)
          const showBaseline = showBaselineById[card.id] ?? !!hasEstimate
          const chartCurves = card.id !== 'baseline' && baselineCurve && showBaseline
            ? [...card.curves, baselineCurve]
            : card.curves
          return (
            <>
              <CardHeader className="pb-2 pt-0 px-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex gap-1 bg-muted rounded-xl p-0.5 w-fit">
                    {AXIS_OPTIONS.map(([m, label]) => (
                      <button key={m} onClick={() => setAxisModeById(prev => ({ ...prev, [card.id]: m }))}
                        className={cn('text-[10px] px-2 py-1 rounded-lg font-semibold transition-all',
                          axisMode === m ? 'bg-white text-navy shadow-sm' : 'text-muted-foreground')}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {/* Overlay the lab-test baseline curve onto this
                      workout's own graph, in addition to the baseline
                      having its own separate box above. */}
                  {card.id !== 'baseline' && baselineCurve && axisMode !== 'dual' && (
                    <button onClick={() => setShowBaselineById(prev => ({ ...prev, [card.id]: !showBaseline }))}
                      className={cn('text-[10px] font-semibold px-2 py-1 rounded-lg border transition-all',
                        showBaseline ? 'bg-navy/5 border-navy/20 text-navy' : 'border-border/50 text-muted-foreground')}>
                      {t.labCompareToBaseline}
                    </button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <LactateMultiCurveChart curves={chartCurves} axisMode={axisMode} size="compact" />
              </CardContent>
            </>
          )
        })()}
      </Card>
    )
  }
}
