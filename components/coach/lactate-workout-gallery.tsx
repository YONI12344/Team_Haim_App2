'use client'

/**
 * components/coach/lactate-workout-gallery.tsx
 *
 * The Lab's "at a glance" comparison view: every distinct workout type that
 * has lactate data (e.g. "20×400", "2000×4") gets its own graph card, plus
 * one for the athlete's real step test — so a coach can visually scan and
 * compare across workout types instead of picking two curves from a
 * dropdown one pair at a time. One shared axis-mode toggle applies to every
 * card so they all stay comparable on the same axes.
 */

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2 } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { type LactateStep } from '@/lib/physiology'
import { useWorkoutLactateGroups, buildSessionCurves, currentWorkoutThresholds } from '@/hooks/useWorkoutLactateGroups'
import { LactateMultiCurveChart, type CurveInput, type AxisMode } from '@/components/coach/lactate-multi-curve-chart'
import { formatTargetRange } from '@/lib/physiology'

const CURVE_COLOR_BASELINE = '#0a1628'

const AXIS_OPTIONS = [
  ['paceVsLactate', 'קצב/לקטט'],
  ['hrVsLactate', 'דופק/לקטט'],
  ['dual', 'זמן'],
] as const

export function LactateWorkoutGallery({ athleteId }: { athleteId: string }) {
  const { loading, grouped, workoutOptions } = useWorkoutLactateGroups(athleteId)
  const [axisModeById, setAxisModeById] = useState<Record<string, AxisMode>>({})
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

  const cards: { id: string; title: string; curves: CurveInput[]; thresholds?: ReturnType<typeof currentWorkoutThresholds> }[] = [
    ...(baselineCurve ? [{ id: 'baseline', title: 'בדיקת מעבדה (בסיס)', curves: [baselineCurve] }] : []),
    ...workoutOptions.map(o => ({
      id: o.id,
      title: o.title,
      curves: buildSessionCurves(grouped.get(o.id)!),
      thresholds: currentWorkoutThresholds(grouped.get(o.id)),
    })),
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
    <div className="space-y-3" dir="rtl">
      <h3 className="text-sm font-bold text-navy">השוואת אימונים — כל סוגי האימונים</h3>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 min-w-0">
        {cards.map(card => {
          const axisMode = axisModeById[card.id] ?? 'paceVsLactate'
          return (
            <Card key={card.id} className="min-w-0">
              <CardHeader className="pb-2 pt-3 px-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <CardTitle className="text-xs">{card.title}</CardTitle>
                  <div className="flex gap-1 bg-muted rounded-xl p-0.5">
                    {AXIS_OPTIONS.map(([m, label]) => (
                      <button key={m} onClick={() => setAxisModeById(prev => ({ ...prev, [card.id]: m }))}
                        className={cn('text-[10px] px-2 py-1 rounded-lg font-semibold transition-all',
                          axisMode === m ? 'bg-white text-navy shadow-sm' : 'text-muted-foreground')}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Current T1/T2/T3 for THIS workout — from the athlete's most
                    recent session of it (same source that drives the dynamic
                    target shown when logging), not the real Lab thresholds. */}
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
              </CardHeader>
              <CardContent className="px-3 pb-3">
                <LactateMultiCurveChart curves={card.curves} axisMode={axisMode} size="compact" />
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
