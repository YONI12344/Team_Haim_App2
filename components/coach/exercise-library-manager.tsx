'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
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
import { Plus, Pencil, Trash2, Loader2, Dumbbell, Video, Timer, Download, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { isCoachEmail } from '@/lib/constants'
import type { ExerciseLibraryItem } from '@/lib/types'
import { listExercises, deleteExercise } from '@/lib/exercise-library'
import { BODY_ZONES } from '@/lib/injury-data'
import { seedRunningStrengthProgram } from '@/lib/seed-running-strength-program'
import { seedRunnerStretchProgram } from '@/lib/seed-runner-stretch-program'
import { seedStrapStretchProgram } from '@/lib/seed-strap-stretch-program'
import { seedAncillaryRoutines } from '@/lib/seed-ancillary-routines'
import { ExerciseEditDialog } from '@/components/coach/exercise-edit-dialog'
import { cn } from '@/lib/utils'

const CATEGORY_OPTIONS: { value: 'strength' | 'stretch' | 'warmup'; label: string }[] = [
  { value: 'strength', label: 'כוח' },
  { value: 'stretch', label: 'מתיחות' },
  { value: 'warmup', label: 'חימום / הפעלה' },
]

export function ExerciseLibraryManager() {
  const { user } = useAuth()
  const isCoach = isCoachEmail(user?.email)

  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ExerciseLibraryItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [filterCategory, setFilterCategory] = useState<'strength' | 'stretch' | 'warmup'>('strength')
  const [importingKey, setImportingKey] = useState<'strength' | 'stretch' | 'strap' | 'ancillary' | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      setExercises(await listExercises())
    } catch (err) {
      console.error('Error loading exercise library:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openAdd = () => {
    setEditingId(null)
    setDialogOpen(true)
  }

  const openEdit = (exercise: ExerciseLibraryItem) => {
    setEditingId(exercise.id)
    setDialogOpen(true)
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteExercise(deleteTarget)
      toast.success('התרגיל נמחק')
      setDeleteTarget(null)
      await load()
    } catch (err) {
      console.error('Error deleting exercise:', err)
      toast.error('מחיקת התרגיל נכשלה')
    } finally {
      setDeleting(false)
    }
  }

  const handleImportRunningProgram = async () => {
    if (!user) return
    setImportingKey('strength')
    try {
      const result = await seedRunningStrengthProgram(user.id || '')
      if (result.alreadyExisted) {
        toast.info('התוכנית כבר יובאה בעבר')
      } else {
        toast.success(`יובאו ${result.exerciseCount} תרגילים ואימון "חיזוקים לריצה" — זמין בספריית האימונים`)
        await load()
      }
    } catch (err) {
      console.error('Error importing running strength program:', err)
      toast.error('הייבוא נכשל')
    } finally {
      setImportingKey(null)
    }
  }

  const handleImportStretchProgram = async () => {
    if (!user) return
    setImportingKey('stretch')
    try {
      const result = await seedRunnerStretchProgram(user.id || '')
      if (result.alreadyExisted) {
        toast.info('שגרת המתיחות כבר יובאה בעבר')
      } else {
        toast.success(`יובאו ${result.exerciseCount} מתיחות ואימון "מתיחות סטטיות לרצים" — זמין בספריית האימונים`)
        await load()
      }
    } catch (err) {
      console.error('Error importing stretch program:', err)
      toast.error('הייבוא נכשל')
    } finally {
      setImportingKey(null)
    }
  }

  const handleImportStrapProgram = async () => {
    if (!user) return
    setImportingKey('strap')
    try {
      const result = await seedStrapStretchProgram(user.id || '')
      if (result.alreadyExisted) {
        toast.info('שגרת הרצועה כבר יובאה בעבר')
      } else {
        toast.success(`יובאו ${result.exerciseCount} מתיחות ואימון "מתיחות מתקדמות: רצועה וניידות" — זמין בספריית האימונים`)
        await load()
      }
    } catch (err) {
      console.error('Error importing strap stretch program:', err)
      toast.error('הייבוא נכשל')
    } finally {
      setImportingKey(null)
    }
  }

  const handleImportAncillaryRoutines = async () => {
    if (!user) return
    setImportingKey('ancillary')
    try {
      const result = await seedAncillaryRoutines(user.id || '')
      if (result.alreadyExisted) {
        toast.info('שגרות החימום כבר יובאו בעבר')
      } else {
        toast.success(`יובאו ${result.exerciseCount} תרגילים ו-${result.workoutsCreated.length} שגרות (חימום קל, חימום מלא, הפעלה ספציפית, מתיחות עם חבל, משקולות קרסול)`)
        await load()
      }
    } catch (err) {
      console.error('Error importing ancillary routines:', err)
      toast.error('הייבוא נכשל')
    } finally {
      setImportingKey(null)
    }
  }

  if (!isCoach) return null

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">ספריית תרגילים</h2>
          <p className="text-xs text-muted-foreground">
            תרגילים לאימוני כוח ומתיחות — שם, סרטון הדגמה, הוראות, סטים/חזרות או זמן ברירת מחדל. נבחרים בבניית אימון ומופיעים לספורטאי במצב אימון.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={handleImportRunningProgram} disabled={importingKey !== null} size="sm" variant="outline">
            {importingKey === 'strength' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
            ייבוא: חיזוקים לריצה
          </Button>
          <Button onClick={handleImportStretchProgram} disabled={importingKey !== null} size="sm" variant="outline">
            {importingKey === 'stretch' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
            ייבוא: מתיחות סטטיות
          </Button>
          <Button onClick={handleImportStrapProgram} disabled={importingKey !== null} size="sm" variant="outline">
            {importingKey === 'strap' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
            ייבוא: מתיחות עם רצועה
          </Button>
          <Button onClick={handleImportAncillaryRoutines} disabled={importingKey !== null} size="sm" variant="outline">
            {importingKey === 'ancillary' ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Download className="h-4 w-4 mr-1" />}
            ייבוא: שגרות חימום (GW)
          </Button>
          <Button onClick={openAdd} size="sm"><Plus className="h-4 w-4 mr-1" />הוסף תרגיל</Button>
        </div>
      </div>

      <div className="flex gap-1.5">
        {CATEGORY_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => setFilterCategory(opt.value)}
            className={cn(
              'px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors',
              filterCategory === opt.value ? 'bg-[#0a1628] text-white border-[#0a1628]' : 'bg-white text-gray-500 border-gray-200',
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {(() => {
        const visible = exercises.filter((ex) => (ex.category || 'strength') === filterCategory)
        if (loading) {
          return <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        }
        if (visible.length === 0) {
          return (
            <div className="text-center py-10 text-muted-foreground">
              <Dumbbell className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">אין עדיין תרגילים בקטגוריה הזו</p>
            </div>
          )
        }
        return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {visible.map((ex) => (
            <Card key={ex.id}>
              <CardContent className="p-3 space-y-2">
                {ex.videoUrl ? (
                  <video src={ex.videoUrl} className="w-full rounded-md aspect-video object-cover bg-muted" muted playsInline preload="metadata" />
                ) : (
                  <div className="w-full aspect-video rounded-md bg-muted flex items-center justify-center text-muted-foreground">
                    <Video className="h-6 w-6 opacity-40" />
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-semibold">{ex.name}</p>
                    {ex.isTimed && <Timer className="h-3 w-3 text-[#c9a84c] shrink-0" />}
                    {ex.videoMuted && <VolumeX className="h-3 w-3 text-muted-foreground shrink-0" />}
                  </div>
                  {ex.isTimed ? (
                    ex.defaultDurationSec != null && (
                      <p className="text-xs text-muted-foreground">{ex.defaultDurationSec} שניות{ex.defaultSets ? ` · ${ex.defaultSets} סטים` : ''}</p>
                    )
                  ) : (ex.defaultSets || ex.defaultReps) && (
                    <p className="text-xs text-muted-foreground">{ex.defaultSets ? `${ex.defaultSets} סטים` : ''}{ex.defaultSets && ex.defaultReps ? ' · ' : ''}{ex.defaultReps || ''}</p>
                  )}
                  {ex.instructions && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{ex.instructions}</p>}
                  {!!ex.injuryZones?.length && (
                    <div className="flex flex-wrap gap-1 mt-1.5">
                      {ex.injuryZones.map((zoneId) => (
                        <span key={zoneId} className="text-[10px] font-semibold text-[#0a1628] bg-[#0a1628]/5 rounded-full px-2 py-0.5">
                          {BODY_ZONES[zoneId]?.he || zoneId}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex gap-1.5">
                  <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={() => openEdit(ex)}>
                    <Pencil className="h-3 w-3 mr-1" />ערוך
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setDeleteTarget(ex)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
        )
      })()}

      <ExerciseEditDialog
        exerciseId={editingId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        defaultCategory={filterCategory}
        onSaved={() => load()}
      />

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת תרגיל</AlertDialogTitle>
            <AlertDialogDescription>
              למחוק את "{deleteTarget?.name}"? תרגיל זה עדיין יופיע באימונים שכבר נבנו איתו, אך לא יהיה ניתן לבחור אותו באימונים חדשים.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>ביטול</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleting} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {deleting ? 'מוחק...' : 'מחק'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
