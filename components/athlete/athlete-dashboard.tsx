'use client'

import { useRouter } from 'next/navigation'

import { useEffect, useState, useRef } from 'react'
import { useNotifications } from '@/hooks/useNotifications'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { format, isToday, isTomorrow, parseISO, startOfWeek, endOfWeek } from 'date-fns'
import {
  Dumbbell,
  Clock,
  Target,
  TrendingUp,
  Flame,
  ChevronRight,
  ArrowUpRight,
  Loader2,
  MessageCircle,
  Bell,
  X,
  CheckCircle2,
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
  updateDoc,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db, realtimeDb } from '@/lib/firebase'
import { ref, push, onValue, query as rtQuery, orderByChild, limitToLast } from 'firebase/database'
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
  const { permission, enableNotifications } = useNotifications()
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setNotifBannerDismissed(localStorage.getItem('notifBannerDismissed') === '1')
    }
  }, [])

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
  const { t, isRTL } = useLanguage()
  const workoutTypeLabels = useWorkoutTypeLabels()
  const [profile, setProfile] = useState<Partial<AthleteProfile> | null>(null)
  const [assigned, setAssigned] = useState<AssignedWorkout[]>([])
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [loading, setLoading] = useState(true)
  const [unreadCount, setUnreadCount] = useState(0)
  const [latestCoachNote, setLatestCoachNote] = useState<any>(null)
  const [allUnreadNotes, setAllUnreadNotes] = useState<any[]>([])
  const [isDismissingNote, setIsDismissingNote] = useState(false)
  const [coachMessages, setCoachMessages] = useState<any[]>([])

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

    // Load latest approved coach note — only show the newest unread one
    getDocs(query(
      collection(db, 'weeklyNotes'),
      where('athleteId', '==', user.id),
      where('approved', '==', true),
    )).then(snap => {
      const notes = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
      const unread = notes.filter(n => !n.readByAthlete)
      if (unread.length > 0) {
        unread.sort((a, b) => (b.weekStart || '').localeCompare(a.weekStart || ''))
        setLatestCoachNote(unread[0])
        setAllUnreadNotes(unread) // keep full list so dismiss can clear all at once
      }
    }).catch(() => {})

    // Load coach messages
    getDocs(query(
      collection(db, 'coachMessages'),
      where('athleteId', '==', user.id),
    )).then(snap => {
      const msgs = snap.docs.map(d => ({ id: d.id, ...d.data() })) as any[]
      msgs.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      setCoachMessages(msgs)
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

  const unreadCoachMessages = coachMessages.filter(m => !m.read)

  // Dismiss weekly summary: hide immediately, mark ALL unread notes as read in Firestore,
  // then write only the newest one to the chat thread (no duplicates, no re-appearing card).
  const handleDismissWeeklySummary = () => {
    if (!latestCoachNote || !user || isDismissingNote) return
    const note = latestCoachNote
    const toMark = allUnreadNotes.length > 0 ? allUnreadNotes : [note]
    setIsDismissingNote(true)
    setLatestCoachNote(null) // instant hide
    setAllUnreadNotes([])
    ;(async () => {
      try {
        // Step 1: Mark ALL unread weekly notes as read at once.
        // This prevents older notes from re-appearing on the next refresh.
        // Check newest note first to skip chat write if already processed.
        const noteSnap = await getDoc(doc(db, 'weeklyNotes', note.id))
        const alreadyRead = noteSnap.exists() && noteSnap.data()?.readByAthlete === true

        await Promise.all(
          toMark.map(n => updateDoc(doc(db, 'weeklyNotes', n.id), { readByAthlete: true }))
        )

        // Step 2: Write the newest note to chat — only once (idempotent guard).
        if (!alreadyRead) {
          try {
            const coachInfo = await getCoachInfo()
            if (coachInfo) {
              const chatId = conversationId(coachInfo.uid, user.id)
              await push(ref(realtimeDb, `conversations/${chatId}/messages`), {
                senderId: coachInfo.uid,
                senderName: coachInfo.name || 'המאמן',
                content: [note.coachNote, note.nextWeekFocus].filter(Boolean).join('\n'),
                type: 'weekly_summary',
                weeklyNoteId: note.id,
                payload: {
                  summary: note.summary || '',
                  achievements: note.achievements || '',
                  improvements: note.improvements || '',
                  nextWeekFocus: note.nextWeekFocus || '',
                  coachNote: note.coachNote || '',
                  weekStart: note.weekStart || '',
                  weekEnd: note.weekEnd || '',
                },
                timestamp: Date.now(),
              })
            }
          } catch (chatErr) {
            console.error('chat write error', chatErr)
          }
        }
      } catch (e) {
        console.error('dismiss summary error', e)
        setIsDismissingNote(false)
      }
    })()
  }

  return (
    <div className="space-y-4 pb-24" dir="rtl">

      {/* Notification permission banner — only when not yet asked and not dismissed */}
      {permission === 'default' && !notifBannerDismissed && (
        <div className="bg-white rounded-2xl border border-[#c9a84c]/30 shadow-sm p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#c9a84c]/10 flex items-center justify-center flex-shrink-0">
            <Bell className="h-5 w-5 text-[#c9a84c]" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-[#0a1628] leading-tight">הפעל התראות</p>
            <p className="text-xs text-gray-500 mt-0.5">קבל תזכורות לאימונים והודעות מהמאמן</p>
          </div>
          <button
            onClick={enableNotifications}
            className="bg-[#0a1628] text-white rounded-xl px-4 h-9 text-sm font-semibold flex-shrink-0 active:scale-95 transition-transform"
          >
            הפעל
          </button>
          <button
            onClick={() => {
              localStorage.setItem('notifBannerDismissed', '1')
              setNotifBannerDismissed(true)
            }}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            aria-label="סגור"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Hero Section — navy gradient (green when done), greeting + today workout */}
      {(() => {
        const mainTw = todayWorkouts[0] || null
        const allDone = todayWorkouts.length > 0 && todayWorkouts.every(w => w.status === 'completed')
        return (
          <div className={cn('rounded-3xl p-6 transition-all',
            allDone
              ? 'bg-gradient-to-br from-emerald-700 to-emerald-800'
              : 'bg-gradient-to-br from-[#0a1628] to-[#0a1628]/85'
          )}>
            <div className="flex items-start justify-between mb-3">
              <p className="text-xl font-bold text-white">שלום, {profileName.split(' ')[0]}</p>
              <p className="text-xs text-white/40 pt-1">{format(new Date(), 'd MMM')}</p>
            </div>

            {todayWorkouts.length > 0 ? (
              <>
                {todayWorkouts.slice(0, 1).map((tw) => (
                  <div key={tw.id}>
                    <p className="text-2xl font-bold text-white leading-tight mt-2 mb-3">{tw.workout.title}</p>
                    <div className="flex items-center gap-2 flex-wrap mb-4">
                      <span className={cn('rounded-full px-3 py-1 text-xs font-bold',
                        allDone ? 'bg-white/20 text-white' : 'bg-[#c9a84c] text-[#0a1628]')}>
                        {workoutTypeLabels[tw.workout.type as WorkoutType] || tw.workout.type}
                      </span>
                      {tw.workout.distance && <span className="text-sm text-white/70">{tw.workout.distance} ק"מ</span>}
                      {tw.workout.duration && <span className="text-sm text-white/70">{tw.workout.duration} דק'</span>}
                    </div>
                    <Link href={`/athlete/schedule?date=${tw.scheduledDate}&workoutId=${tw.id}`}>
                      <button className="w-full h-12 rounded-2xl font-bold text-sm active:scale-95 transition-all bg-white/20 text-white hover:bg-white/25">
                        {tw.status === 'completed' ? '✓ הושלם — צפה בפרטים' : 'פתח אימון'}
                      </button>
                    </Link>
                  </div>
                ))}
                {todayWorkouts.length > 1 && (
                  <p className="text-xs text-white/40 text-center mt-2">+{todayWorkouts.length - 1} אימונים נוספים</p>
                )}
              </>
            ) : (
              <div className="mt-2">
                <p className="text-xl font-bold text-white">יום מנוחה</p>
                <p className="text-sm text-white/50 mt-1">תתאושש ותתכונן למחר</p>
              </div>
            )}
          </div>
        )
      })()}

      {/* New athlete onboarding */}
      {isNewAthlete && <NewAthleteRedirect />}

      {/* Coach messages — gold left-border cards */}
      {unreadCoachMessages.length > 0 && (
        <div className="space-y-3">
          {unreadCoachMessages.map(msg => (
            <div key={msg.id} className="bg-white rounded-3xl shadow-sm border border-gray-100 border-l-4 border-l-[#c9a84c] p-5">
              <p className="text-[11px] font-semibold uppercase tracking-widest text-[#c9a84c] mb-2">הודעה מהמאמן</p>
              {msg.workoutTitle && <p className="text-xs text-gray-400 mb-2">{msg.workoutTitle}</p>}
              <p className="text-sm text-[#0a1628] leading-relaxed">{msg.message}</p>
              <div className="flex items-center justify-between mt-3">
                {msg.createdAt?.seconds && (
                  <p className="text-xs text-gray-400">{format(new Date(msg.createdAt.seconds * 1000), 'd/M/yyyy HH:mm')}</p>
                )}
                <button
                  onClick={() => {
                    setCoachMessages(prev => prev.filter(m => m.id !== msg.id)) // instant hide
                    updateDoc(doc(db, 'coachMessages', msg.id), { read: true, readAt: Date.now() }).catch(() => {})
                  }}
                  className="flex items-center gap-1.5 bg-[#c9a84c] hover:bg-[#b8962e] text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors active:scale-95"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  קראתי
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Pending Strava Feedback */}
      {pendingFeedbackLogs.length > 0 && (
        <Link href="/athlete/schedule">
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 flex items-center justify-between gap-4 active:scale-[0.98] transition-transform">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-2xl bg-[#FC4C02]/10 flex items-center justify-center flex-shrink-0">
                <TrendingUp className="h-5 w-5 text-[#FC4C02]" />
              </div>
              <div>
                <p className="text-sm font-bold text-[#0a1628]">{pendingFeedbackLogs.length} אימונים מחכים למשוב</p>
                <p className="text-xs text-gray-500 mt-0.5">הוסף מאמץ והערה למאמן</p>
              </div>
            </div>
            <ArrowUpRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
          </div>
        </Link>
      )}

      {/* Weekly Progress Card */}
      <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-4">השבוע שלך</p>
        <div className="w-full bg-gray-100 rounded-full h-2 mb-3">
          <div
            className="bg-[#0a1628] rounded-full h-2 transition-all duration-500"
            style={{ width: `${weeklyProgress}%` }}
          />
        </div>
        <p className="text-sm text-gray-500 mb-4">{completedThisWeek} מתוך {totalThisWeek} אימונים הושלמו</p>
        <div className="grid grid-cols-3 gap-4 border-t border-gray-50 pt-4">
          <div className="text-center">
            <p className="text-3xl font-black text-[#0a1628] leading-none">{totalDistance.toFixed(0)}</p>
            <p className="text-xs text-gray-400 mt-1.5">ק"מ בוצע</p>
          </div>
          <div className="text-center border-x border-gray-100">
            <p className="text-3xl font-black text-[#0a1628] leading-none">
              {effortCount > 0 ? avgEffortNumeric.toFixed(1) : '—'}
            </p>
            <p className="text-xs text-gray-400 mt-1.5">מאמץ ממוצע</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-black text-[#0a1628] leading-none">{completedThisWeek}</p>
            <p className="text-xs text-gray-400 mt-1.5">אימונים</p>
          </div>
        </div>
      </div>

      {/* Coach Note */}
      {latestCoachNote && (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 border-l-4 border-l-[#0a1628] p-5">
          {latestCoachNote.nextWeekFocus && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-2">פוקוס שבוע הבא</p>
              <p className="text-sm text-[#0a1628] leading-relaxed mb-4">{latestCoachNote.nextWeekFocus}</p>
              <div className="border-t border-gray-100 mb-4" />
            </>
          )}
          {latestCoachNote.coachNote && (
            <>
              <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400 mb-2">הערת המאמן</p>
              <p className="text-base text-[#0a1628] font-medium leading-relaxed italic">{latestCoachNote.coachNote}</p>
            </>
          )}
          <div className="flex items-center justify-between mt-4">
            {latestCoachNote.weekStart && (
              <p className="text-xs text-gray-400">{latestCoachNote.weekStart} – {latestCoachNote.weekEnd}</p>
            )}
            <button
              onClick={handleDismissWeeklySummary}
              disabled={isDismissingNote}
              className="flex items-center gap-1.5 bg-[#0a1628] hover:bg-[#0a1628]/90 text-white text-xs font-semibold px-3 py-1.5 rounded-full transition-colors active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              קראתי
            </button>
          </div>
        </div>
      )}

      {/* Chat with Coach */}
      <Link href="/athlete/chat" className="block">
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5 flex items-center justify-between active:scale-[0.98] transition-transform">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#0a1628] flex items-center justify-center relative flex-shrink-0">
              <MessageCircle className="h-6 w-6 text-white" />
              {unreadCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
            <div dir={isRTL ? 'rtl' : 'ltr'}>
              <p className="font-bold text-[#0a1628] text-base leading-tight">
                {isRTL ? 'צ׳אט עם המאמן' : 'Chat with Coach'}
              </p>
              {unreadCount > 0 ? (
                <p className="text-sm text-[#c9a84c] font-semibold mt-0.5">
                  {isRTL ? `${unreadCount} הודעות חדשות` : `${unreadCount} new messages`}
                </p>
              ) : (
                <p className="text-xs text-gray-400 mt-0.5">
                  {isRTL ? 'שלח הודעה למאמן שלך' : 'Message your coach'}
                </p>
              )}
            </div>
          </div>
          <ChevronRight className={cn('h-5 w-5 text-gray-300 flex-shrink-0', isRTL && 'rotate-180')} />
        </div>
      </Link>

    </div>
  )
}

