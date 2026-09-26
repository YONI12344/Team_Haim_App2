'use client'

// Coach-only AI Coach: the TeamHaim brain run on one athlete's data from this app.
// Reads the athlete's profile, logs, schedule and days off (with the coach's own Firestore
// permissions), shows the brain's decisions and a free calibration week, lets the coach ask about
// the athlete or have a plan built/changed, and exports a plan to the athlete's schedule only when
// the coach confirms. The AI itself never writes anything.

import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, getDoc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { format, addDays, subWeeks } from 'date-fns'
import { toast } from 'sonner'
import { ChevronDown, ChevronUp, Loader2, Send, Sparkles, Upload } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import type { AthleteSnapshot, HillChoice } from '@/lib/haim-brain/athlete-context'
import { type BrainPlan, type PlanDay, allDays, describeStep, toWorkoutFields } from '@/lib/haim-brain/plan'

type Choice = { topic: string; choice: string; why: string }
type Msg = { role: 'user' | 'assistant'; content: string; cost?: number; kind?: 'ask' | 'build' }

const ZONE_COLOR: Record<string, string> = { easy: '#3fa8a2', golden: '#d9a441', above: '#e0694d', rest: '#9aa0aa' }
const HILL_OPTIONS: HillChoice[] = ['Yes, a good hill nearby', 'Only short hills (under a minute)', 'No hill, but a treadmill with incline', 'No hills at all']

// Firestore Timestamps -> ISO strings, so the snapshot is plain JSON for the API.
function plain(v: any): any {
  if (v && typeof v.toDate === 'function') return v.toDate().toISOString()
  if (Array.isArray(v)) return v.map(plain)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plain(x)]))
  return v
}

export function AiCoachBrain() {
  const { user, firebaseUser } = useAuth()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [athletes, setAthletes] = useState<{ id: string; name: string }[]>([])
  const [athleteId, setAthleteId] = useState('')
  const [snapshot, setSnapshot] = useState<AthleteSnapshot | null>(null)
  const [loadingAthlete, setLoadingAthlete] = useState(false)
  const [hill, setHill] = useState<HillChoice>('')
  const [startDate, setStartDate] = useState(format(addDays(new Date(), 1), 'yyyy-MM-dd'))
  const [analysis, setAnalysis] = useState<{ choices: Choice[]; profile: Record<string, string> } | null>(null)
  const [plan, setPlan] = useState<BrainPlan | null>(null)
  const [planSource, setPlanSource] = useState<string>('')
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState<'' | 'analyze' | 'ask' | 'build'>('')
  const [spent, setSpent] = useState(0)
  const [openDay, setOpenDay] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [includeBusyDays, setIncludeBusyDays] = useState(false)
  const [exporting, setExporting] = useState(false)

  useEffect(() => {
    getDocs(query(collection(db, 'users'), where('role', '==', 'athlete')))
      .then((snap) => setAthletes(snap.docs.map((d) => ({ id: d.id, name: (d.data().name as string) || 'Unnamed' }))
        .sort((a, b) => a.name.localeCompare(b.name))))
      .catch(() => toast.error("Couldn't load your athletes."))
  }, [])

  const call = async (payload: Record<string, unknown>) => {
    const token = await firebaseUser?.getIdToken()
    const res = await fetch('/api/coach-brain', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Something went wrong.')
    return data
  }

  const loadAthlete = async (id: string) => {
    setAthleteId(id)
    setSnapshot(null); setAnalysis(null); setPlan(null); setMessages([]); setPlanSource('')
    if (!id) return
    setLoadingAthlete(true)
    try {
      const since = format(subWeeks(new Date(), 8), 'yyyy-MM-dd')
      const [u, logs, aw, off] = await Promise.all([
        getDoc(doc(db, 'users', id)),
        getDocs(query(collection(db, 'logs'), where('athleteId', '==', id), where('date', '>=', since))),
        getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', id), where('scheduledDate', '>=', since))),
        getDocs(query(collection(db, 'daysOff'), where('athleteId', '==', id))),
      ])
      const snap: AthleteSnapshot = {
        athleteId: id,
        profile: plain(u.data() || {}),
        logs: logs.docs.map((d) => plain(d.data())) as AthleteSnapshot['logs'],
        schedule: aw.docs.map((d) => {
          const w = d.data()
          return { scheduledDate: w.scheduledDate, title: w.workout?.titleEn || w.workout?.title || 'Workout', type: w.workout?.type || '',
            distance: w.workout?.distance, duration: w.workout?.duration, status: w.status }
        }),
        injuries: [],
        daysOff: off.docs.map((d) => plain(d.data())),
        overrides: { hill_access: hill },
        today,
      }
      setSnapshot(snap)
      await analyze(snap, startDate)
    } catch {
      toast.error("Couldn't read this athlete's data.")
    } finally {
      setLoadingAthlete(false)
    }
  }

  const analyze = async (snap: AthleteSnapshot, start: string) => {
    setBusy('analyze')
    try {
      const data = await call({ action: 'analyze', snapshot: snap, startDate: start })
      setAnalysis({ choices: data.choices, profile: data.profile })
      setPlan(data.calibration)
      setPlanSource('Calibration week · built by code · $0')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setBusy('')
    }
  }

  // Hill access and start date change the decisions, so re-run the free analysis.
  const changeHill = (v: HillChoice) => {
    setHill(v)
    if (snapshot) { const s = { ...snapshot, overrides: { hill_access: v } }; setSnapshot(s); analyze(s, startDate) }
  }
  const changeStart = (v: string) => {
    setStartDate(v)
    if (snapshot && /^\d{4}-\d{2}-\d{2}$/.test(v) && planSource.startsWith('Calibration')) analyze(snapshot, v)
  }

  const send = async (kind: 'ask' | 'build') => {
    const text = input.trim()
    if (!text || !snapshot || busy) return
    const history = messages.map(({ role, content }) => ({ role, content }))
    setMessages((m) => [...m, { role: 'user', content: text, kind }])
    setInput('')
    setBusy(kind)
    try {
      const data = await call({ action: kind, snapshot, message: text, messages: history, plan, startDate })
      setSpent((s) => s + (data.cost || 0))
      setMessages((m) => [...m, { role: 'assistant', content: data.reply || data.error || '', cost: data.cost, kind }])
      if (data.plan) { setPlan(data.plan); setPlanSource(`Built by the AI · $${(data.cost || 0).toFixed(2)}`) }
      if (data.error) toast.error(data.error)
    } catch (e: any) {
      setMessages((m) => [...m, { role: 'assistant', content: e.message }])
    } finally {
      setBusy('')
    }
  }

  // What an export would do: sessions from today on, rest days skipped, and (unless the coach opts
  // in) days that already have something scheduled are left alone.
  const exportable = useMemo(() => {
    if (!plan || !snapshot) return { add: [] as PlanDay[], busyDays: [] as PlanDay[] }
    const taken = new Set(snapshot.schedule.filter((w) => w.status !== 'skipped').map((w) => w.scheduledDate))
    const sessions = allDays(plan).filter((d) => d.type !== 'rest' && d.date && d.date >= today)
    const busyDays = sessions.filter((d) => taken.has(d.date!))
    return { add: includeBusyDays ? sessions : sessions.filter((d) => !taken.has(d.date!)), busyDays }
  }, [plan, snapshot, includeBusyDays, today])

  const doExport = async () => {
    if (!user || !snapshot) return
    setExporting(true)
    let done = 0
    try {
      for (const day of exportable.add) {
        const fields = toWorkoutFields(day)
        const base = { ...fields, source: 'haim_brain' as const, libraryHidden: true, createdBy: user.id, createdAt: new Date(), updatedAt: new Date() }
        const ref = await addDoc(collection(db, 'workouts'), { ...base, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        await addDoc(collection(db, 'assignedWorkouts'), {
          workoutId: ref.id,
          workout: { ...base, id: ref.id },
          athleteId: snapshot.athleteId,
          assignedBy: user.id,
          scheduledDate: day.date,
          status: 'scheduled',
          source: 'haim_brain',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        done++
      }
      toast.success(`Added ${done} workout${done === 1 ? '' : 's'} to the schedule.`)
      setExportOpen(false)
      setSnapshot((s) => s && {
        ...s,
        schedule: [...s.schedule, ...exportable.add.map((d) => ({ scheduledDate: d.date!, title: d.title, type: toWorkoutFields(d).type, status: 'scheduled' }))],
      })
    } catch {
      toast.error(done ? `Stopped after ${done} workouts: couldn't add the rest.` : "Couldn't add the workouts.")
    } finally {
      setExporting(false)
    }
  }

  const athleteName = athletes.find((a) => a.id === athleteId)?.name
  const logged8w = snapshot?.logs.length ?? 0
  const upcoming = snapshot?.schedule.filter((w) => w.scheduledDate >= today).length ?? 0

  return (
    <div className="space-y-4 max-w-3xl mx-auto" dir="ltr">
      <div>
        <h1 className="text-2xl font-serif font-bold text-navy">AI Coach</h1>
        <p className="text-sm text-muted-foreground">
          The TeamHaim brain on your athletes' app data. Only you can see this page, and nothing reaches an athlete until you export it.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6 grid gap-4 sm:grid-cols-3">
          <div className="space-y-1.5 sm:col-span-3">
            <Label htmlFor="aic-athlete">Athlete</Label>
            <select id="aic-athlete" value={athleteId} onChange={(e) => loadAthlete(e.target.value)}
              className="w-full h-10 rounded-md border-2 border-ink bg-background px-3 text-sm">
              <option value="">Choose an athlete</option>
              {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="aic-start">Plan starts</Label>
            <Input id="aic-start" type="date" value={startDate} min={today} onChange={(e) => changeStart(e.target.value)} />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="aic-hill">Hill access</Label>
            <select id="aic-hill" value={hill} onChange={(e) => changeHill(e.target.value as HillChoice)}
              className="w-full h-10 rounded-md border-2 border-ink bg-background px-3 text-sm">
              <option value="">Not known (no hills in the plan)</option>
              {HILL_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </div>
        </CardContent>
      </Card>

      {loadingAthlete || busy === 'analyze' ? (
        <div className="flex items-center justify-center h-32"><Loader2 className="h-7 w-7 animate-spin text-gold" /></div>
      ) : null}

      {snapshot && analysis ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle>What the brain read</CardTitle>
              <CardDescription>From {athleteName}'s profile, {logged8w} logged sessions in the last 8 weeks, and {upcoming} workouts already scheduled.</CardDescription>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                {([
                  ['Goal', analysis.profile.target_race !== 'none yet' ? `${analysis.profile.target_race}${analysis.profile.target_time ? `, ${analysis.profile.target_time}` : ''}` : ''],
                  ['Weekly km', analysis.profile.weekly_mileage],
                  ['Training days', analysis.profile.training_days_preference],
                  ['Race results', analysis.profile.recent_pr],
                  ['Longest run, 3 weeks', analysis.profile.longest_run_last_3_weeks],
                  ['Injuries', analysis.profile.injury_history],
                ] as [string, string][]).map(([k, v]) => (
                  <div key={k} className={k === 'Race results' || k === 'Goal' ? 'col-span-2' : ''}>
                    {k}: <span className="text-foreground">{v || 'not in the app'}</span>
                  </div>
                ))}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Decisions and why</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {analysis.choices.map((c) => (
                <div key={c.topic} className="border-t pt-3 first:border-t-0 first:pt-0">
                  <div className="flex justify-between gap-3 text-sm font-semibold"><span>{c.topic}</span><span className="text-muted-foreground font-medium text-right">{c.choice}</span></div>
                  <p className="text-sm text-muted-foreground mt-0.5">{c.why}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {plan ? (
            <Card>
              <CardHeader>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle>{plan.title}</CardTitle>
                    <CardDescription>{planSource} · {plan.start_date} to {plan.end_date}</CardDescription>
                  </div>
                  <Button size="sm" onClick={() => setExportOpen(true)} disabled={!exportable.add.length && !exportable.busyDays.length}>
                    <Upload className="h-4 w-4" /> Export
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {plan.summary ? <p className="text-sm">{plan.summary}</p> : null}
                {plan.pace_source ? <p className="text-xs text-muted-foreground">{plan.pace_source}</p> : null}
                {Object.keys(plan.paces || {}).length ? (
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(plan.paces).filter(([, v]) => v).map(([k, v]) => (
                      <Badge key={k} variant="outline" className="font-normal">{k.replace('_', ' ')}: {v}</Badge>
                    ))}
                  </div>
                ) : null}
                {plan.template?.adjustments?.length ? (
                  <ul className="list-disc ps-5 text-xs text-muted-foreground space-y-0.5">
                    {plan.template.adjustments.map((a) => <li key={a}>{a}</li>)}
                  </ul>
                ) : null}
                {plan.weeks.map((w) => (
                  <div key={w.week}>
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1">
                      Week {w.week}{w.phase ? ` · ${w.phase}` : ''}{w.focus ? ` · ${w.focus}` : ''}
                    </p>
                    <div className="divide-y border-y">
                      {w.days.map((d) => {
                        const open = openDay === d.date
                        const size = [d.km ? `${d.km} km` : '', d.minutes ? `${Math.round(d.minutes)} min` : ''].filter(Boolean).join(' · ')
                        return (
                          <div key={d.date}>
                            <button type="button" onClick={() => setOpenDay(open ? null : d.date!)} disabled={d.type === 'rest'}
                              className="w-full flex items-center gap-3 py-2 text-left text-sm disabled:cursor-default">
                              <span className="w-20 shrink-0 text-muted-foreground tabular-nums">{d.weekday?.slice(0, 3)} {d.date?.slice(5)}</span>
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: ZONE_COLOR[d.zone] }} aria-hidden />
                              <span className={`flex-1 ${d.type === 'rest' ? 'text-muted-foreground' : 'font-medium'}`}>{d.title}</span>
                              <span className="text-xs text-muted-foreground tabular-nums">{size}</span>
                              {d.type !== 'rest' ? (open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />) : <span className="w-4" />}
                            </button>
                            {open ? (
                              <div className="pb-3 ps-[5.75rem] text-sm space-y-1.5">
                                {d.summary ? <p className="text-muted-foreground">{d.summary}</p> : null}
                                <ul className="space-y-1">{d.steps.map((s, i) => <li key={i}>{describeStep(s)}</li>)}</ul>
                                {d.why ? <p className="text-xs text-muted-foreground">Why: {d.why}</p> : null}
                              </div>
                            ) : null}
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
                {plan.notes?.length ? (
                  <ul className="list-disc ps-5 text-xs text-muted-foreground space-y-0.5">{plan.notes.map((n) => <li key={n}>{n}</li>)}</ul>
                ) : null}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Sparkles className="h-4 w-4 text-gold" /> Talk to the brain about {athleteName}</CardTitle>
              <CardDescription>
                Ask reads the athlete's data (about $0.05). Build writes or changes the plan above, e.g. "build the season to the goal race",
                "make week 2 smaller", "no double threshold" (about $0.30-0.90). Spent this session: ${spent.toFixed(2)}.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'ms-10 rounded-lg bg-secondary px-3 py-2 text-sm' : 'text-sm whitespace-pre-wrap'}>
                  {m.role === 'user' ? <span className="text-xs text-muted-foreground block">{m.kind === 'build' ? 'Build' : 'Ask'}</span> : null}
                  {m.content}
                  {m.cost !== undefined ? <span className="block text-xs text-muted-foreground mt-1">${m.cost.toFixed(3)}</span> : null}
                </div>
              ))}
              {busy === 'ask' || busy === 'build' ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" /> {busy === 'build' ? 'Writing the plan. A full season takes a few minutes.' : 'Reading the athlete\'s data.'}
                </p>
              ) : null}
              <Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3}
                placeholder={`e.g. How has ${athleteName || 'this athlete'} trained the last month? / Build 8 weeks to the goal race, 5 days a week`} />
              <div className="flex gap-2 justify-end">
                <Button variant="outline" disabled={!input.trim() || !!busy} onClick={() => send('ask')}><Send className="h-4 w-4" /> Ask</Button>
                <Button disabled={!input.trim() || !!busy} onClick={() => send('build')}><Sparkles className="h-4 w-4" /> Build / change plan</Button>
              </div>
            </CardContent>
          </Card>
        </>
      ) : null}

      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent dir="ltr">
          <DialogHeader>
            <DialogTitle>Export to {athleteName}'s schedule</DialogTitle>
            <DialogDescription>
              {exportable.add.length} workout{exportable.add.length === 1 ? '' : 's'} will be added from {exportable.add[0]?.date || '-'} on.
              Rest days aren't added. {athleteName} will see them in the app within their visible weeks. You can edit or delete them in the planner like any workout.
            </DialogDescription>
          </DialogHeader>
          {exportable.busyDays.length ? (
            <label className="flex items-start gap-2 text-sm">
              <Checkbox checked={includeBusyDays} onCheckedChange={(v) => setIncludeBusyDays(v === true)} />
              <span>{exportable.busyDays.length} day{exportable.busyDays.length === 1 ? ' already has' : 's already have'} a workout scheduled. Add these too (next to the existing ones)?</span>
            </label>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setExportOpen(false)}>Cancel</Button>
            <Button onClick={doExport} disabled={exporting || !exportable.add.length}>
              {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Add {exportable.add.length} workouts
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
