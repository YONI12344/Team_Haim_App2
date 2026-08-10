'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Plus, Dumbbell, Pencil, X, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { collection, doc, getDocs, orderBy, query, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from 'sonner'
import type { ExperienceLevel, Workout, WorkoutType } from '@/lib/types'
import { workoutTypeColors, useWorkoutTypeLabels } from '@/lib/workout-labels'
import { cn } from '@/lib/utils'

const BANK_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'professional']
const BANK_LEVEL_LABELS_HE: Record<ExperienceLevel, string> = {
  beginner: 'מתחילים', intermediate: 'בינוני', advanced: 'מתקדם', professional: 'עילית',
}

// Coach-authored, real workouts the Bakken AI generator can pick from and
// scale (duration/distance only) instead of inventing content — organized
// as "folders" by athlete level, each grouped by workout type so it's
// obvious at a glance how much variety exists per type (thin coverage =
// the AI will repeat that type more often).
export function WorkoutBankManager() {
  const workoutTypeLabels = useWorkoutTypeLabels()
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [loading, setLoading] = useState(true)
  const [removing, setRemoving] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'workouts'), orderBy('title', 'asc')))
      setWorkouts(snap.docs.map((d) => ({ ...(d.data() as Workout), id: d.id })).filter((w) => !!w.bankLevel))
    } catch (err) {
      console.error('Error loading workout bank:', err)
    } finally {
      setLoading(false)
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

  if (loading) return (
    <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-gold" /></div>
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">בנק אימונים</h2>
          <p className="text-sm text-muted-foreground">
            אימונים אמיתיים שכתבתם, מאורגנים לפי רמת ספורטאי. מאמן ה-AI בקן בוחר ומתאים משך/מרחק מתוכם במקום להמציא תוכן — ככל שיש יותר גרסאות לכל סוג, כך פחות חזרתיות.
          </p>
        </div>
        <Link href="/coach/workouts/new">
          <Button className="bg-gold hover:bg-gold/90 text-navy"><Plus className="h-4 w-4 mr-2" />אימון חדש</Button>
        </Link>
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
                Array.from(byType.entries()).map(([type, items]) => (
                  <div key={type}>
                    <p className="text-xs font-medium text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <span className={cn('inline-block px-1.5 py-0.5 rounded border text-[10px]', workoutTypeColors[type])}>
                        {workoutTypeLabels[type]}
                      </span>
                      <span>{items.length} גרסאות</span>
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {items.map((w) => (
                        <Card key={w.id}>
                          <CardContent className="p-2.5 flex items-center justify-between gap-2">
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">{w.title}</p>
                              <p className="text-xs text-muted-foreground">
                                {w.duration ? `${w.duration} דק'` : ''}{w.duration && w.distance ? ' · ' : ''}{w.distance ? `${w.distance} ק"מ` : ''}
                              </p>
                            </div>
                            <div className="flex gap-1 shrink-0">
                              <Link href={`/coach/workouts/${w.id}/edit`}>
                                <Button variant="ghost" size="icon" className="h-7 w-7"><Pencil className="h-3.5 w-3.5" /></Button>
                              </Link>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive"
                                onClick={() => removeFromBank(w)} disabled={removing === w.id}>
                                {removing === w.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                              </Button>
                            </div>
                          </CardContent>
                        </Card>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </details>
        )
      })}
    </div>
  )
}
