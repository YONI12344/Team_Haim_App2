'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { format, isToday, parseISO } from 'date-fns'
import { 
  Users, 
  Dumbbell, 
  MessageCircle, 
  TrendingUp,
  ChevronRight,
  Activity,
  Check,
  Loader2,
} from 'lucide-react'
import Link from 'next/link'
import { collection, getDocs, query, where, orderBy, limit, DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { AthleteProfile, Workout, AssignedWorkout } from '@/lib/types'

function mapDocToAthlete(d: QueryDocumentSnapshot<DocumentData>): AthleteProfile {
  const data = d.data()
  return {
    id: d.id,
    userId: data.userId || d.id,
    name: data.name || '',
    email: data.email || '',
    photoURL: data.photoURL,
    dateOfBirth: data.dateOfBirth,
    gender: data.gender,
    height: data.height,
    weight: data.weight,
    events: Array.isArray(data.events) ? data.events : [],
    personalRecords: Array.isArray(data.personalRecords) ? data.personalRecords : [],
    seasonBests: Array.isArray(data.seasonBests) ? data.seasonBests : [],
    trainingPaces: Array.isArray(data.trainingPaces) ? data.trainingPaces : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    coachId: data.coachId,
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  }
}

export function CoachDashboard() {
  const [athletes, setAthletes] = useState<AthleteProfile[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      // Load athletes from Firestore
      try {
        const athletesSnap = await getDocs(
          query(collection(db, 'users'), where('role', '==', 'athlete'))
        )
        setAthletes(athletesSnap.docs.map(mapDocToAthlete))
      } catch (err) {
        console.error('Error loading athletes:', err)
        setAthletes([])
      }

      // Load workouts from Firestore
      try {
        const workoutsSnap = await getDocs(
          query(collection(db, 'workouts'), orderBy('createdAt', 'desc'), limit(20))
        )
        setWorkouts(
          workoutsSnap.docs.map((d) => ({
            ...(d.data() as Workout),
            id: d.id,
          })),
        )
      } catch (err) {
        console.error('Error loading workouts:', err)
        setWorkouts([])
      }

      // Load assigned workouts
      try {
        const assignedSnap = await getDocs(
          query(collection(db, 'assignedWorkouts'), orderBy('scheduledDate', 'asc'))
        )
        setAssignedWorkouts(
          assignedSnap.docs.map((d) => ({
            ...(d.data() as AssignedWorkout),
            id: d.id,
          })),
        )
      } catch (err) {
        console.error('Error loading assigned workouts:', err)
        setAssignedWorkouts([])
      }

      setLoading(false)
    }

    loadData()
  }, [])
  
  // Get today's workouts across all athletes
  const todaysWorkouts = assignedWorkouts.filter(
    w => isToday(parseISO(w.scheduledDate))
  )

  // Calculate stats
  const completedToday = todaysWorkouts.filter(w => w.status === 'completed').length
  const pendingToday = todaysWorkouts.filter(w => w.status === 'scheduled').length

  const getInitials = (name: string | undefined | null) => {
    const safeName = name || '?'
    return safeName
      .split(' ')
      .map((n) => n[0] || '')
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
          Coach Dashboard
        </h1>
        <p className="text-muted-foreground">
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                <Users className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-2xl font-bold text-navy">{athletes.length}</p>
                <p className="text-xs text-muted-foreground">Athletes</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                <Dumbbell className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-2xl font-bold text-navy">{workouts.length}</p>
                <p className="text-xs text-muted-foreground">Workout Library</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-100 flex items-center justify-center">
                <Check className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-navy">{completedToday}</p>
                <p className="text-xs text-muted-foreground">Completed Today</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-100 flex items-center justify-center">
                <Activity className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <p className="text-2xl font-bold text-navy">{pendingToday}</p>
                <p className="text-xs text-muted-foreground">Pending Today</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Two Column Layout */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* Athletes Quick View */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-medium">Athletes</CardTitle>
            <Link href="/coach/athletes">
              <Button variant="ghost" size="sm" className="text-gold hover:text-gold/80">
                View All
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {athletes.slice(0, 4).map((athlete) => (
                <Link
                  key={athlete.id}
                  href={`/coach/athletes/${athlete.id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-luxury"
                >
                  <div className="flex items-center gap-3">
                    <Avatar className="h-10 w-10">
                      <AvatarImage src={athlete.photoURL} alt={athlete.name} />
                      <AvatarFallback className="bg-gold/10 text-gold text-sm">
                        {getInitials(athlete.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-navy">{athlete.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {athlete.events.slice(0, 2).join(', ')}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-xs">
                      {athlete.personalRecords.length} PRs
                    </Badge>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Today's Schedule */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-medium">{"Today's Workouts"}</CardTitle>
          </CardHeader>
          <CardContent>
            {todaysWorkouts.length > 0 ? (
              <div className="space-y-3">
                {todaysWorkouts.map((workout) => {
                  const athlete = athletes.find(a => a.id === workout.athleteId)
                  return (
                    <div
                      key={workout.id}
                      className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                    >
                      <div className="flex items-center gap-3">
                        <Avatar className="h-8 w-8">
                          <AvatarFallback className="bg-gold/10 text-gold text-xs">
                            {athlete ? getInitials(athlete.name) : '?'}
                          </AvatarFallback>
                        </Avatar>
                        <div>
                          <p className="font-medium text-navy text-sm">
                            {athlete?.name}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {workout.workout.title}
                          </p>
                        </div>
                      </div>
                      <Badge
                        variant="outline"
                        className={
                          workout.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                            : 'bg-amber-100 text-amber-700 border-amber-200'
                        }
                      >
                        {workout.status === 'completed' ? 'Done' : 'Pending'}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                No workouts scheduled for today
              </p>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-medium">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/coach/workouts/new">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <Dumbbell className="h-5 w-5 text-gold" />
                  <span className="text-sm">Create Workout</span>
                </Button>
              </Link>
              <Link href="/coach/athletes">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <Users className="h-5 w-5 text-gold" />
                  <span className="text-sm">Manage Athletes</span>
                </Button>
              </Link>
              <Link href="/coach/chat">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <MessageCircle className="h-5 w-5 text-gold" />
                  <span className="text-sm">Messages</span>
                </Button>
              </Link>
              <Link href="/coach/athletes">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <TrendingUp className="h-5 w-5 text-gold" />
                  <span className="text-sm">View Progress</span>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Recent Workout Library */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-medium">Workout Library</CardTitle>
            <Link href="/coach/workouts">
              <Button variant="ghost" size="sm" className="text-gold hover:text-gold/80">
                View All
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {workouts.slice(0, 4).map((workout) => (
                <div
                  key={workout.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                >
                  <div>
                    <p className="font-medium text-navy text-sm">{workout.title}</p>
                    <p className="text-xs text-muted-foreground capitalize">
                      {workout.type.replace('_', ' ')}
                      {workout.duration && ` - ${workout.duration} min`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
