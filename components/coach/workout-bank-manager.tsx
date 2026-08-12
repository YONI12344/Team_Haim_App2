'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Plus, Dumbbell, Pencil, X, Trash2, Loader2, FolderInput, PackagePlus } from 'lucide-react'
import Link from 'next/link'
import { collection, deleteDoc, doc, getDoc, getDocs, orderBy, query, updateDoc, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from 'sonner'
import type { ExperienceLevel, Workout, WorkoutType } from '@/lib/types'
import { workoutTypeColors, useWorkoutTypeLabels } from '@/lib/workout-labels'
import { cn } from '@/lib/utils'
import { WorkoutBuilder } from '@/components/coach/workout-builder'

const BANK_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'professional']
const BANK_LEVEL_LABELS_HE: Record<ExperienceLevel, string> = {
  beginner: 'מתחילים', intermediate: 'בינוני', advanced: 'מתקדם', professional: 'עילית',
}

function QuickMoveForm({ workout, onSaved, onCancel }: { workout: Workout; onSaved: () => void; onCancel: () => void }) {
  const [level, setLevel] = useState<ExperienceLevel | ''>(workout.bankLevel || '')
  const [stage, setStage] = useState(workout.bankStage || '')
  const [order, setOrder] = useState<number | ''>(workout.bankOrder ?? '')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      await updateDoc(doc(db, 'workouts', workout.id), {
        bankLevel: level || null,
        bankStage: level ? (stage.trim() || null) : null,
        bankOrder: level && order !== '' ? Number(order) : null,
      })
      toast.success('עודכן')
      onSaved()
    } catch (err) {
      console.error('Error moving bank workout:', err)
      toast.error('העדכון נכשל')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-2.5 pt-0 space-y-1.5 border-t border-border/50 mt-2">
      <div className="grid grid-cols-2 gap-1.5">
        <select value={level} onChange={(e) => setLevel(e.target.value as ExperienceLevel | '')}
          className="rounded-md border border-input bg-background px-1.5 py-1 text-[11px]">
          <option value="">לא בבנק</option>
          {BANK_LEVELS.map((lvl) => <option key={lvl} value={lvl}>{BANK_LEVEL_LABELS_HE[lvl]}</option>)}
        </select>
        <Input type="number" placeholder="סדר" value={order}
          onChange={(e) => setOrder(e.target.value === '' ? '' : Number(e.target.value))}
          className="h-7 text-[11px]" disabled={!level} />
      </div>
      <Input placeholder="שלב (לא חובה, למשל ריצה-הליכה שלב 1)" value={stage}
        onChange={(e) => setStage(e.target.value)} className="h-7 text-[11px]" disabled={!level} dir="auto" />
      <div className="flex gap-1.5">
        <Button size="sm" className="h-7 text-[11px] flex-1" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'שמור'}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={onCancel} disabled={saving}>ביטול</Button>
      </div>
    </div>
  )
}

function BankItemGrid({ items, onRemove, onDelete, removing, deleting, onMoved, onEdit }: {
  items: Workout[]; onRemove: (w: Workout) => void; onDelete: (w: Workout) => void
  removing: string | null; deleting: string | null; onMoved: () => void; onEdit: (w: Workout) => void
}) {
  const [movingId, setMovingId] = useState<string | null>(null)
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
      {items.map((w) => (
        <Card key={w.id}>
          <CardContent className="p-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{w.title}</p>
                <p className="text-xs text-muted-foreground">
                  {w.duration ? `${w.duration} דק'` : ''}{w.duration && w.distance ? ' · ' : ''}{w.distance ? `${w.distance} ק"מ` : ''}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7" title="העברה מהירה"
                  onClick={() => setMovingId(movingId === w.id ? null : w.id)}>
                  <FolderInput className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="עריכה" onClick={() => onEdit(w)}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7" title="הסרה מהבנק — נשאר בספריית האימונים"
                  onClick={() => onRemove(w)} disabled={removing === w.id}>
                  {removing === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                </Button>
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="מחיקה לצמיתות"
                  onClick={() => onDelete(w)} disabled={deleting === w.id}>
                  {deleting === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
            {movingId === w.id && (
              <QuickMoveForm workout={w} onCancel={() => setMovingId(null)} onSaved={() => { setMovingId(null); onMoved() }} />
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// Coach-authored, real workouts the Bakken AI generator can pick from and
// scale (duration/distance only) instead of inventing content — organized
// as "folders" by athlete level, then by type, then (when the coach sets
// it) by progression stage/order — a beginner in week 1 (run/walk 40s)
// needs very different content than a beginner in week 8 (near
// continuous), so a flat pile of "beginner easy" workouts isn't enough on
// its own; bankStage/bankOrder let a coach build an explicit ladder.
// Quick-move (FolderInput icon on each card) reassigns level/stage/order
// in place without opening the full workout builder.
export function WorkoutBankManager() {
  const workoutTypeLabels = useWorkoutTypeLabels()
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  // Editing opens in a dialog over the current scroll position/open
  // folders instead of navigating to /coach/workouts/[id]/edit — the old
  // Link-based flow "jumped" away from wherever the coach was browsing.
  const [editingWorkout, setEditingWorkout] = useState<Workout | null>(null)
  const [backfilling, setBackfilling] = useState(false)

  // `silent` skips the full-page spinner — used after an in-place edit so
  // the refresh doesn't blow away scroll position and open <details>.
  const load = async (silent = false) => {
    if (!silent) setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'workouts'), orderBy('title', 'asc')))
      setWorkouts(snap.docs.map((d) => ({ ...(d.data() as Workout), id: d.id })).filter((w) => !!w.bankLevel))
    } catch (err) {
      console.error('Error loading workout bank:', err)
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const removeFromBank = async (workout: Workout) => {
    setRemoving(workout.id)
    try {
      await updateDoc(doc(db, 'workouts', workout.id), { bankLevel: null })
      setWorkouts((prev) => prev.filter((w) => w.id !== workout.id))
      toast.success('הוסר מהבנק')
    } catch (err) {
      console.error('Error removing from bank:', err)
      toast.error('הפעולה נכשלה')
    } finally {
      setRemoving(null)
    }
  }

  // Full delete — removes the workout doc entirely, not just its bank
  // folder tag. Already-assigned copies on athletes' schedules keep an
  // embedded snapshot of the workout, so deleting the library entry
  // doesn't affect days already scheduled.
  const deleteWorkoutEntirely = async (workout: Workout) => {
    if (!confirm(`למחוק לצמיתות את "${workout.title}"? הפעולה לא ניתנת לביטול. אימונים שכבר שובצו לספורטאים לא יושפעו.`)) return
    setDeleting(workout.id)
    try {
      await deleteDoc(doc(db, 'workouts', workout.id))
      setWorkouts((prev) => prev.filter((w) => w.id !== workout.id))
      toast.success('נמחק לצמיתות')
    } catch (err) {
      console.error('Error deleting workout:', err)
      toast.error('המחיקה נכשלה')
    } finally {
      setDeleting(null)
    }
  }

  // One-time catch-up: workouts already assigned to athletes that never
  // made it into the bank (built before this existed, or via a flow that
  // doesn't auto-tag). Only looks at the last month — older assignments
  // reflect a level the athlete may have since moved past, and going
  // forward new assignments already auto-tag themselves (see
  // components/coach/athlete-planner.tsx assignWorkoutToDate /
  // handleCreateWorkout), so this never needs to run as an ongoing sync.
  const handleBackfillFromAssigned = async () => {
    setBackfilling(true)
    try {
      const cutoff = new Date()
      cutoff.setMonth(cutoff.getMonth() - 1)
      const cutoffStr = cutoff.toISOString().slice(0, 10)
      const assignedSnap = await getDocs(query(collection(db, 'assignedWorkouts'), where('scheduledDate', '>=', cutoffStr)))

      const athleteLevelCache = new Map<string, ExperienceLevel | null>()
      const seenWorkoutIds = new Set<string>()
      const plan: { workoutId: string; level: ExperienceLevel }[] = []

      for (const d of assignedSnap.docs) {
        const aw = d.data() as { workoutId?: string; athleteId?: string }
        const workoutId = aw.workoutId
        if (!workoutId || seenWorkoutIds.has(workoutId)) continue
        seenWorkoutIds.add(workoutId)

        const wSnap = await getDoc(doc(db, 'workouts', workoutId))
        if (!wSnap.exists() || wSnap.data().bankLevel) continue

        const athleteId = aw.athleteId
        if (!athleteId) continue
        if (!athleteLevelCache.has(athleteId)) {
          const uSnap = await getDoc(doc(db, 'users', athleteId))
          athleteLevelCache.set(athleteId, (uSnap.exists() ? uSnap.data().experienceLevel : null) || null)
        }
        const level = athleteLevelCache.get(athleteId)
        if (!level) continue

        plan.push({ workoutId, level })
      }

      if (plan.length === 0) {
        toast.info('אין אימונים חסרים להוספה לבנק (בחודש האחרון)')
        return
      }
      if (!confirm(`נמצאו ${plan.length} אימונים ששובצו בחודש האחרון ועדיין לא בבנק. להוסיף אותם עכשיו לרמה המתאימה לספורטאי?`)) return

      for (const item of plan) {
        await updateDoc(doc(db, 'workouts', item.workoutId), { bankLevel: item.level })
      }
      toast.success(`נוספו ${plan.length} אימונים לבנק`)
      await load(true)
    } catch (err) {
      console.error('Error backfilling workout bank from assigned workouts:', err)
      toast.error('הפעולה נכשלה')
    } finally {
      setBackfilling(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gold" /></div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">בנק אימונים</h2>
          <p className="text-sm text-muted-foreground">
            אימונים אמיתיים שכתבתם, מאורגנים לפי רמת ספורטאי ושלב התקדמות. מאמן ה-AI בקן בוחר ומתאים משך/מרחק מתוכם במקום להמציא תוכן — ככל שיש יותר גרסאות לכל סוג, כך פחות חזרתיות. השתמשו בסמל התיקייה על כל אימון כדי להעביר אותו במהירות בין רמות/שלבים.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleBackfillFromAssigned} disabled={backfilling} title="מוסיף לבנק אימונים ששובצו לספורטאים בחודש האחרון ועדיין לא בבנק">
            {backfilling ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <PackagePlus className="h-4 w-4 mr-2" />}
            השלם מאימונים ששובצו
          </Button>
          <Link href="/coach/workouts/new">
            <Button className="bg-gold hover:bg-gold/90 text-navy"><Plus className="h-4 w-4 mr-2" />אימון חדש</Button>
          </Link>
        </div>
      </div>

      {BANK_LEVELS.map((level) => {
        const levelWorkouts = workouts.filter((w) => w.bankLevel === level)
        const byType = new Map<WorkoutType, Workout[]>()
        for (const w of levelWorkouts) {
          if (!byType.has(w.type)) byType.set(w.type, [])
          byType.get(w.type)!.push(w)
        }
        return (
          <details key={level} open={levelWorkouts.length > 0} className="rounded-lg border border-border">
            <summary className="cursor-pointer select-none px-4 py-3 flex items-center gap-2 font-semibold">
              <Dumbbell className="h-4 w-4 text-gold" />
              {BANK_LEVEL_LABELS_HE[level]}
              <span className="text-xs font-normal text-muted-foreground">({levelWorkouts.length} אימונים, {byType.size} סוגים)</span>
            </summary>
            <div className="px-4 pb-4 space-y-4">
              {levelWorkouts.length === 0 ? (
                <p className="text-sm text-muted-foreground py-2">אין עדיין אימונים ברמה הזו בבנק.</p>
              ) : (
                Array.from(byType.entries()).map(([type, typeItems]) => {
                  const items = [...typeItems].sort((a, b) => (a.bankOrder ?? 999) - (b.bankOrder ?? 999))
                  const byStage = new Map<string, Workout[]>()
                  for (const w of items) {
                    const key = w.bankStage || ''
                    if (!byStage.has(key)) byStage.set(key, [])
                    byStage.get(key)!.push(w)
                  }
                  const hasStages = Array.from(byStage.keys()).some((k) => k !== '')
                  return (
                    <div key={type}>
                      <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                        <span className={cn('inline-block px-1.5 py-0.5 rounded border text-[10px]', workoutTypeColors[type])}>
                          {workoutTypeLabels[type]}
                        </span>
                        <span>{items.length} גרסאות</span>
                      </p>
                      {hasStages ? (
                        <div className="space-y-2">
                          {Array.from(byStage.entries()).map(([stage, stageItems]) => (
                            <div key={stage || '_none'}>
                              {stage && <p className="text-[11px] text-muted-foreground mb-1">↳ {stage}</p>}
                              <BankItemGrid items={stageItems} onRemove={removeFromBank} onDelete={deleteWorkoutEntirely} removing={removing} deleting={deleting} onMoved={() => load(true)} onEdit={setEditingWorkout} />
                            </div>
                          ))}
                        </div>
                      ) : (
                        <BankItemGrid items={items} onRemove={removeFromBank} onDelete={deleteWorkoutEntirely} removing={removing} deleting={deleting} onMoved={() => load(true)} onEdit={setEditingWorkout} />
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </details>
        )
      })}

      {/* In-place edit — opens over whichever folder/scroll position the
          coach was at instead of navigating to a separate page. */}
      <Dialog open={!!editingWorkout} onOpenChange={(open) => { if (!open) setEditingWorkout(null) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>עריכת אימון</DialogTitle>
          </DialogHeader>
          {editingWorkout && (
            <WorkoutBuilder
              workoutId={editingWorkout.id}
              hideBackButton
              onDone={() => { setEditingWorkout(null); load(true) }}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
