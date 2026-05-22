'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { format, parseISO, startOfWeek } from 'date-fns'
import {
  ArrowLeft,
  Trophy,
  Target,
  Clock,
  Calendar,
  MapPin,
  Award,
  Activity,
  MessageCircle,
  Loader2,
  Download,
  Plus,
  X,
  Save,
  Check,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type {
  AssignedWorkout,
  AthleteProfile,
  Workout,
  WorkoutLog,
  PersonalRecord,
  TrainingPace,
  Goal,
  Discipline,
  ExperienceLevel,
  TrainingDayType,
  WeekSchedule,
} from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  setDoc,
  serverTimestamp,
  DocumentData,
  QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { TrainingZonesCard } from '@/components/athlete/training-zones-card'
import { RecordEditor, PaceEditor } from '@/components/athlete/profile-editors'
import { AthleteSchedule } from '@/components/athlete/athlete-schedule'
import { toast } from 'sonner'
import { exportAthleteToExcel } from '@/lib/export-athlete'
import { workoutTypeColors, useWorkoutTypeLabels } from '@/lib/workout-labels'
import { useLanguage } from '@/contexts/language-context'

function cleanData<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

function genId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

function mapDocToWorkoutLog(d: QueryDocumentSnapshot<DocumentData>, fallbackAthleteId: string): WorkoutLog {
  const data = d.data()
  return {
    id: d.id,
    athleteId: data.athleteId || fallbackAthleteId,
    workoutId: data.workoutId || '',
    date: data.date || '',
    actualDistance: data.actualDistance ?? undefined,
    actualPace: data.actualPace ?? undefined,
    effort: legacyEffortToNumber(data.effort),
    comment: data.comment || '',
    createdAt: data.createdAt?.toDate?.() || new Date(),
  }
}

function mapDocToAssignedWorkout(d: QueryDocumentSnapshot<DocumentData>): AssignedWorkout {
  const data = d.data()
  return {
    id: d.id,
    workoutId: data.workoutId || '',
    workout: (data.workout || {}) as Workout,
    athleteId: data.athleteId || '',
    assignedBy: data.assignedBy || '',
    scheduledDate: data.scheduledDate || '',
    status: data.status || 'scheduled',
    athleteNotes: data.athleteNotes,
    coachFeedback: data.coachFeedback,
    completedAt: data.completedAt?.toDate?.(),
    actualDuration: data.actualDuration,
    actualDistance: data.actualDistance,
    perceivedEffort: data.perceivedEffort,
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  }
}

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
  goalRaceEvent: string
  goalRaceDate: string
  goalRaceTarget: string
  weekSchedule: WeekSchedule
  weeklyKmMin: string
  weeklyKmMax: string
  offWeekInterval: string
}

interface GoalForm {
  title: string
  targetEvent: string
  targetTime: string
  targetDate: string
  notes: string
}

const defaultWeekSchedule: WeekSchedule = {
  monday: 'rest',
  tuesday: 'rest',
  wednesday: 'rest',
  thursday: 'rest',
  friday: 'rest',
  saturday: 'rest',
  sunday: 'rest',
}

const disciplineValues: Discipline[] = ['track', 'road', 'jogger', 'trail', 'mixed']
const experienceValues: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'professional']

interface AthleteDetailProps {
  athleteId: string
}

export function AthleteDetail({ athleteId }: AthleteDetailProps) {
  const { t } = useLanguage()
  const workoutTypeLabels = useWorkoutTypeLabels()

  const [athlete, setAthlete] = useState<AthleteProfile | null>(null)
  const [athleteWorkouts, setAthleteWorkouts] = useState<AssignedWorkout[]>([])
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)

  const [personalRecords, setPersonalRecords] = useState<PersonalRecord[]>([])
  const [seasonBests, setSeasonBests] = useState<PersonalRecord[]>([])
  const [trainingPaces, setTrainingPaces] = useState<TrainingPace[]>([])
  const [goals, setGoals] = useState<Goal[]>([])

  const [editingProfile, setEditingProfile] = useState(false)
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileForm, setProfileForm] = useState<ProfileForm>({
    name: '', dateOfBirth: '', gender: '', height: '', weight: '',
    events: '', discipline: [], experienceLevel: '', weeklyMileage: '',
    restingHR: '', maxHR: '', goalRaceEvent: '', goalRaceDate: '', goalRaceTarget: '',
    weekSchedule: defaultWeekSchedule, weeklyKmMin: '', weeklyKmMax: '', offWeekInterval: '4',
  })

  const [goalForm, setGoalForm] = useState<GoalForm>({
    title: '', targetEvent: '', targetTime: '', targetDate: '', notes: '',
  })
  const [savingGoal, setSavingGoal] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const profileSnap = await getDoc(doc(db, 'users', athleteId))
        if (profileSnap.exists()) {
          const data = profileSnap.data()
          const prs = Array.isArray(data.personalRecords) ? data.personalRecords : []
          const sbs = Array.isArray(data.seasonBests) ? data.seasonBests : []
          const paces = Array.isArray(data.trainingPaces) ? data.trainingPaces : []
          const gs = Array.isArray(data.goals) ? data.goals : []
          setAthlete({
            id: profileSnap.id,
            userId: data.userId || profileSnap.id,
            name: data.name || data.email || 'Athlete',
            email: data.email || '',
            photoURL: data.photoURL,
            dateOfBirth: data.dateOfBirth,
            gender: data.gender,
            height: data.height,
            weight: data.weight,
            events: Array.isArray(data.events) ? data.events : [],
            discipline: Array.isArray(data.discipline) ? data.discipline : undefined,
            experienceLevel: data.experienceLevel,
            weeklyMileage: data.weeklyMileage,
            restingHR: data.restingHR,
            maxHR: data.maxHR,
            goalRaceEvent: data.goalRaceEvent,
            goalRaceDate: data.goalRaceDate,
            goalRaceTarget: data.goalRaceTarget,
            personalRecords: prs,
            seasonBests: sbs,
            trainingPaces: paces,
            goals: gs,
            coachId: data.coachId,
            createdAt: data.createdAt?.toDate?.() || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || new Date(),
          })
          setPersonalRecords(prs)
          setSeasonBests(sbs)
          setTrainingPaces(paces)
          setGoals(gs)
          setProfileForm({
            name: data.name || '',
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
            goalRaceEvent: data.goalRaceEvent || '',
            goalRaceDate: data.goalRaceDate || '',
            goalRaceTarget: data.goalRaceTarget || '',
            weekSchedule: (data.weekSchedule as WeekSchedule) || defaultWeekSchedule,
            weeklyKmMin: data.weeklyKmRange?.min ? String(data.weeklyKmRange.min) : '',
            weeklyKmMax: data.weeklyKmRange?.max ? String(data.weeklyKmRange.max) : '',
            offWeekInterval: data.offWeekInterval ? String(data.offWeekInterval) : '4',
          })
        } else {
          setAthlete(null)
        }
      } catch (err) {
        console.error('Error loading athlete:', err)
        setAthlete(null)
      }

      try {
        const aw = await getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId)))
        setAthleteWorkouts(aw.docs.map(mapDocToAssignedWorkout))
      } catch (err) {
        console.error('Error loading assigned workouts:', err)
      }

      try {
        const q = query(collection(db, 'logs'), where('athleteId', '==', athleteId))
        const snapshot = await getDocs(q)
        setLogs(snapshot.docs.map((d) => mapDocToWorkoutLog(d, athleteId)))
      } catch (error) {
        console.error('Error loading athlete logs:', error)
      }

      setLoading(false)
    }
    load()
  }, [athleteId])

  const persistField = async (
    field: 'personalRecords' | 'seasonBests' | 'trainingPaces' | 'goals',
    value: unknown[],
  ) => {
    try {
      await setDoc(doc(db, 'users', athleteId), { [field]: cleanData(value), updatedAt: serverTimestamp() }, { merge: true })
    } catch (err) {
      console.error(`Error saving ${field}:`, err)
      toast.error(t.toastSaveChangesFailed)
    }
  }

  const upsertRecord = async (field: 'personalRecords' | 'seasonBests', record: PersonalRecord) => {
    const list = field === 'personalRecords' ? personalRecords : seasonBests
    const setter = field === 'personalRecords' ? setPersonalRecords : setSeasonBests
    const exists = list.some((r) => r.id === record.id)
    const next = exists ? list.map((r) => (r.id === record.id ? record : r)) : [...list, record]
    setter(next)
    await persistField(field, next)
    toast.success(exists ? t.toastUpdated : t.toastAdded)
  }

  const removeRecord = async (field: 'personalRecords' | 'seasonBests', id: string) => {
    const list = field === 'personalRecords' ? personalRecords : seasonBests
    const setter = field === 'personalRecords' ? setPersonalRecords : setSeasonBests
    const next = list.filter((r) => r.id !== id)
    setter(next)
    await persistField(field, next)
  }

  const upsertPace = async (pace: TrainingPace) => {
    const exists = trainingPaces.some((p) => p.id === pace.id)
    const next = exists ? trainingPaces.map((p) => (p.id === pace.id ? pace : p)) : [...trainingPaces, pace]
    setTrainingPaces(next)
    await persistField('trainingPaces', next)
    toast.success(exists ? t.toastUpdated : t.toastAdded)
  }

  const removePace = async (id: string) => {
    const next = trainingPaces.filter((p) => p.id !== id)
    setTrainingPaces(next)
    await persistField('trainingPaces', next)
  }

  const addGoal = async () => {
    if (!goalForm.title.trim()) return
    setSavingGoal(true)
    const newGoal: Goal = {
      id: genId('goal'),
      title: goalForm.title.trim(),
      targetEvent: goalForm.targetEvent.trim() || undefined,
      targetTime: goalForm.targetTime.trim() || undefined,
      targetDate: goalForm.targetDate || undefined,
      notes: goalForm.notes.trim() || undefined,
      status: 'active',
      createdAt: new Date(),
    }
    const next = [...goals, newGoal]
    setGoals(next)
    await persistField('goals', next)
    setGoalForm({ title: '', targetEvent: '', targetTime: '', targetDate: '', notes: '' })
    toast.success(t.toastAdded)
    setSavingGoal(false)
  }

  const removeGoal = async (id: string) => {
    const next = goals.filter((g) => g.id !== id)
    setGoals(next)
    await persistField('goals', next)
  }

  const updateGoalStatus = async (id: string, status: Goal['status']) => {
    const next = goals.map((g) => g.id === id ? { ...g, status } : g)
    setGoals(next)
    await persistField('goals', next)
  }

  const saveProfile = async () => {
    setSavingProfile(true)
    try {
      const updates = {
        name: profileForm.name.trim() || athlete?.name,
        dateOfBirth: profileForm.dateOfBirth || null,
        gender: profileForm.gender || null,
        height: profileForm.height ? Number(profileForm.height) : null,
        weight: profileForm.weight ? Number(profileForm.weight) : null,
        events: profileForm.events.split(',').map((e) => e.trim()).filter(Boolean),
        discipline: profileForm.discipline,
        experienceLevel: profileForm.experienceLevel || null,
        weeklyMileage: profileForm.weeklyMileage ? Number(profileForm.weeklyMileage) : null,
        restingHR: profileForm.restingHR ? Number(profileForm.restingHR) : null,
        maxHR: profileForm.maxHR ? Number(profileForm.maxHR) : null,
        goalRaceEvent: profileForm.goalRaceEvent || null,
        goalRaceDate: profileForm.goalRaceDate || null,
        goalRaceTarget: profileForm.goalRaceTarget || null,
        weekSchedule: profileForm.weekSchedule,
        weeklyKmRange: profileForm.weeklyKmMin && profileForm.weeklyKmMax ? { min: Number(profileForm.weeklyKmMin), max: Number(profileForm.weeklyKmMax) } : null,
        offWeekInterval: profileForm.offWeekInterval ? Number(profileForm.offWeekInterval) : null,
        updatedAt: serverTimestamp(),
      }
      await setDoc(doc(db, 'users', athleteId), cleanData(updates), { merge: true })
      setEditingProfile(false)
      toast.success(t.toastProfileSaved)
    } catch (err) {
      console.error('Error saving profile:', err)
      toast.error(t.toastProfileSaveFailed)
    } finally {
      setSavingProfile(false)
    }
  }

  const toggleDiscipline = (d: Discipline) => {
    setProfileForm((f) => ({
      ...f,
      discipline: f.discipline.includes(d) ? f.discipline.filter((x) => x !== d) : [...f.discipline, d],
    }))
  }

  const getLogForWorkout = (workoutId: string): WorkoutLog | undefined =>
    logs.find((l) => l.workoutId === workoutId)

  const weeklyStats = (() => {
    const map = new Map<string, { week: string; totalDistance: number }>()
    for (const log of logs) {
      if (!log.date) continue
      const start = startOfWeek(parseISO(log.date), { weekStartsOn: 1 })
      const key = start.toISOString().slice(0, 10)
      const cur = map.get(key) || { week: format(start, 'MMM d'), totalDistance: 0 }
      cur.totalDistance += log.actualDistance || 0
      map.set(key, cur)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([, v]) => v)
  })()

  const getInitials = (name: string | undefined | null) => {
    const safeName = name || '?'
    return safeName.split(' ').map((n) => n[0] || '').join('').toUpperCase().slice(0, 2) || '?'
  }

  const handleExport = async () => {
    if (!athlete) return
    setExporting(true)
    try {
      const filename = await exportAthleteToExcel(athleteId)
      toast.success(`${t.exportedToast} ${filename}`)
    } catch (err) {
      console.error('Export error:', err)
      toast.error(t.exportFailedToast)
    } finally {
      setExporting(false)
    }
  }

  const disciplineLabel: Record<Discipline, string> = {
    track: t.disciplineTrack, road: t.disciplineRoad, jogger: t.disciplineJogger,
    trail: t.disciplineTrail, mixed: t.disciplineMixed,
  }

  const goalStatusColors: Record<Goal['status'], string> = {
    active: 'bg-gold/10 text-gold border-gold/30',
    achieved: 'bg-emerald-100 text-emerald-700 border-emerald-200',
    archived: 'bg-muted text-muted-foreground',
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  if (!athlete) {
    return (
      <div className="space-y-6">
        <Link href="/coach/athletes">
          <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="h-4 w-4 mr-2" />{t.backToAthletes}
          </Button>
        </Link>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">{t.athleteNotFound}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <Link href="/coach/athletes">
        <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4 mr-2" />{t.backToAthletes}
        </Button>
      </Link>

      {/* Profile Header */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-start gap-6">
            <Avatar className="w-24 h-24 border-4 border-gold/20">
              <AvatarImage src={athlete.photoURL} alt={athlete.name} />
              <AvatarFallback className="bg-gold/10 text-gold text-2xl font-serif">
                {getInitials(athlete.name)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <h1 className="text-2xl font-serif font-bold text-navy">{athlete.name}</h1>
                  <p className="text-muted-foreground">{athlete.email}</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Button variant="outline" onClick={handleExport} disabled={exporting} className="border-gold/40 text-navy hover:border-gold">
                    {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
                    {exporting ? t.generatingDots : t.exportBtn}
                  </Button>
                  <Link href={`/coach/athletes/${athleteId}/journey`}>
                    <Button variant="outline" className="border-coral/40 text-coral hover:bg-coral-light">{t.journeyBtn}</Button>
                  </Link>
                  <Link href={`/coach/athletes/${athleteId}/planner`}>
                    <Button className="bg-navy hover:bg-navy/90 text-white">📅 Training Planner</Button>
                  </Link>
                  <Link href={`/coach/athletes/${athleteId}/assign`}>
                    <Button className="bg-gold hover:bg-gold/90 text-navy">{t.assignWorkoutBtn}</Button>
                  </Link>
                  <Link href={`/coach/athletes/${athleteId}/documents`}>
                    <Button variant="outline" className="border-navy/40 text-navy hover:bg-navy/10">📄 מסמכים</Button>
                  </Link>
                  <Link href={`/coach/chat?athlete=${athleteId}`}>
                    <Button variant="outline">{t.messageBtn}</Button>
                  </Link>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                {athlete.events.map((event) => (
                  <Badge key={event} variant="secondary" className="bg-navy/10 text-navy">{event}</Badge>
                ))}
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="flex items-center gap-2 text-sm">
                  <Trophy className="h-4 w-4 text-gold" />
                  <span className="text-muted-foreground">{personalRecords.length} {t.tabPRs}</span>
                </div>
                <div className="flex items-center gap-2 text-sm">
                  <Target className="h-4 w-4 text-gold" />
                  <span className="text-muted-foreground">{goals.filter(g => g.status === 'active').length} {t.activeGoalsLabel}</span>
                </div>
                {athlete.height && (
                  <div className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{athlete.height} cm</span>
                  </div>
                )}
                {athlete.weight && (
                  <div className="flex items-center gap-2 text-sm">
                    <Activity className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{athlete.weight} kg</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <TrainingZonesCard personalRecords={personalRecords} restingHR={athlete.restingHR} maxHR={athlete.maxHR} showFormula />

      {/* Tabs */}
      <Tabs defaultValue="schedule" className="space-y-6">
        <TabsList className="flex flex-wrap gap-1 h-auto">
          <TabsTrigger value="schedule">{t.scheduleTab}</TabsTrigger>
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="prs">{t.tabPRs}</TabsTrigger>
          <TabsTrigger value="season">{t.tabSeasonBest}</TabsTrigger>
          <TabsTrigger value="paces">{t.pacesTab}</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
          <TabsTrigger value="progress">{t.progressTab}</TabsTrigger>
          <TabsTrigger value="documents">📄 מסמכים</TabsTrigger>
        </TabsList>

        {/* Schedule Tab */}
        <TabsContent value="schedule" className="space-y-4">
          <div className="flex justify-end mb-2">
            <Link href={`/coach/athletes/${athleteId}/assign`}>
              <Button size="sm" className="bg-gold hover:bg-gold/90 text-navy">{t.assignNewBtn}</Button>
            </Link>
          </div>
          <AthleteSchedule athleteId={athleteId} readOnly={true} />
        </TabsContent>

                {/* Profile Tab */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Athlete Profile</CardTitle>
              {!editingProfile ? (
                <Button onClick={() => setEditingProfile(true)} className="bg-gold hover:bg-gold/90 text-navy">
                  Edit Profile
                </Button>
              ) : (
                <div className="flex gap-2">
                  <Button onClick={saveProfile} disabled={savingProfile} className="bg-gold hover:bg-gold/90 text-navy">
                    {savingProfile ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}
                    {t.saveProfile}
                  </Button>
                  <Button variant="outline" onClick={() => setEditingProfile(false)}>{t.cancel}</Button>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {!editingProfile ? (
                <div className="grid grid-cols-2 md:grid-cols-3 gap-6 text-sm">
                  {profileForm.name && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldName}</p><p className="font-medium text-navy">{profileForm.name}</p></div>}
                  {profileForm.dateOfBirth && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldDateOfBirth}</p><p className="font-medium text-navy">{format(new Date(profileForm.dateOfBirth), 'MMM d, yyyy')}</p></div>}
                  {profileForm.gender && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldGender}</p><p className="font-medium text-navy capitalize">{profileForm.gender}</p></div>}
                  {profileForm.height && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldHeight}</p><p className="font-medium text-navy">{profileForm.height} cm</p></div>}
                  {profileForm.weight && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldWeight}</p><p className="font-medium text-navy">{profileForm.weight} kg</p></div>}
                  {profileForm.weeklyMileage && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldWeeklyMileage}</p><p className="font-medium text-navy">{profileForm.weeklyMileage} km/wk</p></div>}
                  {profileForm.experienceLevel && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldExperienceLevel}</p><p className="font-medium text-navy capitalize">{profileForm.experienceLevel}</p></div>}
                  {profileForm.restingHR && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldRestingHR}</p><p className="font-medium text-navy">{profileForm.restingHR} bpm</p></div>}
                  {profileForm.maxHR && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldMaxHR}</p><p className="font-medium text-navy">{profileForm.maxHR} bpm</p></div>}
                  {profileForm.goalRaceEvent && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldGoalRaceEvent}</p><p className="font-medium text-navy">{profileForm.goalRaceEvent}</p></div>}
                  {profileForm.goalRaceTarget && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldTargetTime}</p><p className="font-medium text-navy">{profileForm.goalRaceTarget}</p></div>}
                  {profileForm.goalRaceDate && <div><p className="text-muted-foreground text-xs mb-1">{t.fieldGoalRaceDate}</p><p className="font-medium text-navy">{format(new Date(profileForm.goalRaceDate), 'MMM d, yyyy')}</p></div>}
                  {profileForm.discipline.length > 0 && <div className="col-span-2 md:col-span-3"><p className="text-muted-foreground text-xs mb-1">{t.fieldDiscipline}</p><div className="flex flex-wrap gap-1">{profileForm.discipline.map(d => <Badge key={d} variant="outline" className="text-navy">{disciplineLabel[d]}</Badge>)}</div></div>}
                  {profileForm.events && <div className="col-span-2 md:col-span-3"><p className="text-muted-foreground text-xs mb-1">{t.fieldEvents}</p><p className="font-medium text-navy">{profileForm.events}</p></div>}
                  {/* Weekly Schedule */}
                  <div className="col-span-2 md:col-span-3 pt-3 border-t mt-2">
                    <p className="text-muted-foreground text-xs mb-2 uppercase tracking-wide font-medium">Weekly Training Schedule</p>
                    <div className="flex flex-wrap gap-3">
                      {(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const).map(day => {
                        const type = profileForm.weekSchedule[day]
                        const colorMap: Record<string, string> = {
                          rest: 'bg-muted text-muted-foreground',
                          off: 'bg-muted text-muted-foreground',
                          easy: 'bg-emerald-100 text-emerald-700',
                          workout: 'bg-blue-100 text-blue-700',
                          long_run: 'bg-orange-100 text-orange-700',
                        }
                        return (
                          <div key={day} className="text-center">
                            <p className="text-xs text-muted-foreground mb-1 capitalize">{day.slice(0,3)}</p>
                            <Badge variant="outline" className={cn('text-xs capitalize', colorMap[type] || '')}>{type.replace('_',' ')}</Badge>
                          </div>
                        )
                      })}
                    </div>
                    {(profileForm.weeklyKmMin || profileForm.weeklyKmMax) && (
                      <p className="text-sm text-muted-foreground mt-2">
                        Weekly target: <span className="font-medium text-navy">{profileForm.weeklyKmMin}–{profileForm.weeklyKmMax} km</span>
                        {profileForm.offWeekInterval && <span className="ml-2 text-xs">(recovery every {profileForm.offWeekInterval} weeks)</span>}
                      </p>
                    )}
                  </div>
                </div>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2"><Label>{t.fieldName}</Label><Input value={profileForm.name} onChange={(e) => setProfileForm({...profileForm, name: e.target.value})} /></div>
                  <div className="space-y-2"><Label>{t.fieldDateOfBirth}</Label><Input type="date" value={profileForm.dateOfBirth} onChange={(e) => setProfileForm({...profileForm, dateOfBirth: e.target.value})} /></div>
                  <div className="space-y-2">
                    <Label>{t.fieldGender}</Label>
                    <Select value={profileForm.gender || undefined} onValueChange={(v) => setProfileForm({...profileForm, gender: v as ProfileForm['gender']})}>
                      <SelectTrigger><SelectValue placeholder={t.selectPlaceholder} /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="male">{t.male}</SelectItem>
                        <SelectItem value="female">{t.female}</SelectItem>
                        <SelectItem value="other">{t.otherGender}</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>{t.fieldExperienceLevel}</Label>
                    <Select value={profileForm.experienceLevel || undefined} onValueChange={(v) => setProfileForm({...profileForm, experienceLevel: v as ExperienceLevel})}>
                      <SelectTrigger><SelectValue placeholder={t.selectPlaceholder} /></SelectTrigger>
                      <SelectContent>
                        {experienceValues.map((v) => <SelectItem key={v} value={v} className="capitalize">{v}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2"><Label>{t.fieldHeight}</Label><Input type="number" value={profileForm.height} onChange={(e) => setProfileForm({...profileForm, height: e.target.value})} /></div>
                  <div className="space-y-2"><Label>{t.fieldWeight}</Label><Input type="number" value={profileForm.weight} onChange={(e) => setProfileForm({...profileForm, weight: e.target.value})} /></div>
                  <div className="space-y-2"><Label>{t.fieldWeeklyMileage}</Label><Input type="number" value={profileForm.weeklyMileage} onChange={(e) => setProfileForm({...profileForm, weeklyMileage: e.target.value})} /></div>
                  <div className="space-y-2"><Label>{t.fieldRestingHR}</Label><Input type="number" value={profileForm.restingHR} onChange={(e) => setProfileForm({...profileForm, restingHR: e.target.value})} /></div>
                  <div className="space-y-2"><Label>{t.fieldMaxHR}</Label><Input type="number" value={profileForm.maxHR} onChange={(e) => setProfileForm({...profileForm, maxHR: e.target.value})} /></div>
                  <div className="space-y-2"><Label>{t.fieldGoalRaceEvent}</Label><Input value={profileForm.goalRaceEvent} onChange={(e) => setProfileForm({...profileForm, goalRaceEvent: e.target.value})} /></div>
                  <div className="space-y-2"><Label>{t.fieldGoalRaceDate}</Label><Input type="date" value={profileForm.goalRaceDate} onChange={(e) => setProfileForm({...profileForm, goalRaceDate: e.target.value})} /></div>
                  <div className="space-y-2"><Label>{t.fieldTargetTime}</Label><Input value={profileForm.goalRaceTarget} onChange={(e) => setProfileForm({...profileForm, goalRaceTarget: e.target.value})} /></div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>{t.fieldDiscipline}</Label>
                    <div className="flex flex-wrap gap-2">
                      {disciplineValues.map((d) => {
                        const active = profileForm.discipline.includes(d)
                        return (
                          <button type="button" key={d} onClick={() => toggleDiscipline(d)} aria-pressed={active}
                            className={cn('rounded-full border px-3 py-1 text-sm transition-colors', active ? 'border-navy bg-navy text-white' : 'border-border bg-background text-muted-foreground hover:border-navy/40')}>
                            {disciplineLabel[d]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label>{t.fieldEvents}</Label>
                    <Input placeholder={t.placeholderEvents} value={profileForm.events} onChange={(e) => setProfileForm({...profileForm, events: e.target.value})} />
                  </div>
                  {/* Weekly Schedule Edit */}
                  <div className="space-y-3 md:col-span-2">
                    <Label>Weekly Training Schedule</Label>
                    <div className="grid grid-cols-7 gap-1">
                      {(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'] as const).map(day => (
                        <div key={day} className="space-y-1">
                          <p className="text-xs text-muted-foreground text-center capitalize">{day.slice(0,3)}</p>
                          <Select value={profileForm.weekSchedule[day]} onValueChange={(v) => setProfileForm(f => ({ ...f, weekSchedule: { ...f.weekSchedule, [day]: v as TrainingDayType } }))}>
                            <SelectTrigger className="h-8 text-xs px-1"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="off">Off</SelectItem>
                              <SelectItem value="rest">Rest</SelectItem>
                              <SelectItem value="easy">Easy</SelectItem>
                              <SelectItem value="workout">Workout</SelectItem>
                              <SelectItem value="long_run">Long Run</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="space-y-2"><Label>Weekly KM Min</Label><Input type="number" placeholder="40" value={profileForm.weeklyKmMin} onChange={(e) => setProfileForm({...profileForm, weeklyKmMin: e.target.value})} /></div>
                  <div className="space-y-2"><Label>Weekly KM Max</Label><Input type="number" placeholder="60" value={profileForm.weeklyKmMax} onChange={(e) => setProfileForm({...profileForm, weeklyKmMax: e.target.value})} /></div>
                  <div className="space-y-2"><Label>Off-week every (weeks)</Label><Input type="number" placeholder="4" value={profileForm.offWeekInterval} onChange={(e) => setProfileForm({...profileForm, offWeekInterval: e.target.value})} /></div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* PRs Tab */}
        <TabsContent value="prs" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Trophy className="h-5 w-5 text-gold" />{t.personalRecordsTitle}</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <RecordEditor kind="pr" records={personalRecords} onAdd={(r) => upsertRecord('personalRecords', r)} onRemove={(id) => removeRecord('personalRecords', id)} />
              {personalRecords.length === 0 ? (
                <p className="text-muted-foreground text-center py-6">{t.noPRsYet}</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {personalRecords.map((pr) => (
                    <div key={pr.id} className="p-4 rounded-lg border border-border bg-gradient-to-br from-gold/5 to-transparent">
                      <div className="flex items-start justify-between mb-2">
                        <Badge className="bg-gold/20 text-gold border-gold/30">{pr.event}</Badge>
                        <Award className="h-5 w-5 text-gold" />
                      </div>
                      <p className="text-3xl font-bold text-navy font-mono">{pr.time}</p>
                      <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5" />{format(new Date(pr.date), 'MMM d, yyyy')}</div>
                        {pr.location && <div className="flex items-center gap-2"><MapPin className="h-3.5 w-3.5" />{pr.location}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Season Bests Tab */}
        <TabsContent value="season" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-gold" />{new Date().getFullYear()} {t.seasonBestsTitle}</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <RecordEditor kind="sb" records={seasonBests} onAdd={(r) => upsertRecord('seasonBests', r)} onRemove={(id) => removeRecord('seasonBests', id)} />
              {seasonBests.length === 0 ? (
                <p className="text-muted-foreground text-center py-6">{t.noSeasonBestsYet}</p>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {seasonBests.map((sb) => (
                    <div key={sb.id} className="p-4 rounded-lg border border-border">
                      <Badge variant="outline">{sb.event}</Badge>
                      <p className="text-2xl font-bold text-navy font-mono mt-2">{sb.time}</p>
                      <div className="mt-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2"><Calendar className="h-3.5 w-3.5" />{format(new Date(sb.date), 'MMM d, yyyy')}</div>
                        {sb.location && <div className="flex items-center gap-2 mt-1"><MapPin className="h-3.5 w-3.5" />{sb.location}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Paces Tab */}
        <TabsContent value="paces" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-gold" />{t.trainingPacesTitle}</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              <PaceEditor paces={trainingPaces} onAdd={upsertPace} onRemove={removePace} />
              {trainingPaces.length === 0 ? (
                <p className="text-muted-foreground text-center py-6">{t.noTrainingPacesYet}</p>
              ) : (
                <div className="space-y-3">
                  {trainingPaces.map((pace) => (
                    <div key={pace.id} className="flex items-center justify-between p-4 rounded-lg border border-border">
                      <div className="flex items-center gap-4">
                        <Badge className="capitalize bg-navy/10 text-navy">{pace.type}</Badge>
                        <div>
                          <p className="font-mono font-semibold text-navy">{pace.pace}</p>
                          {pace.description && <p className="text-sm text-muted-foreground">{pace.description}</p>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Goals Tab */}
        <TabsContent value="goals" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Target className="h-5 w-5 text-gold" />Goals</CardTitle></CardHeader>
            <CardContent className="space-y-6">
              {/* Add Goal Form */}
              <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3">
                <p className="text-sm font-medium text-navy">Add new goal</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1 md:col-span-2">
                    <Label className="text-xs">Goal title</Label>
                    <Input placeholder="e.g. Run sub-3h marathon" value={goalForm.title} onChange={(e) => setGoalForm({...goalForm, title: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t.fieldGoalRaceEvent}</Label>
                    <Input placeholder="e.g. Tel Aviv Marathon" value={goalForm.targetEvent} onChange={(e) => setGoalForm({...goalForm, targetEvent: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t.fieldTargetTime}</Label>
                    <Input placeholder="e.g. 2:59:00" value={goalForm.targetTime} onChange={(e) => setGoalForm({...goalForm, targetTime: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t.fieldGoalRaceDate}</Label>
                    <Input type="date" value={goalForm.targetDate} onChange={(e) => setGoalForm({...goalForm, targetDate: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{t.noteOptional}</Label>
                    <Input placeholder="Any notes..." value={goalForm.notes} onChange={(e) => setGoalForm({...goalForm, notes: e.target.value})} />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button onClick={addGoal} disabled={savingGoal || !goalForm.title.trim()} size="sm" className="bg-gold hover:bg-gold/90 text-navy">
                    {savingGoal ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
                    Add goal
                  </Button>
                </div>
              </div>

              {/* Goals List */}
              {goals.length === 0 ? (
                <p className="text-muted-foreground text-center py-6">{t.noGoalsYet}</p>
              ) : (
                <div className="space-y-3">
                  {goals.map((goal) => (
                    <div key={goal.id} className={cn('p-4 rounded-lg border', goal.status === 'active' ? 'border-gold/30 bg-gold/5' : goal.status === 'achieved' ? 'border-emerald-200 bg-emerald-50' : 'border-border bg-muted/30')}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-2">
                            <h4 className="font-semibold text-navy">{goal.title}</h4>
                            <Badge variant="outline" className={goalStatusColors[goal.status]}>{goal.status}</Badge>
                          </div>
                          <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                            {goal.targetEvent && <span>{t.fieldGoalRaceEvent}: {goal.targetEvent}</span>}
                            {goal.targetTime && <span className="font-mono">{t.fieldTargetTime}: {goal.targetTime}</span>}
                            {goal.targetDate && <span>{t.dateField}: {format(new Date(goal.targetDate), 'MMM d, yyyy')}</span>}
                          </div>
                          {goal.notes && <p className="text-sm text-muted-foreground mt-1">{goal.notes}</p>}
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {goal.status !== 'achieved' && (
                            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-emerald-600 hover:text-emerald-700" onClick={() => updateGoalStatus(goal.id, 'achieved')}>
                              <Check className="h-3 w-3 mr-1" />Done
                            </Button>
                          )}
                          {goal.status === 'active' && (
                            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => updateGoalStatus(goal.id, 'archived')}>
                              Archive
                            </Button>
                          )}
                          {goal.status !== 'active' && (
                            <Button type="button" variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={() => updateGoalStatus(goal.id, 'active')}>
                              Reactivate
                            </Button>
                          )}
                          <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => removeGoal(goal.id)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Progress Tab */}
        <TabsContent value="progress" className="space-y-4">
          <Card>
            <CardHeader><CardTitle>{t.weeklyDistanceChart}</CardTitle></CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={weeklyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="week" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                    <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                    <Tooltip contentStyle={{ backgroundColor: 'var(--card)', border: '1px solid var(--border)', borderRadius: '8px' }} />
                    <Area type="monotone" dataKey="totalDistance" stroke="oklch(0.75 0.12 85)" fill="oklch(0.75 0.12 85 / 0.2)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="documents">
            <iframe
              src={`/coach/athletes/${athleteId}/documents`}
              className="w-full rounded-xl border border-border"
              style={{ height: '70vh', minHeight: 500 }}
            />
          </TabsContent>
        </Tabs>
    </div>
  )
}
