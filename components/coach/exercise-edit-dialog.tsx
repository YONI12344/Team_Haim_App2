'use client'

import { useEffect, useRef, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { Button } from '@/components/ui/button'
import { Loader2, Timer, Trash2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import type { ExerciseLibraryItem } from '@/lib/types'
import { getExercise, saveExercise, uploadExerciseVideo, deleteExerciseVideoFile } from '@/lib/exercise-library'
import { BODY_ZONES, ZONE_IDS } from '@/lib/injury-data'
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

/**
 * Shared add/edit form for an Exercise Library entry — factored out of
 * components/coach/exercise-library-manager.tsx so the exact same "edit
 * this exercise" flow (name, category, timer, injury zones, instructions,
 * video upload/remove/mute) can be opened from anywhere a coach sees an
 * exercise: the library page itself, mid-build in the workout builder
 * (components/coach/strength-block-builder.tsx), or previewing what an
 * athlete sees in Lift Mode / the warm-up popup. Always fetches the
 * canonical ExerciseLibraryItem by id when opened rather than trusting a
 * caller-passed copy, since callers often only have a denormalized
 * snapshot (missing category/isTimed/injuryZones/etc).
 *
 * Note for callers: saving here always updates the shared Exercise
 * Library. It does NOT retroactively change a video/instructions already
 * denormalized onto an existing workout's StrengthBlockExercise (by
 * design — see lib/types.ts StrengthBlock comments) or onto an already-
 * assigned athlete's AssignedWorkout snapshot. Pass onSaved to sync a
 * caller's own local copy when that's possible (e.g. the block builder
 * updates the specific block-exercise the coach clicked from).
 */
export function ExerciseEditDialog({
  exerciseId,
  open,
  onOpenChange,
  defaultCategory,
  onSaved,
}: {
  exerciseId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultCategory?: 'strength' | 'stretch' | 'warmup'
  onSaved?: (exercise: ExerciseLibraryItem) => void
}) {
  const { user } = useAuth()
  const [editing, setEditing] = useState<ExerciseLibraryItem | null>(null)
  const [loadingExercise, setLoadingExercise] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [videoFile, setVideoFile] = useState<File | null>(null)
  const [removeVideo, setRemoveVideo] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setVideoFile(null)
    setRemoveVideo(false)
    if (!exerciseId) {
      setEditing(null)
      setForm({ ...emptyForm, category: defaultCategory || 'strength' })
      return
    }
    setLoadingExercise(true)
    getExercise(exerciseId)
      .then((ex) => {
        setEditing(ex)
        if (ex) {
          setForm({
            name: ex.name,
            instructions: ex.instructions || '',
            category: ex.category || 'strength',
            isTimed: !!ex.isTimed,
            defaultDurationSec: ex.defaultDurationSec != null ? String(ex.defaultDurationSec) : '',
            defaultSets: ex.defaultSets != null ? String(ex.defaultSets) : '',
            defaultReps: ex.defaultReps || '',
            injuryZones: ex.injuryZones || [],
            videoMuted: !!ex.videoMuted,
          })
        }
      })
      .catch((err) => {
        console.error('Error loading exercise for edit:', err)
        toast.error('טעינת התרגיל נכשלה')
      })
      .finally(() => setLoadingExercise(false))
  }, [open, exerciseId, defaultCategory])

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
      const oldVideoPath = editing?.videoPath
      let videoChanged = removeVideo
      let finalVideoUrl = removeVideo ? undefined : editing?.videoUrl
      let finalVideoPath = removeVideo ? undefined : editing?.videoPath
      if (videoFile) {
        setUploadProgress(0)
        const { videoUrl, videoPath } = await uploadExerciseVideo(id, videoFile, setUploadProgress)
        await saveExercise({ id, ...baseFields, videoUrl, videoPath })
        videoChanged = true
        finalVideoUrl = videoUrl
        finalVideoPath = videoPath
      }
      if (videoChanged && oldVideoPath) {
        deleteExerciseVideoFile(oldVideoPath).catch(() => {})
      }
      toast.success(editing ? 'התרגיל עודכן' : 'התרגיל נוסף')
      onSaved?.({
        id,
        ...baseFields,
        videoUrl: finalVideoUrl,
        videoPath: finalVideoPath,
        createdAt: editing?.createdAt || new Date(),
        updatedAt: new Date(),
      })
      onOpenChange(false)
    } catch (err) {
      console.error('Error saving exercise:', err)
      toast.error('שמירת התרגיל נכשלה')
    } finally {
      setSaving(false)
      setUploadProgress(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md w-full max-h-[90vh] overflow-y-auto" dir="rtl">
        <DialogHeader>
          <DialogTitle className="text-right">{exerciseId ? 'עריכת תרגיל' : 'תרגיל חדש'}</DialogTitle>
        </DialogHeader>
        {loadingExercise ? (
          <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
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
        )}
      </DialogContent>
    </Dialog>
  )
}
