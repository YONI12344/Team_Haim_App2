'use client'

import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'
import { resolveSessionRepRows } from '@/lib/strava-lap-matching'

/**
 * The one rep/lap splits table used everywhere a workout's per-rep data is
 * shown — the Strava box (StravaCard/ConsolidatedStravaCard in
 * athlete-planner-view.tsx) and a manually-logged workout's saved splits
 * (ManualLogCard) both render through this, so the two never look like two
 * different features again.
 *
 * Always shows every raw Strava lap exactly as recorded — no rep-grouping,
 * rest-detection, or main-set matching, regardless of workout type. That
 * "smart" regrouping used to run here too (via buildRepDisplayRows) but
 * went through several rounds of real bugs and was explicitly, repeatedly
 * asked to be removed from this specific view: "I want the strava box to
 * be untouched by the AI, give all the splits as is." Any workout-specific
 * matching now happens elsewhere, separate from this raw display.
 *
 * The one exception: already rep-shaped data (`{repIndex, distance, time,
 * pace, avgHr, rest}` per rep — what workout-log-form.tsx saves once a
 * session's reps have been reviewed/edited) still renders as reps, since
 * that's literally what was saved and was never raw Strava data to begin
 * with. Told apart by having `pace` set but no `distanceKm` (every raw
 * Strava lap always carries `distanceKm`).
 */
export function SplitsTable({
  splitLogs, matchedWorkout, referencePace,
}: {
  splitLogs: any[]
  matchedWorkout?: { sets?: any[]; type?: string } | null
  referencePace?: string | null
}) {
  const { t } = useLanguage()
  // Raw Strava lap data always carries a numeric distanceKm (see
  // app/api/strava/sync/route.ts) — already-rep-shaped data (this backfill,
  // or workout-log-form.tsx's saved reps) never does, regardless of
  // whether every field on it happens to be filled in yet.
  const isRepShaped = splitLogs.length > 0 && splitLogs[0].distanceKm == null

  type Row = { label: string; time: string; pace: string; heartRate: number | string | null; targetLabel: string; isRest: boolean }
  let rows: Row[]
  // The Strava box always shows every raw lap exactly as recorded — full
  // stop, no rep-grouping/rest-detection/main-set matching, regardless of
  // workout type or structure. That "smart" regrouping (buildRepDisplayRows
  // via resolveSessionRepRows) went through several rounds of real bugs
  // (missing splits, garbage paces, fabricated rest, stale frozen data) and
  // was explicitly, repeatedly asked to be removed from this specific view:
  // "I want the strava box to be untouched by the AI, give all the splits
  // as is." Only genuinely already-rep-shaped data (isRepShaped — the
  // athlete's own saved rep entries from workout-log-form.tsx, which was
  // never raw Strava data to begin with) still renders as reps here, since
  // that's literally what was saved, nothing to decide.
  if (isRepShaped) {
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

  const showRepHeader = isRepShaped

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
