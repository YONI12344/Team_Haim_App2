'use client'

/**
 * components/coach/lactate-multi-curve-chart.tsx
 *
 * Shared chart engine used by both the real-test "Lactate curve" section in
 * athlete-physiology.tsx and the per-workout-type view in
 * athlete-workout-progress.tsx. Plots one or more curves (each an ordered
 * list of {pace?, hr?, lactate} points) against a selectable pair of axes,
 * and computes a T1/T2/T3 (pace + HR) summary row per curve.
 *
 * IMPORTANT: `sourceType: 'workout'` curves are estimates built from a
 * workout's own session history (not a graduated step test) — always
 * labeled as such here. Nothing in this file writes anywhere; it's a pure
 * display component. The athlete's real physiology thresholds only ever
 * come from an actual step test (lib/physiology.ts / athlete-physiology.tsx).
 */

import { useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  type LactateStep, computeThresholds, paceToSec, secToPace,
} from '@/lib/physiology'

export interface CurvePoint {
  /** "M:SS" per km */
  pace?: string | null
  hr?: number | null
  lactate: number
  /** X-axis category label, only used in 'dual' axis mode (e.g. a session date) */
  label?: string
}

export interface CurveInput {
  id: string
  label: string
  color: string
  sourceType: 'test' | 'workout'
  points: CurvePoint[]
}

export type AxisMode = 'paceVsLactate' | 'hrVsLactate' | 'dual'

/** Convert a curve's points into LactateStep[] for the threshold math (pace required, hr optional). */
function toSteps(points: CurvePoint[]): LactateStep[] {
  return points
    .filter(p => p.pace && paceToSec(p.pace) != null && p.lactate > 0)
    .map(p => ({ pace: p.pace!, hr: p.hr ?? null, lactate: p.lactate }))
}

/** T1/T2/T3 (pace + HR) for one curve, or null fields where not computable. */
export function curveThresholds(points: CurvePoint[]) {
  return computeThresholds(toSteps(points))
}

function paceVsLactateData(points: CurvePoint[]) {
  return points
    .filter(p => p.pace && paceToSec(p.pace) != null)
    .map(p => ({ paceSec: paceToSec(p.pace), lactate: p.lactate }))
    .sort((a, b) => a.paceSec! - b.paceSec!)
}

function hrVsLactateData(points: CurvePoint[]) {
  return points
    .filter(p => p.hr != null)
    .map(p => ({ hr: p.hr, lactate: p.lactate }))
    .sort((a, b) => (a.hr! - b.hr!))
}

function dualAxisData(points: CurvePoint[]) {
  return points.map((p, i) => ({ label: p.label || String(i + 1), hr: p.hr ?? null, lactate: p.lactate }))
}

type MetricDisplay = 'both' | 'lactate' | 'hr'

export function LactateMultiCurveChart({ curves, axisMode }: { curves: CurveInput[]; axisMode: AxisMode }) {
  const [metricDisplay, setMetricDisplay] = useState<MetricDisplay>('both')
  const usable = curves.filter(c => c.points.length > 0)
  if (usable.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">אין עדיין מספיק נתונים לגרף</p>
  }

  return (
    <div className="space-y-3">
      <div style={{ width: '100%', height: 260 }} dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 10, right: 15, left: -10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            {axisMode === 'paceVsLactate' && (
              <>
                <XAxis dataKey="paceSec" type="number" domain={['dataMin - 5', 'dataMax + 5']}
                  tickFormatter={(v: number) => secToPace(v)}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  label={{ value: 'קצב (/ק"מ)', position: 'insideBottom', offset: -3, fontSize: 11, fill: '#9ca3af' }} />
                <YAxis dataKey="lactate" type="number" tick={{ fontSize: 11, fill: '#9ca3af' }}
                  label={{ value: 'mmol/L', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#9ca3af' }} />
              </>
            )}
            {axisMode === 'hrVsLactate' && (
              <>
                <XAxis dataKey="hr" type="number" domain={['dataMin - 5', 'dataMax + 5']}
                  tick={{ fontSize: 11, fill: '#9ca3af' }}
                  label={{ value: 'HR (bpm)', position: 'insideBottom', offset: -3, fontSize: 11, fill: '#9ca3af' }} />
                <YAxis dataKey="lactate" type="number" tick={{ fontSize: 11, fill: '#9ca3af' }}
                  label={{ value: 'mmol/L', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#9ca3af' }} />
              </>
            )}
            {axisMode === 'dual' && (
              <>
                <XAxis dataKey="label" type="category" allowDuplicatedCategory={false} tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis yAxisId="lac" type="number" tick={{ fontSize: 11, fill: '#9ca3af' }} width={35}
                  label={{ value: 'mmol/L', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#9ca3af' }} />
                <YAxis yAxisId="hr" type="number" orientation="right" tick={{ fontSize: 11, fill: '#9ca3af' }} width={35} />
              </>
            )}
            <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #f0f0f0', borderRadius: '12px' }}
              formatter={(v: any, name: string) => [typeof v === 'number' ? v : v, name]}
              labelFormatter={(v: any) => axisMode === 'paceVsLactate' ? secToPace(v) : String(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {axisMode !== 'dual' && usable.map(c => (
              <Line key={c.id}
                name={c.label}
                data={axisMode === 'paceVsLactate' ? paceVsLactateData(c.points) : hrVsLactateData(c.points)}
                dataKey="lactate" stroke={c.color} strokeWidth={2} dot={{ r: 3 }} />
            ))}
            {axisMode === 'dual' && usable.flatMap(c => ([
              <Line key={`${c.id}-lac`} yAxisId="lac" name={`${c.label} · לקטט`} data={dualAxisData(c.points)}
                dataKey="lactate" stroke={c.color} strokeWidth={2} dot={{ r: 3 }} connectNulls />,
              <Line key={`${c.id}-hr`} yAxisId="hr" name={`${c.label} · דופק`} data={dualAxisData(c.points)}
                dataKey="hr" stroke={c.color} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} connectNulls />,
            ]))}
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* T1/T2/T3 summary — switchable between pace+HR, pace only, or HR only */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">ספים (T1/T2/T3)</p>
        <div className="flex gap-1 bg-muted rounded-xl p-0.5">
          {([
            ['both', 'קצב + דופק'],
            ['lactate', 'קצב בלבד'],
            ['hr', 'דופק בלבד'],
          ] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMetricDisplay(m)}
              className={cn('text-[10px] px-2.5 py-1 rounded-lg font-semibold transition-all',
                metricDisplay === m ? 'bg-white text-navy shadow-sm' : 'text-muted-foreground')}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-border overflow-hidden">
        <div className="grid grid-cols-4 gap-1 bg-navy/5 px-2 py-1.5 text-[10px] font-bold text-navy text-center">
          <span>עקומה</span><span>T1 (2.0)</span><span>T2 (4.0)</span><span>T3 (4.5)</span>
        </div>
        {usable.map(c => {
          const { lt1, lt2, lt3 } = curveThresholds(c.points)
          const cell = (t: { paceSecPerKm: number; hr: number | null } | null) => {
            if (!t) return <span className="text-muted-foreground">—</span>
            if (metricDisplay === 'lactate') return <span dir="ltr" className="font-mono">{secToPace(t.paceSecPerKm)}</span>
            if (metricDisplay === 'hr') return <span dir="ltr" className="font-mono">{t.hr ? `♥${t.hr}` : '—'}</span>
            return (
              <span dir="ltr" className="font-mono">
                {secToPace(t.paceSecPerKm)}{t.hr ? ` · ♥${t.hr}` : ''}
              </span>
            )
          }
          return (
            <div key={c.id} className="grid grid-cols-4 gap-1 items-center px-2 py-1.5 border-t border-border/40 text-[11px] text-center text-navy">
              <span className="font-semibold flex items-center justify-center gap-1" style={{ color: c.color }}>
                {c.label}
              </span>
              {cell(lt1)}
              {cell(lt2)}
              {cell(lt3)}
            </div>
          )
        })}
        {usable.some(c => c.sourceType === 'workout') && (
          <p className="text-[10px] text-muted-foreground px-2 py-1.5 border-t border-border/40">
            ⚠️ עקומות מאימונים הן הערכה מתוך היסטוריית האימון — לא בדיקת מדרגות רשמית
          </p>
        )}
      </div>
    </div>
  )
}
