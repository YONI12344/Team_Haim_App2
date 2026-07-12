'use client'

/**
 * components/coach/athlete-workout-progress.tsx
 *
 * "Did this specific recurring workout get easier over time?" — separate
 * from the real T1/T2/T3 section in athlete-physiology.tsx (which only
 * ever comes from a graduated step test). Each session of a recurring
 * workout (e.g. "20×400") becomes its own curve of rep-level (pace, HR,
 * lactate) points — exactly like a step test's steps, just gathered across
 * one workout instead of one graduated protocol — so multiple sessions can
 * be toggled on/off and visually compared against each other and against
 * the athlete's real Lab-test baseline, on switchable axes.
 *
 * Data comes from `hooks/useWorkoutLactateGroups.ts` (logs with
 * hasLactate: true, grouped by workoutId).
 */

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, TrendingUp } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { type LactateStep } from '@/lib/physiology'
import { useWorkoutLactateGroups } from '@/hooks/useWorkoutLactateGroups'
import { LactateMultiCurveChart, type CurveInput, type AxisMode } from '@/components/coach/lactate-multi-curve-chart'

const SESSION_COLORS = ['#e8826b', '#c9a84c', '#6b8fb5', '#8a6bb5', '#4caf8a', '#d4708a', '#c97a4c', '#5c9ab5']
const CURVE_COLOR_BASELINE = '#0a1628'

export function AthleteWorkoutProgress({ athleteId }: { athleteId: string }) {
  const { loading, grouped, workoutOptions } = useWorkoutLactateGroups(athleteId)
  const [selectedWorkoutId, setSelectedWorkoutId] = useState('')
  const [axisMode, setAxisMode] = useState<AxisMode>('paceVsLactate')
  const [view, setView] = useState<'graph' | 'table'>('graph')
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set())
  const [baselineSteps, setBaselineSteps] = useState<LactateStep[] | null>(null)

  useEffect(() => {
    if (!selectedWorkoutId && workoutOptions.length > 0) setSelectedWorkoutId(workoutOptions[0].id)
  }, [workoutOptions, selectedWorkoutId])

  // Reset which sessions are hidden whenever the selected workout changes
  useEffect(() => { setHiddenIds(new Set()) }, [selectedWorkoutId])

  // Most recent real step test — overlaid as the "baseline" curve so a
  // workout's shape can be compared against the athlete's actual Lab test.
  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'lactateTests'), where('athleteId', '==', athleteId)))
        const stepTests = snap.docs
          .map(d => d.data() as any)
          .filter(t => t.kind !== 'spot' && Array.isArray(t.steps) && t.steps.length > 0)
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
        setBaselineSteps(stepTests[0]?.steps ?? null)
      } catch (e) { console.error(e); setBaselineSteps(null) }
    }
    load()
  }, [athleteId])

  const sessionCurves: CurveInput[] = useMemo(() => {
    const logs = grouped.get(selectedWorkoutId)?.logs || []
    return logs.map((log, i) => ({
      id: log.id,
      label: format(new Date(log.date), 'd/M/yy'),
      color: SESSION_COLORS[i % SESSION_COLORS.length],
      sourceType: 'workout' as const,
      points: (log.splitLogs || [])
        .filter(r => r.lactate || r.avgHr || r.pace)
        .map(r => ({ pace: r.pace ?? null, hr: r.avgHr ?? null, lactate: r.lactate ?? 0, label: format(new Date(log.date), 'd/M') })),
    })).filter(c => c.points.length > 0)
  }, [grouped, selectedWorkoutId])

  if (loading) return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="h-6 w-6 animate-spin text-gold" />
    </div>
  )

  if (workoutOptions.length === 0) return null

  const baselineCurve: CurveInput | null = baselineSteps?.length ? {
    id: 'baseline', label: 'בסיס (בדיקת מעבדה)', color: CURVE_COLOR_BASELINE, sourceType: 'test',
    points: baselineSteps.map(s => ({ pace: s.pace, hr: s.hr, lactate: s.lactate })),
  } : null

  const toggleSession = (id: string) => setHiddenIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const visibleCurves = [
    ...sessionCurves.filter(c => !hiddenIds.has(c.id)),
    ...(axisMode !== 'dual' && baselineCurve && !hiddenIds.has('baseline') ? [baselineCurve] : []),
  ]

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center gap-2 pt-2">
        <TrendingUp className="h-4 w-4 text-gold" />
        <h3 className="text-sm font-bold text-navy">התקדמות באימונים</h3>
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4 px-4 space-y-2.5">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <Select value={selectedWorkoutId} onValueChange={setSelectedWorkoutId}>
              <SelectTrigger className="h-9 text-xs w-auto min-w-[160px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {workoutOptions.map(o => (
                  <SelectItem key={o.id} value={o.id} className="text-xs">{o.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="flex gap-1 bg-muted rounded-xl p-0.5">
              {(['graph', 'table'] as const).map(v => (
                <button key={v} onClick={() => setView(v)}
                  className={cn('text-[11px] px-3 py-1 rounded-lg font-semibold transition-all',
                    view === v ? 'bg-white text-navy shadow-sm' : 'text-muted-foreground')}>
                  {v === 'graph' ? '📈 גרף' : '📋 טבלה'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-1 bg-muted rounded-xl p-0.5 w-fit">
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

          {/* Session toggle chips — click to show/hide that session's curve */}
          <div className="flex flex-wrap gap-1.5">
            {sessionCurves.map(c => {
              const active = !hiddenIds.has(c.id)
              return (
                <button key={c.id} onClick={() => toggleSession(c.id)}
                  className={cn('flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border transition-all',
                    active ? 'text-navy' : 'text-muted-foreground border-border/50 opacity-50')}
                  style={active ? { borderColor: c.color, backgroundColor: `${c.color}1a` } : undefined}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: active ? c.color : '#d1d5db' }} />
                  {c.label}
                </button>
              )
            })}
            {baselineCurve && axisMode !== 'dual' && (
              <button onClick={() => toggleSession('baseline')}
                className={cn('flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-full border transition-all',
                  !hiddenIds.has('baseline') ? 'text-navy' : 'text-muted-foreground border-border/50 opacity-50')}
                style={!hiddenIds.has('baseline') ? { borderColor: CURVE_COLOR_BASELINE, backgroundColor: `${CURVE_COLOR_BASELINE}1a` } : undefined}>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: !hiddenIds.has('baseline') ? CURVE_COLOR_BASELINE : '#d1d5db' }} />
                🧪 בסיס
              </button>
            )}
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {sessionCurves.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-4">אין עדיין נתוני לקטט לאימון זה</p>
          ) : (
            <LactateMultiCurveChart curves={visibleCurves} axisMode={axisMode} hideChart={view === 'table'} hideTable={view === 'graph'} />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
