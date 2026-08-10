'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Search,
  Plus,
  Clock,
  Activity,
  ChevronRight,
  Pencil,
  Trash2,
  Loader2,
  Copy,
  Sparkles,
  Download,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { Workout, WorkoutType } from '@/lib/types'
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { isCoachEmail } from '@/lib/constants'
import { workoutTypeColors, useWorkoutTypeLabels } from '@/lib/workout-labels'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

export function WorkoutLibrary() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const workoutTypeLabels = useWorkoutTypeLabels()
  const isCoach = isCoachEmail(user?.email)

  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<WorkoutType | 'all'>('all')
  const [sourceFilter, setSourceFilter] = useState<'all' | 'bakken' | 'coach'>('all')
  const [workouts, setWorkouts] = useState<Workout[]>([])
  // Every workouts/{id} doc referenced by an assignedWorkouts doc with
  // source:'bakken' — Bakken generates its own standalone library entry
  // for every day it creates (bakken-plan-panel.tsx), alongside the
  // assignedWorkouts copy, so those library entries need their own
  // classification since there's no explicit source field on older docs.
  const [bakkenWorkoutIds, setBakkenWorkoutIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [duplicating, setDuplicating] = useState<string | null>(null)
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [workoutsSnap, bakkenAssignedSnap] = await Promise.all([
        getDocs(query(collection(db, 'workouts'), orderBy('createdAt', 'desc'))),
        getDocs(query(collection(db, 'assignedWorkouts'), where('source', '==', 'bakken'))),
      ])
      setBakkenWorkoutIds(new Set(bakkenAssignedSnap.docs.map((d) => d.data().workoutId).filter(Boolean)))
      setWorkouts(
        workoutsSnap.docs
          // Hide per-week clones created by copy-week / paste
          .filter((d) => !d.data().libraryHidden)
          .map((d) => ({
            ...(d.data() as Workout),
            id: d.id,
          })),
      )
    } catch (err) {
      console.error('Error loading workouts:', err)
      setWorkouts([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const isBakken = (workout: Workout) => workout.source === 'bakken' || (!workout.source && bakkenWorkoutIds.has(workout.id))
  const bakkenCount = workouts.filter(isBakken).length
  const coachCount = workouts.length - bakkenCount

  const filteredWorkouts = workouts.filter((workout) => {
    const matchesSearch =
      (workout.title || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (workout.description || '').toLowerCase().includes(searchQuery.toLowerCase())
    const matchesType = typeFilter === 'all' || workout.type === typeFilter
    const matchesSource = sourceFilter === 'all' || (sourceFilter === 'bakken' ? isBakken(workout) : !isBakken(workout))
    return matchesSearch && matchesType && matchesSource
  })

  const handleBulkDeleteBakken = async () => {
    setBulkDeleting(true)
    try {
      const idsToDelete = workouts.filter(isBakken).map((w) => w.id)
      // Firestore batches cap at 500 writes — chunk if the library ever
      // grows past that (unlikely, but cheap to guard against).
      for (let i = 0; i < idsToDelete.length; i += 450) {
        const batch = writeBatch(db)
        for (const id of idsToDelete.slice(i, i + 450)) batch.delete(doc(db, 'workouts', id))
        await batch.commit()
      }
      toast.success(`נמחקו ${idsToDelete.length} אימוני Bakken AI מהספרייה`)
      setBulkDeleteOpen(false)
      await load()
    } catch (err) {
      console.error('Error bulk deleting Bakken workouts:', err)
      toast.error('מחיקה נכשלה')
    } finally {
      setBulkDeleting(false)
    }
  }

  const handleExportCoachWorkouts = () => {
    const coachWorkouts = workouts.filter((w) => !isBakken(w))
    const exportData = coachWorkouts.map((w) => ({
      title: w.title,
      type: w.type,
      description: w.description,
      duration: w.duration,
      distance: w.distance,
      sets: w.sets,
      warmup: w.warmup,
      cooldown: w.cooldown,
      notes: w.notes,
    }))
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `coach-workouts-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const workoutTypes: (WorkoutType | 'all')[] = [
    'all',
    'easy',
    'long_run',
    'tempo',
    'intervals',
    'hill_repeats',
    'fartlek',
    'rest',
  ]

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'workouts', deleteId))
      setWorkouts((prev) => prev.filter((w) => w.id !== deleteId))
      toast.success('Workout deleted')
    } catch (err) {
      console.error('Error deleting workout:', err)
      toast.error('Failed to delete workout')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  const handleDuplicate = async (workout: Workout) => {
    setDuplicating(workout.id)
    try {
      const { id, createdAt, updatedAt, ...rest } = workout
      const newDoc = await addDoc(collection(db, 'workouts'), {
        ...rest,
        title: rest.title + ' (Copy)',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      setWorkouts(prev => [{ ...rest, title: rest.title + ' (Copy)', id: newDoc.id, createdAt: new Date(), updatedAt: new Date() } as Workout, ...prev])
      toast.success('Workout duplicated!')
    } catch (err) {
      console.error('Error duplicating workout:', err)
      toast.error('Failed to duplicate workout')
    } finally {
      setDuplicating(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
            {t.workoutLibraryCardTitle}
          </h1>
          <p className="text-muted-foreground">
            {t.workoutLibrarySubtitle}
          </p>
        </div>
        {isCoach && (
          <Link href="/coach/workouts/new">
            <Button className="bg-gold hover:bg-gold/90 text-navy">
              <Plus className="h-4 w-4 mr-2" />
              {t.createWorkoutAction}
            </Button>
          </Link>
        )}
      </div>

      {/* Search and Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={t.searchWorkoutsPh}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {workoutTypes.map((type) => (
            <Button
              key={type}
              variant="outline"
              size="sm"
              onClick={() => setTypeFilter(type)}
              className={cn(type === typeFilter && 'bg-gold/10 border-gold text-gold')}
            >
              {type === 'all' ? t.all : workoutTypeLabels[type]}
            </Button>
          ))}
        </div>
      </div>

      {/* Source filter + bulk actions — separates Bakken AI-generated
          library clutter from the coach's own real workouts, per explicit
          request to be able to clean up/organize the two separately. */}
      {isCoach && (
        <div className="flex flex-wrap items-center gap-2">
          {([
            { key: 'all' as const, label: `הכל (${workouts.length})` },
            { key: 'coach' as const, label: `שלי (${coachCount})` },
            { key: 'bakken' as const, label: `Bakken AI (${bakkenCount})` },
          ]).map((opt) => (
            <Button
              key={opt.key}
              variant="outline"
              size="sm"
              onClick={() => setSourceFilter(opt.key)}
              className={cn(opt.key === sourceFilter && 'bg-gold/10 border-gold text-gold')}
            >
              {opt.label}
            </Button>
          ))}
          <div className="flex-1" />
          <Button variant="outline" size="sm" onClick={handleExportCoachWorkouts} disabled={coachCount === 0}>
            <Download className="h-3.5 w-3.5 mr-1.5" />
            ייצוא JSON (שלי)
          </Button>
          {bakkenCount > 0 && (
            <Button variant="outline" size="sm" onClick={() => setBulkDeleteOpen(true)} className="text-destructive hover:text-destructive border-destructive/30">
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              מחק את כל אימוני Bakken AI ({bakkenCount})
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gold" />
        </div>
      ) : (
        <>
          {/* Workouts Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredWorkouts.map((workout) => (
              <Card key={workout.id} className="hover:shadow-md transition-luxury">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-1.5">
                      <Badge className={cn('border', workoutTypeColors[workout.type])}>
                        {workoutTypeLabels[workout.type]}
                      </Badge>
                      {isBakken(workout) && (
                        <Badge variant="outline" className="border-primary/30 text-primary text-[10px]">
                          <Sparkles className="h-2.5 w-2.5 mr-1" />Bakken AI
                        </Badge>
                      )}
                    </div>
                    {isCoach && (
                      <div className="flex items-center gap-1">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label="Duplicate workout"
                            onClick={() => handleDuplicate(workout)}
                            disabled={duplicating === workout.id}
                          >
                            {duplicating === workout.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4 text-muted-foreground" />}
                          </Button>
                        <Link href={`/coach/workouts/${workout.id}/edit`}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            aria-label={t.editWorkoutAria}
                          >
                            <Pencil className="h-4 w-4 text-muted-foreground" />
                          </Button>
                        </Link>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteId(workout.id)}
                          aria-label={t.deleteWorkoutAria}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <CardTitle className="text-lg font-semibold text-navy mt-2">
                    {workout.title}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                    {workout.description}
                  </p>

                  <div className="flex flex-wrap gap-3 text-sm text-muted-foreground mb-4">
                    {workout.duration && (
                      <span className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {workout.duration} {t.min}
                      </span>
                    )}
                    {workout.distance && (
                      <span className="flex items-center gap-1">
                        <Activity className="h-4 w-4" />
                        {workout.distance} {t.km}
                      </span>
                    )}
                  </div>

                  {workout.sets && workout.sets.length > 0 && (
                    <div className="mb-4 p-3 rounded-lg bg-muted/50 text-sm">
                      <span className="font-medium text-navy">
                        {workout.sets[0].reps}x{' '}
                        {workout.sets[0].distance || workout.sets[0].duration}
                      </span>
                      {workout.sets[0].pace && (
                        <span className="text-muted-foreground ml-2">
                          @ {workout.sets[0].pace}
                        </span>
                      )}
                    </div>
                  )}

                  <Link href={`/coach/workouts/${workout.id}/assign`}>
                    <Button variant="outline" className="w-full text-gold hover:text-gold/80">
                      {t.assignToAthleteBtn}
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredWorkouts.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {workouts.length === 0
                    ? t.noWorkoutsYet
                    : t.noWorkoutsMatching}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.deleteWorkoutTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {t.deleteWorkoutDesc}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>{t.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? t.deletingDots : t.deleteBtn}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete Bakken AI confirmation */}
      <AlertDialog open={bulkDeleteOpen} onOpenChange={(open) => !open && setBulkDeleteOpen(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת כל אימוני Bakken AI</AlertDialogTitle>
            <AlertDialogDescription>
              פעולה זו תמחק {bakkenCount} אימונים שה-Bakken AI יצר בספרייה. האימונים שאתם יצרתם באופן ידני לא ייפגעו.
              לוח הזמנים שכבר נוצר לספורטאים (assignedWorkouts) לא נמחק — זו מחיקה של תבניות הספרייה בלבד. לא ניתן לבטל פעולה זו.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={bulkDeleting}>ביטול</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBulkDeleteBakken}
              disabled={bulkDeleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {bulkDeleting ? 'מוחק...' : `מחק ${bakkenCount} אימונים`}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
