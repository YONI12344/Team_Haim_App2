'use client'

/**
 * components/coach/workout-comparison-chart.tsx
 *
 * Plots one comparisonGroup's sessions (any workout type — a fartlek, an
 * easy run, anything the coach tagged with the same group name) over
 * calendar time: pace and HR, one point per logged session, oldest to
 * newest. Unlike lactate-multi-curve-chart.tsx this has nothing to do with
 * lactate or a step test — X axis is the session date, not lactate mmol/L.
 */

import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import { format } from 'date-fns'
import { secToPace } from '@/lib/physiology'
import { useLanguage } from '@/contexts/language-context'
import type { ComparisonPoint } from '@/hooks/useWorkoutComparisonGroups'

interface Props {
  points: ComparisonPoint[]
}

/** paceSec negated so a plain ascending Y-axis reads slow-bottom/fast-top,
 *  matching the same convention used in the lactate chart. */
function toRow(p: ComparisonPoint) {
  return {
    x: p.date,
    label: format(new Date(p.date), 'd/M/yy'),
    paceNeg: p.paceSec != null ? -p.paceSec : null,
    hr: p.hr,
  }
}

export function WorkoutComparisonChart({ points }: Props) {
  const { t } = useLanguage()
  const rows = points.map(toRow)
  const hasPace = rows.some(r => r.paceNeg != null)
  const hasHr = rows.some(r => r.hr != null)

  return (
    <div className="space-y-4">
      {hasPace && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground mb-1">{t.labTrendPaceChart}</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis
                domain={['dataMin', 'dataMax']}
                tickFormatter={(v: number) => secToPace(-v)}
                tick={{ fontSize: 10 }}
                width={44}
              />
              <Tooltip formatter={(v: any) => secToPace(-v)} labelFormatter={(l) => l} />
              <Line type="monotone" dataKey="paceNeg" stroke="#c9a84c" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {hasHr && (
        <div>
          <p className="text-[11px] font-semibold text-muted-foreground mb-1">{t.labTrendHrChart}</p>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
              <YAxis domain={['dataMin - 5', 'dataMax + 5']} tick={{ fontSize: 10 }} width={36} />
              <Tooltip />
              <Line type="monotone" dataKey="hr" stroke="#6b8fb5" strokeWidth={2} dot={{ r: 3 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}
