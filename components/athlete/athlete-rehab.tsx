'use client'

import { useAthleteUser } from '@/contexts/view-as-context'
import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { doc, getDoc } from 'firebase/firestore'
import { format, parseISO } from 'date-fns'
import { he as heLocale } from 'date-fns/locale'
import { toast } from 'sonner'
import { Check, ChevronLeft, ChevronRight, Loader2, MessageCircle, Play } from 'lucide-react'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import {
  PAIN_TRIGGERS, areaLabel, createRehabReport, currentCase, listRehabAssignments, listRehabCases,
  listRehabCheckins, listRehabReports, listRehabSessions, rehabDayNumber, saveRehabCheckin, todayStr,
} from '@/lib/rehab'
import type { AssignedWorkout, RehabCase, RehabCheckin, RehabReport, RehabSessionLog } from '@/lib/types'
import { BodyMap, type BodySide } from '@/components/rehab/body-map'
import { PainChip, PainScale } from '@/components/rehab/pain-scale'
import { FEELINGS, RehabJourney } from '@/components/rehab/rehab-journey'
import { useRehabVisible } from '@/hooks/useRehabVisible'

const COPY = {
  he: {
    title: 'השיקום שלי',
    intro: 'משהו כואב? סמנו על הגוף איפה, ספרו מתי זה כואב, והמאמן יחזור אליכם עם תוכנית שיקום.',
    front: 'מלפנים',
    back: 'מאחור',
    day: (n: number) => `יום ${n}`,
    since: (d: string) => `מאז ${d}`,
    goal: 'המטרה',
    coachSays: 'מהמאמן',
    rule: 'הכלל: הכאב לא עובר 2 מתוך 10 באף תרגיל. כואב יותר? חוזרים שלב אחורה.',
    sessionToday: 'אימון השיקום של היום',
    sessionNext: 'אימון השיקום הבא',
    noSession: 'המאמן עוד לא הוסיף אימוני שיקום ליומן.',
    start: 'התחלת אימון',
    doneToday: 'בוצע היום',
    today: 'היום',
    checkinTitle: 'איך הרגל היום?',
    morningPain: 'כאב בבוקר, בצעדים הראשונים',
    eveningPain: 'כאב בערב, בסוף היום',
    feeling: 'הרגשה כללית',
    notes: 'משהו שהמאמן צריך לדעת?',
    notesPh: 'למשל: כאב רק בירידה במדרגות, הלכתי הרבה היום',
    save: 'שמירה',
    saved: 'נשמר',
    savedToast: 'היומן נשמר',
    saveFailed: 'השמירה נכשלה',
    reportTitle: (hasCase: boolean): string => (hasCase ? 'כאב חדש במקום אחר?' : 'איפה כואב?'),
    tapBody: 'לחצו על המקום בגוף.',
    side: 'צד',
    sides: { right: 'ימין', left: 'שמאל', both: 'שני הצדדים' } as Record<'right' | 'left' | 'both', string>,
    painNow: 'כמה כואב עכשיו?',
    startedOn: 'מתי זה התחיל?',
    when: 'מתי כואב?',
    send: 'שליחה למאמן',
    sending: 'שולח...',
    sent: 'נשלח. המאמן יחזור אליכם עם תוכנית.',
    sendFailed: 'השליחה נכשלה',
    pickFirst: 'קודם בוחרים מקום על הגוף',
    pickPain: 'בחרו כמה כואב, מ-0 עד 10',
    chat: 'או כתבו למאמן בצ׳אט',
    myReports: 'הדיווחים שלי',
    status: { new: 'נשלח למאמן', seen: 'המאמן ראה', case_opened: 'נפתחה תוכנית שיקום', closed: 'נסגר' } as Record<RehabReport['status'], string>,
    pastCases: 'פציעות קודמות',
    resolved: 'הסתיים',
    loadFailed: 'טעינת השיקום נכשלה',
    locked: 'השיקום עוד לא נפתח עבורך. משהו כואב? כתבו למאמן.',
    toChat: 'לצ׳אט עם המאמן',
  },
  en: {
    title: 'My rehab',
    intro: 'Something hurts? Tap where on the body, say when it hurts, and your coach will come back to you with a rehab plan.',
    front: 'Front',
    back: 'Back',
    day: (n: number) => `Day ${n}`,
    since: (d: string) => `since ${d}`,
    goal: 'Goal',
    coachSays: 'From your coach',
    rule: 'The rule: pain never above 2 out of 10 in any exercise. If it hurts more, step back.',
    sessionToday: "Today's rehab session",
    sessionNext: 'Next rehab session',
    noSession: "Your coach hasn't added rehab sessions to your plan yet.",
    start: 'Start session',
    doneToday: 'Done today',
    today: 'Today',
    checkinTitle: 'How is it today?',
    morningPain: 'Morning pain, first steps',
    eveningPain: 'Evening pain, end of the day',
    feeling: 'Overall feeling',
    notes: 'Anything your coach should know?',
    notesPh: 'e.g. only hurts going down stairs, walked a lot today',
    save: 'Save',
    saved: 'Saved',
    savedToast: 'Log saved',
    saveFailed: 'Saving failed',
    reportTitle: (hasCase: boolean): string => (hasCase ? 'New pain somewhere else?' : 'Where does it hurt?'),
    tapBody: 'Tap the spot on the body.',
    side: 'Side',
    sides: { right: 'Right', left: 'Left', both: 'Both' } as Record<'right' | 'left' | 'both', string>,
    painNow: 'How much does it hurt now?',
    startedOn: 'When did it start?',
    when: 'When does it hurt?',
    send: 'Send to coach',
    sending: 'Sending...',
    sent: 'Sent. Your coach will come back to you with a plan.',
    sendFailed: 'Sending failed',
    pickFirst: 'Pick a spot on the body first',
    pickPain: 'Pick how much it hurts, 0 to 10',
    chat: 'or message your coach',
    myReports: 'My reports',
    status: { new: 'Sent to coach', seen: 'Coach has seen it', case_opened: 'Rehab plan opened', closed: 'Closed' } as Record<RehabReport['status'], string>,
    pastCases: 'Past injuries',
    resolved: 'Finished',
    loadFailed: 'Failed to load your rehab',
    locked: "Rehab isn't open for you yet. Something hurts? Message your coach.",
    toChat: 'Message your coach',
  },
}
type Copy = typeof COPY.he

export function AthleteRehab() {
  const user = useAthleteUser()
  const { language } = useLanguage()
  const L = COPY[language]
  const isRTL = language !== 'en'
  const visible = useRehabVisible()
  const [loading, setLoading] = useState(true)
  const [gender, setGender] = useState<'male' | 'female'>('male')
  const [cases, setCases] = useState<RehabCase[]>([])
  const [reports, setReports] = useState<RehabReport[]>([])
  const [checkins, setCheckins] = useState<RehabCheckin[]>([])
  const [sessions, setSessions] = useState<RehabSessionLog[]>([])
  const [assignments, setAssignments] = useState<AssignedWorkout[]>([])

  const load = useCallback(async () => {
    if (!user?.id || !visible) return
    try {
      const [profile, c, r, ci, s, a] = await Promise.all([
        getDoc(doc(db, 'users', user.id)),
        listRehabCases(user.id),
        listRehabReports(user.id),
        listRehabCheckins(user.id),
        listRehabSessions(user.id),
        listRehabAssignments(user.id),
      ])
      setGender(profile.data()?.gender === 'female' ? 'female' : 'male')
      setCases(c); setReports(r); setCheckins(ci); setSessions(s); setAssignments(a)
    } catch (err) {
      console.error('Error loading rehab:', err)
      toast.error(L.loadFailed)
    } finally {
      setLoading(false)
    }
  }, [user?.id, visible, L.loadFailed])

  useEffect(() => { load() }, [load])

  const active = currentCase(cases)
  const caseCheckins = useMemo(() => (active ? checkins.filter((c) => c.caseId === active.id) : []), [checkins, active])
  const caseSessions = useMemo(
    () => (active ? sessions.filter((s) => !s.caseId || s.caseId === active.id) : []),
    [sessions, active],
  )
  const fmt = (d: string, pattern: string) => format(parseISO(d), pattern, isRTL ? { locale: heLocale } : undefined)

  if (visible === false) {
    return (
      <div dir={isRTL ? 'rtl' : 'ltr'} className="poster-plate mx-auto max-w-md space-y-3 p-5 text-center">
        <p className="text-[15px]">{L.locked}</p>
        <Link href="/athlete/chat" className="poster-caps inline-flex h-11 items-center gap-2 rounded-md bg-ink px-4 text-[19px] text-stock">
          <MessageCircle className="h-4 w-4" />{L.toChat}
        </Link>
      </div>
    )
  }

  if (loading || visible === null) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-ochre" />
      </div>
    )
  }

  const resolvedCases = cases.filter((c) => c.status === 'resolved')

  return (
    <div dir={isRTL ? 'rtl' : 'ltr'} className="mx-auto max-w-2xl space-y-8">
      <header className="poster-settle">
        <h1 className="poster-caps text-[46px]">{L.title}</h1>
        {active ? (
          <p className="mt-1 text-[15px] text-ink/75">
            <span className="font-semibold text-ink">{active.title}</span>
            {' '}{L.since(fmt(active.injuryDate, 'd MMMM'))}
          </p>
        ) : (
          <p className="mt-1 max-w-prose text-[15px] leading-relaxed text-ink/75">{L.intro}</p>
        )}
      </header>

      {active && (
        <>
          <CaseCard rehabCase={active} gender={gender} L={L} />
          <SessionCard assignments={assignments} sessions={caseSessions} L={L} fmt={fmt} />
          <CheckinCard
            key={active.id}
            rehabCase={active}
            athleteId={user!.id}
            existing={caseCheckins.find((c) => c.date === todayStr())}
            language={language}
            L={L}
            onSaved={load}
          />
          <RehabJourney
            rehabCase={active}
            checkins={caseCheckins}
            sessions={caseSessions}
            plannedSessions={assignments.filter((a) => a.scheduledDate <= todayStr()).length}
            language={language}
          />
        </>
      )}

      <ReportSection
        athleteId={user!.id}
        hasCase={!!active}
        reports={reports}
        gender={gender}
        language={language}
        L={L}
        fmt={fmt}
        onSent={load}
      />

      {resolvedCases.length > 0 && (
        <section>
          <h2 className="poster-caps text-[24px]">{L.pastCases}</h2>
          <ul className="mt-2 divide-y divide-ink/10 rounded-md border border-ink/20 bg-card/70">
            {resolvedCases.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="font-semibold">{c.title}</span>
                <span className="text-xs text-ink/60">{fmt(c.injuryDate, 'd MMM yyyy')} · {L.resolved}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function CaseCard({ rehabCase, gender, L }: { rehabCase: RehabCase; gender: 'male' | 'female'; L: Copy }) {
  const day = Math.max(1, rehabDayNumber(rehabCase))
  return (
    <section className="poster-plate grid grid-cols-[1fr_auto] items-start gap-4 p-4 sm:grid-cols-[1fr_200px]">
      <div className="space-y-3">
        <p className="poster-caps text-[40px] leading-none text-ochre-deep">{L.day(day)}</p>
        {rehabCase.goal && (
          <div>
            <p className="text-xs font-bold text-ink/60">{L.goal}</p>
            <p className="text-[15px] font-semibold">{rehabCase.goal}</p>
          </div>
        )}
        {rehabCase.coachNotes && (
          <div>
            <p className="text-xs font-bold text-ink/60">{L.coachSays}</p>
            <p className="whitespace-pre-line text-sm leading-relaxed">{rehabCase.coachNotes}</p>
          </div>
        )}
        <p className="border-t border-ink/15 pt-2.5 text-xs font-semibold leading-relaxed text-ochre-deep">{L.rule}</p>
      </div>
      <BodyMap
        className="w-[150px] sm:w-[200px]"
        spots={[{ areaKey: rehabCase.bodyArea, side: rehabCase.side }]}
        gender={gender}
        labels={{ front: L.front, back: L.back }}
      />
    </section>
  )
}

function SessionCard({ assignments, sessions, L, fmt }: {
  assignments: AssignedWorkout[]
  sessions: RehabSessionLog[]
  L: Copy
  fmt: (d: string, p: string) => string
}) {
  const today = todayStr()
  const todays = assignments.find((a) => a.scheduledDate === today)
  const next = todays || assignments.find((a) => a.scheduledDate > today && a.status !== 'completed')
  const doneLog = todays ? sessions.find((s) => s.assignedWorkoutId === todays.id) : undefined
  const Chevron = L === COPY.he ? ChevronLeft : ChevronRight

  if (!next) {
    return <p className="rounded-md border border-dashed border-ink/30 px-4 py-3 text-sm text-ink/70">{L.noSession}</p>
  }
  const isToday = next.scheduledDate === today
  const done = isToday && next.status === 'completed'
  return (
    <section className="overflow-hidden rounded-md border-2 border-ink">
      <div className="flex items-center justify-between gap-3 bg-ink px-4 py-3 text-stock">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-stock/70">{isToday ? L.sessionToday : L.sessionNext}</p>
          <p className="truncate text-base font-bold">{next.workout.title}</p>
        </div>
        <p className="poster-caps shrink-0 text-[20px] text-ochre">{isToday ? L.today : fmt(next.scheduledDate, 'EEE d/M')}</p>
      </div>
      {done ? (
        <div className="flex items-center justify-between gap-3 bg-stock px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-bold text-pine"><Check className="h-5 w-5" />{L.doneToday}</span>
          {doneLog && <PainChip value={doneLog.maxPain} />}
        </div>
      ) : (
        <Link
          href={`/athlete/lift/${next.id}`}
          className="poster-caps flex h-14 items-center justify-center gap-2 bg-pine text-[22px] text-stock transition-transform active:scale-[0.99]"
        >
          <Play className="h-5 w-5" />{L.start}<Chevron className="h-5 w-5" />
        </Link>
      )}
    </section>
  )
}

function CheckinCard({ rehabCase, athleteId, existing, language, L, onSaved }: {
  rehabCase: RehabCase
  athleteId: string
  existing?: RehabCheckin
  language: 'he' | 'en'
  L: Copy
  onSaved: () => void
}) {
  const [morning, setMorning] = useState<number | null>(existing?.morningPain ?? null)
  const [evening, setEvening] = useState<number | null>(existing?.eveningPain ?? null)
  const [feeling, setFeeling] = useState<number | null>(existing?.feeling ?? null)
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const touch = <T,>(set: (v: T) => void) => (v: T) => { set(v); setDirty(true) }

  const save = async () => {
    setSaving(true)
    try {
      await saveRehabCheckin({ caseId: rehabCase.id, athleteId, date: todayStr(), morningPain: morning, eveningPain: evening, feeling, notes })
      toast.success(L.savedToast)
      setDirty(false)
      onSaved()
    } catch (err) {
      console.error('Error saving rehab check-in:', err)
      toast.error(L.saveFailed)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="poster-plate space-y-4 p-4">
      <h2 className="poster-caps text-[26px]">{L.checkinTitle}</h2>
      <div className="space-y-2">
        <p className="text-sm font-semibold">{L.morningPain}</p>
        <PainScale value={morning} onChange={touch(setMorning)} label={L.morningPain} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">{L.eveningPain}</p>
        <PainScale value={evening} onChange={touch(setEvening)} label={L.eveningPain} />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold">{L.feeling}</p>
        <div role="radiogroup" aria-label={L.feeling} className="grid grid-cols-5 gap-1">
          {FEELINGS[language].map((f, i) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={feeling === i + 1}
              onClick={() => touch(setFeeling)(i + 1)}
              className={cn(
                'h-10 rounded-md border text-xs font-semibold transition-colors',
                feeling === i + 1 ? 'border-ink bg-ink text-stock' : 'border-border bg-card text-ink/80',
              )}
            >
              {f}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <label htmlFor="rehab-notes" className="text-sm font-semibold">{L.notes}</label>
        <Textarea id="rehab-notes" value={notes} onChange={(e) => { setNotes(e.target.value); setDirty(true) }} placeholder={L.notesPh} rows={2} dir="auto" />
      </div>
      <button
        type="button"
        onClick={save}
        disabled={saving || (!dirty && !!existing)}
        className="poster-caps flex h-12 w-full items-center justify-center gap-2 rounded-md bg-ink text-[21px] text-stock transition-transform active:scale-[0.98] disabled:opacity-60"
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : !dirty && existing ? <Check className="h-5 w-5" /> : null}
        {!dirty && existing ? L.saved : L.save}
      </button>
    </section>
  )
}

function ReportSection({ athleteId, hasCase, reports, gender, language, L, fmt, onSent }: {
  athleteId: string
  hasCase: boolean
  reports: RehabReport[]
  gender: 'male' | 'female'
  language: 'he' | 'en'
  L: Copy
  fmt: (d: string, p: string) => string
  onSent: () => void
}) {
  const [spot, setSpot] = useState<{ areaKey: string; side: BodySide } | null>(null)
  const [pain, setPain] = useState<number | null>(null)
  const [since, setSince] = useState(todayStr())
  const [triggers, setTriggers] = useState<string[]>([])
  const [notes, setNotes] = useState('')
  const [sending, setSending] = useState(false)
  const openReports = reports.filter((r) => r.status !== 'closed')

  const send = async () => {
    if (!spot) { toast.error(L.pickFirst); return }
    if (pain == null) { toast.error(L.pickPain); return }
    setSending(true)
    try {
      await createRehabReport({ athleteId, areaKey: spot.areaKey, side: spot.side, pain, since, triggers, notes })
      toast.success(L.sent)
      setSpot(null); setPain(null); setTriggers([]); setNotes(''); setSince(todayStr())
      onSent()
    } catch (err) {
      console.error('Error sending pain report:', err)
      toast.error(L.sendFailed)
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="poster-caps text-[30px]">{L.reportTitle(hasCase)}</h2>
        <p className="text-sm text-ink/70">{L.tapBody}</p>
      </div>

      <div className="poster-plate p-4">
        <BodyMap
          spots={spot ? [spot] : []}
          onPick={(s) => setSpot(s)}
          gender={gender}
          labels={{ front: L.front, back: L.back }}
        />
      </div>

      {spot && (
        <div className="poster-plate poster-settle space-y-4 p-4">
          <p className="poster-caps text-[26px] text-rust">{areaLabel(spot.areaKey, language)}</p>
          {spot.side && (
            <div className="space-y-2">
              <p className="text-sm font-semibold">{L.side}</p>
              <div role="radiogroup" aria-label={L.side} className="grid grid-cols-3 gap-1">
                {(['right', 'left', 'both'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={spot.side === s}
                    onClick={() => setSpot({ ...spot, side: s })}
                    className={cn(
                      'h-10 rounded-md border text-sm font-semibold transition-colors',
                      spot.side === s ? 'border-ink bg-ink text-stock' : 'border-border bg-card',
                    )}
                  >
                    {L.sides[s]}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-2">
            <p className="text-sm font-semibold">{L.painNow}</p>
            <PainScale value={pain} onChange={setPain} label={L.painNow} />
          </div>
          <div className="space-y-2">
            <label htmlFor="pain-since" className="text-sm font-semibold">{L.startedOn}</label>
            <Input id="pain-since" type="date" value={since} max={todayStr()} onChange={(e) => setSince(e.target.value)} className="max-w-[200px]" />
          </div>
          <div className="space-y-2">
            <p className="text-sm font-semibold">{L.when}</p>
            <div className="flex flex-wrap gap-1.5">
              {PAIN_TRIGGERS.map((t) => {
                const on = triggers.includes(t.key)
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setTriggers((prev) => (on ? prev.filter((x) => x !== t.key) : [...prev, t.key]))}
                    className={cn(
                      'rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors',
                      on ? 'border-ink bg-ink text-stock' : 'border-border bg-card text-ink/80',
                    )}
                  >
                    {t[language]}
                  </button>
                )
              })}
            </div>
          </div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={L.notesPh} rows={2} dir="auto" />
          <button
            type="button"
            onClick={send}
            disabled={sending}
            className="poster-caps flex h-12 w-full items-center justify-center gap-2 rounded-md bg-rust text-[21px] text-stock transition-transform active:scale-[0.98] disabled:opacity-60"
          >
            {sending && <Loader2 className="h-5 w-5 animate-spin" />}
            {sending ? L.sending : L.send}
          </button>
          <Link href="/athlete/chat" className="flex items-center justify-center gap-1.5 text-sm font-semibold text-ink/70 underline underline-offset-4">
            <MessageCircle className="h-4 w-4" />{L.chat}
          </Link>
        </div>
      )}

      {openReports.length > 0 && (
        <div>
          <h3 className="text-sm font-bold">{L.myReports}</h3>
          <ul className="mt-2 divide-y divide-ink/10 rounded-md border border-ink/20 bg-card/70">
            {openReports.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {areaLabel(r.areaKey, language)}{r.side ? ` · ${L.sides[r.side as 'right' | 'left' | 'both']}` : ''}
                  </span>
                  <span className="text-xs text-ink/60">{fmt(r.since, 'd MMM')} · {L.status[r.status]}</span>
                </span>
                <PainChip value={r.pain} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
