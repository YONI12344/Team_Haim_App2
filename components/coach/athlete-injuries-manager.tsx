'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, deleteDoc, doc, getDocs, query, serverTimestamp, setDoc, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
import { Plus, Pencil, Trash2, Loader2, HeartPulse, Eye, EyeOff } from 'lucide-react'
import { toast } from 'sonner'
import { BODY_ZONES, ZONE_IDS } from '@/lib/injury-data'
import type { AthleteInjury, AssignedWorkout } from '@/lib/types'

function genId(): string {
  return `injury_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

const emptyForm = {
  zoneId: ZONE_IDS[0],
  title: '',
  description: '',
  status: 'active' as 'active' | 'recovered',
  visibleToAthlete: false,
  rehabWorkoutId: '',
}

export function AthleteInjuriesManager({ athleteId }: { athleteId: string }) {
  const { user } = useAuth()
  const [injuries, setInjuries] = useState<AthleteInjury[]>([])
  const [rehabOptions, setRehabOptions] = useState<AssignedWorkout[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<AthleteInjury | null>(null)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<AthleteInjury | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [injSnap, awSnap] = await Promise.all([
        getDocs(query(collection(db, 'injuries'), where('athleteId', '==', athleteId))),
        getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId))),
      ])
      const list = injSnap.docs.map((d) => {
        const data = d.data()
        return {
          id: d.id,
          athleteId: data.athleteId,
          zoneId: data.zoneId,
          title: data.title || '',
          description: data.description,
          status: data.status || 'active',
          visibleToAthlete: !!data.visibleToAthlete,
          rehabWorkoutId: data.rehabWorkoutId,
          createdBy: data.createdBy || '',
          createdAt: data.createdAt?.toDate?.() || new Date(),
          updatedAt: data.updatedAt?.toDate?.() || new Date(),
        } as AthleteInjury
      })
      list.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
      setInjuries(list)

      const strengthWorkouts = awSnap.docs
        .map((d) => ({ ...(d.data() as AssignedWorkout), id: d.id }))
        .filter((w) => w.workout?.type === 'strength' && w.workout.strengthBlocks?.length)
        .sort((a, b) => (b.scheduledDate || '').localeCompare(a.scheduledDate || ''))
      setRehabOptions(strengthWorkouts)
    } catch (err) {
      console.error('Error loading injuries:', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [athleteId])

  const openAdd = () => {
    setEditing(null)
    setForm(emptyForm)
    setDialogOpen(true)
  }

  const openEdit = (injury: AthleteInjury) => {
    setEditing(injury)
    setForm({
      zoneId: injury.zoneId,
      title: injury.title,
      description: injury.description || '',
      status: injury.status,
      visibleToAthlete: injury.visibleToAthlete,
      rehabWorkoutId: injury.rehabWorkoutId || '',
    })
    setDialogOpen(true)
  }

  const handleSave = async () => {
    if (!user || !form.title.trim()) return
    setSaving(true)
    try {
      const id = editing?.id || genId()
      await setDoc(doc(db, 'injuries', id), {
        athleteId,
        zoneId: form.zoneId,
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: form.status,
        visibleToAthlete: form.visibleToAthlete,
        rehabWorkoutId: form.rehabWorkoutId || null,
        createdBy: editing?.createdBy || user.id || '',
        createdAt: editing?.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(),
      }, { merge: true })
      toast.success(editing ? 'הפציעה עודכנה' : 'הפציעה נוספה')
      setDialogOpen(false)
      await load()
    } catch (err) {
      console.error('Error saving injury:', err)
      toast.error('שמירת הפציעה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'injuries', deleteTarget.id))
      toast.success('הפציעה נמחקה')
      setDeleteTarget(null)
      await load()
    } catch (err) {
      console.error('Error deleting injury:', err)
      toast.error('מחיקת הפציעה נכשלה')
    } finally {
      setDeleting(false)
    }
  }

  const rehabTitle = useMemo(() => {
    const map = new Map(rehabOptions.map((w) => [w.id, w]))
    return (id?: string) => (id ? map.get(id)?.workout?.title : undefined)
  }, [rehabOptions])

  return (
    <div dir="rtl" className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">פציעות ומניעה</h2>
          <p className="text-xs text-muted-foreground">
            רשומות פציעה לפי אזור בגוף. הצגה לספורטאי מותנית בהפעלת &quot;גלוי לספורטאי&quot;.
          </p>
        </div>
        <Button onClick={openAdd} size="sm"><Plus className="h-4 w-4 mr-1" />הוסף פציעה</Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : injuries.length === 0 ? (
        <div className="text-center py-10 text-muted-foreground">
          <HeartPulse className="h-8 w-8 mx-auto mb-2 opacity-50" />
          <p className="text-sm">אין רשומות פציעה עדיין</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {injuries.map((inj) => (
            <Card key={inj.id}>
              <CardContent className="p-3.5 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold">{inj.title}</p>
                    <p className="text-xs text-muted-foreground">{BODY_ZONES[inj.zoneId]?.he || inj.zoneId}</p>
                  </div>
                  <span className={`text-[10px] font-semibold rounded-full px-2 py-0.5 shrink-0 ${
                    inj.status === 'active' ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {inj.status === 'active' ? 'פעילה' : 'הבריאה'}
                  </span>
                </div>
                {inj.description && <p className="text-xs text-muted-foreground line-clamp-2">{inj.description}</p>}
                {inj.rehabWorkoutId && (
                  <p className="text-xs text-primary">🏋️ תוכנית שיקום: {rehabTitle(inj.rehabWorkoutId) || 'אימון'}</p>
                )}
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  {inj.visibleToAthlete ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
                  {inj.visibleToAthlete ? 'גלוי לספורטאי' : 'מוסתר מהספורטאי'}
                </div>
                <div className="flex gap-1.5 pt-1">
                  <Button variant="outline" size="sm" className="h-7 text-xs flex-1" onClick={() => openEdit(inj)}>
                    <Pencil className="h-3 w-3 mr-1" />ערוך
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setDeleteTarget(inj)}>
                    <Trash2 className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-right">{editing ? 'עריכת פציעה' : 'פציעה חדשה'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">אזור בגוף</Label>
              <Select value={form.zoneId} onValueChange={(v) => setForm({ ...form, zoneId: v })}>
                <SelectTrigger dir="rtl"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">
                  {ZONE_IDS.map((zoneId) => (
                    <SelectItem key={zoneId} value={zoneId}>{BODY_ZONES[zoneId].he}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">כותרת</Label>
              <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder='למשל: דלקת גיד אכילס' dir="rtl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">תיאור / הערות</Label>
              <Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="min-h-[70px] text-sm" dir="rtl" />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">סטטוס</Label>
              <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as 'active' | 'recovered' })}>
                <SelectTrigger dir="rtl"><SelectValue /></SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="active">פעילה</SelectItem>
                  <SelectItem value="recovered">הבריאה</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs font-semibold">תוכנית שיקום (אימון כוח קיים)</Label>
              <Select value={form.rehabWorkoutId || '__none__'} onValueChange={(v) => setForm({ ...form, rehabWorkoutId: v === '__none__' ? '' : v })}>
                <SelectTrigger dir="rtl"><SelectValue placeholder="ללא" /></SelectTrigger>
                <SelectContent dir="rtl">
                  <SelectItem value="__none__">ללא</SelectItem>
                  {rehabOptions.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.workout.title} · {w.scheduledDate}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                כדי ליצור תוכנית חדשה: בנו אימון כוח בספריית התרגילים ושייכו אותו לספורטאי כרגיל, ואז בחרו אותו כאן.
              </p>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <Label className="text-xs font-semibold">גלוי לספורטאי</Label>
              <Switch checked={form.visibleToAthlete} onCheckedChange={(v) => setForm({ ...form, visibleToAthlete: v })} />
            </div>
            <Button onClick={handleSave} disabled={saving || !form.title.trim()} className="w-full">
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              שמור
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>מחיקת פציעה</AlertDialogTitle>
            <AlertDialogDescription>
              למחוק את &quot;{deleteTarget?.title}&quot;?
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
