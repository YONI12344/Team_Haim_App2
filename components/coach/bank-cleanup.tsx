'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, AlertTriangle, Copy, FolderTree, Sparkles, Trash2 } from 'lucide-react'
import { addDoc, collection, doc, getDocs, serverTimestamp, writeBatch } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import type { ExperienceLevel, Workout } from '@/lib/types'
import { useWorkoutTypeLabels } from '@/lib/workout-labels'
import {
  findEmptyStubs, findBadDurations, findBadReps, findExactDuplicates, proposeTitleDisambiguation, proposeLevel,
  findCoverageGaps, buildAdaptedWorkout, LEVEL_LABEL_HE,
  type WorkoutFlag, type TitleProposal, type CoverageGap, type DuplicateGroup,
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
  const { user } = useAuth()
  const workoutTypeLabels = useWorkoutTypeLabels()
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState<string | null>(null)
  // Coverage-gap section: per-gap opt-in (keyed by type+targetLevel)
  const [gapOverrides, setGapOverrides] = useState<Record<string, boolean>>({})

  // Bug section: per-flag editable overrides + opt-in checkbox
  const [bugOverrides, setBugOverrides] = useState<Record<string, { checked: boolean; duration?: number }>>({})
  // Exact-duplicates section: per-group (keyed by keepWorkoutId) editable title + opt-in
  const [dupOverrides, setDupOverrides] = useState<Record<string, { checked: boolean; title: string }>>({})
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
  const exactDuplicates = useMemo(() => findExactDuplicates(workouts), [workouts])
  const titleProposals = useMemo(() => proposeTitleDisambiguation(workouts), [workouts])
  const levelProposals = useMemo(() => workouts.map(proposeLevel), [workouts])
  const coverageGaps = useMemo(() => findCoverageGaps(workouts), [workouts])
  const gapKey = (g: CoverageGap) => `${g.type}::${g.targetLevel}`

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
    setDupOverrides((prev) => {
      const next = { ...prev }
      for (const g of exactDuplicates) if (!next[g.keepWorkoutId]) next[g.keepWorkoutId] = { checked: true, title: g.proposedTitle }
      return next
    })
  }, [exactDuplicates])

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

  useEffect(() => {
    setGapOverrides((prev) => {
      const next = { ...prev }
      for (const g of coverageGaps) { const k = gapKey(g); if (next[k] === undefined) next[k] = true }
      return next
    })
  }, [coverageGaps])

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

  const applyDuplicates = async () => {
    setApplying('duplicates')
    try {
      const ops: Array<{ id: string; data: Record<string, unknown> } | { id: string; delete: true }> = []
      let keptCount = 0, deletedCount = 0
      for (const g of exactDuplicates) {
        const ov = dupOverrides[g.keepWorkoutId]
        if (!ov?.checked) continue
        ops.push({ id: g.keepWorkoutId, data: { title: ov.title } })
        keptCount++
        for (const id of g.deleteWorkoutIds) { ops.push({ id, delete: true }); deletedCount++ }
      }
      await commitInChunks(ops)
      toast.success(`נשמרו ${keptCount} אימונים, נמחקו ${deletedCount} עותקים כפולים`)
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

  const applyGaps = async () => {
    setApplying('gaps')
    try {
      const checked = coverageGaps.filter((g) => gapOverrides[gapKey(g)])
      let created = 0
      for (const g of checked) {
        const template = workoutById.get(g.templateWorkoutId)
        if (!template) continue
        const adapted = buildAdaptedWorkout(template, g.targetLevel)
        await addDoc(collection(db, 'workouts'), {
          ...adapted,
          source: 'coach',
          createdBy: user?.id || null,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        created++
      }
      toast.success(`נוצרו ${created} אימונים מותאמים`)
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

      {/* Section 2: exact duplicates — same title+duration+distance = the
          same workout saved multiple times, not legitimate variety */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Trash2 className="h-4 w-4 text-destructive" />כפילויות מדויקות ({exactDuplicates.length} קבוצות, {exactDuplicates.reduce((s, g) => s + g.deleteWorkoutIds.length, 0)} עותקים)</CardTitle>
          <CardDescription>אותו שם + משך + מרחק = אותו אימון שנשמר כמה פעמים — שומר עותק אחד (העשיר ביותר), מוחק את השאר, ומוסיף את הק"מ לשם</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {exactDuplicates.length === 0 ? (
            <p className="text-sm text-muted-foreground">לא נמצאו כפילויות מדויקות.</p>
          ) : (
            <>
              <div className="max-h-96 overflow-y-auto space-y-1.5">
                {exactDuplicates.map((g) => {
                  const ov = dupOverrides[g.keepWorkoutId]
                  if (!ov) return null
                  return (
                    <div key={g.keepWorkoutId} className="flex items-center gap-2 text-xs rounded-md bg-destructive/5 p-2">
                      <input type="checkbox" checked={ov.checked} onChange={(e) => setDupOverrides((prev) => ({ ...prev, [g.keepWorkoutId]: { ...ov, checked: e.target.checked } }))} />
                      <span className="text-muted-foreground shrink-0">שומר:</span>
                      <Input value={ov.title} onChange={(e) => setDupOverrides((prev) => ({ ...prev, [g.keepWorkoutId]: { ...ov, title: e.target.value } }))}
                        className="h-7 flex-1 text-xs" dir="auto" />
                      <span className="text-destructive shrink-0">מוחק {g.deleteWorkoutIds.length} עותקים</span>
                    </div>
                  )
                })}
              </div>
              <Button size="sm" onClick={applyDuplicates} disabled={applying === 'duplicates'} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {applying === 'duplicates' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                נקה כפילויות
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Section 3: title disambiguation */}
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

      {/* Section 4: bank level inference */}
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

      {/* Section 5: coverage gaps — adapted copies for missing levels */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2"><Sparkles className="h-4 w-4 text-gold" />פערי כיסוי — יצירת אימונים מותאמים ({coverageGaps.length})</CardTitle>
          <CardDescription>
            לכל סוג אימון שכבר יש לו לפחות רמה אחת בבנק, אבל חסר ברמות אחרות — יוצר עותק מהאימון הקרוב ביותר: אותו מבנה ונוסח בדיוק, כמות החזרות (ולכן משך/מרחק כולל) מותאמת לרמה, וחימום/שחרור מוחלפים בתבנית האמיתית שלכם לרמה הזו. תלוי בשיוך הרמות למעלה — הריצו את "שייך לבנק" קודם.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {coverageGaps.length === 0 ? (
            <p className="text-sm text-muted-foreground">אין פערי כיסוי כרגע (או שעדיין לא שויכו רמות בבנק למעלה).</p>
          ) : (
            <>
              <div className="max-h-96 overflow-y-auto space-y-1.5">
                {coverageGaps.map((g) => {
                  const template = workoutById.get(g.templateWorkoutId)
                  if (!template) return null
                  const k = gapKey(g)
                  const preview = buildAdaptedWorkout(template, g.targetLevel)
                  return (
                    <div key={k} className="flex items-center gap-2 text-xs rounded-md bg-muted/40 p-2">
                      <input type="checkbox" checked={!!gapOverrides[k]} onChange={(e) => setGapOverrides((prev) => ({ ...prev, [k]: e.target.checked }))} />
                      <span className="text-muted-foreground shrink-0">{workoutTypeLabels[g.type]}</span>
                      <span className="shrink-0 font-medium">{LEVEL_LABEL_HE[g.targetLevel]}</span>
                      <span className="text-muted-foreground shrink-0">←</span>
                      <span className="text-muted-foreground truncate">{template.title} ({LEVEL_LABEL_HE[g.templateLevel]})</span>
                      <span className="flex-1 truncate">→ {preview.title}, {preview.sets?.[0]?.reps ?? '—'}× , {preview.duration ?? '—'} דק' , {preview.distance ?? '—'} ק"מ</span>
                    </div>
                  )
                })}
              </div>
              <Button size="sm" onClick={applyGaps} disabled={applying === 'gaps'}>
                {applying === 'gaps' ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                צור אימונים מסומנים
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
