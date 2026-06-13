'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { format, isToday, parseISO, startOfWeek, endOfWeek, addDays } from 'date-fns'
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

import { db, realtimeDb } from '@/lib/firebase'
import { ref, onValue, query as rtQuery, orderByChild, limitToLast } from 'firebase/database'
import { useAuth } from '@/contexts/auth-context'
import type { AthleteProfile, Workout, AssignedWorkout } from '@/lib/types'
import { useLanguage } from '@/contexts/language-context'
import { useWorkoutTypeLabels } from '@/lib/workout-labels'

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
  const { t } = useLanguage()
  const workoutTypeLabels = useWorkoutTypeLabels()
  const { user } = useAuth()
  const [totalUnread, setTotalUnread] = useState(0)
  const [athletes, setAthletes] = useState<AthleteProfile[]>([])
  const [workouts, setWorkouts] = useState<Workout[]>([])
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [unreadMessages, setUnreadMessages] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id || !athletes.length) return
    let unsubs: (() => void)[] = []
    const counts: Record<string, number> = {}
    // Request notification permission
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    athletes.forEach(athlete => {
      const chatId = `${user.id}_${athlete.id}`
      const lastReadKey = `lastRead_${chatId}_${user.id}`
      const lastRead = parseInt(localStorage.getItem(lastReadKey) || '0')
      const msgsRef = ref(realtimeDb, `conversations/${chatId}/messages`)
      const msgsQuery = rtQuery(msgsRef, orderByChild('timestamp'), limitToLast(20))
      const unsub = onValue(msgsQuery, (snapshot) => {
        let count = 0
        const now = Date.now()
        snapshot.forEach((child) => {
          const msg = child.val()
          if (msg.senderId !== user.id && msg.timestamp > lastRead) {
            count++
            if (msg.timestamp > now - 15000 && 'Notification' in window && Notification.permission === 'granted') {
              const athleteName = athlete.name || 'ספורטאי'
              new Notification(`הודעה חדשה מ${athleteName} 💬`, {
                body: msg.content,
                icon: '/favicon.ico'
              })
            }
          }
        })
        counts[athlete.id] = count
        setTotalUnread(Object.values(counts).reduce((a, b) => a + b, 0))
      })
      unsubs.push(unsub)
    })
    return () => unsubs.forEach(u => u())
  }, [user?.id, athletes.length])

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

      // Load unread coach messages
      try {
        const msgSnap = await getDocs(
          query(collection(db, 'coachMessages'), where('read', '==', false))
        )
        const counts: Record<string, number> = {}
        msgSnap.docs.forEach(d => {
          const aid = d.data().athleteId as string
          counts[aid] = (counts[aid] || 0) + 1
        })
        setUnreadMessages(counts)
      } catch {
        setUnreadMessages({})
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

  // Weekly stats
  const thisWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const thisWeekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const completedThisWeekAll = assignedWorkouts.filter(
    w => w.status === 'completed' && w.scheduledDate >= thisWeekStart && w.scheduledDate <= thisWeekEnd
  )
  const totalKmThisWeek = completedThisWeekAll.reduce((s, w) => s + (w.workout?.distance || 0), 0)

  // Athletes without next-week plan
  const nextWeekStart = format(addDays(new Date(thisWeekEnd), 1), 'yyyy-MM-dd')
  const nextWeekEnd = format(addDays(new Date(thisWeekEnd), 7), 'yyyy-MM-dd')
  const athletesWithNextWeekPlan = new Set(
    assignedWorkouts
      .filter(w => w.scheduledDate >= nextWeekStart && w.scheduledDate <= nextWeekEnd)
      .map(w => w.athleteId)
  )

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
          {t.coachDashboardTitle}
        </h1>
        <p className="text-muted-foreground">
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </p>
      </div>

      {/* Quick nav */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/coach/workouts?tab=planning">
          <Card className="border-navy/20 hover:border-navy/40 transition-colors cursor-pointer bg-navy/5 h-full">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-navy/10 flex items-center justify-center flex-shrink-0">
                  <Activity className="h-5 w-5 text-navy" />
                </div>
                <div>
                  <p className="font-semibold text-navy text-sm">מרכז תכנון</p>
                  <p className="text-xs text-muted-foreground">לוח בקרה לכלל הספורטאים</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/coach/workouts">
          <Card className="border-gold/20 hover:border-gold/40 transition-colors cursor-pointer bg-gold/5 h-full">
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center flex-shrink-0">
                  <Dumbbell className="h-5 w-5 text-gold" />
                </div>
                <div>
                  <p className="font-semibold text-navy text-sm">ספריית אימונים</p>
                  <p className="text-xs text-muted-foreground">כל האימונים הזמינים</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>

      {/* Weekly overview */}
      <Card className="rounded-2xl border-navy/10">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">סקירה שבועית</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="text-center">
              <p className="text-2xl font-bold text-navy">{athletes.length}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">ספורטאים</p>
            </div>
            <div className="text-center border-x border-border/40">
              <p className="text-2xl font-bold text-emerald-600">{completedThisWeekAll.length}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">אימונים הושלמו</p>
            </div>
            <div className="text-center">
              <p className="text-2xl font-bold text-gold">{totalKmThisWeek.toFixed(0)}</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">ק"מ השבוע</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Chat - top of dashboard */}
      <Link href="/coach/chat">
        <Card className="border-gold/30 hover:border-gold/60 transition-colors cursor-pointer">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                    <MessageCircle className="h-5 w-5 text-gold" />
                  </div>
                  {totalUnread > 0 && (
                    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                      {totalUnread > 9 ? '9+' : totalUnread}
                    </span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-navy">{t.messagesAction}</p>
                  <p className="text-xs text-muted-foreground">
                    {totalUnread > 0 ? `${totalUnread} הודעות שלא נקראו` : 'אין הודעות חדשות'}
                  </p>
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
      </Link>

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
                <p className="text-xs text-muted-foreground">{t.athletesStat}</p>
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
                <p className="text-xs text-muted-foreground">{t.workoutLibraryStat}</p>
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
                <p className="text-xs text-muted-foreground">{t.completedToday}</p>
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
                <p className="text-xs text-muted-foreground">{t.pendingToday}</p>
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
            <CardTitle className="text-lg font-medium">{t.athletesStat}</CardTitle>
            <Link href="/coach/athletes">
              <Button variant="ghost" size="sm" className="text-gold hover:text-gold/80">
                {t.viewAll}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {athletes.slice(0, 5).map((athlete) => {
                const hasUnread = unreadMessages[athlete.id] > 0
                const hasPlan = athletesWithNextWeekPlan.has(athlete.id)
                const weekDone = completedThisWeekAll.filter(w => w.athleteId === athlete.id).length
                const weekTotal = assignedWorkouts.filter(
                  w => w.athleteId === athlete.id && w.scheduledDate >= thisWeekStart && w.scheduledDate <= thisWeekEnd
                ).length
                return (
                  <div key={athlete.id} className="relative flex items-center gap-3 p-3 rounded-2xl bg-muted/40 hover:bg-muted/70 transition-colors">
                    {hasUnread && (
                      <span className="absolute top-2.5 left-2.5 w-2 h-2 bg-orange-500 rounded-full" />
                    )}
                    <Link href={`/coach/athletes/${athlete.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                      <Avatar className="h-9 w-9 flex-shrink-0">
                        <AvatarImage src={athlete.photoURL} alt={athlete.name} />
                        <AvatarFallback className="bg-gold/10 text-gold text-xs">
                          {getInitials(athlete.name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-semibold text-navy text-sm truncate">{athlete.name}</p>
                          {!hasPlan && (
                            <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 bg-red-50 text-red-600 border-red-200 flex-shrink-0">
                              ללא תוכנית
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {weekTotal > 0 ? `${weekDone}/${weekTotal} השבוע` : 'אין אימונים השבוע'}
                        </p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Link href={`/coach/athletes/${athlete.id}`}>
                        <Button variant="outline" size="sm" className="h-7 text-xs px-2 border-navy/20 hover:border-navy/50">
                          פלנר
                        </Button>
                      </Link>
                      <Link href="/coach/chat">
                        <Button variant="outline" size="sm" className="h-7 text-xs px-2 relative border-gold/30 hover:border-gold/60">
                          צ'אט
                          {hasUnread && (
                            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-orange-500 text-white text-[8px] font-bold rounded-full flex items-center justify-center">
                              {unreadMessages[athlete.id]}
                            </span>
                          )}
                        </Button>
                      </Link>
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>

        {/* Today's Schedule */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-medium">{t.todaysWorkoutsCard}</CardTitle>
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
                        {workout.status === 'completed' ? t.doneBadge : t.pendingBadge}
                      </Badge>
                    </div>
                  )
                })}
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                {t.noWorkoutsToday}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Quick Actions */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-medium">{t.quickActions}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              <Link href="/coach/workouts/new">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <Dumbbell className="h-5 w-5 text-gold" />
                  <span className="text-sm">{t.createWorkoutAction}</span>
                </Button>
              </Link>
              <Link href="/coach/athletes">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <Users className="h-5 w-5 text-gold" />
                  <span className="text-sm">{t.manageAthletesAction}</span>
                </Button>
              </Link>
              <Link href="/coach/chat">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <MessageCircle className="h-5 w-5 text-gold" />
                  <span className="text-sm">{t.messagesAction}</span>
                </Button>
              </Link>
              <Link href="/coach/athletes">
                <Button variant="outline" className="w-full h-auto py-4 flex-col gap-2">
                  <TrendingUp className="h-5 w-5 text-gold" />
                  <span className="text-sm">{t.viewProgressAction}</span>
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>

        {/* Recent Workout Library */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="text-lg font-medium">{t.workoutLibraryCardTitle}</CardTitle>
            <Link href="/coach/workouts">
              <Button variant="ghost" size="sm" className="text-gold hover:text-gold/80">
                {t.viewAll}
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
                    <p className="text-xs text-muted-foreground">
                      {workoutTypeLabels[workout.type] || workout.type}
                      {workout.duration && ` - ${workout.duration} ${t.min}`}
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
