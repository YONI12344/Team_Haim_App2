'use client'

/**
 * components/coach/lactate-multi-curve-chart.tsx
 *
 * Shared chart engine used by both the real-test "Lactate curve" section in
 * athlete-physiology.tsx and the per-workout-type view in
 * athlete-workout-progress.tsx. Plots one or more curves (each an ordered
 * list of {pace?, hr?, lactate} points — one point per rep/step, never a
 * session-average, so pace/HR/lactate always come from the same
 * measurement instead of being mismatched across different reps) against a
 * selectable pair of axes. Marks each curve's own T1/T2/T3 directly on the
 * chart and lists every plotted point in a table under its curve.
 *
 * IMPORTANT: `sourceType: 'workout'` curves are estimates built from a
 * workout's own rep/session history (not a graduated step test) — always
 * labeled as such here. Nothing in this file writes anywhere; it's a pure
 * display component. The athlete's real physiology thresholds only ever
 * come from an actual step test (lib/physiology.ts / athlete-physiology.tsx).
 */

import { Fragment, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, ReferenceDot, ReferenceLine,
} from 'recharts'
import { cn } from '@/lib/utils'
import {
  type LactateStep, computeThresholds, paceToSec, secToPace,
  interpolateAtLactate, projectWorkoutTrend,
  LT1_TARGET, LT2_TARGET, LT3_TARGET,
} from '@/lib/physiology'
import { ChevronDown } from 'lucide-react'

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

/** Same as curveThresholds, but for a 'workout' curve whose own narrow
 *  lactate band can't reach a level directly — projects the missing ones
 *  from the baseline curve's local slope (see lib/physiology.ts
 *  projectWorkoutTrend), the same math drawn as the dashed trendline below. */
function curveThresholdsWithBaseline(points: CurvePoint[], baselinePoints: CurvePoint[] | null) {
  const direct = curveThresholds(points)
  if (!baselinePoints || baselinePoints.length < 2) return direct
  const projected = projectWorkoutTrend(toSteps(points), toSteps(baselinePoints))
  if (!projected) return direct
  return {
    lt1: direct.lt1 || interpolateAtLactate(projected, LT1_TARGET),
    lt2: direct.lt2 || interpolateAtLactate(projected, LT2_TARGET),
    lt3: direct.lt3 || interpolateAtLactate(projected, LT3_TARGET),
  }
}

/** paceNeg = -paceSec: pace is seconds/km, so a plain ascending axis would
 *  put the FASTEST pace on the left — plotting the negated value keeps a
 *  normal ascending numeric axis (no reliance on recharts' `reversed`,
 *  which doesn't reposition ReferenceDot/ReferenceLine consistently) while
 *  reading left→right as slow→fast, matching how a step test is run and
 *  the standard lactate-curve convention. Undo the negation in every place
 *  that displays or positions against this value (ticks, tooltip, T1/T2/T3
 *  markers) via secToPace(-v).
 */
function paceVsLactateData(points: CurvePoint[]) {
  return points
    .filter(p => p.pace && paceToSec(p.pace) != null)
    .map(p => ({ paceNeg: -paceToSec(p.pace)!, lactate: p.lactate, hr: p.hr ?? null, pace: p.pace ?? null }))
    .sort((a, b) => a.paceNeg - b.paceNeg)
}

function hrVsLactateData(points: CurvePoint[]) {
  return points
    .filter(p => p.hr != null)
    .map(p => ({ hr: p.hr, lactate: p.lactate, pace: p.pace ?? null }))
    .sort((a, b) => (a.hr! - b.hr!))
}

/** Pace delta between this curve's T-level and the previous (chronologically
 *  earlier) session's same level — a small ▲/▼ chip so a coach can see at a
 *  glance whether the athlete got faster at the same lactate level from one
 *  session of this workout to the next. */
export function paceDelta(curSec: number, prevSec: number): { label: string; improved: boolean } | null {
  const diff = curSec - prevSec
  if (Math.abs(diff) < 1) return null
  const abs = Math.round(Math.abs(diff))
  return { label: `${diff < 0 ? '-' : '+'}${Math.floor(abs / 60)}:${String(abs % 60).padStart(2, '0')}`, improved: diff < 0 }
}

function dualAxisData(points: CurvePoint[]) {
  return points.map((p, i) => ({ label: p.label || String(i + 1), hr: p.hr ?? null, lactate: p.lactate }))
}

/**
 * ONE shared, sorted array of rows for the whole chart — the critical fix
 * for a real bug: giving each curve's <Line> its OWN separate `data` array
 * let recharts position points by their INDEX within that array (point #1
 * of curve A next to point #1 of curve B, etc.) instead of by their actual
 * shared X value, so two points at completely different paces could render
 * at the same pixel position. Every curve (plus the projected "trend"
 * pseudo-curve) becomes its own column (`c.id`, or `${c.id}-trend`) on this
 * ONE shared row list, keyed by a single `xVal` — recharts' standard,
 * correct pattern for multiple series sharing one continuous numeric axis.
 * Each row only has the column(s) for whichever curve(s) actually have a
 * point at that exact X value; every <Line dataKey={c.id} connectNulls>
 * then draws only through its own column, skipping rows that belong to
 * other curves, but always positioned by real value, never by index.
 */
function buildSharedRows(
  usable: CurveInput[],
  axisMode: 'paceVsLactate' | 'hrVsLactate',
  baselineCurve: CurveInput | null,
): Record<string, any>[] {
  const rows: Record<string, any>[] = []
  for (const c of usable) {
    const pts = axisMode === 'paceVsLactate' ? paceVsLactateData(c.points) : hrVsLactateData(c.points)
    for (const p of pts as any[]) {
      const xVal = axisMode === 'paceVsLactate' ? p.paceNeg : p.hr
      if (xVal == null) continue
      rows.push({ xVal, [c.id]: p.lactate, [`${c.id}__hr`]: p.hr ?? null, [`${c.id}__pace`]: p.pace ?? null })
    }
  }
  if (baselineCurve) {
    for (const c of usable.filter(c => c.sourceType === 'workout')) {
      const projected = projectWorkoutTrend(toSteps(c.points), toSteps(baselineCurve.points))
      if (!projected) continue
      const projPoints: CurvePoint[] = projected.map(s => ({ pace: s.pace, hr: s.hr, lactate: s.lactate }))
      const pts = axisMode === 'paceVsLactate' ? paceVsLactateData(projPoints) : hrVsLactateData(projPoints)
      const trendKey = `${c.id}-trend`
      for (const p of pts as any[]) {
        const xVal = axisMode === 'paceVsLactate' ? p.paceNeg : p.hr
        if (xVal == null) continue
        rows.push({ xVal, [trendKey]: p.lactate })
      }
    }
  }
  return rows.sort((a, b) => a.xVal - b.xVal)
}

const AXIS_CAPTION: Record<AxisMode, string> = {
  paceVsLactate: 'ציר X: קצב (לכל ק"מ) · ציר Y: לקטט בדם (mmol/L)',
  hrVsLactate: 'ציר X: דופק (bpm) · ציר Y: לקטט בדם (mmol/L)',
  dual: 'ציר X: תאריך/מפגש · ציר Y (שמאל): לקטט (mmol/L) · ציר Y (ימין): דופק (bpm)',
}

interface RangeStat { min: number; max: number; avg: number }

function statOf(vals: number[]): RangeStat | null {
  if (!vals.length) return null
  return { min: Math.min(...vals), max: Math.max(...vals), avg: Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 10) / 10 }
}

/** min/avg/max across a curve's raw points, for the "Excel-style" summary row. */
function summarizeCurve(points: CurvePoint[]) {
  const lactate = statOf(points.map(p => p.lactate).filter(v => v > 0))
  const hr = statOf(points.map(p => p.hr).filter((v): v is number => v != null))
  const paceSec = statOf(points.map(p => paceToSec(p.pace)).filter((v): v is number => v != null))
  return { lactate, hr, paceSec }
}

type MetricDisplay = 'both' | 'pace' | 'hr'

const T_LEVELS = [
  { key: 'lt1' as const, target: LT1_TARGET, name: 'T1' },
  { key: 'lt2' as const, target: LT2_TARGET, name: 'T2' },
  { key: 'lt3' as const, target: LT3_TARGET, name: 'T3' },
]

export function LactateMultiCurveChart({ curves, axisMode, hideChart, hideTable, size = 'full' }: {
  curves: CurveInput[]; axisMode: AxisMode; hideChart?: boolean; hideTable?: boolean; size?: 'full' | 'compact'
}) {
  const [metricDisplay, setMetricDisplay] = useState<MetricDisplay>('both')
  const [expandedCurve, setExpandedCurve] = useState<string | null>(null)
  const usable = curves.filter(c => c.points.length > 0)
  if (usable.length === 0) {
    return <p className="text-xs text-muted-foreground text-center py-4">אין עדיין מספיק נתונים לגרף</p>
  }
  // When a real step-test curve is also on this chart, a 'workout' curve
  // whose own narrow lactate band can't reach a level gets it projected
  // from the baseline's local slope instead — shown both as a dashed
  // trendline (below) and used for that curve's own T1/T2/T3 markers.
  const baselineCurve = usable.find(c => c.sourceType === 'test') ?? null

  const pointLabel = (dataKey: 'lactate' | 'hr') => ({
    position: 'top' as const,
    fontSize: 9,
    formatter: (v: number) => (v == null ? '' : dataKey === 'lactate' ? v : Math.round(v)),
  })

  // T1/T2/T3 marker x-positions (direct or estimated) — the domain must
  // reach these too, or an estimated marker (which by definition usually
  // sits outside the workout's own narrow measured band — that's WHY it
  // needed projecting) would fall outside the tighter domain below and
  // simply not be drawn.
  const thresholdXs = axisMode !== 'dual' ? usable.flatMap(c => {
    const t = c.sourceType === 'workout' ? curveThresholdsWithBaseline(c.points, baselineCurve?.points ?? null) : curveThresholds(c.points)
    return T_LEVELS.map(({ key }) => {
      const point = t[key]
      if (!point) return null
      return axisMode === 'paceVsLactate' ? -point.paceSecPerKm : point.hr
    }).filter((x): x is number => x != null)
  }) : []

  // The X-domain must come from the real (measured) curves + the T-level
  // markers only — the dashed projection line itself can run far past both
  // at its 1.5/5.5 mmol ends, and letting recharts auto-size the domain off
  // ALL rendered lines (including that one) squeezed the real, visible
  // data into a fraction of the chart's width with a huge blank gap beside it.
  const paceDomain = (() => {
    if (axisMode !== 'paceVsLactate') return undefined
    const vals = [...usable.flatMap(c => paceVsLactateData(c.points).map(p => p.paceNeg)), ...thresholdXs]
    return vals.length ? [Math.min(...vals) - 8, Math.max(...vals) + 8] as [number, number] : undefined
  })()
  const hrDomain = (() => {
    if (axisMode !== 'hrVsLactate') return undefined
    const vals = [...usable.flatMap(c => hrVsLactateData(c.points).map(p => p.hr!)), ...thresholdXs]
    return vals.length ? [Math.min(...vals) - 8, Math.max(...vals) + 8] as [number, number] : undefined
  })()

  // The one shared row array every Line in this chart reads from — see
  // buildSharedRows for why this (not a separate `data` per <Line>) is
  // what actually guarantees correct, value-based X positioning.
  const sharedRows = axisMode !== 'dual' ? buildSharedRows(usable, axisMode, baselineCurve) : []

  /** Custom axis tick renderers — plain SVG <text>, same approach as the
   *  point labels below (which reliably render in every screenshot this
   *  session), instead of recharts' built-in tick={{...}} style-object
   *  path, which was rendering completely blank in this environment for
   *  reasons that weren't worth chasing further once a guaranteed
   *  alternative was available. */
  const paceTick = (props: any) => {
    const { x, y, payload } = props
    return (
      <text x={x} y={y + 14} textAnchor="middle" fontSize={10} fill="#374151">
        {secToPace(-payload.value)}
      </text>
    )
  }
  const hrTick = (props: any) => {
    const { x, y, payload } = props
    return (
      <text x={x} y={y + 14} textAnchor="middle" fontSize={10} fill="#374151">
        {Math.round(payload.value)}
      </text>
    )
  }
  const lactateTick = (props: any) => {
    const { x, y, payload } = props
    return (
      <text x={x} y={y + 4} textAnchor="end" fontSize={10} fill="#374151">
        {payload.value}
      </text>
    )
  }
  const categoryTick = (props: any) => {
    const { x, y, payload } = props
    return (
      <text x={x} y={y + 14} textAnchor="middle" fontSize={10} fill="#374151">
        {payload.value}
      </text>
    )
  }

  /** Plain-HTML fallback for the X-axis range — recharts' own tick
   *  rendering (both the built-in style-object form and a custom SVG
   *  render function) was showing up completely blank in production for
   *  reasons that couldn't be pinned down without a browser to inspect.
   *  This row is ordinary text in a div, entirely outside the SVG and
   *  recharts' rendering pipeline, so it cannot be affected by whatever
   *  was suppressing the in-chart ticks — guaranteed visible slow/mid/fast
   *  (or low/mid/high HR) labels spanning the same range as the chart. */
  const axisRangeLabels = (() => {
    if (axisMode === 'paceVsLactate') {
      const vals = usable.flatMap(c => paceVsLactateData(c.points).map(p => -p.paceNeg))
      if (!vals.length) return null
      const slow = Math.max(...vals), fast = Math.min(...vals)
      return { left: secToPace(slow), mid: secToPace((slow + fast) / 2), right: secToPace(fast) }
    }
    if (axisMode === 'hrVsLactate') {
      const vals = usable.flatMap(c => hrVsLactateData(c.points).map(p => p.hr!))
      if (!vals.length) return null
      const lo = Math.min(...vals), hi = Math.max(...vals)
      return { left: `♥${Math.round(lo)}`, mid: `♥${Math.round((lo + hi) / 2)}`, right: `♥${Math.round(hi)}` }
    }
    return null
  })()

  /** Rep-level label showing lactate PLUS whichever of pace/HR isn't already
   *  on an axis, so a point on the pace/lactate chart still shows that rep's
   *  HR (and vice versa) instead of only the plotted value. The value that
   *  IS on the axis belongs on the axis itself (see the XAxis tickFormatter
   *  below), not repeated on every single point. */
  const richPointLabel = (curveId: string, mode: 'paceVsLactate' | 'hrVsLactate') =>
    (props: any) => {
      const { x, y, value, payload } = props
      if (value == null) return <></>
      const hr = payload?.[`${curveId}__hr`]
      const paceStr = payload?.[`${curveId}__pace`]
      const extra = mode === 'paceVsLactate'
        ? (hr != null ? `♥${hr}` : '')
        : (paceStr || '')
      return (
        <text x={x} y={y - 8} fontSize={9} textAnchor="middle" fill="#6b7280">
          {value}{extra ? ` · ${extra}` : ''}
        </text>
      )
    }

  return (
    <div className="space-y-3 min-w-0">
      {!hideChart && (
      <div className="space-y-1 min-w-0">
        <p className="text-[10px] font-semibold text-muted-foreground text-center" dir="rtl">{AXIS_CAPTION[axisMode]}</p>
        <div className="w-full min-w-0 overflow-hidden" style={{ height: size === 'compact' ? 300 : 360 }} dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart key={axisMode} data={axisMode !== 'dual' ? sharedRows : undefined} margin={{ top: 16, right: 24, left: 24, bottom: 28 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
            {axisMode === 'paceVsLactate' && (
              <>
                <XAxis dataKey="xVal" type="number" domain={paceDomain ?? ['dataMin - 5', 'dataMax + 5']} allowDataOverflow
                  tickCount={6} height={26} tick={paceTick} />
                <YAxis type="number" width={30} tick={lactateTick} />
              </>
            )}
            {axisMode === 'hrVsLactate' && (
              <>
                <XAxis dataKey="xVal" type="number" domain={hrDomain ?? ['dataMin - 5', 'dataMax + 5']} allowDataOverflow
                  tickCount={6} height={26} tick={hrTick} />
                <YAxis type="number" width={30} tick={lactateTick} />
              </>
            )}
            {axisMode === 'dual' && (
              <>
                <XAxis dataKey="label" type="category" allowDuplicatedCategory={false} height={26} tick={categoryTick} />
                <YAxis yAxisId="lac" type="number" width={35} tick={lactateTick}
                  label={{ value: 'mmol/L', angle: -90, position: 'insideLeft', fontSize: 11, fill: '#9ca3af' }} />
                <YAxis yAxisId="hr" type="number" orientation="right" width={35} tick={hrTick} />
              </>
            )}
            {/* Constant lactate reference lines — where 2.0/4.0/4.5 mmol
                actually sit on the Y-axis, regardless of any curve. */}
            {axisMode !== 'dual' && [LT1_TARGET, LT2_TARGET, LT3_TARGET].map(v => (
              <ReferenceLine key={v} y={v} stroke="#c7c7c7" strokeDasharray="4 4"
                label={{ value: v.toFixed(1), position: 'insideRight', fontSize: 9, fill: '#9ca3af' }} />
            ))}
            <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #f0f0f0', borderRadius: '12px' }}
              labelFormatter={(v: any) => axisMode === 'paceVsLactate' ? secToPace(-v) : String(v)} />
            <Legend wrapperStyle={{ fontSize: 11 }} />
            {axisMode !== 'dual' && usable.map(c => (
              <Line key={c.id}
                name={c.label}
                dataKey={c.id} stroke={c.color} strokeWidth={2} dot={{ r: 3 }} connectNulls
                label={richPointLabel(c.id, axisMode)} />
            ))}
            {/* Dashed projection — extends a workout curve's own (narrow)
                measured segment outward using the baseline test's local
                slope, so you can see WHERE an estimated T1/T2/T3 comes
                from instead of only reading three numbers. Only drawn when
                a real baseline curve is also present on this chart. */}
            {axisMode !== 'dual' && baselineCurve && usable
              .filter(c => c.sourceType === 'workout')
              .map(c => (
                <Line key={`${c.id}-trend`}
                  name={`${c.label} · הערכה (המשך מהאימון)`}
                  dataKey={`${c.id}-trend`} stroke={c.color} strokeWidth={3}
                  strokeDasharray="8 5" dot={{ r: 2, strokeWidth: 1 }} connectNulls isAnimationActive={false} />
              ))}
            {axisMode === 'dual' && usable.flatMap(c => ([
              <Line key={`${c.id}-lac`} yAxisId="lac" name={`${c.label} · לקטט`} data={dualAxisData(c.points)}
                dataKey="lactate" stroke={c.color} strokeWidth={2} dot={{ r: 3 }} connectNulls
                label={pointLabel('lactate')} />,
              <Line key={`${c.id}-hr`} yAxisId="hr" name={`${c.label} · דופק`} data={dualAxisData(c.points)}
                dataKey="hr" stroke={c.color} strokeWidth={2} strokeDasharray="4 3" dot={{ r: 3 }} connectNulls
                label={pointLabel('hr')} />,
            ]))}
            {/* T1/T2/T3 marked directly on the chart — only meaningful on the
                pace/HR-vs-lactate axes, where a threshold has a real x
                position. Workout curves fall back to the projected
                (dashed-trend) value when their own data can't reach a
                level, drawn hollow/dashed to mark it as an estimate. */}
            {axisMode !== 'dual' && usable.flatMap(c => {
              const direct = curveThresholds(c.points)
              const t = c.sourceType === 'workout' ? curveThresholdsWithBaseline(c.points, baselineCurve?.points ?? null) : direct
              return T_LEVELS.map(({ key, target, name }) => {
                const point = t[key]
                if (!point) return null
                const x = axisMode === 'paceVsLactate' ? -point.paceSecPerKm : point.hr
                if (x == null) return null
                const isEstimate = !direct[key]
                return (
                  <ReferenceDot key={`${c.id}-${key}`} x={x} y={target} r={5}
                    fill="#fff" stroke={c.color} strokeWidth={2}
                    strokeDasharray={isEstimate ? '3 2' : undefined}
                    label={{ value: isEstimate ? `${name}?` : name, position: 'top', fontSize: 10, fill: c.color, fontWeight: 700 }} />
                )
              })
            })}
          </LineChart>
        </ResponsiveContainer>
        </div>
        {axisRangeLabels && (
          <div className="flex items-center justify-between px-2" dir="ltr">
            <span className="text-[11px] font-bold text-navy">{axisRangeLabels.left}</span>
            <span className="text-[10px] text-muted-foreground">{axisRangeLabels.mid}</span>
            <span className="text-[11px] font-bold text-navy">{axisRangeLabels.right}</span>
          </div>
        )}
      </div>
      )}

      {!hideTable && (
      <>
      {/* T1/T2/T3 summary — switchable between pace+HR, pace only, or HR only */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">ספים (T1/T2/T3)</p>
        <div className="flex gap-1 bg-muted rounded-xl p-0.5">
          {([
            ['both', 'קצב + דופק'],
            ['pace', 'קצב בלבד'],
            ['hr', 'דופק בלבד'],
          ] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMetricDisplay(m)}
              className={cn('text-[10px] px-2 py-1 rounded-lg font-semibold transition-all whitespace-nowrap',
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
        {usable.map((c, i) => {
          const direct = curveThresholds(c.points)
          const { lt1, lt2, lt3 } = c.sourceType === 'workout' ? curveThresholdsWithBaseline(c.points, baselineCurve?.points ?? null) : direct
          const prevC = usable[i - 1]
          const prev = prevC && prevC.sourceType === 'workout' && c.sourceType === 'workout' ? curveThresholds(prevC.points) : null
          const cell = (t: { paceSecPerKm: number; hr: number | null } | null, prevT: { paceSecPerKm: number; hr: number | null } | null, isEstimate?: boolean) => {
            if (!t) return <span className="text-muted-foreground">—</span>
            const trend = metricDisplay !== 'hr' && prevT ? paceDelta(t.paceSecPerKm, prevT.paceSecPerKm) : null
            const trendChip = trend && (
              <span className={cn('text-[9px] font-bold', trend.improved ? 'text-green-600' : 'text-red-500')}>
                {trend.improved ? '▲' : '▼'}{trend.label}
              </span>
            )
            const estimateMark = isEstimate && <span className="text-[9px] text-muted-foreground">≈</span>
            if (metricDisplay === 'pace') return (
              <span dir="ltr" className="font-mono inline-flex items-center gap-1 justify-center flex-wrap">
                {secToPace(t.paceSecPerKm)}{estimateMark}{trendChip}
              </span>
            )
            if (metricDisplay === 'hr') return <span dir="ltr" className="font-mono">{t.hr ? `♥${t.hr}` : '—'}{estimateMark}</span>
            return (
              <span dir="ltr" className="font-mono inline-flex items-center gap-1 justify-center flex-wrap">
                {secToPace(t.paceSecPerKm)}{t.hr ? ` · ♥${t.hr}` : ''}{estimateMark}{trendChip}
              </span>
            )
          }
          return (
            <div key={c.id} className="grid grid-cols-4 gap-1 items-center px-2 py-1.5 border-t border-border/40 text-[11px] text-center text-navy">
              <span className="font-semibold flex items-center justify-center gap-1" style={{ color: c.color }}>
                {c.label}
              </span>
              {cell(lt1, prev?.lt1 ?? null, !direct.lt1)}
              {cell(lt2, prev?.lt2 ?? null, !direct.lt2)}
              {cell(lt3, prev?.lt3 ?? null, !direct.lt3)}
            </div>
          )
        })}
      </div>

      {/* Per-curve data-point table — every plotted point, expandable per curve */}
      <div className="space-y-1.5">
        {usable.map(c => (
          <div key={c.id} className="rounded-xl border border-border overflow-hidden">
            <button onClick={() => setExpandedCurve(p => p === c.id ? null : c.id)}
              className="w-full px-3 py-2 flex items-center justify-between hover:bg-muted/20">
              <span className="text-xs font-bold flex items-center gap-1.5" style={{ color: c.color }}>
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: c.color }} />
                {c.label}
                <span className="text-[10px] text-muted-foreground font-normal">({c.points.length} נק')</span>
              </span>
              <ChevronDown className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform', expandedCurve === c.id && 'rotate-180')} />
            </button>
            {expandedCurve === c.id && (() => {
              const s = summarizeCurve(c.points)
              return (
                <div className="border-t border-border/40">
                  {(s.lactate || s.hr || s.paceSec) && (
                    <div className="grid grid-cols-4 gap-px bg-border text-[10px] text-center overflow-x-auto">
                      <div className="bg-navy/5 font-bold text-navy px-1.5 py-1">סטטיסטיקה</div>
                      <div className="bg-navy/5 font-bold text-navy px-1.5 py-1">מינימום</div>
                      <div className="bg-navy/5 font-bold text-navy px-1.5 py-1">ממוצע</div>
                      <div className="bg-navy/5 font-bold text-navy px-1.5 py-1">מקסימום</div>
                      {/* Pace is seconds/km, so numeric min = fastest — shown
                          under מקסימום (max effort) here, and numeric max =
                          slowest under מינימום (min effort), so this row
                          reads consistently with HR/lactate below it (low =
                          least effort, high = most effort) instead of by
                          raw magnitude. */}
                      <div className="bg-white px-1.5 py-1 text-navy">קצב</div>
                      <div className="bg-white px-1.5 py-1 font-mono text-navy" dir="ltr">{s.paceSec ? secToPace(s.paceSec.max) : '—'}</div>
                      <div className="bg-white px-1.5 py-1 font-mono text-navy" dir="ltr">{s.paceSec ? secToPace(s.paceSec.avg) : '—'}</div>
                      <div className="bg-white px-1.5 py-1 font-mono text-navy" dir="ltr">{s.paceSec ? secToPace(s.paceSec.min) : '—'}</div>
                      <div className="bg-white px-1.5 py-1 text-navy">דופק</div>
                      <div className="bg-white px-1.5 py-1 font-mono text-navy">{s.hr?.min ?? '—'}</div>
                      <div className="bg-white px-1.5 py-1 font-mono text-navy">{s.hr ? Math.round(s.hr.avg) : '—'}</div>
                      <div className="bg-white px-1.5 py-1 font-mono text-navy">{s.hr?.max ?? '—'}</div>
                      <div className="bg-white px-1.5 py-1 text-navy">לקטט</div>
                      <div className="bg-white px-1.5 py-1 font-mono font-bold text-navy">{s.lactate?.min ?? '—'}</div>
                      <div className="bg-white px-1.5 py-1 font-mono font-bold text-navy">{s.lactate?.avg ?? '—'}</div>
                      <div className="bg-white px-1.5 py-1 font-mono font-bold text-navy">{s.lactate?.max ?? '—'}</div>
                    </div>
                  )}
                  <div className="grid grid-cols-3 gap-px bg-border text-[10px] font-bold text-navy text-center mt-1.5">
                    <div className="bg-navy/5 px-1.5 py-1">קצב</div><div className="bg-navy/5 px-1.5 py-1">דופק</div><div className="bg-navy/5 px-1.5 py-1">לקטט</div>
                  </div>
                  <div className="grid grid-cols-3 gap-px bg-border text-[11px] text-center text-navy">
                    {c.points.map((p, i) => (
                      <Fragment key={i}>
                        <div className={cn('px-1.5 py-1 font-mono', i % 2 ? 'bg-navy/[0.03]' : 'bg-white')} dir="ltr">{p.pace || '—'}</div>
                        <div className={cn('px-1.5 py-1', i % 2 ? 'bg-navy/[0.03]' : 'bg-white')}>{p.hr ?? '—'}</div>
                        <div className={cn('px-1.5 py-1 font-bold', i % 2 ? 'bg-navy/[0.03]' : 'bg-white')}>{p.lactate || '—'}</div>
                      </Fragment>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>
        ))}
      </div>
      </>
      )}
    </div>
  )
}
