'use client'

// "In my words": the step between the brain's plan and the athlete's schedule. The plan's sessions are
// rewritten the way the coach writes workouts for this athlete (language, shorthand, name, Hebrew gender
// when the profile states it), then the coach edits, unticks, and sends. Nothing reaches the athlete
// until "Send". Separate from the brain: it only changes the words, never the numbers.

import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { format, subDays } from 'date-fns'
import { toast } from 'sonner'
import { Languages, Loader2, PenLine, Send } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { logAiUsage } from '@/lib/ai-coach/usage-log'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { type PlanDay, toWorkoutFields } from '@/lib/haim-brain/plan'
import type { CoachExample, WrittenWorkout } from '@/lib/coach-voice/write'
import { clearDraft, loadDraft, saveDraft } from '@/lib/coach-voice/drafts'

const BATCH = 14
const RUNNING = ['easy', 'long_run', 'tempo', 'intervals', 'hill_repeats', 'fartlek', 'recovery', 'threshold', 'time_trial', 'race']
const TEXT_FIELDS = ['warmup', 'cooldown', 'notes'] as const

/** The coach's own recent workouts for this athlete (their style), topped up from the coach's library. */
async function loadExamples(athleteId: string, coachId: string): Promise<CoachExample[]> {
  const pick = (w: any): CoachExample => ({ title: w.title, description: w.description, warmup: w.warmup, cooldown: w.cooldown,
    notes: w.notes, type: w.type, distance: w.distance, duration: w.duration })
  const own = (w: any) => w && RUNNING.includes(w.type) && !['haim_brain', 'bakken'].includes(w.source) && (w.title || w.description)
  const since = format(subDays(new Date(), 180), 'yyyy-MM-dd')
  const aw = await getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId), where('scheduledDate', '>=', since)))
  const seen = new Set<string>()
  const out: CoachExample[] = []
  for (const d of aw.docs.map((x) => x.data()).sort((a, b) => String(b.scheduledDate).localeCompare(String(a.scheduledDate)))) {
    const w = d.workout
    if (!own(w) || seen.has(w.title)) continue
    seen.add(w.title); out.push(pick(w))
    if (out.length >= 12) break
  }
  if (out.length < 6) {
    const lib = await getDocs(query(collection(db, 'workouts'), where('createdBy', '==', coachId)))
    for (const d of lib.docs) {
      const w = d.data()
      if (!own(w) || w.libraryHidden || seen.has(w.title)) continue
      seen.add(w.title); out.push(pick(w))
      if (out.length >= 15) break
    }
  }
  return out
}

export function CoachVoiceReview({ open, onClose, athlete, days, busyDates, onSent }: {
  open: boolean
  onClose: () => void
  athlete: { id: string; name: string; gender?: string }
  days: PlanDay[] // sessions from today on, rest days already left out
  busyDates: Set<string> // days that already have a workout on the schedule
  onSent: (dates: string[]) => void
}) {
  const { user, firebaseUser } = useAuth()
  const [written, setWritten] = useState<WrittenWorkout[]>([])
  const [include, setInclude] = useState<Record<string, boolean>>({})
  const [english, setEnglish] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [cost, setCost] = useState(0)
  const [sending, setSending] = useState(false)
  const dayByDate = useMemo(() => new Map(days.map((d) => [d.date!, d])), [days])

  // A saved draft for these same dates is reused instead of paying to write it again.
  useEffect(() => {
    if (!open) return
    setCost(0)
    setInclude(Object.fromEntries(days.map((d) => [d.date!, !busyDates.has(d.date!)])))
    loadDraft(athlete.id).then((draft) => {
      const usable = draft.filter((w) => dayByDate.has(w.date))
      setWritten(usable.length === days.length ? usable : [])
    }).catch(() => setWritten([]))
  }, [open, athlete.id, days, busyDates, dayByDate])

  const write = async () => {
    if (!user) return
    setWritten([])
    setProgress({ done: 0, total: days.length })
    try {
      const examples = await loadExamples(athlete.id, user.id).catch(() => [])
      const token = await firebaseUser?.getIdToken()
      const all: WrittenWorkout[] = []
      for (let i = 0; i < days.length; i += BATCH) {
        const res = await fetch('/api/coach-voice', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ days: days.slice(i, i + BATCH), examples,
            athlete: { firstName: athlete.name.split(' ')[0], gender: athlete.gender } }),
        })
        const data = await res.json().catch(() => ({}))
        if (data.usage) {
          logAiUsage({ route: 'coach-voice', model: data.model, athleteId: athlete.id, coachId: user.id, usage: data.usage })
          setCost((c) => c + (data.cost || 0))
        }
        if (!res.ok) throw new Error(data.error || "Couldn't write the workouts.")
        all.push(...data.workouts)
        setWritten([...all])
        setProgress({ done: Math.min(i + BATCH, days.length), total: days.length })
      }
      saveDraft(athlete.id, all).catch(() => {})
      if (!examples.length) toast.message('No workouts of yours were found to copy the style from, so it used plain coach Hebrew.')
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setProgress(null)
    }
  }

  const edit = (date: string, field: keyof WrittenWorkout, value: string) =>
    setWritten((ws) => ws.map((w) => (w.date === date ? { ...w, [field]: value } : w)))

  const chosen = written.filter((w) => include[w.date])

  const send = async () => {
    if (!user || !chosen.length) return
    if (!confirm(`Send ${chosen.length} workout${chosen.length === 1 ? '' : 's'} to ${athlete.name}? They'll see them in the app.`)) return
    setSending(true)
    const sent: string[] = []
    try {
      for (const w of chosen) {
        const day = dayByDate.get(w.date)
        if (!day) continue
        const { type, duration, distance } = toWorkoutFields(day) as { type: string; duration?: number; distance?: number }
        const text: Record<string, string> = {}
        for (const k of ['title', 'description', ...TEXT_FIELDS] as const) {
          if (w[k]) text[k] = w[k]
          const en = w[`${k}En` as keyof WrittenWorkout]
          if (en) text[`${k}En`] = en
        }
        const base = { ...text, type, ...(duration ? { duration } : {}), ...(distance ? { distance } : {}),
          source: 'haim_brain' as const, libraryHidden: true, createdBy: user.id, createdAt: new Date(), updatedAt: new Date() }
        const ref = await addDoc(collection(db, 'workouts'), { ...base, createdAt: serverTimestamp(), updatedAt: serverTimestamp() })
        await addDoc(collection(db, 'assignedWorkouts'), {
          workoutId: ref.id, workout: { ...base, id: ref.id }, athleteId: athlete.id, assignedBy: user.id,
          scheduledDate: w.date, status: 'scheduled', source: 'haim_brain',
          createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
        })
        sent.push(w.date)
      }
      toast.success(`Sent ${sent.length} workout${sent.length === 1 ? '' : 's'} to ${athlete.name}.`)
      clearDraft(athlete.id).catch(() => {})
      onClose()
    } catch {
      toast.error(sent.length ? `Stopped after ${sent.length}: couldn't send the rest.` : "Couldn't send the workouts.")
    } finally {
      setSending(false)
      if (sent.length) onSent(sent)
    }
  }

  const f = english ? 'En' : ''
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !sending) onClose() }}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="ltr">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><PenLine className="h-4 w-4" /> In my words: {athlete.name}</DialogTitle>
          <DialogDescription>
            The plan's {days.length} session{days.length === 1 ? '' : 's'} rewritten the way you write workouts for {athlete.name.split(' ')[0]}.
            Numbers stay exactly as planned. Edit anything, untick what you don't want, then send. Nothing reaches the athlete before that.
          </DialogDescription>
        </DialogHeader>

        {!written.length && !progress ? (
          <div className="py-6 text-center space-y-3">
            <p className="text-sm text-muted-foreground">
              Uses your recent workouts as the style to copy
              {athlete.gender === 'female' || athlete.gender === 'male' ? `, ${athlete.gender === 'female' ? 'feminine' : 'masculine'} Hebrew forms (from the profile)` : ', gender-neutral Hebrew (no gender in the profile)'}.
              {' '}About ${Math.max(0.1, days.length * 0.012).toFixed(2)}.
            </p>
            <Button onClick={write}><PenLine className="h-4 w-4" /> Write them in my words</Button>
          </div>
        ) : null}

        {progress ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Writing {progress.done} of {progress.total}...
          </p>
        ) : null}

        {written.length ? (
          <>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{chosen.length} of {written.length} selected{cost ? ` · this rewrite $${cost.toFixed(2)}` : ''}</span>
              <div className="flex gap-1">
                <Button size="sm" variant="ghost" onClick={() => setEnglish((e) => !e)}>
                  <Languages className="h-4 w-4" /> {english ? 'Show my language' : 'Show English version'}
                </Button>
                <Button size="sm" variant="ghost" onClick={write} disabled={!!progress}>Rewrite</Button>
              </div>
            </div>
            <div className="space-y-3">
              {written.map((w) => {
                const day = dayByDate.get(w.date)
                const size = [day?.km ? `${day.km} km` : '', day?.minutes ? `${Math.round(day.minutes)} min` : ''].filter(Boolean).join(' · ')
                return (
                  <div key={w.date} className={`rounded-md border p-3 space-y-2 ${include[w.date] ? '' : 'opacity-50'}`}>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Checkbox checked={!!include[w.date]} onCheckedChange={(v) => setInclude((s) => ({ ...s, [w.date]: v === true }))} />
                      <span className="tabular-nums">{day?.weekday?.slice(0, 3)} {w.date}</span> · {size}
                      {busyDates.has(w.date) ? <span className="text-destructive">· already has a workout that day</span> : null}
                    </label>
                    <Input dir="auto" value={w[`title${f}` as keyof WrittenWorkout]} onChange={(e) => edit(w.date, `title${f}` as keyof WrittenWorkout, e.target.value)} className="font-medium" />
                    <Textarea dir="auto" rows={3} value={w[`description${f}` as keyof WrittenWorkout]} onChange={(e) => edit(w.date, `description${f}` as keyof WrittenWorkout, e.target.value)} />
                    <details className="text-xs">
                      <summary className="cursor-pointer text-muted-foreground">Warm-up, cool-down, notes</summary>
                      <div className="mt-2 space-y-2">
                        {TEXT_FIELDS.map((k) => (
                          <Textarea key={k} dir="auto" rows={2} placeholder={k}
                            value={w[`${k}${f}` as keyof WrittenWorkout]} onChange={(e) => edit(w.date, `${k}${f}` as keyof WrittenWorkout, e.target.value)} />
                        ))}
                      </div>
                    </details>
                  </div>
                )
              })}
            </div>
          </>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => { if (written.length) saveDraft(athlete.id, written).catch(() => {}); onClose() }} disabled={sending}>
            {written.length ? 'Save draft and close' : 'Close'}
          </Button>
          <Button onClick={send} disabled={sending || !!progress || !chosen.length}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send {chosen.length || ''} to {athlete.name.split(' ')[0]}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
