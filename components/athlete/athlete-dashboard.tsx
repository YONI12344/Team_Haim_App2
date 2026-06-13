'use client'

import { useRouter } from 'next/navigation'

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { format, isToday, isTomorrow, parseISO, startOfWeek, endOfWeek } from 'date-fns'
import {
  Calendar,
  Dumbbell,
  Clock,
  Target,
  TrendingUp,
  Flame,
  ChevronRight,
  ArrowUpRight,
  Activity,
  Loader2,
  UserPlus,
  MessageCircle,
} from 'lucide-react'
import Link from 'next/link'
import { cn } from '@/lib/utils'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db, realtimeDb } from '@/lib/firebase'
import { ref, onValue, query as rtQuery, orderByChild, limitToLast } from 'firebase/database'
import { getCoachInfo, conversationId } from '@/lib/coach'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { useWorkoutTypeLabels, workoutTypeColors } from '@/lib/workout-labels'
import type {
  AssignedWorkout,
  AthleteProfile,
  Workout,
  WorkoutLog,
  WorkoutType,
} from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'

function mapAssignedWorkout(d: QueryDocumentSnapshot<DocumentData>): AssignedWorkout {
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

function NewAthleteRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/athlete/onboarding') }, [router])
  return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )
}

export function AthleteDashboard() {
  const router = useRouter()

  // Save Strava connection from URL params
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("strava") !== "connected") return
    const stravaId = params.get("stravaId")
    const stravaName = params.get("stravaName")
    const accessToken = params.get("accessToken")
    const refreshToken = params.get("refreshToken")
    const expiresAt = params.get("expiresAt")
    if (!stravaId || !accessToken) return
    import("firebase/firestore").then(({ doc, setDoc, serverTimestamp }) => {
      import("@/lib/firebase").then(({ db }) => {
        setDoc(doc(db, "strava_connections", `strava_${stravaId}`), {
          stravaId: Number(stravaId),
          name: stravaName || "",
          accessToken,
          refreshToken: refreshToken || "",
          expiresAt: Number(expiresAt),
          connectedAt: serverTimestamp(),
        }, { merge: true }).then(() => {
          console.log("✅ Strava saved!")
          // Also save stravaId to user document
          if (user?.id) {
            setDoc(doc(db, "users", user.id), { stravaId: Number(stravaId), stravaConnected: true }, { merge: true })
          }
          window.history.replaceState({}, "", "/athlete")
        })
      })
    })
  }, [])
  const { user } = useAuth()
  const { t } = useLanguage()
  const workoutTypeLabels = useWorkoutTypeLabels()
  const [profile, setProfile] = useState<Partial<AthleteProfile> | null>(null)
  const [assigned, setAssigned] = useState<AssignedWorkout[]>([])
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const [latestCoachNote, setLatestCoachNote] = useState<any>(null)

  useEffect(() => {
    if (!user?.id) return
    let unsubChat: (() => void) | null = null
    const setupChat = async () => {
      try {
        const coachInfo = await getCoachInfo()
        if (!coachInfo?.uid) return
        const chatId = conversationId(coachInfo.uid, user.id)
        const lastReadKey = `lastRead_${chatId}_${user.id}`
        const lastRead = parseInt(localStorage.getItem(lastReadKey) || '0')
        const msgsRef = ref(realtimeDb, `conversations/${chatId}/messages`)
        const msgsQuery = rtQuery(msgsRef, orderByChild('timestamp'), limitToLast(50))
        unsubChat = onValue(msgsQuery, (snapshot) => {
          let count = 0
          const now = Date.now()
          snapshot.forEach((child) => {
            const msg = child.val()
            if (msg.senderId !== user.id && msg.timestamp > lastRead) {
              count++
              // Show browser notification for very recent messages
              if (msg.timestamp > now - 15000 && 'Notification' in window && Notification.permission === 'granted') {
                new Notification('הודעה חדשה מהמאמן 💬', { body: msg.content, icon: '/favicon.ico' })
              }
            }
          })
          setUnreadCount(count)
        })
      } catch {}
    }
    setupChat()
    // Request notification permission
    if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission()
    }
    return () => { if (unsubChat) unsubChat() }
  }, [user?.id])

  useEffect(() => {
    if (!user?.id) return
    let unsubAssigned: (() => void) | null = null
    let unsubLogs: (() => void) | null = null

    const loadProfile = async () => {
      try {
        const profileSnap = await getDoc(doc(db, 'users', user.id))
        if (profileSnap.exists()) {
          const data = profileSnap.data()
          setProfile({
            name: data.name || user.name,
            events: Array.isArray(data.events) ? data.events : [],
            personalRecords: Array.isArray(data.personalRecords) ? data.personalRecords : [],
            goals: Array.isArray(data.goals) ? data.goals : [],
            onboardingComplete: data.onboardingComplete === true,
          })
        } else {
          setProfile({ name: user.name, events: [], personalRecords: [], goals: [] })
        }
      } catch (err) {
        console.error('Error loading athlete profile:', err)
        setProfile({ name: user.name, events: [], personalRecords: [], goals: [] })
      }
    }

    loadProfile()

    // Load latest approved coach note
    getDocs(query(
      collection(db, 'weeklyNotes'),
      where('athleteId', '==', user.id),
      where('approved', '==', true),
    )).then(snap => {
      const notes = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
      if (notes.length > 0) {
        notes.sort((a, b) => (b.weekStart || '').localeCompare(a.weekStart || ''))
        setLatestCoachNote(notes[0])
      }
    }).catch(() => {})

    // Real-time listener for assigned workouts
    unsubAssigned = onSnapshot(
      query(collection(db, 'assignedWorkouts'), where('athleteId', '==', user.id)),
      (snap) => {
        setAssigned(snap.docs.map(mapAssignedWorkout))
        setLoading(false)
      },
      (err) => {
        console.error('Error loading assigned workouts:', err)
        setAssigned([])
        setLoading(false)
      }
    )

    // Real-time listener for logs
    unsubLogs = onSnapshot(
      query(collection(db, 'logs'), where('athleteId', '==', user.id)),
      (snap) => {
        setLogs(snap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            athleteId: data.athleteId || user.id,
            workoutId: data.workoutId || '',
            date: data.date || '',
            actualDistance: data.actualDistance ?? undefined,
            actualPace: data.actualPace ?? undefined,
            effort: legacyEffortToNumber(data.effort),
            comment: data.comment || '',
            source: data.source || '',
            feedbackStatus: data.feedbackStatus || '',
            stravaName: data.stravaName || '',
            createdAt: data.createdAt?.toDate?.() || new Date(),
          }
        }))
      },
      (err) => {
        console.error('Error loading logs:', err)
        setLogs([])
      }
    )

    return () => {
      unsubAssigned?.()
      unsubLogs?.()
    }
  }, [user?.id, user?.name])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  const upcomingWorkouts = assigned
    .filter((w) => w.status === 'scheduled')
    .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
    .slice(0, 5)

  const todayWorkouts = assigned.filter(
    (w) => w.scheduledDate && isToday(parseISO(w.scheduledDate)),
  )

  const startOfThisWeek = startOfWeek(new Date(), { weekStartsOn: 1 })
  const endOfThisWeek = endOfWeek(new Date(), { weekStartsOn: 1 })
  const thisWeekWorkouts = assigned.filter((w) => {
    if (!w.scheduledDate) return false
    const d = parseISO(w.scheduledDate)
    return d >= startOfThisWeek && d <= endOfThisWeek
  })
  const completedThisWeek = thisWeekWorkouts.filter((w) => w.status === 'completed').length
  const totalThisWeek = thisWeekWorkouts.length
  const weeklyProgress = totalThisWeek
    ? (completedThisWeek / totalThisWeek) * 100
    : 0

  // Aggregate weekly stats from logs
  const startOfThisWeekStr = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const endOfThisWeekStr = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const thisWeekLogs = logs.filter(l => l.date >= startOfThisWeekStr && l.date <= endOfThisWeekStr)
  const pendingFeedbackLogs = (logs as any[]).filter(l => l.source === 'strava' && l.feedbackStatus === 'pending')
  const totalDistance = thisWeekLogs.reduce((s, l) => s + (l.actualDistance || 0), 0)
  const effortCount = logs.length
  const avgEffortNumeric = effortCount
    ? logs.reduce((s, l) => s + legacyEffortToNumber(l.effort), 0) / effortCount
    : 0
  const totalDurationMin = assigned
    .filter((w) => w.status === 'completed')
    .reduce((s, w) => s + (w.actualDuration || w.workout?.duration || 0), 0)

  const profileName = profile?.name || user?.name || t.athleteFallback
  const events = profile?.events || []
  const prs = profile?.personalRecords || []
  const goals = profile?.goals || []
  const isNewAthlete = !loading && profile !== null && !profile?.onboardingComplete

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
          {t.welcomeBack}, {profileName.split(' ')[0]}
        </h1>
        <p className="text-sm text-muted-foreground">
          {format(new Date(), 'd MMMM yyyy')}
        </p>
        <p className="text-sm text-muted-foreground font-medium tracking-wide">
          רצים עם הלב, חוגגים{' '}
          <span className="text-gold font-bold text-base">תחיים</span>
        </p>
      </div>

      {/* New athlete onboarding — redirect to profile */}
      {isNewAthlete && <NewAthleteRedirect />}

      {/* Pending Strava Feedback */}
      {pendingFeedbackLogs.length > 0 && (
        <Link href="/athlete/schedule">
          <div className="rounded-xl bg-amber-50 border border-amber-300 p-3 flex items-center justify-between gap-3 cursor-pointer hover:bg-amber-100 transition-colors">
            <div className="flex items-center gap-2.5">
              <span className="text-xl">🚴</span>
              <div>
                <p className="text-sm font-bold text-amber-800">
                  {pendingFeedbackLogs.length} אימונים מחכים למשוב
                </p>
                <p className="text-xs text-amber-600">לחץ להוסיף מאמץ והערה</p>
              </div>
            </div>
            <span className="text-amber-500 text-lg">←</span>
          </div>
        </Link>
      )}

      {/* Today's Workouts */}
      {todayWorkouts.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-1 pt-3">
            <CardTitle className="text-lg font-medium">{t.todaysWorkoutTitle}</CardTitle>
            {todayWorkouts.length > 1 && (
              <span className="text-sm text-gold font-medium">({todayWorkouts.length})</span>
            )}
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {todayWorkouts.map((todayWorkout) => (
                <Link
                  key={todayWorkout.id}
                  href={`/athlete/schedule?date=${todayWorkout.scheduledDate}&workoutId=${todayWorkout.id}`}
                  className="flex items-center justify-between p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-gold/10 flex items-center justify-center flex-shrink-0">
                      <Dumbbell className="h-4 w-4 text-gold" />
                    </div>
                    <div>
                      <p className="font-medium text-navy text-sm">{todayWorkout.workout.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        {todayWorkout.workout.duration && (
                          <p className="text-xs text-muted-foreground">{todayWorkout.workout.duration} {t.min}</p>
                        )}
                        {todayWorkout.workout.distance && (
                          <p className="text-xs text-muted-foreground">· {todayWorkout.workout.distance} {t.km}</p>
                        )}
                      </div>
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={
                      todayWorkout.status === 'completed'
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                        : 'bg-amber-100 text-amber-700 border-amber-200'
                    }
                  >
                    {todayWorkout.status === 'completed' ? t.doneBadge ?? 'Done' : t.pendingBadge ?? 'Pending'}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Row */}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/athlete/stats" className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-gold/40 hover:bg-gold/5 transition-all group">
          <div className="h-10 w-10 rounded-lg bg-orange-50 flex items-center justify-center flex-shrink-0">
            <Flame className="h-5 w-5 text-orange-500" />
          </div>
          <div>
            <p className="text-xl font-bold text-navy">{completedThisWeek}</p>
            <p className="text-xs text-muted-foreground">אימונים השבוע</p>
          </div>
        </Link>

        <Link href="/athlete/schedule" className="flex items-center gap-3 p-4 rounded-xl border border-border bg-card hover:border-gold/40 hover:bg-gold/5 transition-all group">
          <div className="h-10 w-10 rounded-lg bg-gold/10 flex items-center justify-center flex-shrink-0">
            <Activity className="h-5 w-5 text-gold" />
          </div>
          <div>
            <p className="text-xl font-bold text-navy">{totalDistance.toFixed(1)}</p>
            <p className="text-xs text-muted-foreground">ק"מ השבוע</p>
          </div>
        </Link>
      </div>

      {/* Weekly Summary Card */}
      {latestCoachNote && (
        <Card className="border-gold/30 overflow-hidden">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between" dir="rtl">
              <CardTitle className="text-sm font-bold text-navy">סיכום שבועי</CardTitle>
              {latestCoachNote.weekStart && (
                <span className="text-[11px] text-muted-foreground">{latestCoachNote.weekStart} – {latestCoachNote.weekEnd}</span>
              )}
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <div className="rounded-xl bg-navy p-4 space-y-3" dir="rtl">
              {latestCoachNote.summary && (
                <>
                  <div>
                    <p className="text-[10px] font-semibold text-gold uppercase tracking-widest mb-1">סיכום השבוע</p>
                    <p className="text-xs text-white leading-relaxed">{latestCoachNote.summary}</p>
                  </div>
                  <div className="border-t border-white/10"/>
                </>
              )}
              {latestCoachNote.achievements && (
                <>
                  <div>
                    <p className="text-[10px] font-semibold text-gold uppercase tracking-widest mb-1">הישגים</p>
                    <p className="text-xs text-white leading-relaxed">{latestCoachNote.achievements}</p>
                  </div>
                  <div className="border-t border-white/10"/>
                </>
              )}
              {latestCoachNote.improvements && (
                <>
                  <div>
                    <p className="text-[10px] font-semibold text-gold uppercase tracking-widest mb-1">נקודות לשיפור</p>
                    <p className="text-xs text-white leading-relaxed">{latestCoachNote.improvements}</p>
                  </div>
                  <div className="border-t border-white/10"/>
                </>
              )}
              {latestCoachNote.nextWeekFocus && (
                <>
                  <div>
                    <p className="text-[10px] font-semibold text-gold uppercase tracking-widest mb-1">פוקוס שבוע הבא</p>
                    <p className="text-xs text-white leading-relaxed">{latestCoachNote.nextWeekFocus}</p>
                  </div>
                  <div className="border-t border-white/10"/>
                </>
              )}
              {latestCoachNote.coachNote && (
                <div>
                  <p className="text-[10px] font-semibold text-gold uppercase tracking-widest mb-1">הערת המאמן</p>
                  <p className="text-sm text-white leading-relaxed italic">{latestCoachNote.coachNote}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick Nav Buttons */}
      <div className="grid grid-cols-1 gap-3">
        <Link href="/athlete/schedule" className="flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:border-gold/40 hover:bg-gold/5 transition-all group">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gold/10 flex items-center justify-center">
              <Calendar className="h-5 w-5 text-gold" />
            </div>
            <div>
              <p className="font-semibold text-navy text-sm">{t.scheduleTitle ?? 'לוח זמנים'}</p>
              <p className="text-xs text-muted-foreground">תצוגה שבועית וחודשית</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-gold transition-colors" />
        </Link>

        <Link href="/athlete/chat" className="flex items-center justify-between p-4 rounded-xl border border-border bg-card hover:border-gold/40 hover:bg-gold/5 transition-all group relative">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-gold/10 flex items-center justify-center relative">
              <MessageCircle className="h-5 w-5 text-gold" />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center">{unreadCount > 9 ? '9+' : unreadCount}</span>
              )}
            </div>
            <div>
              <p className="font-semibold text-navy text-sm">{t.chat ?? 'צ׳אט עם המאמן'}</p>
              <p className="text-xs text-muted-foreground">שאל שאלות, קבל משוב</p>
            </div>
          </div>
          <ArrowUpRight className="h-4 w-4 text-muted-foreground group-hover:text-gold transition-colors" />
        </Link>
      </div>

        </div>
  )
}

