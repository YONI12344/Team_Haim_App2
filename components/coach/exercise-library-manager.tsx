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
import { Plus, Pencil, Trash2, Loader2, Dumbbell, Video, Timer, Download, VolumeX } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { isCoachEmail } from '@/lib/constants'
import type { ExerciseLibraryItem } from '@/lib/types'
import { listExercises, saveExercise, deleteExercise, uploadExerciseVideo, deleteExerciseVideoFile } from '@/lib/exercise-library'
import { BODY_ZONES, ZONE_IDS } from '@/lib/injury-data'
import { seedRunningStrengthProgram } from '@/lib/seed-running-strength-program'
import { seedRunnerStretchProgram } from '@/lib/seed-runner-stretch-program'
import { seedStrapStretchProgram } from '@/lib/seed-strap-stretch-program'
import { seedAncillaryRoutines } from '@/lib/seed-ancillary-routines'
import { cn } from '@/lib/utils'

const emptyForm = {
  name: '',
  instructions: '',
  category: 'strength' as 'strength' | 'stretch' | 'warmup',
  isTimed: false,
  defaultDurationSec: '',
  defaultSets: '',
  defaultReps: '',
  injuryZones: [] as string[],
  videoMuted: false,
}

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
  const [editing, setEditing] = useState<ExerciseLibraryItem | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [removeVideo, setRemoveVideo] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<ExerciseLibraryItem | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [filterCategory, setFilterCategory] = useState<'strength' | 'stretch' | 'warmup'>('strength')
  const [importingKey, setImportingKey] = useState<'strength' | 'stretch' | 'strap' | 'ancillary' | null>(null)
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
    setForm({ ...emptyForm, category: filterCategory })
    setVideoFile(null)
    setRemoveVideo(false)
    setDialogOpen(true)
  }

  const openEdit = (exercise: ExerciseLibraryItem) => {
    setEditing(exercise)
    setForm({
      name: exercise.name,
      instructions: exercise.instructions || '',
      category: exercise.category || 'strength',
      isTimed: !!exercise.isTimed,
      defaultDurationSec: exercise.defaultDurationSec != null ? String(exercise.defaultDurationSec) : '',
      defaultSets: exercise.defaultSets != null ? String(exercise.defaultSets) : '',
      defaultReps: exercise.defaultReps || '',
      injuryZones: exercise.injuryZones || [],
      videoMuted: !!exercise.videoMuted,
    })
    setVideoFile(null)
    setRemoveVideo(false)
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!user || !form.name.trim()) return
    setSaving(true)
    try {
      const baseFields = {
        name: form.name.trim(),
        instructions: form.instructions.trim() || undefined,
        category: form.category,
        isTimed: form.isTimed,
        defaultDurationSec: form.isTimed && form.defaultDurationSec ? Number(form.defaultDurationSec) : undefined,
        defaultSets: form.defaultSets ? Number(form.defaultSets) : undefined,
        defaultReps: form.defaultReps.trim() || undefined,
        injuryZones: form.injuryZones,
        videoMuted: form.videoMuted,
        createdBy: editing?.createdBy || user.id || '',
      }
      const id = await saveExercise({
        id: editing?.id,
        ...baseFields,
        videoUrl: removeVideo ? undefined : editing?.videoUrl,
        videoPath: removeVideo ? undefined : editing?.videoPath,
      })
      // Track whether the old file (if any) needs cleaning up from
      // Storage — either it's being replaced by a new upload below, or
      // it's being removed outright. Deleted only after the new state is
      // safely saved, so a failed upload never leaves the exercise with
      // no video at all.
      const oldVideoPath = editing?.videoPath
      let videoChanged = removeVideo
      if (videoFile) {
        setUploadProgress(0)
        const { videoUrl, videoPath } = await uploadExerciseVideo(id, videoFile, setUploadProgress)
        await saveExercise({ id, ...baseFields, videoUrl, videoPath })
        videoChanged = true
      }
      if (videoChanged && oldVideoPath) {
        deleteExerciseVideoFile(oldVideoPath).catch(() => {})
      }
      toast.success(editing ? 'התרגיל עודכן' : 'התרגיל נוסף')
      setDialogOpen(false)
      setRemoveVideo(false)
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
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">קטגוריה</Label>
              <div className="flex gap-1.5">
                {CATEGORY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setForm({ ...form, category: opt.value })}
                    className={cn(
                      'flex-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors',
                      form.category === opt.value ? 'bg-[#0a1628] text-white border-[#0a1628]' : 'bg-white text-gray-500 border-gray-200',
                    )}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <Timer className="h-3.5 w-3.5 text-muted-foreground" />
                <Label className="text-xs font-semibold">תרגיל מבוסס זמן (לא חזרות)</Label>
              </div>
              <Switch checked={form.isTimed} onCheckedChange={(v) => setForm({ ...form, isTimed: v })} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">סטים (ברירת מחדל)</Label>
                <Input type="number" min={1} value={form.defaultSets} onChange={(e) => setForm({ ...form, defaultSets: e.target.value })} placeholder="3" />
              </div>
              {form.isTimed ? (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">משך (שניות)</Label>
                  <Input type="number" min={1} value={form.defaultDurationSec} onChange={(e) => setForm({ ...form, defaultDurationSec: e.target.value })} placeholder="30" />
                </div>
              ) : (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold">חזרות (ברירת מחדל)</Label>
                  <Input value={form.defaultReps} onChange={(e) => setForm({ ...form, defaultReps: e.target.value })} placeholder="8-12" dir="rtl" />
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">אזורי פציעה רלוונטיים (אופציונלי)</Label>
              <p className="text-[11px] text-muted-foreground">
                תרגיל זה יופיע לספורטאי בעמוד מניעת פציעות עבור האזורים שסומנו
              </p>
              <div className="flex flex-wrap gap-1.5">
                {ZONE_IDS.map((zoneId) => {
                  const active = form.injuryZones.includes(zoneId)
                  return (
                    <button
                      key={zoneId}
                      type="button"
                      onClick={() => setForm((prev) => ({
                        ...prev,
                        injuryZones: active
                          ? prev.injuryZones.filter((z) => z !== zoneId)
                          : [...prev.injuryZones, zoneId],
                      }))}
                      className={cn(
                        'px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors',
                        active ? 'bg-[#0a1628] text-white border-[#0a1628]' : 'bg-white text-gray-500 border-gray-200',
                      )}
                    >
                      {BODY_ZONES[zoneId].he}
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">הוראות ביצוע</Label>
              <Textarea value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} className="min-h-[70px] text-sm" placeholder="איך לבצע את התרגיל נכון..." dir="rtl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">סרטון הדגמה</Label>
              {editing?.videoUrl && !videoFile && !removeVideo && (
                <div className="space-y-1.5 mb-1.5">
                  <video src={editing.videoUrl} className="w-full rounded-md aspect-video object-cover bg-muted" controls preload="metadata" />
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setRemoveVideo(true)}>
                    <Trash2 className="h-3 w-3 mr-1" />הסר סרטון
                  </Button>
                </div>
              )}
              {removeVideo && !videoFile && (
                <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 mb-1.5">
                  <p className="text-xs text-destructive">הסרטון יימחק בעת השמירה</p>
                  <Button type="button" variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setRemoveVideo(false)}>בטל</Button>
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="video/*"
                onChange={(e) => { setVideoFile(e.target.files?.[0] || null); setRemoveVideo(false) }}
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
              <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5 mt-1.5">
                <div className="flex items-center gap-1.5">
                  <VolumeX className="h-3.5 w-3.5 text-muted-foreground" />
                  <Label className="text-xs font-semibold">השתקת קול לספורטאי</Label>
                </div>
                <Switch checked={form.videoMuted} onCheckedChange={(v) => setForm({ ...form, videoMuted: v })} />
              </div>
              <p className="text-[11px] text-muted-foreground">
                משתיק את הניגון אצל הספורטאי (וידאו, טיימר וכו&apos;) — לא מוחק את הקול מהקובץ עצמו.
              </p>
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
