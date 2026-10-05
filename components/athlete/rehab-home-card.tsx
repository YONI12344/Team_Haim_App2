'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { addDays, format } from 'date-fns'
import { toast } from 'sonner'
import { Check, ChevronLeft, ChevronRight, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  PAIN_ZONE_CLASSES, averagePain, currentCase, listRehabAssignments, listRehabCases, listRehabCheckins,
  painZone, rehabDayNumber, saveRehabPain, todayStr,
} from '@/lib/rehab'
import type { AssignedWorkout, RehabCase, RehabCheckin } from '@/lib/types'
import { PainScale } from '@/components/rehab/pain-scale'

export type Slot = 'morningPain' | 'eveningPain'

const COPY = {
  he: {
    section: 'השיקום שלי',
    day: (n: number) => `יום ${n}`,
    ask: { morningPain: 'איך הרגל הבוקר?', eveningPain: 'איך הרגל הערב?' },
    slot: { morningPain: 'בוקר', eveningPain: 'ערב' },
    scaleHint: '0 בלי כאב, 10 הכי חזק. נשמר בלחיצה.',
    saved: (slot: string, v: number) => `נשמר: ${slot} ${v}`,
    advice: { ok: 'בתוך הטווח. ממשיכים.', back: 'מעל 2. היום עושים גרסה קלה יותר.', stop: 'כאב חזק. נחים היום ומעדכנים את המאמן.' },
    saveFailed: 'השמירה נכשלה',
    week: 'כאב בבוקר, 7 הימים האחרונים',
    avg: (now: number | null, prev: number | null) =>
      now == null ? 'עוד אין מספיק נתונים לממוצע' : prev == null ? `ממוצע בוקר וערב השבוע ${now}` : `ממוצע בוקר וערב השבוע ${now}, שבוע שעבר ${prev}`,
    dayLetters: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
    sessionToday: 'אימון השיקום של היום',
    sessionDone: 'אימון השיקום של היום בוצע',
    nextSession: (d: string) => `אימון השיקום הבא: ${d}`,
    all: 'לכל השיקום',
  },
  en: {
    section: 'My rehab',
    day: (n: number) => `Day ${n}`,
    ask: { morningPain: 'How is it this morning?', eveningPain: 'How is it this evening?' },
    slot: { morningPain: 'morning', eveningPain: 'evening' },
    scaleHint: '0 no pain, 10 the worst. Saves when you tap.',
    saved: (slot: string, v: number) => `Saved: ${slot} ${v}`,
    advice: { ok: 'Within range. Carry on.', back: 'Above 2. Do an easier version today.', stop: 'Strong pain. Rest today and tell your coach.' },
    saveFailed: 'Saving failed',
    week: 'Morning pain, last 7 days',
    avg: (now: number | null, prev: number | null) =>
      now == null ? 'Not enough data for an average yet' : prev == null ? `Morning and evening average this week ${now}` : `Morning and evening average this week ${now}, last week ${prev}`,
    dayLetters: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    sessionToday: "Today's rehab session",
    sessionDone: "Today's rehab session is done",
    nextSession: (d: string) => `Next rehab session: ${d}`,
    all: 'All of my rehab',
  },
}

/**
 * The injury on the athlete's home screen, once the coach has opened rehab
 * for them and there's an active case: a one-tap pain check-in (morning
 * before 3pm, evening after), the last seven mornings as stamps, and
 * today's rehab session. Renders nothing otherwise.
 */
export function RehabHomeCard({ athleteId, language }: { athleteId: string; language: 'he' | 'en' }) {
  const [rehabCase, setRehabCase] = useState<RehabCase | null>(null)
  const [checkins, setCheckins] = useState<RehabCheckin[]>([])
  const [assignments, setAssignments] = useState<AssignedWorkout[]>([])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const active = currentCase(await listRehabCases(athleteId))
        if (cancelled || !active) return
        const [ci, a] = await Promise.all([listRehabCheckins(athleteId, active.id), listRehabAssignments(athleteId)])
        if (cancelled) return
        setRehabCase(active); setCheckins(ci); setAssignments(a)
      } catch (err) {
        console.error('Error loading rehab for home:', err)
      }
    })()
    return () => { cancelled = true }
  }, [athleteId])

  if (!rehabCase) return null

  // Optimistic: the stamp and advice update on tap, and roll back if the save fails.
  const savePain = async (slot: Slot, pain: number): Promise<boolean> => {
    const today = todayStr()
    const prev = checkins
    setCheckins((list) => {
      const existing = list.find((c) => c.date === today)
      const base: RehabCheckin = existing ?? { id: `${rehabCase.id}_${today}`, caseId: rehabCase.id, athleteId, date: today, updatedAt: new Date() }
      return [...list.filter((c) => c.date !== today), { ...base, [slot]: pain }].sort((a, b) => a.date.localeCompare(b.date))
    })
    try {
      await saveRehabPain({ caseId: rehabCase.id, athleteId, date: today }, slot, pain)
      return true
    } catch (err) {
      console.error('Error saving pain from home:', err)
      setCheckins(prev)
      toast.error(COPY[language].saveFailed)
      return false
    }
  }

  return <RehabHomeCardView rehabCase={rehabCase} checkins={checkins} assignments={assignments} language={language} onPain={savePain} />
}

/** The card itself, data in and taps out. */
export function RehabHomeCardView({ rehabCase, checkins, assignments, language, onPain }: {
  rehabCase: RehabCase
  checkins: RehabCheckin[]
  assignments: AssignedWorkout[]
  language: 'he' | 'en'
  onPain: (slot: Slot, pain: number) => Promise<boolean>
}) {
  const L = COPY[language]
  const isRTL = language !== 'en'
  const [slot, setSlot] = useState<Slot>(() => (new Date().getHours() < 15 ? 'morningPain' : 'eveningPain'))
  const [justSaved, setJustSaved] = useState<Slot | null>(null)
  const today = todayStr()
  const todays = checkins.find((c) => c.date === today)
  const week = useMemo(() => {
    const byDate = new Map(checkins.map((c) => [c.date, c]))
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(new Date(), i - 6)
      const ds = format(d, 'yyyy-MM-dd')
      return { ds, d, pain: byDate.get(ds)?.morningPain ?? null }
    })
  }, [checkins])

  const value = todays?.[slot] ?? null
  const tap = async (pain: number) => {
    setJustSaved(slot)
    if (!(await onPain(slot, pain))) setJustSaved(null)
  }

  const todaysSession = assignments.find((a) => a.scheduledDate === today)
  const nextSession = assignments.find((a) => a.scheduledDate > today && a.status !== 'completed')
  const avgNow = averagePain(checkins, 6, 0)
  const avgPrev = averagePain(checkins, 13, 7)
  const Chevron = isRTL ? ChevronLeft : ChevronRight

  return (
    <section aria-label={L.section}>
      <div className="poster-rule mb-3">
        <span className="poster-caps text-[20px]">{L.section}</span>
        <i />
      </div>

      <div className="overflow-hidden rounded-md border-2 border-rust bg-[color-mix(in_oklab,var(--color-stock)_70%,white)]">
        <div className="flex items-baseline justify-between gap-3 bg-rust px-4 py-2.5 text-stock">
          <p className="min-w-0 truncate text-sm font-semibold">{rehabCase.title}</p>
          <p className="poster-caps shrink-0 text-[24px] leading-none">{L.day(Math.max(1, rehabDayNumber(rehabCase)))}</p>
        </div>

        <div className="space-y-5 p-4">
          <div className="space-y-2.5">
            <div className="flex items-end justify-between gap-3">
              <h2 className="poster-caps text-[28px] leading-none">{L.ask[slot]}</h2>
              <div role="radiogroup" aria-label={L.ask[slot]} className="flex shrink-0 rounded-md border-2 border-ink p-0.5">
                {(['morningPain', 'eveningPain'] as Slot[]).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={slot === s}
                    onClick={() => { setSlot(s); setJustSaved(null) }}
                    className={cn(
                      'poster-caps h-7 rounded px-2.5 text-[16px] transition-colors',
                      slot === s ? 'bg-ink text-stock' : 'text-ink/70',
                    )}
                  >
                    {L.slot[s]}
                  </button>
                ))}
              </div>
            </div>
            <PainScale value={value} onChange={tap} label={L.ask[slot]} />
            <p className={cn('min-h-[1.25rem] text-xs', value != null ? cn('font-semibold', PAIN_ZONE_CLASSES[painZone(value)].text) : 'text-ink/60')} aria-live="polite">
              {value != null
                ? `${justSaved === slot ? `${L.saved(L.slot[slot], value)}. ` : ''}${L.advice[painZone(value)]}`
                : L.scaleHint}
            </p>
          </div>

          <div>
            <ol className="grid grid-cols-7 gap-1.5" aria-label={L.week}>
              {week.map(({ ds, d, pain }) => (
                <li key={ds} className="flex flex-col items-center gap-1">
                  <span className={cn('poster-caps text-[14px]', ds === today ? 'text-ink' : 'text-ink/55')}>
                    {L.dayLetters[d.getDay()]}
                  </span>
                  <span
                    className={cn(
                      'tabular flex h-9 w-full items-center justify-center rounded-md text-sm font-bold',
                      pain != null ? PAIN_ZONE_CLASSES[painZone(pain)].solid : 'border-2 border-dashed border-ink/25 text-ink/30',
                      ds === today && 'ring-2 ring-ink ring-offset-2 ring-offset-stock',
                    )}
                  >
                    {pain ?? ''}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-ink/65">{L.week}. {L.avg(avgNow, avgPrev)}</p>
          </div>

          {todaysSession ? (
            todaysSession.status === 'completed' ? (
              <p className="flex h-12 items-center justify-center gap-2 rounded-md border-2 border-pine text-sm font-bold text-pine">
                <Check className="h-5 w-5" />{L.sessionDone}
              </p>
            ) : (
              <Link
                href={`/athlete/lift/${todaysSession.id}`}
                className="poster-caps flex h-12 items-center justify-center gap-2 rounded-md bg-pine text-[21px] text-stock transition-transform active:scale-[0.98]"
              >
                <Play className="h-4 w-4" />{L.sessionToday}<Chevron className="h-5 w-5" />
              </Link>
            )
          ) : nextSession ? (
            <p className="text-sm text-ink/75">{L.nextSession(format(new Date(`${nextSession.scheduledDate}T12:00:00`), 'd.M'))}</p>
          ) : null}

          <Link href="/athlete/rehab" className="flex items-center justify-between border-t-2 border-ink/10 pt-3 text-sm font-semibold">
            {L.all}
            <Chevron className="h-4 w-4 text-ink/50" />
          </Link>
        </div>
      </div>
    </section>
  )
}
