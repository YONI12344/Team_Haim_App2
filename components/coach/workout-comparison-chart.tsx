'use client'

/**
 * components/coach/workout-comparison-chart.tsx
 *
 * Plots one comparisonGroup's sessions (any workout type — a fartlek, an
 * easy run, anything the coach tagged with the same group name) over
 * calendar time: pace and HR, one point per logged session, oldest to
 * newest. Unlike lactate-multi-curve-chart.tsx this has nothing to do with
 * lactate or a step test — X axis is the session date, not lactate mmol/L.
 *
 * Each point is labeled with its actual value directly on the chart (not
 * just the Y axis) since a tight value range (e.g. 3:52-4:03) made recharts'
 * auto-generated axis ticks crowd/overlap and unreadable — and a header
 * delta badge states outright whether the athlete got faster/slower vs
 * their first session, rather than making the coach read it off the line.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList,
} from 'recharts'
import { format } from 'date-fns'
import { secToPace } from '@/lib/physiology'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'
import type { ComparisonPoint, ComparisonSummaryKind } from '@/hooks/useWorkoutComparisonGroups'

interface Props {
  points: ComparisonPoint[]
  /** Interval/threshold sessions must plot the REP pace/HR (avgRepPaceSec/
   *  avgRepHr — the fast running, excluding rest/warmup), not the overall
   *  session average, which for a Strava-sourced activity includes the jog
   *  recoveries and would understate how fast the reps themselves were. */
  kind: ComparisonSummaryKind
}

/** paceSec negated so a plain ascending Y-axis reads slow-bottom/fast-top,
 *  matching the same convention used in the lactate chart. */
function toRow(p: ComparisonPoint, kind: ComparisonSummaryKind) {
  const paceSec = kind === 'intervals' ? (p.avgRepPaceSec ?? p.paceSec) : p.paceSec
  const hr = kind === 'intervals' ? (p.avgRepHr ?? p.hr) : p.hr
  return {
    x: p.date,
    label: format(new Date(p.date), 'd/M'),
    paceNeg: paceSec != null ? -paceSec : null,
    paceLabel: paceSec != null ? secToPace(paceSec) : '',
    hr,
    hrLabel: hr != null ? String(Math.round(hr)) : '',
  }
}

/** Pads a tight numeric range so the top/bottom point labels never sit
 *  flush against the chart edge, and rounds every bound to a whole number
 *  so recharts' auto ticks never show a floating-point artifact (e.g.
 *  "126.55000000000001") the way an unrounded domain did. */
function paddedDomain(values: number[]): [number, number] {
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = Math.max(max - min, 1)
  const pad = Math.max(1, Math.round(span * 0.35))
  return [Math.round(min - pad), Math.round(max + pad)]
}

function DeltaBadge({ first, last, unit, lowerIsBetter, vsFirstLabel }: {
  first: number
  last: number
  unit: 'pace' | 'bpm'
  lowerIsBetter: boolean
  vsFirstLabel: string
}) {
  const delta = last - first
  if (Math.abs(delta) < 1) {
    return <span className="text-[10px] font-semibold text-muted-foreground">— {vsFirstLabel}</span>
  }
  const improved = lowerIsBetter ? delta < 0 : delta > 0
  const magnitude = unit === 'pace' ? `${Math.round(Math.abs(delta))}${' '}${'שנ׳' /* seconds, short */}` : `${Math.round(Math.abs(delta))} bpm`
  return (
    <span className={cn(
      'inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full',
      improved ? 'bg-emerald-500/15 text-emerald-700' : 'bg-rose-500/15 text-rose-700',
    )}>
      {improved ? '▼' : '▲'} {magnitude} <span className="font-medium opacity-70">{vsFirstLabel}</span>
    </span>
  )
}

export function WorkoutComparisonChart({ points, kind }: Props) {
  const { t } = useLanguage()
  const rows = points.map(p => toRow(p, kind))
  const paceVals = rows.map(r => r.paceNeg).filter((v): v is number => v != null)
  const hrVals = rows.map(r => r.hr).filter((v): v is number => v != null)
  const hasPace = paceVals.length > 0
  const hasHr = hrVals.length > 0
  const paceDomain = hasPace ? paddedDomain(paceVals) : undefined
  const hrDomain = hasHr ? paddedDomain(hrVals) : undefined

  return (
    <div className="space-y-4">
      {hasPace && (
        <div>
          <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
            <p className="text-[11px] font-semibold text-muted-foreground">{t.labTrendPaceChart}</p>
            {paceVals.length > 1 && (
              <DeltaBadge first={paceVals[0]} last={paceVals[paceVals.length - 1]} unit="pace" lowerIsBetter={false} vsFirstLabel={t.labTrendVsFirst} />
            )}
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={rows} margin={{ top: 22, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis
                domain={paceDomain}
                tickCount={3}
                allowDecimals={false}
                tickFormatter={(v: number) => secToPace(-v)}
                tick={{ fontSize: 10 }}
                width={44}
              />
              <Tooltip formatter={(v: any) => secToPace(-v)} labelFormatter={(l) => l} />
              <Line type="monotone" dataKey="paceNeg" stroke="#c9a84c" strokeWidth={2.5} dot={{ r: 4, fill: '#c9a84c' }} connectNulls>
                <LabelList dataKey="paceLabel" position="top" style={{ fontSize: 11, fontWeight: 700, fill: '#a8862f' }} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {hasHr && (
        <div>
          <div className="flex items-center justify-between mb-1 flex-wrap gap-1">
            <p className="text-[11px] font-semibold text-muted-foreground">{t.labTrendHrChart}</p>
            {hrVals.length > 1 && (
              <DeltaBadge first={hrVals[0]} last={hrVals[hrVals.length - 1]} unit="bpm" lowerIsBetter={true} vsFirstLabel={t.labTrendVsFirst} />
            )}
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={rows} margin={{ top: 22, right: 16, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis domain={hrDomain} tickCount={3} allowDecimals={false} tick={{ fontSize: 10 }} width={36} />
              <Tooltip />
              <Line type="monotone" dataKey="hr" stroke="#6b8fb5" strokeWidth={2.5} dot={{ r: 4, fill: '#6b8fb5' }} connectNulls>
                <LabelList dataKey="hrLabel" position="top" style={{ fontSize: 11, fontWeight: 700, fill: '#4d6f92' }} />
              </Line>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
