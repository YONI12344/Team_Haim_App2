'use client'

import { useEffect, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { format } from 'date-fns'
import {
  User,
  Calendar,
  Ruler,
  Weight,
  Trophy,
  Target,
  Clock,
  MapPin,
  Award,
  Loader2,
  Save,
  Camera,
  X,
  Heart,
  Download,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { collection, doc, getDoc, getDocs, query, setDoc, serverTimestamp, where } from 'firebase/firestore'
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'
import type {
  AthleteProfile as AthleteProfileType,
  Discipline,
  ExperienceLevel,
  PersonalRecord,
  TrainingPace,
  Goal,
  WorkoutLog,
  AssignedWorkout,
  Workout,
} from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import { listJourneys } from '@/lib/journey'
import {
  buildAthleteWorkbook,
  setWorkbookProperties,
  downloadWorkbook,
  athleteFilename,
  type ExportAthleteData,
} from '@/lib/export'
import { TrainingZonesCard } from './training-zones-card'
import { PaceEditor, RecordEditor } from './profile-editors'

const paceTypeColors: Record<string, string> = {
  easy: 'bg-emerald-100 text-emerald-700',
  tempo: 'bg-amber-100 text-amber-700',
  threshold: 'bg-orange-100 text-orange-700',
  interval: 'bg-red-100 text-red-700',
  repetition: 'bg-purple-100 text-purple-700',
  race: 'bg-gold/20 text-gold',
}

const disciplineOptions: { value: Discipline; label: string }[] = [
  { value: 'track', label: 'Track & Field' },
  { value: 'road', label: 'Distance / Road' },
  { value: 'jogger', label: 'Jogger' },
  { value: 'trail', label: 'Trail' },
  { value: 'mixed', label: 'Mixed' },
]

const experienceOptions: { value: ExperienceLevel; label: string }[] = [
  { value: 'beginner', label: 'Beginner' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'professional', label: 'Professional' },
]

interface ProfileForm {
  name: string
  dateOfBirth: string
  gender: '' | 'male' | 'female' | 'other'
  height: string
  weight: string
  events: string
  discipline: Discipline[]
  experienceLevel: ExperienceLevel | ''
  weeklyMileage: string
  restingHR: string
  maxHR: string
  currentHR: string
  targetHR: string
  targetPaceKm: string
  goalRaceEvent: string
  goalRaceDate: string
  goalRaceTarget: string
}

export function AthleteProfile() {
  const { user, firebaseUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [hasProfile, setHasProfile] = useState(false)
  const [editing, setEditing] = useState(false)
  const [photoURL, setPhotoURL] = useState<string | undefined>(undefined)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const [form, setForm] = useState<ProfileForm>({
    name: '',
    dateOfBirth: '',
    gender: '',
    height: '',
    weight: '',
    events: '',
    discipline: [],
    experienceLevel: '',
    weeklyMileage: '',
    restingHR: '',
    maxHR: '',
    currentHR: '',
    targetHR: '',
    targetPaceKm: '',
    goalRaceEvent: '',
    goalRaceDate: '',
    goalRaceTarget: '',
  })

  const [personalRecords, setPersonalRecords] = useState<PersonalRecord[]>([])
  const [seasonBests, setSeasonBests] = useState<PersonalRecord[]>([])
  const [trainingPaces, setTrainingPaces] = useState<TrainingPace[]>([])
  const [goals, setGoals] = useState<Goal[]>([])

  useEffect(() => {
    if (!user?.id) return
    const load = async () => {
      setLoading(true)
      try {
        const snap = await getDoc(doc(db, 'users', user.id))
        if (snap.exists()) {
          const data = snap.data() as Partial<AthleteProfileType>
          const meaningful =
            !!data.dateOfBirth ||
            !!data.gender ||
            !!data.height ||
            !!data.weight ||
            (Array.isArray(data.events) && data.events.length > 0)
          setHasProfile(meaningful)
          setPhotoURL(data.photoURL || user.photoURL || undefined)
          setForm({
            name: data.name || user.name || '',
            dateOfBirth: data.dateOfBirth || '',
            gender: (data.gender as ProfileForm['gender']) || '',
            height: data.height ? String(data.height) : '',
            weight: data.weight ? String(data.weight) : '',
            events: Array.isArray(data.events) ? data.events.join(', ') : '',
            discipline: Array.isArray(data.discipline) ? data.discipline : [],
            experienceLevel: (data.experienceLevel as ExperienceLevel) || '',
            weeklyMileage: data.weeklyMileage ? String(data.weeklyMileage) : '',
            restingHR: data.restingHR ? String(data.restingHR) : '',
            maxHR: data.maxHR ? String(data.maxHR) : '',
            currentHR: data.currentHR ? String(data.currentHR) : '',
            targetHR: data.targetHR ? String(data.targetHR) : '',
            targetPaceKm: data.targetPaceKm || '',
            goalRaceEvent: data.goalRaceEvent || '',
            goalRaceDate: data.goalRaceDate || '',
            goalRaceTarget: data.goalRaceTarget || '',
          })
          setPersonalRecords(Array.isArray(data.personalRecords) ? data.personalRecords : [])
          setSeasonBests(Array.isArray(data.seasonBests) ? data.seasonBests : [])
          setTrainingPaces(Array.isArray(data.trainingPaces) ? data.trainingPaces : [])
          setGoals(Array.isArray(data.goals) ? data.goals : [])
        } else {
          setHasProfile(false)
          setForm((f) => ({ ...f, name: user.name || '' }))
        }
      } catch (err) {
        console.error('Error loading athlete profile:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user?.id, user?.name, user?.photoURL])

  const toggleDiscipline = (d: Discipline) => {
    setForm((f) => ({
      ...f,
      discipline: f.discipline.includes(d)
        ? f.discipline.filter((x) => x !== d)
        : [...f.discipline, d],
    }))
  }

  const handlePhotoSelect = async (file: File) => {
    if (!user?.id) return
    if (!file.type.startsWith('image/')) {
      toast.error('Please choose an image file')
      return
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image is larger than 5 MB')
      return
    }
    setUploadingPhoto(true)
    try {
      // Only accept a small whitelist of image extensions to avoid surprises
      // even if the content-type header was tampered with.
      const allowed = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif'])
      const rawExt = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
      const ext = allowed.has(rawExt) ? rawExt : 'jpg'
      const ref = storageRef(storage, `profilePhotos/${user.id}.${ext}`)
      // Always send an image/* content type — some mobile pickers leave
      // `file.type` blank, which would otherwise fail the storage rule.
      const extToMime: Record<string, string> = {
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
      }
      const safeContentType =
        file.type && file.type.startsWith('image/')
          ? file.type
          : extToMime[ext] || 'image/jpeg'
      await uploadBytes(ref, file, { contentType: safeContentType })
      const url = await getDownloadURL(ref)
      setPhotoURL(url)
      await setDoc(
        doc(db, 'users', user.id),
        { photoURL: url, updatedAt: serverTimestamp() },
        { merge: true },
      )
      toast.success('Profile photo updated')
    } catch (err) {
      console.error('Error uploading photo:', err)
      toast.error('Failed to upload photo')
    } finally {
      setUploadingPhoto(false)
    }
  }

  const handlePhotoRemove = async () => {
    if (!user?.id) return
    try {
      // Best-effort delete; ignore if not found / extensions differ.
      for (const ext of ['jpg', 'jpeg', 'png', 'webp']) {
        try {
          await deleteObject(storageRef(storage, `profilePhotos/${user.id}.${ext}`))
        } catch {
          /* ignore */
        }
      }
      await setDoc(
        doc(db, 'users', user.id),
        { photoURL: null, updatedAt: serverTimestamp() },
        { merge: true },
      )
      setPhotoURL(undefined)
      toast.success('Profile photo removed')
    } catch (err) {
      console.error('Error removing photo:', err)
      toast.error('Failed to remove photo')
    }
  }

  const handleSave = async () => {
    if (!user?.id) return
    setSaving(true)
    try {
      const updates: Record<string, unknown> = {
        name: form.name.trim() || user.name,
        dateOfBirth: form.dateOfBirth || null,
        gender: form.gender || null,
        height: form.height ? Number(form.height) : null,
        weight: form.weight ? Number(form.weight) : null,
        events: form.events
          .split(',')
          .map((e) => e.trim())
          .filter(Boolean),
        discipline: form.discipline,
        experienceLevel: form.experienceLevel || null,
        weeklyMileage: form.weeklyMileage ? Number(form.weeklyMileage) : null,
        restingHR: form.restingHR ? Number(form.restingHR) : null,
        maxHR: form.maxHR ? Number(form.maxHR) : null,
        currentHR: form.currentHR ? Number(form.currentHR) : null,
        targetHR: form.targetHR ? Number(form.targetHR) : null,
        targetPaceKm: form.targetPaceKm.trim() || null,
        goalRaceEvent: form.goalRaceEvent || null,
        goalRaceDate: form.goalRaceDate || null,
        goalRaceTarget: form.goalRaceTarget || null,
        updatedAt: serverTimestamp(),
      }
      await setDoc(doc(db, 'users', user.id), updates, { merge: true })
      setHasProfile(true)
      setEditing(false)
      toast.success('Profile saved!')
    } catch (err) {
      console.error('Error saving profile:', err)
      toast.error('Failed to save profile')
    } finally {
      setSaving(false)
    }
  }

  const persistField = async (
    field: 'personalRecords' | 'seasonBests' | 'trainingPaces',
    value: unknown[],
  ) => {
    if (!user?.id) return
    try {
      await setDoc(
        doc(db, 'users', user.id),
        { [field]: value, updatedAt: serverTimestamp() },
        { merge: true },
      )
    } catch (err) {
      console.error(`Error saving ${field}:`, err)
      toast.error('Failed to save changes')
    }
  }

  const upsertRecord = async (
    field: 'personalRecords' | 'seasonBests',
    record: PersonalRecord,
  ) => {
    const list = field === 'personalRecords' ? personalRecords : seasonBests
    const setter = field === 'personalRecords' ? setPersonalRecords : setSeasonBests
    const exists = list.some((r) => r.id === record.id)
    const next = exists
      ? list.map((r) => (r.id === record.id ? record : r))
      : [...list, record]
    setter(next)
    await persistField(field, next)
    toast.success(exists ? 'Updated' : 'Added')
  }

  const removeRecord = async (
    field: 'personalRecords' | 'seasonBests',
    id: string,
  ) => {
    const list = field === 'personalRecords' ? personalRecords : seasonBests
    const setter = field === 'personalRecords' ? setPersonalRecords : setSeasonBests
    const next = list.filter((r) => r.id !== id)
    setter(next)
    await persistField(field, next)
  }

  const upsertPace = async (pace: TrainingPace) => {
    const exists = trainingPaces.some((p) => p.id === pace.id)
    const next = exists
      ? trainingPaces.map((p) => (p.id === pace.id ? pace : p))
      : [...trainingPaces, pace]
    setTrainingPaces(next)
    await persistField('trainingPaces', next)
    toast.success(exists ? 'Updated' : 'Added')
  }

  const removePace = async (id: string) => {
    const next = trainingPaces.filter((p) => p.id !== id)
    setTrainingPaces(next)
    await persistField('trainingPaces', next)
  }

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'

  const handleExport = async () => {
    if (!user?.id) return
    setExporting(true)
    try {
      // Fetch workout logs
      let workoutLogs: ExportAthleteData['workoutLogs'] = []
      try {
        const logsSnap = await getDocs(
          query(collection(db, 'logs'), where('athleteId', '==', user.id)),
        )
        workoutLogs = logsSnap.docs.map((d) => {
          const data = d.data()
          const aw = data as { date?: string; workoutTitle?: string; actualDistance?: number; actualPace?: string; effort?: 'easy' | 'medium' | 'hard' | number | undefined | null; comment?: string }
          return {
            date: aw.date || '',
            workoutTitle: aw.workoutTitle || '',
            distance: aw.actualDistance,
            pace: aw.actualPace,
            effort: legacyEffortToNumber(aw.effort),
            comment: aw.comment || '',
          }
        })
      } catch { /* ignore */ }

      // Fetch assigned workouts
      let assignedWorkouts: ExportAthleteData['assignedWorkouts'] = []
      try {
        const awSnap = await getDocs(
          query(collection(db, 'assignedWorkouts'), where('athleteId', '==', user.id)),
        )
        assignedWorkouts = awSnap.docs.map((d) => {
          const data = d.data() as {
            scheduledDate?: string
            workout?: Workout
            status?: string
            coachFeedback?: string
          }
          const w = (data.workout || {}) as Workout
          return {
            date: data.scheduledDate || '',
            workoutTitle: w.title || '',
            type: w.type || '',
            status: data.status || '',
            duration: w.duration,
            distance: w.distance,
            coachFeedback: data.coachFeedback || '',
          }
        })
      } catch { /* ignore */ }

      // Fetch journey stages
      let journeyStages: ExportAthleteData['journeyStages'] = []
      try {
        const journeys = await listJourneys(user.id)
        journeyStages = journeys.flatMap((j) =>
          j.stages.map((s) => ({
            stageName: s.name,
            type: s.type,
            startDate: s.startDate,
            endDate: s.endDate,
            focus: s.focus,
            weeklyVolumeKm: s.weeklyVolumeKm,
            keyWorkouts: s.keyWorkouts?.join('; ') || '',
            milestones: s.milestones?.join('; ') || '',
          })),
        )
      } catch { /* ignore */ }

      const exportData: ExportAthleteData = {
        name: form.name || user.name || 'Athlete',
        email: user.email || '',
        dateOfBirth: form.dateOfBirth || undefined,
        gender: form.gender || undefined,
        height: form.height ? Number(form.height) : undefined,
        weight: form.weight ? Number(form.weight) : undefined,
        discipline: form.discipline,
        events: form.events.split(',').map((e) => e.trim()).filter(Boolean),
        experienceLevel: form.experienceLevel || undefined,
        weeklyMileage: form.weeklyMileage ? Number(form.weeklyMileage) : undefined,
        restingHR: form.restingHR ? Number(form.restingHR) : undefined,
        maxHR: form.maxHR ? Number(form.maxHR) : undefined,
        goalRaceEvent: form.goalRaceEvent || undefined,
        goalRaceDate: form.goalRaceDate || undefined,
        goalRaceTarget: form.goalRaceTarget || undefined,
        personalRecords,
        seasonBests,
        trainingPaces,
        goals,
        workoutLogs,
        assignedWorkouts,
        journeyStages,
      }

      const wb = buildAthleteWorkbook(exportData)
      setWorkbookProperties(wb, exportData.name)
      const filename = athleteFilename(exportData.name)
      downloadWorkbook(wb, filename)
      toast.success(`Exported ${filename}`)
    } catch (err) {
      console.error('Export error:', err)
      toast.error('Export failed. Please try again.')
    } finally {
      setExporting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  const displayName = form.name || user?.name || 'Athlete'
  const eventsArray = form.events
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean)
  const avatarUrl = photoURL || firebaseUser?.photoURL || undefined

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl md:text-3xl font-semibold text-navy">
            My Profile
          </h1>
          <p className="text-muted-foreground text-sm">
            Your athletic profile and training information
          </p>
        </div>
        {!editing ? (
          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={exporting}
              className="border-gold/40 text-navy hover:border-gold"
            >
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Download className="h-4 w-4 mr-2" />
              )}
              {exporting ? 'Generating…' : 'Export my data'}
            </Button>
            <Button
              onClick={() => setEditing(true)}
              className="bg-gold hover:bg-gold/90 text-navy"
            >
              {hasProfile ? 'Edit Profile' : 'Complete your profile'}
            </Button>
          </div>
        ) : null}
      </div>

      {!hasProfile && !editing && (
        <Card className="rounded-2xl border-gold/30 bg-gold/5">
          <CardContent className="pt-6">
            <p className="text-navy font-medium">Complete your profile</p>
            <p className="text-muted-foreground text-sm mt-1">
              Add your details so your coach can tailor your training.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Profile Card */}
      <Card className="rounded-2xl">
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-start gap-6">
            <div className="relative">
              {/*
                Using a native <label htmlFor> tied to a real file input is the
                most reliable way to open the device photo picker on every
                platform (especially iOS Safari and in-app webviews where a
                programmatic `inputRef.click()` is often silently ignored).
              */}
              <label
                htmlFor="profile-photo-input"
                className={cn(
                  'group relative block w-24 h-24 rounded-full overflow-hidden',
                  'cursor-pointer focus-within:ring-2 focus-within:ring-gold/60',
                  uploadingPhoto && 'pointer-events-none opacity-80',
                )}
                title="Change photo"
                aria-label="Change profile photo"
              >
                <Avatar className="w-24 h-24 border-4 border-gold/20">
                  <AvatarImage src={avatarUrl} alt={displayName} />
                  <AvatarFallback className="bg-gold/10 text-gold text-2xl font-serif">
                    {getInitials(displayName)}
                  </AvatarFallback>
                </Avatar>
                <span
                  className={cn(
                    'absolute inset-0 flex items-center justify-center rounded-full',
                    'bg-navy/0 text-transparent transition-colors',
                    'group-hover:bg-navy/40 group-hover:text-white',
                    'group-focus-within:bg-navy/40 group-focus-within:text-white',
                  )}
                  aria-hidden="true"
                >
                  {uploadingPhoto ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Camera className="h-6 w-6" />
                  )}
                </span>
                <input
                  id="profile-photo-input"
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  disabled={uploadingPhoto}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) handlePhotoSelect(f)
                    e.target.value = ''
                  }}
                />
              </label>

              {avatarUrl && !uploadingPhoto && (
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full bg-background"
                  onClick={(e) => {
                    // Stop the click from bubbling up to the label which would
                    // otherwise open the file picker right after removing the
                    // photo.
                    e.preventDefault()
                    e.stopPropagation()
                    handlePhotoRemove()
                  }}
                  aria-label="Remove profile photo"
                  title="Remove photo"
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            <div className="flex-1 space-y-4 w-full">
              {!editing ? (
                <>
                  <div>
                    <h2 className="font-serif text-2xl font-semibold text-navy">
                      {displayName}
                    </h2>
                    <p className="text-muted-foreground text-sm">{user?.email}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {form.experienceLevel && (
                      <Badge className="bg-coral text-white capitalize">
                        {form.experienceLevel}
                      </Badge>
                    )}
                    {form.discipline.map((d) => (
                      <Badge key={d} variant="outline" className="border-navy/30 text-navy">
                        {disciplineOptions.find((o) => o.value === d)?.label || d}
                      </Badge>
                    ))}
                    {eventsArray.length === 0 ? (
                      <span className="text-sm text-muted-foreground">
                        No events listed yet
                      </span>
                    ) : (
                      eventsArray.map((event) => (
                        <Badge key={event} variant="secondary" className="bg-navy/10 text-navy">
                          {event}
                        </Badge>
                      ))
                    )}
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                    {form.dateOfBirth && (
                      <div className="flex items-center gap-2 text-sm">
                        <Calendar className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {format(new Date(form.dateOfBirth), 'MMM d, yyyy')}
                        </span>
                      </div>
                    )}
                    {form.gender && (
                      <div className="flex items-center gap-2 text-sm">
                        <User className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground capitalize">
                          {form.gender}
                        </span>
                      </div>
                    )}
                    {form.height && (
                      <div className="flex items-center gap-2 text-sm">
                        <Ruler className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{form.height} cm</span>
                      </div>
                    )}
                    {form.weight && (
                      <div className="flex items-center gap-2 text-sm">
                        <Weight className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">{form.weight} kg</span>
                      </div>
                    )}
                    {form.weeklyMileage && (
                      <div className="flex items-center gap-2 text-sm">
                        <Target className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground">
                          {form.weeklyMileage} km/wk
                        </span>
                      </div>
                    )}
                    {(form.restingHR || form.maxHR) && (
                      <div className="flex items-center gap-2 text-sm">
                        <Heart className="h-4 w-4 text-coral" />
                        <span className="text-muted-foreground">
                          {form.restingHR ? `${form.restingHR}` : '—'}
                          {' / '}
                          {form.maxHR ? `${form.maxHR}` : '—'} bpm
                        </span>
                      </div>
                    )}
                    {(form.currentHR || form.targetHR) && (
                      <div className="flex items-center gap-2 text-sm">
                        <Heart className="h-4 w-4 text-coral" />
                        <span className="text-muted-foreground">
                          {form.currentHR ? `now ${form.currentHR}` : '—'}
                          {form.targetHR ? ` · target ${form.targetHR}` : ''} bpm
                        </span>
                      </div>
                    )}
                    {form.targetPaceKm && (
                      <div className="flex items-center gap-2 text-sm">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-muted-foreground font-mono">
                          target {form.targetPaceKm}/km
                        </span>
                      </div>
                    )}
                  </div>

                  {form.goalRaceEvent && (
                    <div className="rounded-xl bg-coral-light/50 p-3 text-sm">
                      <span className="font-semibold text-navy">Goal: </span>
                      {form.goalRaceEvent}
                      {form.goalRaceTarget ? ` in ${form.goalRaceTarget}` : ''}
                      {form.goalRaceDate ? ` · ${format(new Date(form.goalRaceDate), 'MMM d, yyyy')}` : ''}
                    </div>
                  )}
                </>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="profile-name">Name</Label>
                    <Input
                      id="profile-name"
                      value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-dob">Date of Birth</Label>
                    <Input
                      id="profile-dob"
                      type="date"
                      value={form.dateOfBirth}
                      onChange={(e) => setForm({ ...form, dateOfBirth: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-gender">Gender</Label>
                    <Select
                      value={form.gender || undefined}
                      onValueChange={(v) => setForm({ ...form, gender: v as ProfileForm['gender'] })}
                    >
                      <SelectTrigger id="profile-gender">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">Male</SelectItem>
                        <SelectItem value="female">Female</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-level">Experience level</Label>
                    <Select
                      value={form.experienceLevel || undefined}
                      onValueChange={(v) =>
                        setForm({ ...form, experienceLevel: v as ExperienceLevel })
                      }
                    >
                      <SelectTrigger id="profile-level">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        {experienceOptions.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-height">Height (cm)</Label>
                    <Input
                      id="profile-height"
                      type="number"
                      value={form.height}
                      onChange={(e) => setForm({ ...form, height: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-weight">Weight (kg)</Label>
                    <Input
                      id="profile-weight"
                      type="number"
                      value={form.weight}
                      onChange={(e) => setForm({ ...form, weight: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-mileage">Weekly mileage (km)</Label>
                    <Input
                      id="profile-mileage"
                      type="number"
                      value={form.weeklyMileage}
                      onChange={(e) => setForm({ ...form, weeklyMileage: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-rhr">Resting HR (bpm)</Label>
                    <Input
                      id="profile-rhr"
                      type="number"
                      value={form.restingHR}
                      onChange={(e) => setForm({ ...form, restingHR: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-mhr">Max HR (bpm)</Label>
                    <Input
                      id="profile-mhr"
                      type="number"
                      value={form.maxHR}
                      onChange={(e) => setForm({ ...form, maxHR: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-chr">Current HR (bpm)</Label>
                    <Input
                      id="profile-chr"
                      type="number"
                      placeholder="recent training avg"
                      value={form.currentHR}
                      onChange={(e) => setForm({ ...form, currentHR: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-thr">Target HR (bpm)</Label>
                    <Input
                      id="profile-thr"
                      type="number"
                      placeholder="goal effort HR"
                      value={form.targetHR}
                      onChange={(e) => setForm({ ...form, targetHR: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-target-pace">Target pace (min/km)</Label>
                    <Input
                      id="profile-target-pace"
                      placeholder="e.g. 4:30"
                      value={form.targetPaceKm}
                      onChange={(e) => setForm({ ...form, targetPaceKm: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>Discipline</Label>
                    <div className="flex flex-wrap gap-2">
                      {disciplineOptions.map((d) => {
                        const active = form.discipline.includes(d.value)
                        return (
                          <button
                            type="button"
                            key={d.value}
                            onClick={() => toggleDiscipline(d.value)}
                            aria-pressed={active}
                            className={cn(
                              'rounded-full border px-3 py-1 text-sm transition-luxury',
                              active
                                ? 'border-navy bg-navy text-white'
                                : 'border-border bg-background text-muted-foreground hover:border-navy/40',
                            )}
                          >
                            {d.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="profile-events">Events (comma separated)</Label>
                    <Input
                      id="profile-events"
                      placeholder="e.g. 800m, 1500m, 3000m"
                      value={form.events}
                      onChange={(e) => setForm({ ...form, events: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-goal-event">Goal race event</Label>
                    <Input
                      id="profile-goal-event"
                      placeholder="e.g. Tel Aviv Half"
                      value={form.goalRaceEvent}
                      onChange={(e) => setForm({ ...form, goalRaceEvent: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="profile-goal-date">Goal race date</Label>
                    <Input
                      id="profile-goal-date"
                      type="date"
                      value={form.goalRaceDate}
                      onChange={(e) => setForm({ ...form, goalRaceDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="profile-goal-target">Target time</Label>
                    <Input
                      id="profile-goal-target"
                      placeholder="e.g. 1:35:00"
                      value={form.goalRaceTarget}
                      onChange={(e) => setForm({ ...form, goalRaceTarget: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-2 md:col-span-2">
                    <Button
                      onClick={handleSave}
                      disabled={saving}
                      className="bg-gold hover:bg-gold/90 text-navy"
                    >
                      {saving ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Save className="h-4 w-4 mr-2" />
                      )}
                      Save Profile
                    </Button>
                    <Button variant="outline" onClick={() => setEditing(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Training zones */}
      <TrainingZonesCard
        personalRecords={personalRecords}
        restingHR={form.restingHR ? Number(form.restingHR) : undefined}
        maxHR={form.maxHR ? Number(form.maxHR) : undefined}
      />

      {/* Tabs */}
      <Tabs defaultValue="prs" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="prs">PRs</TabsTrigger>
          <TabsTrigger value="season">Season Best</TabsTrigger>
          <TabsTrigger value="paces">Paces</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
        </TabsList>

        {/* Personal Records */}
        <TabsContent value="prs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-gold" />
                Personal Records
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <RecordEditor
                kind="pr"
                records={personalRecords}
                onAdd={(r) => upsertRecord('personalRecords', r)}
                onRemove={(id) => removeRecord('personalRecords', id)}
              />
              {personalRecords.length === 0 ? (
                <p className="text-muted-foreground text-center py-6">
                  No personal records yet
                </p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {personalRecords.map((pr) => (
                    <div
                      key={pr.id}
                      className="p-4 rounded-lg border border-border bg-gradient-to-br from-gold/5 to-transparent"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <Badge className="bg-gold/20 text-gold border-gold/30">
                          {pr.event}
                        </Badge>
                        <Award className="h-5 w-5 text-gold" />
                      </div>
                      <p className="text-3xl font-bold text-navy font-mono">{pr.time}</p>
                      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(pr.date), 'MMM d, yyyy')}
                        </div>
                        {pr.location && (
                          <div className="flex items-center gap-2">
                            <MapPin className="h-3.5 w-3.5" />
                            {pr.location}
                          </div>
                        )}
                        {pr.competition && (
                          <p className="text-xs mt-1">{pr.competition}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Season Bests */}
        <TabsContent value="season" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-gold" />
                {new Date().getFullYear()} Season Bests
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <RecordEditor
                kind="sb"
                records={seasonBests}
                onAdd={(r) => upsertRecord('seasonBests', r)}
                onRemove={(id) => removeRecord('seasonBests', id)}
              />
              {seasonBests.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {seasonBests.map((sb) => (
                    <div key={sb.id} className="p-4 rounded-lg border border-border">
                      <div className="flex items-start justify-between mb-2">
                        <Badge variant="outline">{sb.event}</Badge>
                      </div>
                      <p className="text-2xl font-bold text-navy font-mono">{sb.time}</p>
                      <div className="mt-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(sb.date), 'MMM d, yyyy')}
                        </div>
                        {sb.location && (
                          <div className="flex items-center gap-2 mt-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {sb.location}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No season bests recorded yet
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Training Paces */}
        <TabsContent value="paces" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-gold" />
                Training Paces
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <PaceEditor
                paces={trainingPaces}
                onAdd={upsertPace}
                onRemove={removePace}
              />
              {trainingPaces.length === 0 ? (
                <p className="text-muted-foreground text-center py-6">
                  No training paces yet
                </p>
              ) : (
                <div className="space-y-3">
                  {trainingPaces.map((pace) => (
                    <div
                      key={pace.id}
                      className="flex items-center justify-between p-4 rounded-lg border border-border"
                    >
                      <div className="flex items-center gap-4">
                        <Badge
                          className={cn(
                            'capitalize font-medium',
                            paceTypeColors[pace.type] || 'bg-muted',
                          )}
                        >
                          {pace.type}
                        </Badge>
                        <div>
                          <p className="font-mono font-semibold text-navy">{pace.pace}</p>
                          {pace.description && (
                            <p className="text-sm text-muted-foreground">{pace.description}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Goals */}
        <TabsContent value="goals" id="goals" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-gold" />
                Goals
              </CardTitle>
            </CardHeader>
            <CardContent>
              {goals.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">No goals yet</p>
              ) : (
                <div className="space-y-4">
                  {goals.map((goal) => (
                    <div
                      key={goal.id}
                      className={cn(
                        'p-4 rounded-lg border',
                        goal.status === 'active'
                          ? 'border-gold/30 bg-gold/5'
                          : goal.status === 'achieved'
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-border bg-muted/30',
                      )}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold text-navy">{goal.title}</h4>
                            <Badge
                              variant="outline"
                              className={cn(
                                goal.status === 'active' && 'bg-gold/10 text-gold border-gold/30',
                                goal.status === 'achieved' && 'bg-emerald-100 text-emerald-700 border-emerald-200',
                                goal.status === 'archived' && 'bg-muted text-muted-foreground',
                              )}
                            >
                              {goal.status}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                            {goal.targetEvent && <span>Event: {goal.targetEvent}</span>}
                            {goal.targetTime && (
                              <span className="font-mono">Target: {goal.targetTime}</span>
                            )}
                            {goal.targetDate && (
                              <span>By: {format(new Date(goal.targetDate), 'MMM d, yyyy')}</span>
                            )}
                          </div>
                          {goal.notes && (
                            <p className="text-sm text-muted-foreground mt-2">{goal.notes}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
