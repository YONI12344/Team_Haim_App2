'use client'

import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'
import { expectedRepMetersForWorkout, resolveSessionRepRows } from '@/lib/strava-lap-matching'

/**
 * The one rep/lap splits table used everywhere a workout's per-rep data is
 * shown — the Strava box (StravaCard/ConsolidatedStravaCard in
 * athlete-planner-view.tsx) and a manually-logged workout's saved splits
 * (ManualLogCard) both render through this, so the two never look like two
 * different features again.
 *
 * splitLogs can arrive in either of two shapes:
 * 1. Raw per-lap Strava data (`{distanceKm, time, heartRate, pace,
 *    paceZone, notes}` per device lap) — a treadmill has no GPS at all
 *    (distance-per-lap is just an accelerometer estimate) and a track's
 *    short reps are exactly where GPS distance is noisiest, so when
 *    `matchedWorkout` has a known rep structure, laps are first re-grouped
 *    by buildRepDisplayRows (combines auto-laps into whole reps, computes
 *    pace from elapsed time ÷ the workout's own planned distance instead
 *    of the device's noisy one, and keeps every rest/recovery lap as its
 *    own row instead of dropping it).
 * 2. Already rep-shaped data (`{repIndex, distance, time, pace, avgHr,
 *    rest}` per rep) — what workout-log-form.tsx saves once a session's
 *    reps have been reviewed/edited. Told apart by having `pace` set but
 *    no `distanceKm` (every raw Strava lap always carries `distanceKm`),
 *    and rendered directly — there's nothing left to re-group, and it
 *    doesn't need `matchedWorkout` at all to know that.
 *
 * A continuous run with no rep structure and no already-computed reps just
 * shows the raw per-lap/per-km splits as-is.
 */
export function SplitsTable({
  splitLogs, matchedWorkout, referencePace,
}: {
  splitLogs: any[]
  matchedWorkout?: { sets?: any[] } | null
  referencePace?: string | null
}) {
  const { t } = useLanguage()
  const expectedMeters = expectedRepMetersForWorkout(matchedWorkout)
  // Raw Strava lap data always carries a numeric distanceKm (see
  // app/api/strava/sync/route.ts) — already-rep-shaped data (this backfill,
  // or workout-log-form.tsx's saved reps) never does, regardless of
  // whether every field on it happens to be filled in yet.
  const isRepShaped = splitLogs.length > 0 && splitLogs[0].distanceKm == null
  const hasRepStructure = expectedMeters.length > 0

  type Row = { label: string; time: string; pace: string; heartRate: number | string | null; targetLabel: string; isRest: boolean }
  let rows: Row[]
  if (isRepShaped || hasRepStructure) {
    // resolveSessionRepRows is the single shared implementation of
    // "detect raw-vs-rep-shaped, regroup via buildRepDisplayRows if
    // needed" — also used by useWorkoutComparisonGroups so the Lab's
    // per-type session summaries are computed from exactly the same
    // corrected rep data this table displays, instead of a second,
    // independent (and previously wrong) implementation.
    rows = []
    resolveSessionRepRows(splitLogs, matchedWorkout).forEach((r, i) => {
      rows.push({ label: String(i + 1), time: r.time, pace: r.pace, heartRate: r.heartRate, targetLabel: r.distanceLabel || '—', isRest: false })
      if (r.rest) rows.push({ label: t.restLapLabel, time: r.rest, pace: '', heartRate: null, targetLabel: '—', isRest: true })
    })
  } else {
    // Continuous run, raw per-km Strava splits — shows each split's pace
    // zone (Strava's own effort classification) rather than a target
    // distance, since there's no planned rep structure to compare against.
    rows = splitLogs.map((s: any, i: number) => ({
      label: String(i + 1),
      time: s.time,
      pace: s.pace || '',
      heartRate: s.heartRate || null,
      targetLabel: (s.paceZone || s.notes?.replace('Zone ', '')) ? `Z${s.paceZone || s.notes?.replace('Zone ', '')}` : '—',
      isRest: false,
    }))
  }

  const showRepHeader = isRepShaped || hasRepStructure

  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <table className="w-full table-fixed text-[10px]" dir="ltr">
        <colgroup>
          <col style={{ width: '14%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '18%' }} />
        </colgroup>
        <thead>
          <tr className="bg-[#0a1628]/5">
            <th className="py-1.5 text-center font-bold text-[#0a1628] whitespace-nowrap">{showRepHeader ? '#' : 'km'}</th>
            <th className="py-1.5 text-center font-bold text-[#0a1628] whitespace-nowrap">{t.timeInputLabel}</th>
            <th className="py-1.5 text-center font-bold text-[#0a1628] whitespace-nowrap">{t.tempoLabel}</th>
            <th className="py-1.5 text-center font-bold text-[#0a1628] whitespace-nowrap">{t.heartRateLabel}</th>
            <th className="py-1.5 text-center font-bold text-[#0a1628] whitespace-nowrap">{showRepHeader ? t.targetDistanceLabel : 'Zone'}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const pace = row.pace?.replace('/km', '') || '—'
            const hr = row.heartRate ?? '—'
            const isfast = !row.isRest && row.pace && parseFloat(row.pace) < parseFloat(referencePace || '99')
            return (
              <tr key={i} className={cn('border-t border-border/40', row.isRest ? 'bg-gray-50' : i % 2 === 0 ? 'bg-white' : 'bg-muted/20')}>
                <td className={cn('py-2 text-center font-bold truncate px-0.5', row.isRest ? 'text-gray-400 text-[9px]' : 'text-[#0a1628]')}>{row.label}</td>
                <td className={cn('py-2 text-center font-mono', row.isRest && 'text-gray-400')}>{row.time}</td>
                <td className={cn('py-2 text-center font-mono font-semibold', row.isRest ? 'text-gray-300' : isfast ? 'text-emerald-600' : 'text-[#0a1628]')}>{row.isRest ? '—' : pace}</td>
                <td className={cn('py-2 text-center font-mono', row.isRest ? 'text-gray-400' : typeof hr === 'number' && hr > 160 ? 'text-red-500' : typeof hr === 'number' && hr > 140 ? 'text-orange-500' : 'text-[#0a1628]')}>{hr}</td>
                <td className={cn('py-2 text-center font-bold', row.isRest ? 'text-gray-300' : 'text-emerald-600')}>{row.targetLabel}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
