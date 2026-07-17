'use client'

/**
 * components/coach/workout-comparison-gallery.tsx
 *
 * The Lab's "workout trends" view: every comparisonGroup the coach has
 * tagged (any workout type — e.g. "Fartlek A") gets its own collapsible
 * card showing pace/HR over calendar time across every logged session,
 * plus a session table. Independent of LactateWorkoutGallery, which is
 * lactate-specific (threshold workouts only) — this covers any workout
 * type and needs no lactate data at all.
 *
 * Groups are bucketed into one folder per workout `type` (mirroring
 * lactate-workout-gallery.tsx's FOLDER_ORDER/FOLDER_LABEL pattern), and
 * each group's card leads with a type-appropriate latest-session summary:
 * interval-type → avg rep pace / reps / rest / rep HR; fartlek → pace /
 * HR / distance; long run → distance (the headline) / pace / HR; anything
 * else keeps the generic session table only.
 */

import { useState } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { format } from 'date-fns'
import { secToPace } from '@/lib/physiology'
import {
  useWorkoutComparisonGroups, buildComparisonPoints, summaryKindForGroup,
  type ComparisonPoint, type ComparisonSummaryKind,
} from '@/hooks/useWorkoutComparisonGroups'
import { WorkoutComparisonChart } from '@/components/coach/workout-comparison-chart'
import { useLanguage } from '@/contexts/language-context'

// One folder per workout `type` (the same field the coach picks in the
// workout builder — lib/types.ts WorkoutType) — most-structured first, only
// the types actually present rendered. Same approach as
// lactate-workout-gallery.tsx's FOLDER_ORDER, extended to the full
// WorkoutType union this gallery can see (it isn't threshold-only).
const FOLDER_ORDER = ['intervals', 'hill_repeats', 'threshold', 'time_trial', 'fartlek', 'long_run', 'tempo', 'easy', 'recovery', 'race', 'other'] as const
type FolderKey = typeof FOLDER_ORDER[number]
const FOLDER_LABEL: Record<FolderKey, (t: any) => string> = {
  intervals: t => t.labFolderInterval,
  hill_repeats: t => t.labFolderHillRepeats,
  threshold: t => t.labFolderThreshold,
  time_trial: t => t.labFolderTimeTrial,
  fartlek: t => t.labFolderFartlek,
  long_run: t => t.labFolderLongRun,
  tempo: t => t.labFolderTempo,
  easy: t => t.labFolderEasy,
  recovery: t => t.labFolderRecovery,
  race: t => t.labFolderRace,
  other: t => t.labFolderOther,
}

/** A group's folder — its workout type normalized onto FOLDER_ORDER
 *  (legacy 'interval'/'repetition' values old docs may carry → intervals,
 *  anything unknown → other). */
function folderKeyFor(type?: string): FolderKey {
  if (!type) return 'other'
  if (type === 'interval' || type === 'repetition') return 'intervals'
  return (FOLDER_ORDER as readonly string[]).includes(type) ? type as FolderKey : 'other'
}

// One stable accent color per distinct group inside a type-folder — the
// same idea as lactate-workout-gallery.tsx's WORKOUT_COLORS, but in the
// brighter variants that stay readable on the dark navy card these folders
// now sit on.
const WORKOUT_COLORS = ['#4caf8a', '#e8826b', '#6b8fb5', '#c9a84c', '#8a6bb5', '#d4708a', '#5c9ab5', '#c97a4c']

const darkStatTile = 'rounded-xl bg-white/10 px-2 py-1.5 text-center'

/** The latest session's rest, formatted for display: prefers the ACTUAL
 *  logged rest (avg of splitLogs[].rest — Strava rest laps / manual entry),
 *  falling back to the prescribed restLabel marked as planned. */
function restStat(p: ComparisonPoint): { value: string; planned: boolean } | null {
  if (p.avgRestSec != null) return { value: secToPace(p.avgRestSec), planned: false }
  if (p.restLabel) return { value: p.restLabel, planned: true }
  return null
}

/** One row's displayed rest in the interval table — same actual-first
 *  preference as the stat tile. */
function restCell(p: ComparisonPoint): string | null {
  if (p.avgRestSec != null) return secToPace(p.avgRestSec)
  return p.restLabel ?? null
}

export function WorkoutComparisonGallery({ athleteId }: { athleteId: string }) {
  const { t, isRTL } = useLanguage()
  const { loading, grouped, groupOptions } = useWorkoutComparisonGroups(athleteId)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [openFolder, setOpenFolder] = useState<string | null>(null)

  if (loading) return (
    <div className="flex items-center justify-center py-6">
      <Loader2 className="h-6 w-6 animate-spin text-gold" />
    </div>
  )

  if (groupOptions.length === 0) return (
    <div className="rounded-2xl border border-dashed border-border p-4 text-center" dir={isRTL ? 'rtl' : 'ltr'}>
      <p className="text-sm font-semibold text-navy">{t.labNoTrendGroups}</p>
      <p className="text-xs text-muted-foreground mt-1">{t.labNoTrendGroupsHint}</p>
    </div>
  )

  // Bucket groups into folders by workout type — same shape as the lactate
  // gallery's folders so the two sections scan identically.
  type GroupCard = { id: string; name: string; count: number; color: string }
  const folders = new Map<FolderKey, GroupCard[]>()
  groupOptions.forEach(opt => {
    const key = folderKeyFor(opt.type)
    if (!folders.has(key)) folders.set(key, [])
    const list = folders.get(key)!
    list.push({ id: opt.id, name: opt.name, count: opt.count, color: WORKOUT_COLORS[list.length % WORKOUT_COLORS.length] })
  })
  const orderedFolders = FOLDER_ORDER
    .filter(key => folders.has(key))
    .map(key => ({ key, label: FOLDER_LABEL[key](t), cards: folders.get(key)! }))

  return (
    <div className="space-y-2" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h3 className="text-sm font-bold text-navy">{t.labWorkoutTrends}</h3>
        <p className="text-xs text-muted-foreground">{t.labWorkoutTrendsHint}</p>
      </div>

      <div className="space-y-2">
        {orderedFolders.map(folder => (
          <div key={folder.key} className="rounded-2xl bg-gradient-to-br from-[#0a1628] to-[#0a1628]/85 overflow-hidden">
            <button onClick={() => setOpenFolder(p => p === folder.key ? null : folder.key)}
              className="w-full px-3 py-2.5 flex items-center justify-between bg-white/5 hover:bg-white/10">
              <span className="text-xs font-bold text-white flex items-center gap-1.5">
                📁 {folder.label}
                <span className="text-[10px] font-normal text-white/50">({folder.cards.length})</span>
              </span>
              <ChevronDown className={cn('h-4 w-4 text-white/50 transition-transform', openFolder === folder.key && 'rotate-180')} />
            </button>
            {openFolder === folder.key && (
              <div className="p-2 space-y-2">
                {folder.cards.map(card => renderGroupCard(card))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )

  function renderGroupCard(card: { id: string; name: string; count: number; color: string }) {
    const group = grouped.get(card.id)!
    const points = buildComparisonPoints(group)
    const kind = summaryKindForGroup(group)
    const latest = points[points.length - 1]
    const isOpen = expandedId === card.id
    return (
      <div key={card.id} className="rounded-2xl border border-white/10 bg-white/5 overflow-hidden min-w-0">
        <button onClick={() => setExpandedId(p => p === card.id ? null : card.id)}
          className="w-full text-right px-3 py-3 hover:bg-white/5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: card.color }} />
              <span className="text-xs font-bold text-white whitespace-nowrap">{card.name}</span>
              <span className="text-[9px] font-medium text-white/50 whitespace-nowrap">
                {card.count} {t.labSessionsCount}
              </span>
            </div>
            <ChevronDown className={cn('h-4 w-4 text-white/50 flex-shrink-0 transition-transform', isOpen && 'rotate-180')} />
          </div>
          {latest && renderStatTiles(kind, latest)}
        </button>

        {isOpen && (
          <div className="px-3 pb-3 space-y-3">
            {/* The recharts trend chart keeps its light-theme colors — it
                sits on its own white tile inside the dark card. */}
            <div className="rounded-xl bg-white p-2">
              <WorkoutComparisonChart points={points} />
            </div>
            {renderSessionList(kind, points, card.color)}
          </div>
        )}
      </div>
    )
  }

  /** Latest-session headline tiles — the type-appropriate summary, shown
   *  even collapsed (mirrors the lactate gallery's always-visible T1/T2/T3
   *  row). Generic types get none — their table already says it all. */
  function renderStatTiles(kind: ComparisonSummaryKind, latest: ComparisonPoint) {
    if (kind === 'generic') return null
    const caption = (
      <p className="text-[9px] text-white/40 mt-2 mb-1">
        {t.labLatestSession} · {format(new Date(latest.date), 'd/M/yy')}
      </p>
    )
    if (kind === 'intervals') {
      const rest = restStat(latest)
      // Rep-level values when the session logged reps, else the session's
      // overall pace/HR so an unrepped log still shows something.
      const repPace = latest.avgRepPace ?? latest.pace
      const repHr = latest.avgRepHr ?? latest.hr
      return (
        <>
          {caption}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
            <div className={darkStatTile}>
              <p className="text-[9px] text-white/50">{t.labStatAvgRepPace}</p>
              <p className="text-sm font-black text-[#c9a84c]" dir="ltr">{repPace ?? '—'}</p>
            </div>
            <div className={darkStatTile}>
              <p className="text-[9px] text-white/50">{t.labStatRepCount}</p>
              <p className="text-sm font-black text-white">{latest.repCount ?? '—'}</p>
            </div>
            <div className={darkStatTile}>
              <p className="text-[9px] text-white/50">
                {t.labStatRest}{rest?.planned ? ` (${t.labRestPlanned})` : ''}
              </p>
              <p className="text-sm font-black text-white" dir="ltr">{rest?.value ?? '—'}</p>
            </div>
            <div className={darkStatTile}>
              <p className="text-[9px] text-white/50">{t.labStatAvgRepHr}</p>
              <p className="text-sm font-black text-white">{repHr ?? '—'}</p>
            </div>
          </div>
        </>
      )
    }
    // fartlek / long_run: pace, HR, distance — for a long run, distance IS
    // the story (volume), so it leads and gets the big gold number.
    const distanceTile = (big: boolean) => (
      <div className={darkStatTile} key="dist">
        <p className="text-[9px] text-white/50">{t.labStatDistance}</p>
        <p className={cn('font-black', big ? 'text-xl text-[#c9a84c]' : 'text-sm text-white')} dir="ltr">
          {latest.distance != null ? `${latest.distance}` : '—'}
          <span className="text-[9px] font-semibold text-white/50"> {isRTL ? 'ק"מ' : 'km'}</span>
        </p>
      </div>
    )
    const paceTile = (
      <div className={darkStatTile} key="pace">
        <p className="text-[9px] text-white/50">{t.labStatAvgPace}</p>
        <p className={cn('font-black text-sm', kind === 'fartlek' ? 'text-[#c9a84c]' : 'text-white')} dir="ltr">{latest.pace ?? '—'}</p>
      </div>
    )
    const hrTile = (
      <div className={darkStatTile} key="hr">
        <p className="text-[9px] text-white/50">{t.labStatAvgHr}</p>
        <p className="text-sm font-black text-white">{latest.hr ?? '—'}</p>
      </div>
    )
    return (
      <>
        {caption}
        <div className="grid grid-cols-3 gap-1.5">
          {kind === 'long_run'
            ? [distanceTile(true), paceTile, hrTile]
            : [paceTile, hrTile, distanceTile(false)]}
        </div>
      </>
    )
  }

  /** Per-session cards instead of a cramped multi-column table — each
   *  session is its own rounded box (colored top accent = the group's own
   *  color) with labeled stat chips laid out in a mobile-friendly grid,
   *  so a coach scanning on a phone can read one session at a glance
   *  instead of scrolling a 6-column table sideways. */
  function renderSessionList(kind: ComparisonSummaryKind, points: ComparisonPoint[], groupColor: string) {
    const stat = (label: string, value: string | number | null | undefined, opts?: { color?: string; ltr?: boolean; changed?: boolean }) => (
      <div className="rounded-lg bg-white/[0.06] px-2 py-1.5 min-w-0">
        <p className="text-[8.5px] text-white/45 truncate">{label}</p>
        <p className={cn('text-[12px] font-bold truncate', opts?.color ?? 'text-white', opts?.changed && 'underline decoration-2 underline-offset-2')} dir={opts?.ltr ? 'ltr' : undefined}>
          {value ?? '—'}
        </p>
      </div>
    )
    const effortColor = (e?: number | string | null) => {
      const n = typeof e === 'number' ? e : parseFloat(String(e ?? ''))
      if (!Number.isFinite(n)) return 'text-white/60'
      if (n >= 8) return 'text-rose-300'
      if (n >= 6) return 'text-amber-300'
      return 'text-emerald-300'
    }
    const hrColor = (hr?: number | null) => hr == null ? 'text-white' : hr > 160 ? 'text-rose-300' : hr > 140 ? 'text-amber-300' : 'text-white'

    return (
      <div className="space-y-1.5">
        {[...points].reverse().map((p, ri) => {
          const i = points.length - 1 - ri
          const isLatest = i === points.length - 1
          if (kind === 'intervals') {
            const rest = restCell(p)
            const prevRest = i > 0 ? restCell(points[i - 1]) : undefined
            const restChanged = prevRest !== undefined && rest !== prevRest
            return (
              <div key={p.logId} className="rounded-xl bg-white/[0.04] border-t-2 overflow-hidden" style={{ borderColor: groupColor }}>
                <div className="px-2.5 pt-2 flex items-center justify-between">
                  <span className="text-[11px] font-bold text-white">{format(new Date(p.date), 'd/M/yy')}</span>
                  {isLatest && <span className="text-[8.5px] font-bold text-[#c9a84c]">{t.labLatestSession}</span>}
                </div>
                <div className="p-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                  {stat(t.labStatAvgRepPace, p.avgRepPace ?? p.pace, { color: 'text-[#c9a84c]', ltr: true })}
                  {stat(t.labStatRepCount, p.repCount)}
                  {stat(t.labTrendTableRest, rest, { ltr: true, changed: restChanged })}
                  {stat(t.labTrendTableHr, p.avgRepHr ?? p.hr, { color: hrColor(p.avgRepHr ?? p.hr) })}
                </div>
                {p.effort != null && (
                  <div className="px-2.5 pb-2">
                    <span className={cn('text-[9px] font-bold', effortColor(p.effort))}>{t.labTrendTableEffort}: {p.effort}</span>
                  </div>
                )}
              </div>
            )
          }
          // fartlek / long_run / generic
          const hasRest = kind === 'generic' && p.restLabel != null
          const prevRest = i > 0 ? points[i - 1].restLabel : undefined
          const restChanged = hasRest && prevRest !== undefined && p.restLabel !== prevRest
          return (
            <div key={p.logId} className="rounded-xl bg-white/[0.04] border-t-2 overflow-hidden" style={{ borderColor: groupColor }}>
              <div className="px-2.5 pt-2 flex items-center justify-between">
                <span className="text-[11px] font-bold text-white">{format(new Date(p.date), 'd/M/yy')}</span>
                {isLatest && <span className="text-[8.5px] font-bold text-[#c9a84c]">{t.labLatestSession}</span>}
              </div>
              <div className="p-2 grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                {stat(t.labTrendTableDistance, p.distance != null ? `${p.distance} ${isRTL ? 'ק"מ' : 'km'}` : null, { color: 'text-[#c9a84c]' })}
                {stat(t.labTrendTablePace, p.pace, { ltr: true })}
                {stat(t.labTrendTableHr, p.hr, { color: hrColor(p.hr) })}
                {hasRest
                  ? stat(t.labTrendTableRest, p.restLabel, { changed: restChanged })
                  : stat(t.labTrendTableDuration, p.durationMin != null ? `${p.durationMin} ${t.labTrendTableMin}` : null)}
              </div>
              {p.effort != null && (
                <div className="px-2.5 pb-2">
                  <span className={cn('text-[9px] font-bold', effortColor(p.effort))}>{t.labTrendTableEffort}: {p.effort}</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }
}
