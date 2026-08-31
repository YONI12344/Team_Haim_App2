'use client'

import { useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { ArrowLeft, Search, Loader2, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { AthleteProfile, Workout } from '@/lib/types'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'
import { workoutTypeColors, useWorkoutTypeLabels } from '@/lib/workout-labels'
import { useWorkoutLibrary } from '@/hooks/useWorkoutLibrary'

interface AthleteRow {
  id: string
  name: string
  email: string
  photoURL?: string
}

const getInitials = (name: string) =>
  name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2) || '?'

/**
 * Step 1 of the streamlined "assign this workout" flow, opened from the
 * Workout Library's "Assign to athlete" button — the workout is already
 * chosen (that's how you got here), so this is just "pick who." Picking an
 * athlete goes straight to their real schedule
 * (components/coach/athlete-planner.tsx) with ?assignWorkoutId=<id> — the
 * planner shows a "placing this workout" banner and skips its own
 * type/workout picker on the next date tap, so the coach lands on the
 * athlete's actual calendar to choose the date, instead of a bare inline
 * date picker with no visibility into what's already scheduled.
 *
 * Replaces the old WorkoutAssign multi-select flow (workout-assign.tsx),
 * which re-showed the whole workout picker, let you multi-select athletes,
 * and redirected to the generic athlete roster on submit rather than the
 * athlete you just assigned to.
 */
export function AssignPickAthlete({ workoutId }: { workoutId: string }) {
  const { t } = useLanguage()
  const router = useRouter()
  const workoutTypeLabels = useWorkoutTypeLabels()
  const { workouts: allWorkouts } = useWorkoutLibrary()

  const [workout, setWorkout] = useState<Workout | null>(null)
  const [athletes, setAthletes] = useState<AthleteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => {
    const found = allWorkouts.find((w) => w.id === workoutId)
    if (found) setWorkout(found)
    else {
      getDoc(doc(db, 'workouts', workoutId)).then((snap) => {
        if (snap.exists()) setWorkout({ ...(snap.data() as Workout), id: snap.id })
      })
    }
  }, [workoutId, allWorkouts])

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'athlete')))
        setAthletes(snap.docs.map((d) => {
          const data = d.data()
          return { id: d.id, name: data.name || data.email || 'Athlete', email: data.email || '', photoURL: data.photoURL }
        }).sort((a, b) => a.name.localeCompare(b.name)))
      } catch (err) {
        console.error('Error loading athletes for assign:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filteredAthletes = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return athletes
    return athletes.filter((a) => a.name.toLowerCase().includes(q) || a.email.toLowerCase().includes(q))
  }, [athletes, searchQuery])

  const pickAthlete = (athleteId: string) => {
    router.push(`/coach/athletes/${athleteId}/planner?assignWorkoutId=${workoutId}`)
  }

  return (
    <div className="space-y-6">
      <Link href="/coach/workouts">
        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />
          {t.backBtn}
        </Button>
      </Link>

      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">למי לשבץ?</h1>
        {workout ? (
          <div className="flex items-center gap-2 mt-1">
            <p className="text-muted-foreground">{workout.title}</p>
            <Badge variant="outline" className={cn('text-xs', workoutTypeColors[workout.type])}>
              {workoutTypeLabels[workout.type]}
            </Badge>
          </div>
        ) : (
          <p className="text-muted-foreground">טוען אימון…</p>
        )}
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="חיפוש ספורטאי..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-gold" />
        </div>
      ) : filteredAthletes.length === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          {athletes.length === 0 ? t.noAthletesSignedUp : 'לא נמצאו ספורטאים תואמים'}
        </p>
      ) : (
        <div className="space-y-2">
          {filteredAthletes.map((athlete) => (
            <button
              key={athlete.id}
              onClick={() => pickAthlete(athlete.id)}
              className="w-full p-4 rounded-lg border border-border hover:bg-muted/50 transition-luxury text-left flex items-center gap-3"
            >
              <Avatar className="h-10 w-10">
                <AvatarImage src={athlete.photoURL} alt={athlete.name} />
                <AvatarFallback className="bg-gold/10 text-gold">{getInitials(athlete.name)}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-navy truncate">{athlete.name}</p>
                <p className="text-sm text-muted-foreground truncate">{athlete.email}</p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
