'use client'

import { useMemo } from 'react'
import { format, parseISO } from 'date-fns'
import { he as heLocale } from 'date-fns/locale'
import {
  CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Scatter, Tooltip, XAxis, YAxis,
} from 'recharts'
import { cn } from '@/lib/utils'
import { averagePain, buildRehabSeries, rehabDayNumber } from '@/lib/rehab'
import type { RehabCase, RehabCheckin, RehabSessionLog } from '@/lib/types'
import { PainChip } from './pain-scale'

const INK = '#16223A'
const SKY = '#0E6E7A'
const OCHRE = '#C9962C'
const PINE = '#1E4F3A'

export const FEELINGS = {
  he: ['קשה', 'לא טוב', 'בסדר', 'טוב', 'מצוין'],
  en: ['Rough', 'Not great', 'Okay', 'Good', 'Great'],
}

const COPY = {
  he: {
    day: 'יום',
    sinceInjury: 'מאז הפציעה',
    avgPain: 'כאב ממוצע השבוע',
    vsLast: (v: number | null) => (v == null ? 'אין נתונים משבוע שעבר' : `שבוע שעבר ${v}`),
    sessions: 'אימוני שיקום',
    sessionsSub: (done: number, planned: number) => (planned ? `מתוך ${planned} שתוכננו` : 'הושלמו'),
    lastMorning: 'כאב בוקר אחרון',
    chartTitle: 'הכאב לאורך הדרך',
    morning: 'בוקר',
    evening: 'ערב',
    session: 'הכי כואב באימון',
    okZone: 'אזור 0-2',
    empty: 'עוד אין נתונים. אחרי כמה ימים של מילוי כאב בוקר וערב, הגרף יתחיל להראות את הכיוון.',
    sessionsTitle: 'אימוני שיקום שבוצעו',
    noSessions: 'עוד לא בוצע אימון שיקום.',
    checkinsTitle: 'יומן כאב',
    feeling: 'הרגשה',
    noNotes: '',
  },
  en: {
    day: 'Day',
    sinceInjury: 'since the injury',
    avgPain: 'Average pain this week',
    vsLast: (v: number | null) => (v == null ? 'No data from last week' : `Last week ${v}`),
    sessions: 'Rehab sessions',
    sessionsSub: (done: number, planned: number) => (planned ? `of ${planned} planned` : 'completed'),
    lastMorning: 'Last morning pain',
    chartTitle: 'Pain over time',
    morning: 'Morning',
    evening: 'Evening',
    session: 'Worst in session',
    okZone: '0-2 zone',
    empty: 'No data yet. After a few days of morning and evening check-ins, the chart starts to show the trend.',
    sessionsTitle: 'Completed rehab sessions',
    noSessions: 'No rehab session completed yet.',
    checkinsTitle: 'Pain log',
    feeling: 'Feeling',
    noNotes: '',
  },
}

/**
 * The injury at a glance, shared by the athlete's rehab page and the
 * coach's: where the pain is heading, how many sessions got done, and the
 * day-by-day log behind it.
 */
export function RehabJourney({ rehabCase, checkins, sessions, plannedSessions, language }: {
  rehabCase: RehabCase
  checkins: RehabCheckin[]
  sessions: RehabSessionLog[]
  plannedSessions: number
  language: 'he' | 'en'
}) {
  const L = COPY[language]
  const series = useMemo(() => buildRehabSeries(checkins, sessions), [checkins, sessions])
  const thisWeek = averagePain(checkins, 6, 0)
  const lastWeek = averagePain(checkins, 13, 7)
  const lastMorning = [...checkins].reverse().find((c) => typeof c.morningPain === 'number')?.morningPain ?? null
  const fmt = (d: string, pattern: string) => format(parseISO(d), pattern, language === 'he' ? { locale: heLocale } : undefined)
  const chartData = series.map((p) => ({ ...p, label: fmt(p.date, 'd MMM') }))

  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-md border-2 border-ink bg-ink sm:grid-cols-4">
        <Stat label={L.sinceInjury} value={`${L.day} ${Math.max(1, rehabDayNumber(rehabCase))}`} />
        <Stat
          label={L.avgPain}
          value={thisWeek == null ? '-' : String(thisWeek)}
          sub={L.vsLast(lastWeek)}
          tone={thisWeek == null ? undefined : thisWeek <= 2 ? 'ok' : thisWeek <= 4 ? 'back' : 'stop'}
        />
        <Stat label={L.sessions} value={String(sessions.length)} sub={L.sessionsSub(sessions.length, plannedSessions)} />
        <Stat label={L.lastMorning} value={lastMorning == null ? '-' : String(lastMorning)} />
      </dl>

      <section className="poster-plate p-4">
        <h3 className="poster-caps text-[22px]">{L.chartTitle}</h3>
        {chartData.length < 2 ? (
          <p className="mt-2 text-sm text-ink/65">{L.empty}</p>
        ) : (
          <>
            <div className="mt-3 h-[230px]" dir="ltr">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 6, right: 8, bottom: 0, left: -18 }}>
                  <ReferenceArea y1={0} y2={2} fill={PINE} fillOpacity={0.09} stroke="none" />
                  <CartesianGrid stroke={INK} strokeOpacity={0.08} vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={{ stroke: INK, strokeOpacity: 0.4 }} minTickGap={18} />
                  <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 11, fill: INK }} tickLine={false} axisLine={false} />
                  <Tooltip
                    contentStyle={{ background: '#F7F2E6', border: `2px solid ${INK}`, borderRadius: 6, fontSize: 12 }}
                    formatter={(v: number, name: string) => [v, name]}
                  />
                  <Line name={L.morning} type="monotone" dataKey="morning" stroke={INK} strokeWidth={2.2} dot={{ r: 3, fill: INK }} connectNulls />
                  <Line name={L.evening} type="monotone" dataKey="evening" stroke={SKY} strokeWidth={2.2} strokeDasharray="5 4" dot={{ r: 3, fill: SKY }} connectNulls />
                  <Scatter name={L.session} dataKey="session" fill={OCHRE} shape="square" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/75">
              <li className="flex items-center gap-1.5"><span className="h-0.5 w-5 bg-ink" />{L.morning}</li>
              <li className="flex items-center gap-1.5"><span className="h-0.5 w-5 border-t-2 border-dashed border-sky" />{L.evening}</li>
              <li className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 bg-ochre" />{L.session}</li>
              <li className="flex items-center gap-1.5"><span className="h-3 w-5 bg-pine/15" />{L.okZone}</li>
            </ul>
          </>
        )}
      </section>

      <section>
        <h3 className="poster-caps text-[22px]">{L.sessionsTitle}</h3>
        {sessions.length === 0 ? (
          <p className="mt-1.5 text-sm text-ink/65">{L.noSessions}</p>
        ) : (
          <ol className="mt-2 space-y-2.5">
            {[...sessions].reverse().map((s) => (
              <li key={s.id} className="rounded-md border border-ink/20 bg-card/70 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{fmt(s.date, language === 'he' ? 'EEEE, d MMMM' : 'EEE, d MMM')}</p>
                  <PainChip value={s.maxPain} />
                </div>
                <ul className="mt-2 grid gap-1">
                  {s.exercises.map((e, i) => (
                    <li key={i} className="flex items-center justify-between gap-3 text-xs">
                      <span className={cn('truncate', e.setsDone === 0 && 'text-ink/45 line-through')}>{e.name}</span>
                      <span className="flex shrink-0 items-center gap-2 text-ink/60">
                        {e.maxWeightKg != null && <span className="tabular">{e.maxWeightKg} kg</span>}
                        <PainChip value={e.pain} className="h-5 min-w-5 text-[11px]" />
                      </span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </section>

      {checkins.length > 0 && (
        <section>
          <h3 className="poster-caps text-[22px]">{L.checkinsTitle}</h3>
          <ol className="mt-2 divide-y divide-ink/10 rounded-md border border-ink/20 bg-card/70">
            {[...checkins].reverse().slice(0, 21).map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-3 py-2.5 text-sm">
                <span className="w-20 shrink-0 text-xs font-semibold text-ink/70">{fmt(c.date, 'd MMM')}</span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <PainChip value={c.morningPain} className="h-5 min-w-5 text-[11px]" />
                  <PainChip value={c.eveningPain} className="h-5 min-w-5 text-[11px]" />
                </span>
                <span className="min-w-0 flex-1 text-xs leading-relaxed text-ink/75">
                  {c.feeling != null && <span className="font-semibold text-ink">{FEELINGS[language][c.feeling - 1]}. </span>}
                  {c.notes}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'ok' | 'back' | 'stop' }) {
  return (
    <div className="bg-stock px-3 py-3">
      <dt className="text-[11px] font-semibold leading-tight text-ink/65">{label}</dt>
      <dd className={cn(
        'poster-caps mt-1 text-[30px]',
        tone === 'ok' && 'text-pine', tone === 'back' && 'text-ochre-deep', tone === 'stop' && 'text-rust',
      )}>
        {value}
      </dd>
      {sub && <dd className="text-[11px] text-ink/55">{sub}</dd>}
    </div>
  )
}
