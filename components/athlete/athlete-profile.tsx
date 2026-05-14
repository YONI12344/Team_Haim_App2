'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'
import type {
  AthleteProfile as AthleteProfileType,
  PersonalRecord,
  TrainingPace,
  Goal,
} from '@/lib/types'

const paceTypeColors: Record<string, string> = {
  easy: 'bg-emerald-100 text-emerald-700',
  tempo: 'bg-amber-100 text-amber-700',
  threshold: 'bg-orange-100 text-orange-700',
  interval: 'bg-red-100 text-red-700',
  repetition: 'bg-purple-100 text-purple-700',
  race: 'bg-gold/20 text-gold',
}

interface ProfileForm {
  name: string
  dateOfBirth: string
  gender: string
  height: string
  weight: string
  events: string
}

export function AthleteProfile() {
  const { user, firebaseUser } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [hasProfile, setHasProfile] = useState(false)
  const [editing, setEditing] = useState(false)

  const [form, setForm] = useState<ProfileForm>({
    name: '',
    dateOfBirth: '',
    gender: '',
    height: '',
    weight: '',
    events: '',
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
          setForm({
            name: data.name || user.name || '',
            dateOfBirth: data.dateOfBirth || '',
            gender: data.gender || '',
            height: data.height ? String(data.height) : '',
            weight: data.weight ? String(data.weight) : '',
            events: Array.isArray(data.events) ? data.events.join(', ') : '',
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
  }, [user?.id, user?.name])

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

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
            My Profile
          </h1>
          <p className="text-muted-foreground">
            Your athletic profile and training information
          </p>
        </div>
        {!editing ? (
          <Button
            onClick={() => setEditing(true)}
            className="bg-gold hover:bg-gold/90 text-navy"
          >
            {hasProfile ? 'Edit Profile' : 'Complete your profile'}
          </Button>
        ) : null}
      </div>

      {!hasProfile && !editing && (
        <Card className="border-gold/30 bg-gold/5">
          <CardContent className="pt-6">
            <p className="text-navy font-medium">Complete your profile</p>
            <p className="text-muted-foreground text-sm mt-1">
              Add your details so your coach can tailor your training.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Profile Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-start gap-6">
            <Avatar className="w-24 h-24 border-4 border-gold/20">
              <AvatarImage src={user?.photoURL || firebaseUser?.photoURL || undefined} alt={displayName} />
              <AvatarFallback className="bg-gold/10 text-gold text-2xl font-serif">
                {getInitials(displayName)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 space-y-4 w-full">
              {!editing ? (
                <>
                  <div>
                    <h2 className="text-2xl font-serif font-bold text-navy">
                      {displayName}
                    </h2>
                    <p className="text-muted-foreground">{user?.email}</p>
                  </div>

                  <div className="flex flex-wrap gap-2">
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
                  </div>
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
                    <Input
                      id="profile-gender"
                      placeholder="male / female / other"
                      value={form.gender}
                      onChange={(e) => setForm({ ...form, gender: e.target.value })}
                    />
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
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="profile-events">Events (comma separated)</Label>
                    <Input
                      id="profile-events"
                      placeholder="e.g. 800m, 1500m, 3000m"
                      value={form.events}
                      onChange={(e) => setForm({ ...form, events: e.target.value })}
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
            <CardContent>
              {personalRecords.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
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
            <CardContent>
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
            <CardContent>
              {trainingPaces.length === 0 ? (
                <p className="text-muted-foreground text-center py-8">
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
