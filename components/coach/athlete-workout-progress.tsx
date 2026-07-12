'use client'

/**
 * components/coach/athlete-workout-progress.tsx
 *
 * "Did this specific recurring workout get easier over time?" — separate
 * from the real T1/T2/T3 section in athlete-physiology.tsx (which only
 * ever comes from a graduated step test). A workout done at one target
 * pace (e.g. "20×400") has no lactate *curve* within a single session —
 * but comparing its own session-average (pace, HR, lactate) across dates
 * IS a legitimate curve, and this view plots exactly that (via the shared
 * components/coach/lactate-multi-curve-chart.tsx engine), overlaid against
 * the athlete's real Lab-test baseline when one exists.
 *
 * Data comes from `hooks/useWorkoutLactateGroups.ts` (logs with
 * hasLactate: true, grouped by workoutId).
 */

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, TrendingUp, ChevronDown } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { secToPace, type LactateStep } from '@/lib/physiology'
import { useWorkoutLactateGroups, averageRepMetrics, type WorkoutRepEntry } from '@/hooks/useWorkoutLactateGroups'
import { LactateMultiCurveChart, curveThresholds, type CurveInput, type CurvePoint, type AxisMode } from '@/components/coach/lactate-multi-curve-chart'

interface SessionPoint {
  logId: string
  date: string
  avgLactate: number | null
  avgHr: number | null
  avgPace: string | null
  repCount: number
  reps: WorkoutRepEntry[]
  notes?: string
}

const CURVE_COLOR_WORKOUT = '#e8826b'
const CURVE_COLOR_BASELINE = '#c9a84c'

export function AthleteWorkoutProgress({ athleteId }: { athleteId: string }) {
  const { loading, grouped, workoutOptions } = useWorkoutLactateGroups(athleteId)
  const [selectedWorkoutId, setSelectedWorkoutId] = useState('')
  const [axisMode, setAxisMode] = useState<AxisMode>('dual')
  const [expandedSession, setExpandedSession] = useState<string | null>(null)
  const [baselineSteps, setBaselineSteps] = useState<LactateStep[] | null>(null)

  useEffect(() => {
    if (!selectedWorkoutId && workoutOptions.length > 0) setSelectedWorkoutId(workoutOptions[0].id)
  }, [workoutOptions, selectedWorkoutId])

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

  if (loading) return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="h-6 w-6 animate-spin text-gold" />
    </div>
  )

  if (workoutOptions.length === 0) return null

  const sessions: SessionPoint[] = (grouped.get(selectedWorkoutId)?.logs || []).map(log => {
    const reps = log.splitLogs || []
    const { avgLactate, avgHr, avgPace } = averageRepMetrics(reps)
    return {
      logId: log.id,
      date: log.date,
      avgLactate, avgHr, avgPace,
      repCount: reps.filter(r => r.lactate || r.avgHr).length,
      reps,
      notes: log.comment,
    }
  })

  // One point per session — this session-over-time series is itself a
  // legitimate curve, distinct from (and never merged into) real physiology.
  const sessionPoints: CurvePoint[] = sessions.map(s => ({
    pace: s.avgPace, hr: s.avgHr, lactate: s.avgLactate ?? 0, label: format(new Date(s.date), 'd/M'),
  }))

  // Cumulative T1/T2/T3 up to and including each session, so the table
  // below shows how this workout's thresholds have shifted over time.
  const cumulativeByLogId = new Map<string, ReturnType<typeof curveThresholds>>()
  sessions.forEach((s, i) => {
    cumulativeByLogId.set(s.logId, curveThresholds(sessionPoints.slice(0, i + 1)))
  })

  const curves: CurveInput[] = [
    { id: 'workout', label: grouped.get(selectedWorkoutId)?.title || 'אימון', color: CURVE_COLOR_WORKOUT, sourceType: 'workout', points: sessionPoints },
  ]
  if (baselineSteps?.length && axisMode !== 'dual') {
    curves.push({
      id: 'baseline', label: 'בסיס (בדיקת מעבדה)', color: CURVE_COLOR_BASELINE, sourceType: 'test',
      points: baselineSteps.map(s => ({ pace: s.pace, hr: s.hr, lactate: s.lactate })),
    })
  }

  return (
    <div className="space-y-3" dir="rtl">
      <div className="flex items-center gap-2 pt-2">
        <TrendingUp className="h-4 w-4 text-gold" />
        <h3 className="text-sm font-bold text-navy">התקדמות באימונים</h3>
      </div>

      <Card>
        <CardHeader className="pb-2 pt-4 px-4">
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
              {([
                ['dual', 'זמן'],
                ['paceVsLactate', 'קצב/לקטט'],
                ['hrVsLactate', 'דופק/לקטט'],
              ] as const).map(([m, label]) => (
                <button key={m} onClick={() => setAxisMode(m)}
                  className={cn('text-[11px] px-3 py-1 rounded-lg font-semibold transition-all',
                    axisMode === m ? 'bg-white text-navy shadow-sm' : 'text-muted-foreground')}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {sessions.length < 2 ? (
            <p className="text-xs text-muted-foreground text-center py-4">נדרשות לפחות שתי בדיקות של אותו אימון כדי להציג מגמה</p>
          ) : (
            <LactateMultiCurveChart curves={curves} axisMode={axisMode} />
          )}

          <div className="space-y-1.5">
            {[...sessions].reverse().map(s => {
              const cum = cumulativeByLogId.get(s.logId)
              return (
                <div key={s.logId} className="rounded-xl border border-border overflow-hidden">
                  <button onClick={() => setExpandedSession(p => p === s.logId ? null : s.logId)}
                    className="w-full px-3 py-2 flex items-center justify-between hover:bg-muted/20">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-navy">{format(new Date(s.date), 'd/M/yyyy')}</span>
                      {s.avgLactate != null && (
                        <span className="text-[10px] font-semibold bg-red-50 text-red-600 border border-red-100 px-1.5 py-0.5 rounded-full">🧪 {s.avgLactate}</span>
                      )}
                      {s.avgHr != null && (
                        <span className="text-[10px] font-semibold bg-navy/5 border border-navy/10 px-1.5 py-0.5 rounded-full">❤️ {s.avgHr}</span>
                      )}
                      <span className="text-[10px] text-muted-foreground">{s.repCount} חזרות</span>
                    </div>
                    <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', expandedSession === s.logId && 'rotate-180')} />
                  </button>
                  {expandedSession === s.logId && (
                    <div className="border-t border-border/40 px-3 py-2 space-y-1.5">
                      {s.notes && <p className="text-[11px] text-muted-foreground">{s.notes}</p>}
                      {cum && (cum.lt1 || cum.lt2 || cum.lt3) && (
                        <div className="rounded-lg bg-navy/5 px-2 py-1.5 text-[10px] text-navy flex flex-wrap gap-x-3 gap-y-1" dir="ltr">
                          <span className="text-muted-foreground" dir="rtl">מצטבר עד תאריך זה:</span>
                          {cum.lt1 && <span>T1 {secToPace(cum.lt1.paceSecPerKm)}{cum.lt1.hr ? ` ♥${cum.lt1.hr}` : ''}</span>}
                          {cum.lt2 && <span>T2 {secToPace(cum.lt2.paceSecPerKm)}{cum.lt2.hr ? ` ♥${cum.lt2.hr}` : ''}</span>}
                          {cum.lt3 && <span>T3 {secToPace(cum.lt3.paceSecPerKm)}{cum.lt3.hr ? ` ♥${cum.lt3.hr}` : ''}</span>}
                        </div>
                      )}
                      <div className="grid grid-cols-4 gap-1 text-[10px] font-bold text-navy text-center">
                        <span>#</span><span>קצב</span><span>דופק</span><span>לקטט</span>
                      </div>
                      {s.reps.map((r, i) => (
                        <div key={i} className="grid grid-cols-4 gap-1 text-[11px] text-center text-navy">
                          <span className="text-muted-foreground">{i + 1}</span>
                          <span dir="ltr" className="font-mono">{r.pace || r.time || '—'}</span>
                          <span>{r.avgHr ?? '—'}</span>
                          <span>{r.lactate ?? '—'}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
