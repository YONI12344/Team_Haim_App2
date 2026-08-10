'use client'

import { useEffect, useRef, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
import { Plus, Pencil, Trash2, Loader2, Dumbbell, Video } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { isCoachEmail } from '@/lib/constants'
import type { ExerciseLibraryItem } from '@/lib/types'
import { listExercises, saveExercise, deleteExercise, uploadExerciseVideo } from '@/lib/exercise-library'

const emptyForm = { name: '', instructions: '', defaultSets: '', defaultReps: '' }

export function ExerciseLibraryManager() {
  const { user } = useAuth()
  const isCoach = isCoachEmail(user?.email)

  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<ExerciseLibraryItem | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ExerciseLibraryItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
    setEditing(null)
    setForm(emptyForm)
    setVideoFile(null)
    setDialogOpen(true)
  }

  const openEdit = (exercise: ExerciseLibraryItem) => {
    setEditing(exercise)
    setForm({
      name: exercise.name,
      instructions: exercise.instructions || '',
      defaultSets: exercise.defaultSets != null ? String(exercise.defaultSets) : '',
      defaultReps: exercise.defaultReps || '',
    })
    setVideoFile(null)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!user || !form.name.trim()) return
    setSaving(true)
    try {
      const id = await saveExercise({
        id: editing?.id,
        name: form.name.trim(),
        instructions: form.instructions.trim() || undefined,
        defaultSets: form.defaultSets ? Number(form.defaultSets) : undefined,
        defaultReps: form.defaultReps.trim() || undefined,
        videoUrl: editing?.videoUrl,
        videoPath: editing?.videoPath,
        createdBy: editing?.createdBy || user.id || '',
      })
      if (videoFile) {
        setUploadProgress(0)
        const { videoUrl, videoPath } = await uploadExerciseVideo(id, videoFile, setUploadProgress)
        await saveExercise({
          id,
          name: form.name.trim(),
          instructions: form.instructions.trim() || undefined,
          defaultSets: form.defaultSets ? Number(form.defaultSets) : undefined,
          defaultReps: form.defaultReps.trim() || undefined,
          videoUrl,
          videoPath,
          createdBy: editing?.createdBy || user.id || '',
        })
      }
      toast.success(editing ? 'התרגיל עודכן' : 'התרגיל נוסף')
      setDialogOpen(false)
      await load()
    } catch (err) {
      console.error('Error saving exercise:', err)
      toast.error('שמירת התרגיל נכשלה')
    } finally {
      setSaving(false)
      setUploadProgress(null)
    }
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

  if (!isCoach) return null

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">ספריית תרגילים</h2>
          <p className="text-xs text-muted-foreground">
            תרגילים לאימוני כוח — שם, סרטון הדגמה, הוראות, סטים/חזרות ברירת מחדל. נבחרים בבניית אימון כוח ומופיעים לספורטאי במצב אימון (Lift Mode).
          </p>
        </div>
        <Button onClick={openAdd} size="sm"><Plus className="h-4 w-4 mr-1" />הוסף תרגיל</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : exercises.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <Dumbbell className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">אין עדיין תרגילים בספרייה</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {exercises.map((ex) => (
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
                  <p className="text-sm font-semibold">{ex.name}</p>
                  {(ex.defaultSets || ex.defaultReps) && (
                    <p className="text-xs text-muted-foreground">{ex.defaultSets ? `${ex.defaultSets} סטים` : ''}{ex.defaultSets && ex.defaultReps ? ' · ' : ''}{ex.defaultReps || ''}</p>
                  )}
                  {ex.instructions && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{ex.instructions}</p>}
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
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md w-full max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">{editing ? 'עריכת תרגיל' : 'תרגיל חדש'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">שם התרגיל</Label>
              <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="למשל: סקוואט" dir="rtl" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">סטים (ברירת מחדל)</Label>
                <Input type="number" min={1} value={form.defaultSets} onChange={(e) => setForm({ ...form, defaultSets: e.target.value })} placeholder="3" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">חזרות (ברירת מחדל)</Label>
                <Input value={form.defaultReps} onChange={(e) => setForm({ ...form, defaultReps: e.target.value })} placeholder="8-12" dir="rtl" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">הוראות ביצוע</Label>
              <Textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className="min-h-[70px] text-sm" placeholder="איך לבצע את התרגיל נכון..." dir="rtl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">סרטון הדגמה</Label>
              {editing?.videoUrl && !videoFile && (
                <video src={editing.videoUrl} className="w-full rounded-md aspect-video object-cover bg-muted mb-1.5" controls preload="metadata" />
              )}
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                onChange={(e) => setVideoFile(e.target.files?.[0] || null)}
                className="text-xs text-muted-foreground"
              />
              <p className="text-[11px] text-muted-foreground">וידאו בלבד · מקסימום 200MB{editing?.videoUrl ? ' · השארה ריק שומרת על הסרטון הקיים' : ''}</p>
              {uploadProgress != null && (
                <div className="mt-1.5">
                  <div className="bg-muted rounded-full h-1.5 overflow-hidden">
                    <div className="bg-primary h-full transition-all" style={{ width: `${uploadProgress}%` }} />
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5">מעלה סרטון... {uploadProgress}%</p>
                </div>
              )}
            </div>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()} className="w-full">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              שמור
            </Button>
          </div>
        </DialogContent>
      </Dialog>

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
