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
import { useWorkoutLactateGroups, buildSessionCurves } from '@/hooks/useWorkoutLactateGroups'
import { LactateMultiCurveChart, type CurveInput, type AxisMode } from '@/components/coach/lactate-multi-curve-chart'

const CURVE_COLOR_BASELINE = '#0a1628'

export function LactateWorkoutGallery({ athleteId }: { athleteId: string }) {
  const { loading, grouped, workoutOptions } = useWorkoutLactateGroups(athleteId)
  const [axisMode, setAxisMode] = useState<AxisMode>('paceVsLactate')
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
    id: 'baseline', label: '🧪 בדיקת מעבדה', color: CURVE_COLOR_BASELINE, sourceType: 'test',
    points: baselineSteps.map(s => ({ pace: s.pace, hr: s.hr, lactate: s.lactate })),
  } : null

  const cards: { id: string; title: string; curves: CurveInput[] }[] = [
    ...(baselineCurve ? [{ id: 'baseline', title: '🧪 בדיקת מעבדה (בסיס)', curves: [baselineCurve] }] : []),
    ...workoutOptions.map(o => ({
      id: o.id,
      title: `💪 ${o.title}`,
      curves: buildSessionCurves(grouped.get(o.id)!),
    })),
  ]

  if (cards.length === 0) return null

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-navy">📊 השוואת אימונים — כל סוגי האימונים</h3>
        <div className="flex gap-1 bg-muted rounded-xl p-0.5">
          {([
            ['paceVsLactate', 'קצב/לקטט'],
            ['hrVsLactate', 'דופק/לקטט'],
            ['dual', 'זמן'],
          ] as const).map(([m, label]) => (
            <button key={m} onClick={() => setAxisMode(m)}
              className={cn('text-[11px] px-3 py-1 rounded-lg font-semibold transition-all',
                axisMode === m ? 'bg-white text-navy shadow-sm' : 'text-muted-foreground')}>
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {cards.map(card => (
          <Card key={card.id}>
            <CardHeader className="pb-2 pt-3 px-3">
              <CardTitle className="text-xs">{card.title}</CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3">
              <LactateMultiCurveChart curves={card.curves} axisMode={axisMode} size="compact" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
