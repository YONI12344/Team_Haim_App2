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
import { useWorkoutLactateGroups, buildSessionCurves, currentWorkoutThresholds } from '@/hooks/useWorkoutLactateGroups'
import { LactateMultiCurveChart, curveThresholds, paceDelta, type CurveInput, type AxisMode } from '@/components/coach/lactate-multi-curve-chart'
import { formatTargetRange } from '@/lib/physiology'

const CURVE_COLOR_BASELINE = '#0a1628'

const AXIS_OPTIONS = [
  ['paceVsLactate', 'קצב/לקטט'],
  ['hrVsLactate', 'דופק/לקטט'],
  ['dual', 'זמן'],
] as const

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
  const { loading, grouped, workoutOptions } = useWorkoutLactateGroups(athleteId)
  const [axisModeById, setAxisModeById] = useState<Record<string, AxisMode>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [showBaselineById, setShowBaselineById] = useState<Record<string, boolean>>({})
  const [baselineSteps, setBaselineSteps] = useState<LactateStep[] | null>(null)
  const [baselineLoading, setBaselineLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setBaselineLoading(true)
      try {
        const snap = await getDocs(query(collection(db, 'lactateTests'), where('athleteId', '==', athleteId)))
        const stepTests = snap.docs
          .map(d => d.data() as any)
          .filter(t => t.kind !== 'spot' && Array.isArray(t.steps) && t.steps.length > 0)
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
    id: 'baseline', label: 'בדיקת מעבדה', color: CURVE_COLOR_BASELINE, sourceType: 'test',
    points: baselineSteps.map(s => ({ pace: s.pace, hr: s.hr, lactate: s.lactate })),
  } : null

  const cards: { id: string; title: string; curves: CurveInput[]; thresholds?: ReturnType<typeof currentWorkoutThresholds>; trend?: ReturnType<typeof paceDelta> }[] = [
    ...(baselineCurve ? [{ id: 'baseline', title: 'בדיקת מעבדה (בסיס)', curves: [baselineCurve] }] : []),
    ...workoutOptions.map(o => {
      const curves = buildSessionCurves(grouped.get(o.id)!)
      return {
        id: o.id,
        title: o.title,
        curves,
        thresholds: currentWorkoutThresholds(grouped.get(o.id)),
        trend: sessionTrend(curves),
      }
    }),
  ]

  if (cards.length === 0) return (
    <div className="rounded-2xl border border-dashed border-border p-4 text-center" dir="rtl">
      <p className="text-sm font-semibold text-navy">עדיין אין גרפים להצגה</p>
      <p className="text-xs text-muted-foreground mt-1">
        ברגע שתתווסף בדיקת מעבדה, או שהאתלט ידווח לקטט באימון (באימוני סף בלבד —
        בשדה ליד כל חזרה), הגרף שלו יופיע כאן אוטומטית.
      </p>
    </div>
  )

  return (
    <div className="space-y-2" dir="rtl">
      <h3 className="text-sm font-bold text-navy">השוואת אימונים — כל סוגי האימונים</h3>

      <div className="space-y-2">
        {cards.map(card => {
          const axisMode = axisModeById[card.id] ?? 'paceVsLactate'
          const isOpen = expandedId === card.id
          return (
            <Card key={card.id} className="min-w-0">
              <button onClick={() => setExpandedId(p => p === card.id ? null : card.id)}
                className="w-full text-right px-3 py-2.5 flex items-center justify-between gap-2 hover:bg-muted/20">
                <div className="flex items-center gap-2 flex-wrap min-w-0">
                  <span className="text-xs font-bold text-navy whitespace-nowrap">{card.title}</span>
                  {card.trend && (
                    <span className={cn('text-[9px] font-bold px-1.5 py-0.5 rounded-full',
                      card.trend.improved ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500')}>
                      {card.trend.improved ? '▲' : '▼'}{card.trend.label}
                    </span>
                  )}
                  {/* Current T1/T2/T3 for THIS workout — from the athlete's
                      most recent session of it (same source that drives the
                      dynamic target shown when logging), not the real Lab
                      thresholds. */}
                  {card.thresholds && (card.thresholds.T1 || card.thresholds.T2 || card.thresholds.T3) && (
                    <div className="flex flex-wrap gap-1">
                      {(['T1', 'T2', 'T3'] as const).map(level => {
                        const r = card.thresholds![level]
                        if (!r) return null
                        return (
                          <span key={level} className="text-[10px] font-semibold bg-navy/5 border border-navy/10 text-navy px-1.5 py-0.5 rounded-full whitespace-nowrap" dir="ltr">
                            {level} · {formatTargetRange(r, ['pace', 'hr'])}
                          </span>
                        )
                      })}
                    </div>
                  )}
                </div>
                <ChevronDown className={cn('h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform', isOpen && 'rotate-180')} />
              </button>

              {isOpen && (() => {
                const showBaseline = !!showBaselineById[card.id]
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
                            🧪 השווה לבדיקת מעבדה
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
        })}
      </div>
    </div>
  )
}
