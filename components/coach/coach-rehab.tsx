'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { doc, getDoc, updateDoc } from 'firebase/firestore'
import { format, parseISO } from 'date-fns'
import { he as heLocale } from 'date-fns/locale'
import { toast } from 'sonner'
import { ArrowRight, CalendarPlus, Check, Download, Loader2, MessageCircle, Plus, RotateCcw } from 'lucide-react'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/auth-context'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { ViewAsButton } from '@/components/coach/view-as-button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  BODY_AREAS, areaLabel, assignRehabProgram, createRehabCase, listRehabAssignments, listRehabCases, listRehabCheckins,
  listRehabReports, listRehabSessions, listRehabTemplates, todayStr, triggerLabel, updateRehabCase, updateRehabReport,
  type RehabCaseInput,
} from '@/lib/rehab'
import { seedCalfRehabProgram } from '@/lib/seed-calf-rehab-program'
import type { AssignedWorkout, RehabCase, RehabCheckin, RehabReport, RehabSessionLog, Workout } from '@/lib/types'
import { BodyMap } from '@/components/rehab/body-map'
import { PainChip } from '@/components/rehab/pain-scale'
import { RehabJourney } from '@/components/rehab/rehab-journey'

const SIDES: Record<'right' | 'left' | 'both', string> = { right: 'ימין', left: 'שמאל', both: 'שני הצדדים' }
const REPORT_STATUS: Record<RehabReport['status'], string> = {
  new: 'חדש', seen: 'נקרא', case_opened: 'נפתחה תוכנית', closed: 'נסגר',
}
const fmt = (d: string, p: string) => format(parseISO(d), p, { locale: heLocale })

const emptyCase = (): RehabCaseInput => ({
  title: '', bodyArea: 'back:calves', side: null, injuryDate: todayStr(), goal: '', coachNotes: '', reportId: null,
})

/**
 * The coach's rehab desk for one athlete: what they reported on the body
 * map, the injury cases opened from those reports, the rehab program put on
 * their calendar, and the whole journey (pain trend, sessions, daily log).
 */
export function CoachRehab({ athleteId }: { athleteId: string }) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [athleteName, setAthleteName] = useState('')
  const [gender, setGender] = useState<'male' | 'female'>('male')
  const [openToAthlete, setOpenToAthlete] = useState(false)
  const [cases, setCases] = useState<RehabCase[]>([])
  const [reports, setReports] = useState<RehabReport[]>([])
  const [checkins, setCheckins] = useState<RehabCheckin[]>([])
  const [sessions, setSessions] = useState<RehabSessionLog[]>([])
  const [assignments, setAssignments] = useState<AssignedWorkout[]>([])
  const [templates, setTemplates] = useState<Workout[]>([])
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null)
  const [draft, setDraft] = useState<RehabCaseInput | null>(null)

  const load = useCallback(async () => {
    try {
      const [profile, c, r, ci, s, a, t] = await Promise.all([
        getDoc(doc(db, 'users', athleteId)),
        listRehabCases(athleteId),
        listRehabReports(athleteId),
        listRehabCheckins(athleteId),
        listRehabSessions(athleteId),
        listRehabAssignments(athleteId),
        listRehabTemplates(),
      ])
      const p = profile.data()
      setAthleteName(p?.name || p?.email || '')
      setGender(p?.gender === 'female' ? 'female' : 'male')
      setOpenToAthlete(p?.rehabVisibleToAthlete === true)
      setCases(c); setReports(r); setCheckins(ci); setSessions(s); setAssignments(a); setTemplates(t)
      setSelectedCaseId((prev) => prev ?? (c.find((x) => x.status === 'active') || c[0])?.id ?? null)
    } catch (err) {
      console.error('Error loading athlete rehab:', err)
      toast.error('טעינת השיקום נכשלה')
    } finally {
      setLoading(false)
    }
  }, [athleteId])

  useEffect(() => { load() }, [load])

  const selected = cases.find((c) => c.id === selectedCaseId) || null
  const openReports = reports.filter((r) => r.status === 'new' || r.status === 'seen')
  const caseCheckins = useMemo(() => (selected ? checkins.filter((c) => c.caseId === selected.id) : []), [checkins, selected])
  const caseSessions = useMemo(
    () => (selected ? sessions.filter((s) => s.caseId === selected.id || (!s.caseId && selected.status === 'active')) : []),
    [sessions, selected],
  )

  const openCaseFromReport = (r: RehabReport) => {
    setDraft({
      title: `${areaLabel(r.areaKey, 'he')}${r.side ? `, ${SIDES[r.side as keyof typeof SIDES]}` : ''}`,
      bodyArea: r.areaKey,
      side: r.side ?? null,
      injuryDate: r.since,
      goal: '',
      coachNotes: '',
      reportId: r.id,
    })
    if (r.status === 'new') updateRehabReport(r.id, { status: 'seen' }).catch(() => {})
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (loading) {
    return <div className="flex min-h-[50vh] items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-ochre" /></div>
  }

  return (
    <div dir="rtl" className="mx-auto max-w-5xl space-y-8 pb-10">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/coach/athletes/${athleteId}`} className="mb-1 inline-flex items-center gap-1 text-sm text-ink/70 hover:text-ink">
            <ArrowRight className="h-4 w-4" />{athleteName || 'חזרה לספורטאי'}
          </Link>
          <h1 className="poster-caps text-[44px]">שיקום</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 items-center gap-2 rounded-md border-2 border-ink px-3 text-sm font-semibold">
            <Switch
              checked={openToAthlete}
              onCheckedChange={async (checked) => {
                setOpenToAthlete(checked)
                try {
                  await updateDoc(doc(db, 'users', athleteId), { rehabVisibleToAthlete: checked })
                  toast.success(checked ? 'השיקום נפתח לספורטאי' : 'השיקום נסגר לספורטאי')
                } catch (err) {
                  console.error('Error toggling rehab visibility:', err)
                  setOpenToAthlete(!checked)
                  toast.error('העדכון נכשל')
                }
              }}
            />
            {openToAthlete ? 'פתוח לספורטאי' : 'סגור לספורטאי'}
          </label>
          <ViewAsButton athleteId={athleteId} label="תצוגת ספורטאי" />
          <Link href={`/coach/chat/${athleteId}`} className="flex h-10 items-center gap-1.5 rounded-md border-2 border-ink px-3 text-sm font-semibold">
            <MessageCircle className="h-4 w-4" />צ׳אט עם {athleteName.split(' ')[0] || 'הספורטאי'}
          </Link>
          <button
            type="button"
            onClick={() => setDraft(emptyCase())}
            className="flex h-10 items-center gap-1.5 rounded-md bg-ink px-3 text-sm font-semibold text-stock"
          >
            <Plus className="h-4 w-4" />פציעה חדשה
          </button>
        </div>
      </header>

      {draft && (
        <CaseForm
          initial={draft}
          title={draft.reportId ? 'פתיחת תוכנית שיקום מהדיווח' : 'פציעה חדשה'}
          submitLabel="פתיחת תיק שיקום"
          onCancel={() => setDraft(null)}
          onSubmit={async (input) => {
            const id = await createRehabCase(athleteId, input, user?.id || '')
            if (input.reportId) await updateRehabReport(input.reportId, { status: 'case_opened', caseId: id })
            toast.success('נפתח תיק שיקום. עכשיו אפשר להוסיף תוכנית ליומן.')
            setDraft(null)
            setSelectedCaseId(id)
            await load()
          }}
        />
      )}

      <section className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <h2 className="poster-caps text-[28px]">דיווחי כאב</h2>
          {reports.length === 0 ? (
            <p className="rounded-md border border-dashed border-ink/30 px-4 py-3 text-sm text-ink/70">
              הספורטאי עוד לא דיווח על כאב. כשידווח, הדיווח יופיע כאן עם המקום שסימן על הגוף.
            </p>
          ) : (
            <ul className="space-y-2.5">
              {reports.map((r) => (
                <li key={r.id} className={cn('rounded-md border-2 p-3', r.status === 'new' ? 'border-rust bg-rust/5' : 'border-ink/20 bg-card/70')}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-bold">
                        {areaLabel(r.areaKey, 'he')}{r.side ? `, ${SIDES[r.side as keyof typeof SIDES]}` : ''}
                      </p>
                      <p className="text-xs text-ink/65">
                        כואב מאז {fmt(r.since, 'd MMMM')} · דווח {format(r.createdAt, 'd/M HH:mm')} · {REPORT_STATUS[r.status]}
                      </p>
                    </div>
                    <PainChip value={r.pain} />
                  </div>
                  {r.triggers.length > 0 && (
                    <p className="mt-2 text-sm">{r.triggers.map((t) => triggerLabel(t, 'he')).join(', ')}</p>
                  )}
                  {r.notes && <p className="mt-1 whitespace-pre-line text-sm text-ink/80">{r.notes}</p>}
                  {(r.status === 'new' || r.status === 'seen') && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" onClick={() => openCaseFromReport(r)} className="h-9 rounded-md bg-pine px-3 text-sm font-semibold text-stock">
                        פתיחת תוכנית שיקום
                      </button>
                      {r.status === 'new' && (
                        <button type="button" onClick={async () => { await updateRehabReport(r.id, { status: 'seen' }); load() }} className="h-9 rounded-md border border-ink/40 px-3 text-sm font-semibold">
                          סימון כנקרא
                        </button>
                      )}
                      <button type="button" onClick={async () => { await updateRehabReport(r.id, { status: 'closed' }); load() }} className="h-9 rounded-md px-3 text-sm text-ink/60 underline underline-offset-4">
                        סגירה בלי תוכנית
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="poster-plate h-fit p-4">
          <BodyMap
            spots={[
              ...openReports.map((r) => ({ areaKey: r.areaKey, side: r.side ?? null })),
              ...cases.filter((c) => c.status === 'active').map((c) => ({ areaKey: c.bodyArea, side: c.side ?? null })),
            ]}
            gender={gender}
            labels={{ front: 'מלפנים', back: 'מאחור' }}
          />
          <p className="mt-2 text-center text-xs text-ink/60">באדום: דיווחים פתוחים ופציעות פעילות</p>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="poster-caps me-2 text-[28px]">פציעות</h2>
          {cases.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setSelectedCaseId(c.id)}
              className={cn(
                'h-9 rounded-md border px-3 text-sm font-semibold transition-colors',
                c.id === selectedCaseId ? 'border-ink bg-ink text-stock' : 'border-ink/30 bg-card',
                c.status === 'resolved' && c.id !== selectedCaseId && 'text-ink/50',
              )}
            >
              {c.title}{c.status === 'resolved' ? ' (הסתיים)' : ''}
            </button>
          ))}
        </div>

        {!selected ? (
          <p className="rounded-md border border-dashed border-ink/30 px-4 py-3 text-sm text-ink/70">
            אין עדיין תיק שיקום. פותחים אחד מדיווח כאב, או בכפתור &quot;פציעה חדשה&quot;.
          </p>
        ) : (
          <div className="grid gap-6 lg:grid-cols-[360px_minmax(0,1fr)]">
            <div className="space-y-6">
              <CaseForm
                key={selected.id}
                initial={{
                  title: selected.title, bodyArea: selected.bodyArea, side: selected.side ?? null, injuryDate: selected.injuryDate,
                  goal: selected.goal || '', coachNotes: selected.coachNotes || '',
                }}
                title="פרטי הפציעה"
                submitLabel="שמירת שינויים"
                onSubmit={async (input) => {
                  await updateRehabCase(selected.id, {
                    title: input.title.trim(), bodyArea: input.bodyArea, side: input.side, injuryDate: input.injuryDate,
                    goal: input.goal?.trim() || null, coachNotes: input.coachNotes?.trim() || null,
                  })
                  toast.success('נשמר')
                  await load()
                }}
                footer={
                  <button
                    type="button"
                    onClick={async () => {
                      const resolving = selected.status === 'active'
                      await updateRehabCase(selected.id, { status: resolving ? 'resolved' : 'active', resolvedDate: resolving ? todayStr() : null })
                      toast.success(resolving ? 'השיקום סומן כהסתיים' : 'התיק נפתח מחדש')
                      await load()
                    }}
                    className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md border-2 border-ink text-sm font-semibold"
                  >
                    {selected.status === 'active' ? <><Check className="h-4 w-4" />סיום השיקום, חזר לריצה</> : <><RotateCcw className="h-4 w-4" />פתיחה מחדש</>}
                  </button>
                }
              />
              {selected.status === 'active' && (
                <AssignProgram
                  athleteId={athleteId}
                  templates={templates}
                  assignments={assignments}
                  coachId={user?.id || ''}
                  onChanged={load}
                />
              )}
            </div>
            <RehabJourney
              rehabCase={selected}
              checkins={caseCheckins}
              sessions={caseSessions}
              plannedSessions={assignments.filter((a) => a.scheduledDate <= todayStr() && a.scheduledDate >= selected.injuryDate).length}
              language="he"
            />
          </div>
        )}
      </section>
    </div>
  )
}

function CaseForm({ initial, title, submitLabel, onSubmit, onCancel, footer }: {
  initial: RehabCaseInput
  title: string
  submitLabel: string
  onSubmit: (input: RehabCaseInput) => Promise<void>
  onCancel?: () => void
  footer?: React.ReactNode
}) {
  const [form, setForm] = useState<RehabCaseInput>(initial)
  const [saving, setSaving] = useState(false)
  const set = <K extends keyof RehabCaseInput>(k: K, v: RehabCaseInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  const submit = async () => {
    if (!form.title.trim()) { toast.error('חסרה כותרת לפציעה'); return }
    setSaving(true)
    try {
      await onSubmit(form)
    } catch (err) {
      console.error('Error saving rehab case:', err)
      toast.error('השמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="poster-plate space-y-3 p-4">
      <h3 className="poster-caps text-[24px]">{title}</h3>
      <div className="space-y-1.5">
        <Label htmlFor="case-title">כותרת</Label>
        <Input id="case-title" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="למשל: מתיחה בתאומים, שמאל" dir="auto" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1.5">
          <Label>מקום</Label>
          <Select value={form.bodyArea} onValueChange={(v) => set('bodyArea', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {BODY_AREAS.map((a) => <SelectItem key={a.key} value={a.key}>{a.he}{a.view === 'back' ? ' (מאחור)' : ''}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>צד</Label>
          <Select value={form.side || 'none'} onValueChange={(v) => set('side', v === 'none' ? null : (v as 'left' | 'right' | 'both'))}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">לא רלוונטי</SelectItem>
              <SelectItem value="right">ימין</SelectItem>
              <SelectItem value="left">שמאל</SelectItem>
              <SelectItem value="both">שני הצדדים</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="case-date">תאריך הפציעה</Label>
        <Input id="case-date" type="date" value={form.injuryDate} max={todayStr()} onChange={(e) => set('injuryDate', e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="case-goal">המטרה (הספורטאי רואה)</Label>
        <Input id="case-goal" value={form.goal || ''} onChange={(e) => set('goal', e.target.value)} placeholder="למשל: חזרה לריצה קלה של 20 דקות" dir="auto" />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="case-notes">הנחיות לספורטאי</Label>
        <Textarea id="case-notes" value={form.coachNotes || ''} onChange={(e) => set('coachNotes', e.target.value)} rows={3} placeholder="מה עושים ומה לא בשבועות הקרובים" dir="auto" />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={submit} disabled={saving} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-md bg-ink text-sm font-semibold text-stock disabled:opacity-60">
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}{submitLabel}
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="h-10 rounded-md px-3 text-sm text-ink/70">ביטול</button>}
      </div>
      {footer}
    </section>
  )
}

function AssignProgram({ athleteId, templates, assignments, coachId, onChanged }: {
  athleteId: string
  templates: Workout[]
  assignments: AssignedWorkout[]
  coachId: string
  onChanged: () => Promise<void> | void
}) {
  const [templateId, setTemplateId] = useState<string>(templates[0]?.id || '')
  const [startDate, setStartDate] = useState(todayStr())
  const [days, setDays] = useState('12')
  const [busy, setBusy] = useState(false)
  const upcoming = assignments.filter((a) => a.scheduledDate >= todayStr())

  useEffect(() => { if (!templateId && templates[0]) setTemplateId(templates[0].id) }, [templates, templateId])

  const assign = async () => {
    const workout = templates.find((t) => t.id === templateId)
    if (!workout) return
    setBusy(true)
    try {
      const n = await assignRehabProgram({ athleteId, workout, startDate, days: Math.max(1, Number(days) || 1), assignedBy: coachId })
      toast.success(`נוספו ${n} אימוני שיקום ליומן`)
      await onChanged()
    } catch (err) {
      console.error('Error assigning rehab program:', err)
      toast.error('ההוספה ליומן נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const importCalf = async () => {
    setBusy(true)
    try {
      const r = await seedCalfRehabProgram(coachId)
      toast.success(r.alreadyExisted ? 'התוכנית כבר קיימת בספרייה' : 'תוכנית שיקום התאומים נוספה לספרייה')
      await onChanged()
    } catch (err) {
      console.error('Error importing calf rehab program:', err)
      toast.error('הייבוא נכשל')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="poster-plate space-y-3 p-4">
      <h3 className="poster-caps text-[24px]">תוכנית ביומן</h3>
      {templates.length === 0 ? (
        <div className="space-y-2 text-sm">
          <p className="text-ink/75">אין עדיין אימוני שיקום בספרייה. בונים אחד בספריית האימונים (סוג: שיקום), או מייבאים את תוכנית התאומים המוכנה.</p>
          <button type="button" onClick={importCalf} disabled={busy} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md border-2 border-ink font-semibold disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}ייבוא: שיקום תאומים וסולאוס
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label>אימון השיקום</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger><SelectValue placeholder="בחירת אימון" /></SelectTrigger>
              <SelectContent>
                {templates.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="rehab-start">מתחילים ב</Label>
              <Input id="rehab-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rehab-days">מספר אימונים</Label>
              <Input id="rehab-days" type="number" min={1} max={60} value={days} onChange={(e) => setDays(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-ink/65">פעם ביום, 6 ימים ואז יום מנוחה. אפשר לערוך כל יום אחר כך ביומן האימונים.</p>
          <button type="button" onClick={assign} disabled={busy || !templateId} className="flex h-10 w-full items-center justify-center gap-1.5 rounded-md bg-pine font-semibold text-stock disabled:opacity-60">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}הוספה ליומן
          </button>
        </>
      )}
      {upcoming.length > 0 && (
        <p className="text-xs text-ink/70">
          ביומן: {upcoming.length} אימוני שיקום מהיום והלאה, הבא ב-{fmt(upcoming[0].scheduledDate, 'EEEE d/M')}.{' '}
          <Link href={`/coach/athletes/${athleteId}/planner`} className="font-semibold underline underline-offset-4">ליומן</Link>
        </p>
      )}
    </section>
  )
}
