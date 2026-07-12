'use client'

/**
 * components/coach/athlete-workout-progress.tsx
 *
 * "Did this specific recurring workout get easier over time?" — separate
 * from the real T1/T2 section in athlete-physiology.tsx (which only ever
 * comes from a graduated step test). A workout done at one target pace
 * (e.g. "20×400") has no lactate *curve* — it only tells you how the
 * athlete responds to that one repeated stimulus, so this view compares
 * the SAME workout (same `workoutId`, reused across dates for recurring
 * sessions) across sessions instead of interpolating fake thresholds.
 *
 * Reads `logs` docs with `hasLactate: true` (set by
 * components/athlete/workout-log-form.tsx), grouped by workoutId, using
 * the denormalized `workoutTitle` on each log — no extra `workouts` reads.
 */

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, TrendingUp, ChevronDown } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts'

interface RepEntry {
  avgHr?: number
  lactate?: number
  pace?: string
  time?: string
}

interface LogDoc {
  id: string
  workoutId: string
  workoutTitle?: string
  date: string
  splitLogs?: RepEntry[]
  comment?: string
}

interface SessionPoint {
  logId: string
  date: string
  avgLactate: number | null
  avgHr: number | null
  repCount: number
  reps: RepEntry[]
  notes?: string
}

const avg = (vals: number[]) => vals.length ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 : null

export function AthleteWorkoutProgress({ athleteId }: { athleteId: string }) {
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<LogDoc[]>([])
  const [selectedWorkoutId, setSelectedWorkoutId] = useState('')
  const [metric, setMetric] = useState<'lactate' | 'hr' | 'both'>('lactate')
  const [expandedSession, setExpandedSession] = useState<string | null>(null)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const snap = await getDocs(query(
          collection(db, 'logs'),
          where('athleteId', '==', athleteId),
          where('hasLactate', '==', true),
        ))
        const docs = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as Omit<LogDoc, 'id'>) }))
          .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
        setLogs(docs)
      } catch (e) { console.error(e) }
      finally { setLoading(false) }
    }
    load()
  }, [athleteId])

  const grouped = useMemo(() => {
    const map = new Map<string, { title: string; logs: LogDoc[] }>()
    for (const log of logs) {
      if (!map.has(log.workoutId)) map.set(log.workoutId, { title: log.workoutTitle || 'אימון', logs: [] })
      map.get(log.workoutId)!.logs.push(log)
    }
    return map
  }, [logs])

  const workoutOptions = useMemo(() =>
    Array.from(grouped.entries())
      .map(([id, g]) => ({ id, title: g.title, lastDate: g.logs[g.logs.length - 1]?.date || '' }))
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate)),
    [grouped])

  useEffect(() => {
    if (!selectedWorkoutId && workoutOptions.length > 0) setSelectedWorkoutId(workoutOptions[0].id)
  }, [workoutOptions, selectedWorkoutId])

  if (loading) return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="h-6 w-6 animate-spin text-gold" />
    </div>
  )

  if (workoutOptions.length === 0) return null

  const sessions: SessionPoint[] = (grouped.get(selectedWorkoutId)?.logs || []).map(log => {
    const reps = log.splitLogs || []
    const lacVals = reps.map(r => r.lactate).filter((v): v is number => v != null && v > 0)
    const hrVals = reps.map(r => r.avgHr).filter((v): v is number => v != null && v > 0)
    return {
      logId: log.id,
      date: log.date,
      avgLactate: avg(lacVals),
      avgHr: avg(hrVals),
      repCount: reps.filter(r => r.lactate || r.avgHr).length,
      reps,
      notes: log.comment,
    }
  })

  const chartData = sessions.map(s => ({ date: format(new Date(s.date), 'd/M'), lactate: s.avgLactate, hr: s.avgHr }))
  const oldest = sessions[0]
  const latest = sessions[sessions.length - 1]
  const showComparison = sessions.length >= 2 && oldest.logId !== latest.logId

  const trendCard = (label: string, emoji: string, oldVal: number | null, newVal: number | null, unit: string) => {
    if (oldVal == null || newVal == null) return null
    const delta = Math.round((newVal - oldVal) * 100) / 100
    const pct = oldVal !== 0 ? Math.round((delta / oldVal) * 1000) / 10 : 0
    const better = delta < 0
    return (
      <div className={cn('rounded-xl border p-3', better ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200')}>
        <p className="text-[10px] text-muted-foreground mb-1">{emoji} {label} — מגמה</p>
        <p className="text-xs font-mono" dir="ltr">{oldVal} → <span className="font-bold">{newVal}</span> {unit}</p>
        <p className={cn('text-[11px] font-bold mt-1', better ? 'text-emerald-700' : 'text-red-600')} dir="ltr">
          {better ? '✓ ' : ''}{pct > 0 ? '+' : ''}{pct}%
        </p>
      </div>
    )
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
              {(['lactate', 'hr', 'both'] as const).map(m => (
                <button key={m} onClick={() => setMetric(m)}
                  className={cn('text-[11px] px-3 py-1 rounded-lg font-semibold transition-all',
                    metric === m ? 'bg-white text-navy shadow-sm' : 'text-muted-foreground')}>
                  {m === 'lactate' ? '🧪 לקטט' : m === 'hr' ? '❤️ דופק' : 'שניהם'}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-3">
          {sessions.length < 2 ? (
            <p className="text-xs text-muted-foreground text-center py-4">נדרשות לפחות שתי בדיקות של אותו אימון כדי להציג מגמה</p>
          ) : (
            <div style={{ width: '100%', height: 220 }} dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData} margin={{ top: 10, right: 10, left: -15, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                  {metric !== 'hr' && <YAxis yAxisId="lac" tick={{ fontSize: 11, fill: '#9ca3af' }} width={35} />}
                  {metric !== 'lactate' && <YAxis yAxisId="hr" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} width={35} />}
                  <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #f0f0f0', borderRadius: '12px' }} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  {metric !== 'hr' && (
                    <Line yAxisId="lac" name="לקטט (ממוצע)" dataKey="lactate" stroke="#e8826b" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  )}
                  {metric !== 'lactate' && (
                    <Line yAxisId="hr" name="דופק (ממוצע)" dataKey="hr" stroke="#c9a84c" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  )}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {showComparison && (
            <div className="grid grid-cols-2 gap-2">
              {trendCard('לקטט ממוצע', '🧪', oldest.avgLactate, latest.avgLactate, 'mmol/L')}
              {trendCard('דופק ממוצע', '❤️', oldest.avgHr, latest.avgHr, 'bpm')}
            </div>
          )}

          <div className="space-y-1.5">
            {[...sessions].reverse().map(s => (
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
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
