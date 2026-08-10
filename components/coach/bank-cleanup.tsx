'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, AlertTriangle, Copy, FolderTree } from 'lucide-react'
import { collection, doc, getDocs, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from 'sonner'
import type { ExperienceLevel, Workout } from '@/lib/types'
import { useWorkoutTypeLabels } from '@/lib/workout-labels'
import {
  findEmptyStubs, findBadDurations, findBadReps, proposeTitleDisambiguation, proposeLevel,
  type WorkoutFlag, type TitleProposal,
} from '@/lib/bank-cleanup'

const BANK_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'professional']
const BANK_LEVEL_LABELS_HE: Record<ExperienceLevel, string> = {
  beginner: 'מתחילים', intermediate: 'בינוני', advanced: 'מתקדם', professional: 'עילית',
}

async function commitInChunks(ops: Array<{ id: string; data: Record<string, unknown> } | { id: string; delete: true }>) {
  for (let i = 0; i < ops.length; i += 450) {
    const batch = writeBatch(db)
    for (const op of ops.slice(i, i + 450)) {
      const ref = doc(db, 'workouts', op.id)
      if ('delete' in op) batch.delete(ref)
      else batch.update(ref, op.data as any)
    }
    await batch.commit()
  }
}

export function BankCleanup() {
  const workoutTypeLabels = useWorkoutTypeLabels()
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string | null>(null)

  // Bug section: per-flag editable overrides + opt-in checkbox
  const [bugOverrides, setBugOverrides] = useState<Record<string, { checked: boolean; duration?: number }>>({})
  // Title section: per-proposal editable text + opt-in
  const [titleOverrides, setTitleOverrides] = useState<Record<string, { checked: boolean; title: string }>>({})
  // Level section: per-workout chosen level + opt-in
  const [levelOverrides, setLevelOverrides] = useState<Record<string, { checked: boolean; level: ExperienceLevel | '' }>>({})

  const load = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(collection(db, 'workouts'))
      const list = snap.docs.map((d) => ({ ...(d.data() as Workout), id: d.id }))
      setWorkouts(list)
    } catch (err) {
      console.error('Error loading workouts for cleanup:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const stubs = useMemo(() => findEmptyStubs(workouts), [workouts])
  const badDurations = useMemo(() => findBadDurations(workouts), [workouts])
  const badReps = useMemo(() => findBadReps(workouts), [workouts])
  const titleProposals = useMemo(() => proposeTitleDisambiguation(workouts), [workouts])
  const levelProposals = useMemo(() => workouts.map(proposeLevel), [workouts])

  // Seed edit state whenever the underlying analysis changes (fresh load
  // or after an apply reloads the data) — stubs/bugs default ON (they're
  // objectively wrong), title renames default ON, level defaults ON only
  // when a rule actually produced a level.
  useEffect(() => {
    setBugOverrides((prev) => {
      const next = { ...prev }
      for (const f of badDurations) if (!next[f.workoutId]) next[f.workoutId] = { checked: true, duration: f.suggestedDuration }
      for (const f of stubs) if (!next[f.workoutId]) next[f.workoutId] = { checked: true }
      return next
    })
  }, [badDurations, stubs])

  useEffect(() => {
    setTitleOverrides((prev) => {
      const next = { ...prev }
      for (const p of titleProposals) if (!next[p.workoutId]) next[p.workoutId] = { checked: true, title: p.proposedTitle }
      return next
    })
  }, [titleProposals])

  useEffect(() => {
    setLevelOverrides((prev) => {
      const next = { ...prev }
      for (const p of levelProposals) if (!next[p.workoutId]) next[p.workoutId] = { checked: !!p.proposedLevel, level: p.proposedLevel || '' }
      return next
    })
  }, [levelProposals])

  const workoutById = useMemo(() => new Map(workouts.map((w) => [w.id, w])), [workouts])

  const applyBugs = async () => {
    setApplying('bugs')
    try {
      const ops: Array<{ id: string; data: Record<string, unknown> } | { id: string; delete: true }> = []
      for (const f of badDurations) {
        const ov = bugOverrides[f.workoutId]
        if (ov?.checked && ov.duration != null) ops.push({ id: f.workoutId, data: { duration: ov.duration } })
      }
      for (const f of stubs) {
        if (bugOverrides[f.workoutId]?.checked) ops.push({ id: f.workoutId, delete: true })
      }
      await commitInChunks(ops)
      toast.success(`עודכנו/נמחקו ${ops.length} אימונים`)
      await load()
    } catch (err) {
      console.error(err); toast.error('הפעולה נכשלה')
    } finally {
      setApplying(null)
    }
  }

  const applyTitles = async () => {
    setApplying('titles')
    try {
      const ops = titleProposals
        .filter((p) => titleOverrides[p.workoutId]?.checked)
        .map((p) => ({ id: p.workoutId, data: { title: titleOverrides[p.workoutId].title } }))
      await commitInChunks(ops)
      toast.success(`שונו ${ops.length} שמות`)
      await load()
    } catch (err) {
      console.error(err); toast.error('הפעולה נכשלה')
    } finally {
      setApplying(null)
    }
  }

  const applyLevels = async () => {
    setApplying('levels')
    try {
      const ops = levelProposals
        .filter((p) => levelOverrides[p.workoutId]?.checked && levelOverrides[p.workoutId].level)
        .map((p) => ({ id: p.workoutId, data: { bankLevel: levelOverrides[p.workoutId].level } }))
      await commitInChunks(ops)
      toast.success(`שויכו ${ops.length} אימונים לבנק`)
      await load()
    } catch (err) {
      console.error(err); toast.error('הפעולה נכשלה')
    } finally {
      setApplying(null)
    }
  }

  if (loading) return (
    <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gold" /></div>
  )

  return (
    <div className="space-y-6" dir="rtl">
      <div>
        <h2 className="text-lg font-semibold">ניקוי וארגון הספרייה</h2>
        <p className="text-sm text-muted-foreground">
          כל ההצעות כאן מבוססות על חוקים קבועים (משך זמן, כפילויות שם) — לא AI, כי אין כרגע קרדיט ל-API ו-233 אימונים אמיתיים לא צריכים ניחושים. כלום לא נשמר עד שתאשרו כל סעיף בנפרד.
        </p>
      </div>

      {/* Section 1: data bugs */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-600" />בעיות נתונים ({badDurations.length + badReps.length + stubs.length})</CardTitle>
          <CardDescription>משכי זמן/חזרות לא סבירים, ואימונים ריקים לגמרי</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {badDurations.length === 0 && badReps.length === 0 && stubs.length === 0 ? (
            <p className="text-sm text-muted-foreground">לא נמצאו בעיות.</p>
          ) : (
            <>
              <div className="max-h-96 overflow-y-auto space-y-1.5">
                {badDurations.map((f) => {
                  const w = workoutById.get(f.workoutId)
                  const ov = bugOverrides[f.workoutId]
                  if (!w || !ov) return null
                  return (
                    <div key={f.workoutId} className="flex items-center gap-2 text-xs rounded-md bg-muted/40 p-2">
                      <input type="checkbox" checked={ov.checked} onChange={(e) => setBugOverrides((p) => ({ ...p, [f.workoutId]: { ...ov, checked: e.target.checked } }))} />
                      <span className="flex-1 truncate">{w.title} <span className="text-muted-foreground">({f.detail})</span></span>
                      <span className="text-muted-foreground shrink-0">משך חדש:</span>
                      <Input type="number" value={ov.duration ?? ''} onChange={(e) => setBugOverrides((p) => ({ ...p, [f.workoutId]: { ...ov, duration: e.target.value === '' ? undefined : Number(e.target.value) } }))}
                        className="h-7 w-20 text-xs" />
                    </div>
                  )
                })}
                {stubs.map((f) => {
                  const w = workoutById.get(f.workoutId)
                  const ov = bugOverrides[f.workoutId]
                  if (!w || !ov) return null
                  return (
                    <div key={f.workoutId} className="flex items-center gap-2 text-xs rounded-md bg-destructive/5 p-2">
                      <input type="checkbox" checked={ov.checked} onChange={(e) => setBugOverrides((p) => ({ ...p, [f.workoutId]: { ...ov, checked: e.target.checked } }))} />
                      <span className="flex-1 truncate">{w.title} <span className="text-muted-foreground">— ריק לגמרי, יימחק</span></span>
                    </div>
                  )
                })}
                {badReps.map((f) => {
                  const w = workoutById.get(f.workoutId)
                  if (!w) return null
                  return (
                    <div key={f.workoutId + f.detail} className="flex items-center gap-2 text-xs rounded-md bg-amber-50 p-2">
                      <span className="flex-1 truncate">{w.title} <span className="text-muted-foreground">({f.detail}) — לתקן ידנית בעריכת האימון</span></span>
                    </div>
                  )
                })}
              </div>
              <Button size="sm" onClick={applyBugs} disabled={applying === 'bugs'}>
                {applying === 'bugs' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                החל תיקונים
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Section 2: title disambiguation */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Copy className="h-4 w-4 text-blue-600" />שמות כפולים ({titleProposals.length})</CardTitle>
          <CardDescription>אותו שם משמש כמה אימונים שונים לגמרי — הצעה להוסיף פרט מבחין (משך/מרחק)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {titleProposals.length === 0 ? (
            <p className="text-sm text-muted-foreground">לא נמצאו שמות כפולים שדורשים שינוי.</p>
          ) : (
            <>
              <div className="max-h-96 overflow-y-auto space-y-1.5">
                {titleProposals.map((p) => {
                  const ov = titleOverrides[p.workoutId]
                  if (!ov) return null
                  return (
                    <div key={p.workoutId} className="flex items-center gap-2 text-xs rounded-md bg-muted/40 p-2">
                      <input type="checkbox" checked={ov.checked} onChange={(e) => setTitleOverrides((prev) => ({ ...prev, [p.workoutId]: { ...ov, checked: e.target.checked } }))} />
                      <span className="text-muted-foreground shrink-0 w-32 truncate">{p.originalTitle}</span>
                      <span className="text-muted-foreground shrink-0">→</span>
                      <Input value={ov.title} onChange={(e) => setTitleOverrides((prev) => ({ ...prev, [p.workoutId]: { ...ov, title: e.target.value } }))}
                        className="h-7 flex-1 text-xs" dir="auto" />
                    </div>
                  )
                })}
              </div>
              <Button size="sm" onClick={applyTitles} disabled={applying === 'titles'}>
                {applying === 'titles' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                החל שינויי שם
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Section 3: bank level inference */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><FolderTree className="h-4 w-4 text-emerald-600" />שיוך לרמת בנק ({levelProposals.filter((p) => p.proposedLevel).length}/{workouts.length})</CardTitle>
          <CardDescription>הצעת רמה לפי משך זמן וסוג האימון — בדקו לפני אישור, זה ניחוש גס</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="max-h-[32rem] overflow-y-auto space-y-1">
            {levelProposals.map((p) => {
              const w = workoutById.get(p.workoutId)
              const ov = levelOverrides[p.workoutId]
              if (!w || !ov) return null
              return (
                <div key={p.workoutId} className="flex items-center gap-2 text-xs rounded-md bg-muted/40 p-2">
                  <input type="checkbox" checked={ov.checked} onChange={(e) => setLevelOverrides((prev) => ({ ...prev, [p.workoutId]: { ...ov, checked: e.target.checked } }))} />
                  <span className="flex-1 truncate">{w.title}</span>
                  <span className="text-muted-foreground shrink-0">{workoutTypeLabels[w.type]}</span>
                  <span className="text-muted-foreground shrink-0">{w.duration ?? '—'} דק'</span>
                  <select value={ov.level} onChange={(e) => setLevelOverrides((prev) => ({ ...prev, [p.workoutId]: { ...ov, level: e.target.value as ExperienceLevel | '' } }))}
                    className="rounded-md border border-input bg-background px-1.5 py-1 text-xs shrink-0">
                    <option value="">לא בבנק</option>
                    {BANK_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{BANK_LEVEL_LABELS_HE[lvl]}</option>)}
                  </select>
                </div>
              )
            })}
          </div>
          <Button size="sm" onClick={applyLevels} disabled={applying === 'levels'}>
            {applying === 'levels' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
            שייך לבנק
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
