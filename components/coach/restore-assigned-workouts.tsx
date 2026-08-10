'use client'

/**
 * Recovery tool for a specific incident: the Bank Cleanup wizard's
 * duplicate-deletion deleted workouts/{id} docs that were still
 * referenced (by workoutId) from assignedWorkouts — i.e. real days on
 * real athletes' schedules. Those days are NOT actually broken (each
 * assignedWorkouts doc embeds a full snapshot of the workout, not just a
 * reference — see athlete-planner-view.tsx, which only ever reads
 * w.workout, never re-fetches by workoutId), but the workout is gone
 * from the reusable library/bank, and editing that specific assigned
 * instance would now fail (WorkoutBuilder's edit path does
 * updateDoc(workouts/{workoutId}, ...), which errors on a missing doc).
 *
 * This scans every assignedWorkouts doc, finds ones whose workoutId no
 * longer exists in the workouts collection, and re-creates that doc at
 * the SAME id from the embedded snapshot — so existing workoutId
 * references start resolving again and the workout reappears in the
 * library/bank.
 */

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AlertTriangle, Loader2, RotateCcw } from 'lucide-react'
import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from 'sonner'
import type { AssignedWorkout, Workout } from '@/lib/types'
import { useWorkoutTypeLabels } from '@/lib/workout-labels'

interface MissingEntry {
  workoutId: string
  workout: Workout
  athleteIds: Set<string>
  count: number
}

const richness = (w: Workout) =>
  (w.warmup ? 1 : 0) + (w.cooldown ? 1 : 0) + (w.notes ? 1 : 0) + (w.description ? 1 : 0) + ((w.sets?.length || 0) > 0 ? 1 : 0)

export function RestoreAssignedWorkouts() {
  const workoutTypeLabels = useWorkoutTypeLabels()
  const [loading, setLoading] = useState(true)
  const [missing, setMissing] = useState<MissingEntry[]>([])
  const [checked, setChecked] = useState<Record<string, boolean>>({})
  const [restoring, setRestoring] = useState(false)
  const [scannedCount, setScannedCount] = useState(0)

  const scan = async () => {
    setLoading(true)
    try {
      const [workoutsSnap, assignedSnap] = await Promise.all([
        getDocs(collection(db, 'workouts')),
        getDocs(collection(db, 'assignedWorkouts')),
      ])
      const existingIds = new Set(workoutsSnap.docs.map((d) => d.id))
      setScannedCount(assignedSnap.size)

      const byId = new Map<string, MissingEntry>()
      for (const d of assignedSnap.docs) {
        const aw = d.data() as AssignedWorkout
        const wid = aw.workoutId
        if (!wid || existingIds.has(wid) || !aw.workout) continue
        const existing = byId.get(wid)
        if (!existing) {
          byId.set(wid, { workoutId: wid, workout: aw.workout, athleteIds: new Set([aw.athleteId]), count: 1 })
        } else {
          existing.count++
          existing.athleteIds.add(aw.athleteId)
          if (richness(aw.workout) > richness(existing.workout)) existing.workout = aw.workout
        }
      }
      const list = Array.from(byId.values()).sort((a, b) => b.count - a.count)
      setMissing(list)
      setChecked(Object.fromEntries(list.map((m) => [m.workoutId, true])))
    } catch (err) {
      console.error('Error scanning for missing assigned workouts:', err)
      toast.error('הסריקה נכשלה')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { scan() }, [])

  const restoreSelected = async () => {
    const toRestore = missing.filter((m) => checked[m.workoutId])
    if (toRestore.length === 0) return
    setRestoring(true)
    let done = 0
    try {
      for (const m of toRestore) {
        const { id: _drop, ...rest } = m.workout as any
        await setDoc(doc(db, 'workouts', m.workoutId), {
          ...rest,
          libraryHidden: false,
          source: rest.source || 'coach',
          restoredAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          createdAt: rest.createdAt || serverTimestamp(),
        })
        done++
      }
      toast.success(`שוחזרו ${done} אימונים לספרייה`)
      setMissing((prev) => prev.filter((m) => !checked[m.workoutId]))
    } catch (err) {
      console.error('Error restoring workouts:', err)
      toast.error(`שוחזרו ${done} מתוך ${toRestore.length} — אירעה שגיאה, נסו שוב`)
      await scan()
    } finally {
      setRestoring(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gold" /></div>
  )

  return (
    <div className="space-y-4">
      <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 flex items-start gap-2">
        <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold text-red-800">שחזור אימונים שנמחקו מהספרייה</p>
          <p className="text-xs text-red-700 mt-1">
            נסרקו {scannedCount} שיבוצים אצל ספורטאים. הימים עצמם בלוח הזמנים של הספורטאים <b>לא נפגעו</b> — כל שיבוץ שומר עותק מלא של האימון בתוכו.
            הבעיה היא רק שהאימון נמחק מהספרייה/הבנק, כך שלא ניתן יותר לבחור אותו מחדש, ועריכת השיבוץ הספציפי הזה עלולה להיכשל.
            הרשימה למטה היא כל האימונים החסרים שעדיין בשימוש אצל ספורטאים — סמנו ולחצו שחזור כדי להחזיר אותם לספרייה.
          </p>
        </div>
      </div>

      {missing.length === 0 ? (
        <p className="text-sm text-muted-foreground py-4 text-center">לא נמצאו אימונים חסרים — כל השיבוצים מצביעים על אימון קיים בספרייה.</p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">{missing.length} אימונים חסרים נמצאו, בשימוש ב-{missing.reduce((s, m) => s + m.count, 0)} שיבוצים</p>
            <Button onClick={restoreSelected} disabled={restoring || missing.every((m) => !checked[m.workoutId])} className="bg-gold hover:bg-gold/90 text-navy">
              {restoring ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <RotateCcw className="h-4 w-4 mr-2" />}
              שחזר {missing.filter((m) => checked[m.workoutId]).length} אימונים לספרייה
            </Button>
          </div>
          <div className="space-y-2">
            {missing.map((m) => (
              <Card key={m.workoutId}>
                <CardContent className="p-3 flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={!!checked[m.workoutId]}
                    onChange={(e) => setChecked((p) => ({ ...p, [m.workoutId]: e.target.checked }))}
                    className="mt-1"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{m.workout.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {workoutTypeLabels[m.workout.type] || m.workout.type}
                      {m.workout.duration ? ` · ${m.workout.duration} דק'` : ''}
                      {m.workout.distance ? ` · ${m.workout.distance} ק"מ` : ''}
                      {m.workout.bankLevel ? ` · בבנק: ${m.workout.bankLevel}` : ''}
                      {' · '}{m.count} שיבוצים אצל {m.athleteIds.size} ספורטאים
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
