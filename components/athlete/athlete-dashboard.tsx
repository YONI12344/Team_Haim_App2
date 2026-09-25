'use client'

import { useRouter } from 'next/navigation'

import { useEffect, useState, useRef } from 'react'
import { useNotifications } from '@/hooks/useNotifications'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { format, isToday, isTomorrow, parseISO, startOfWeek, endOfWeek, addDays } from 'date-fns'
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
  FlaskConical,
  RefreshCw,
  ChevronLeft,
} from 'lucide-react'
import Link from 'next/link'
import { listJourneys, stageDisplayName } from '@/lib/journey'
import { cn, isCoachMessageRecent } from '@/lib/utils'
import { toast } from 'sonner'
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
import { db } from '@/lib/firebase'
import { realtimeDb } from '@/lib/firebase-realtime'
import { ref, push, onValue, query as rtQuery, orderByChild, limitToLast } from 'firebase/database'
import { getCoachInfo, conversationId } from '@/lib/coach'
import { isCoachEmail } from '@/lib/constants'
import { useStravaSync } from '@/hooks/useStravaSync'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { useWorkoutTypeLabels, workoutTypeColors } from '@/lib/workout-labels'
import type {
  JourneyDoc,
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
  const { user } = useAuth()
  const { permission, enableNotifications } = useNotifications()
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setNotifBannerDismissed(localStorage.getItem('notifBannerDismissed') === '1')
    }
  }, [])

  // Save Strava connection from URL params. Waits for `user` to be ready
  // (Firebase Auth is still hydrating right after the full-page OAuth
  // redirect back from Strava) and re-runs once it is — previously this
  // ran once on mount with `user` fixed in its closure, so on a fresh
  // connect it very often fired before auth was ready: the users/{id}
  // stravaId write was silently skipped (gated on user?.id) and the whole
  // chain had no .catch, so a permission-denied write from an
  // unauthenticated request failed with nothing shown anywhere — the
  // athlete would see "connected" with no error, but sync could later
  // fail depending on what state was actually persisted.
  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (params.get("strava") !== "connected") return
    if (!user?.id) return
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
          // Lets firestore.rules scope this doc to its own owner — this
          // collection holds a raw Strava OAuth accessToken/refreshToken,
          // and had no owner field at all before, so any signed-in athlete
          // could read or overwrite any OTHER athlete's Strava tokens by
          // guessing/enumerating strava_<id> doc ids.
          userId: user.id,
          name: stravaName || "",
          accessToken,
          refreshToken: refreshToken || "",
          expiresAt: Number(expiresAt),
          connectedAt: serverTimestamp(),
        }, { merge: true }).then(() => {
          console.log("✅ Strava saved!")
          // Also save stravaId to user document
          return setDoc(doc(db, "users", user.id), { stravaId: Number(stravaId), stravaConnected: true }, { merge: true })
        }).then(() => {
          window.history.replaceState({}, "", "/athlete")
        }).catch((err) => {
          console.error("Strava connection save failed:", err)
          toast.error(t.stravaConnectBtn)
        })
      })
    })
  }, [user?.id])
  // logs/assigned below are on real-time onSnapshot listeners, so a
  // successful sync's Firestore writes flow into this screen automatically
  // — no manual refetch callback needed here (unlike the Schedule page's
  // own copy of this hook, which reloads a plain one-time query).
  const { syncing: stravaSyncing, sync: syncStrava } = useStravaSync(user?.id || '')
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
  // The athlete's current season (journey) — its phase inks the home poster.
  const [season, setSeason] = useState<JourneyDoc | null>(null)

  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    listJourneys(user.id)
      .then((journeys) => {
        if (cancelled || journeys.length === 0) return
        const today = format(new Date(), 'yyyy-MM-dd')
        const active = journeys.find((j) => j.startDate <= today && j.goalRaceDate >= today)
          || [...journeys].sort((a, b) => (b.goalRaceDate || '').localeCompare(a.goalRaceDate || ''))[0]
        setSeason(active)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [user?.id])

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
                new Notification(t.newMessageNotifTitle + ' 💬', { body: msg.content, icon: '/favicon.ico' })
              }
            }
          })
          setUnreadCount(count)
        })
      } catch {}
    }
    setupChat()
    // Notification permission is only ever requested from the explained
    // "enable notifications" banner (see useNotifications()) — an
    // unprompted, unexplained request here risked the browser auto-denying
    // it, which permanently blocks the real push-notification flow since a
    // denial can't be re-prompted in-app.
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
            kmWeekStartDay: data.kmWeekStartDay === 0 ? 0 : 1,
            visibleWeeksAhead: typeof data.visibleWeeksAhead === 'number' ? data.visibleWeeksAhead : 2,
            labVisibleToAthlete: data.labVisibleToAthlete === true,
            strengthToolsVisibleToAthlete: data.strengthToolsVisibleToAthlete === true,
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
      const recent = msgs.filter(m => isCoachMessageRecent(m.createdAt))
      recent.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      setCoachMessages(recent)
    }).catch(() => {})

    // Real-time listener for assigned workouts — last 14 days + all future.
    // The whole dashboard used to sit behind a full-page spinner until THIS
    // one listener's first snapshot came back — on a slow connection or a
    // cold Firestore "listen" handshake that could take several seconds,
    // even though every other section (profile, notes, messages) had
    // nothing to do with this query and could render immediately. Capping
    // the wait means the page never blocks longer than this regardless of
    // network conditions — the hero/weekly-progress sections just render
    // with whatever's in `assigned` so far (empty, most likely) and update
    // in place the moment the real snapshot arrives, same as always.
    const LOADING_GATE_CAP_MS = 800
    let gateOpened = false
    const openGate = () => { if (!gateOpened) { gateOpened = true; setLoading(false) } }
    const gateTimer = setTimeout(openGate, LOADING_GATE_CAP_MS)
    const thirtyDaysAgo = format(addDays(new Date(), -14), 'yyyy-MM-dd')
    unsubAssigned = onSnapshot(
      query(collection(db, 'assignedWorkouts'), where('athleteId', '==', user.id), where('scheduledDate', '>=', thirtyDaysAgo)),
      (snap) => {
        setAssigned(snap.docs.map(mapAssignedWorkout))
        openGate()
      },
      (err) => {
        console.error('Error loading assigned workouts:', err)
        setAssigned([])
        openGate()
      }
    )

    // Real-time listener for logs — last 14 days
    unsubLogs = onSnapshot(
      query(collection(db, 'logs'), where('athleteId', '==', user.id), where('date', '>=', thirtyDaysAgo)),
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
      clearTimeout(gateTimer)
      unsubAssigned?.()
      unsubLogs?.()
    }
  }, [user?.id, user?.name])

  if (loading) {
    return (
      <div className="mx-auto max-w-xl space-y-4" aria-busy>
        <div className="h-48 rounded-2xl bg-navy-tint animate-pulse" />
        <div className="h-20 rounded-2xl bg-navy-tint animate-pulse" />
      </div>
    )
  }

  // Rolling visibility window — athlete sees only N weeks ahead (Saturday roll)
  const visibleWeeks = profile?.visibleWeeksAhead ?? 2
  const visCutoff = visibleWeeks > 0
    ? format(addDays(startOfWeek(new Date(), { weekStartsOn: 6 }), visibleWeeks * 7), 'yyyy-MM-dd')
    : null
  const bypassesVisWindow = (w: AssignedWorkout) =>
    w.showAheadOverride || w.workout?.type === 'race' || w.workout?.type === 'time_trial'
  const isVisible = (w: AssignedWorkout) => !visCutoff || w.scheduledDate < visCutoff || bypassesVisWindow(w)

  const todayWorkouts = assigned.filter(
    (w) => w.scheduledDate && isToday(parseISO(w.scheduledDate)),
  )

  // Weekly window follows the athlete's km-week start setting (default Monday)
  const kmWeekStartsOn: 0 | 1 = profile?.kmWeekStartDay === 0 ? 0 : 1
  const startOfThisWeek = startOfWeek(new Date(), { weekStartsOn: kmWeekStartsOn })
  const endOfThisWeek = endOfWeek(new Date(), { weekStartsOn: kmWeekStartsOn })
  const thisWeekWorkouts = assigned.filter((w) => {
    if (!w.scheduledDate) return false
    const d = parseISO(w.scheduledDate)
    return d >= startOfThisWeek && d <= endOfThisWeek
  })
  const completedThisWeek = thisWeekWorkouts.filter((w) => w.status === 'completed').length
  const totalThisWeek = thisWeekWorkouts.length

  // Aggregate weekly stats from logs
  const startOfThisWeekStr = format(startOfThisWeek, 'yyyy-MM-dd')
  const endOfThisWeekStr = format(endOfThisWeek, 'yyyy-MM-dd')
  const thisWeekLogs = logs.filter(l => l.date >= startOfThisWeekStr && l.date <= endOfThisWeekStr)
  const pendingFeedbackLogs = (logs as any[]).filter(l => l.source === 'strava' && l.feedbackStatus === 'pending')
  const totalDistance = thisWeekLogs.reduce((s, l) => s + (l.actualDistance || 0), 0)
  const effortCount = logs.length
  const avgEffortNumeric = effortCount
    ? logs.reduce((s, l) => s + legacyEffortToNumber(l.effort), 0) / effortCount
    : 0

  const profileName = profile?.name || user?.name || t.athleteFallback
  // The coach previewing the athlete app is never sent through athlete onboarding.
  const isNewAthlete = !loading && profile !== null && !profile?.onboardingComplete && !isCoachEmail(user?.email)
  const unreadCoachMessages = coachMessages.filter(m => !m.read)
  const L = HOME_COPY[isRTL ? 'he' : 'en']

  // Season: which phase today falls in, for the hero's phase chip.
  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const activeStage = season?.stages?.find((s) => todayStr >= s.startDate && todayStr <= s.endDate)
  const weeksToRace = season?.goalRaceDate
    ? Math.max(0, Math.ceil((parseISO(season.goalRaceDate).getTime() - Date.now()) / (7 * 86400000)))
    : null

  const allDoneToday = todayWorkouts.length > 0 && todayWorkouts.every(w => w.status === 'completed')
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(startOfThisWeek, i))

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
        const noteSnap = await getDoc(doc(db, 'weeklyNotes', note.id))
        const alreadyRead = noteSnap.exists() && noteSnap.data()?.readByAthlete === true

        await Promise.all(
          toMark.map(n => updateDoc(doc(db, 'weeklyNotes', n.id), { readByAthlete: true }))
        )

        // Write the newest note to chat — only once (idempotent guard).
        if (!alreadyRead) {
          try {
            const coachInfo = await getCoachInfo()
            if (coachInfo) {
              const chatId = conversationId(coachInfo.uid, user.id)
              await push(ref(realtimeDb, `conversations/${chatId}/messages`), {
                senderId: coachInfo.uid,
                senderName: coachInfo.name || t.theCoachFallback,
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

  const Chevron = isRTL ? ChevronLeft : ChevronRight

  return (
    <div className="mx-auto max-w-xl space-y-5" dir={isRTL ? 'rtl' : 'ltr'}>
      {isNewAthlete && <NewAthleteRedirect />}

      {/* Notification permission — full card until dismissed/answered, then a
          small persistent pill so there's always a way to recover. */}
      {permission !== 'granted' && (
        (notifBannerDismissed || permission === 'denied') ? (
          <button
            onClick={() => permission === 'denied' ? toast.error(t.notificationsDeniedHint) : enableNotifications()}
            className="flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-semibold text-muted-foreground transition-colors duration-150 hover:border-navy/30 hover:text-navy"
          >
            <Bell className="h-3.5 w-3.5" />
            {t.notificationsPillLabel}
          </button>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-sm">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold-light">
              <Bell className="h-4 w-4 text-gold" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold leading-tight text-navy">{t.notificationsTitle}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{t.notificationsDesc}</p>
            </div>
            <button
              onClick={enableNotifications}
              className="h-9 shrink-0 rounded-xl bg-navy px-3.5 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-95"
            >
              {t.enableBtn}
            </button>
            <button
              onClick={() => {
                localStorage.setItem('notifBannerDismissed', '1')
                setNotifBannerDismissed(true)
              }}
              className="shrink-0 text-muted-foreground hover:text-navy"
              aria-label={t.close}
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      )}

      {/* ── Hero: today's session ── */}
      <section
        className="relative overflow-hidden rounded-2xl bg-navy p-5 text-white shadow-sm"
        aria-label={L.today}
      >
        <div className="pointer-events-none absolute -end-20 -top-20 h-64 w-64 rounded-full bg-gold/15 blur-3xl" aria-hidden />
        <div className="relative flex items-center justify-between gap-2">
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs font-semibold tabular-nums">
            {weeksToRace != null && season
              ? L.raceIn(weeksToRace, season.goalRaceEvent)
              : format(new Date(), 'd.M')}
          </span>
          <button
            onClick={() => syncStrava()}
            disabled={stravaSyncing}
            className="flex h-8 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-semibold transition-[transform,background-color] duration-150 ease-out hover:bg-white/15 active:scale-95 disabled:opacity-60"
          >
            {stravaSyncing
              ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[#FC4C02]" />
              : <RefreshCw className="h-3.5 w-3.5 text-[#FC4C02]" />}
            {stravaSyncing ? t.stravaSyncingBtn : 'Strava'}
          </button>
        </div>

        <p className="relative mt-4 text-[13px] text-white/60">
          {t.helloGreeting}, {profileName.split(' ')[0]}
          {activeStage && <> · <span className="text-gold">{stageDisplayName(activeStage, isRTL)}</span></>}
        </p>

        {todayWorkouts.length > 0 ? (
          todayWorkouts.map((tw, i) => {
            const done = tw.status === 'completed'
            const meta = [
              workoutTypeLabels[tw.workout.type as WorkoutType] || tw.workout.type,
              tw.workout.distance ? `${tw.workout.distance} ${t.km}` : null,
              tw.workout.duration ? `${tw.workout.duration} ${t.min}` : null,
            ].filter(Boolean).join(' · ')
            return (
              <div key={tw.id} className={cn('relative', i > 0 && 'mt-4 border-t border-white/10 pt-4')}>
                <div className="mt-1 flex items-start justify-between gap-3">
                  <h1 className="text-balance font-display text-3xl font-semibold leading-tight">{tw.workout.title}</h1>
                  {done && (
                    <span className="mt-1 flex shrink-0 items-center gap-1 rounded-full bg-gold/15 px-2 py-0.5 text-xs font-semibold text-gold">
                      <CheckCircle2 className="h-3 w-3" /> {L.done}
                    </span>
                  )}
                </div>
                <p className="mt-1.5 text-sm tabular-nums text-white/70">{meta}</p>
                <Link
                  href={`/athlete/schedule?date=${tw.scheduledDate}&workoutId=${tw.id}`}
                  className={cn(
                    'mt-4 flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-transform duration-150 ease-out active:scale-[0.97]',
                    done ? 'border border-white/25 text-white hover:bg-white/5' : 'bg-gold text-navy',
                  )}
                >
                  {done ? t.workoutDoneDetails : t.openWorkoutBtn}
                  <Chevron className="h-4 w-4" />
                </Link>
              </div>
            )
          })
        ) : (
          <div className="relative mt-1">
            <h1 className="font-display text-3xl font-semibold">{t.restDayLabel}</h1>
            <p className="mt-1.5 text-sm text-white/70">{t.restDaySubtitle}</p>
          </div>
        )}
      </section>

      {/* ── This week ── */}
      <section aria-label={t.yourWeekLabel}>
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.yourWeekLabel}</p>
        <ol className="grid grid-cols-7 gap-1.5">
          {weekDays.map((d) => {
            const ds = format(d, 'yyyy-MM-dd')
            const dayWorkouts = thisWeekWorkouts.filter(w => w.scheduledDate === ds && isVisible(w))
            const state = dayWorkouts.length === 0
              ? 'rest'
              : dayWorkouts.every(w => w.status === 'completed')
                ? 'done'
                : dayWorkouts.some(w => w.status === 'skipped') ? 'skipped' : 'planned'
            const today = ds === todayStr
            return (
              <li key={ds}>
                <Link
                  href={`/athlete/schedule?date=${ds}`}
                  aria-label={`${format(d, 'd.M')} ${L.dayState[state]}`}
                  className={cn(
                    'flex h-[68px] flex-col items-center justify-between rounded-xl border py-1.5 transition-colors duration-150',
                    today ? 'border-navy bg-navy text-white' : 'border-border text-navy hover:border-navy/30',
                  )}
                >
                  <span className={cn('text-xs font-medium', today ? 'text-white/60' : 'text-muted-foreground')}>{L.dayLetters[d.getDay()]}</span>
                  <span className="text-[15px] font-semibold leading-none tabular-nums">{format(d, 'd')}</span>
                  <span
                    aria-hidden
                    className={cn(
                      'h-2 w-2 rounded-full',
                      state === 'done' && (today ? 'bg-gold' : 'bg-pine'),
                      state === 'planned' && (today ? 'border border-gold' : 'border border-navy/40'),
                      state === 'skipped' && 'bg-destructive/70',
                      state === 'rest' && 'bg-transparent',
                    )}
                  />
                </Link>
              </li>
            )
          })}
        </ol>

        <dl className="mt-3 grid grid-cols-3 rounded-2xl border border-border bg-card shadow-sm">
          {[
            { v: totalDistance.toFixed(0), l: t.weekKmDoneLabel },
            { v: `${completedThisWeek}/${totalThisWeek}`, l: t.workoutsStatLabel },
            { v: effortCount > 0 ? avgEffortNumeric.toFixed(1) : '—', l: t.averageEffortShort },
          ].map((s, i) => (
            <div key={s.l} className={cn('px-2 py-3 text-center', i > 0 && 'border-s border-border')}>
              <dd className="font-display text-3xl font-semibold tabular-nums text-navy">{s.v}</dd>
              <dt className="mt-1 text-xs text-muted-foreground">{s.l}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* ── From the coach: direct messages ── */}
      {unreadCoachMessages.length > 0 && (
        <section className="space-y-3" aria-label={t.messageFromCoach}>
          {unreadCoachMessages.map(msg => (
            <article key={msg.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="mb-2 flex items-center gap-1.5 text-pine">
                <MessageCircle className="h-3.5 w-3.5" />
                <span className="text-xs font-semibold uppercase tracking-wide">{t.messageFromCoach}</span>
              </div>
              {msg.workoutTitle && <p className="mb-1.5 text-xs text-muted-foreground">{msg.workoutTitle}</p>}
              <p className="text-[15px] leading-relaxed text-foreground">{msg.message}</p>
              <div className="mt-3 flex items-center justify-between">
                {msg.createdAt?.seconds && (
                  <p className="text-xs tabular-nums text-muted-foreground">{format(new Date(msg.createdAt.seconds * 1000), 'd/M/yyyy HH:mm')}</p>
                )}
                <button
                  onClick={() => {
                    setCoachMessages(prev => prev.filter(m => m.id !== msg.id)) // instant hide
                    updateDoc(doc(db, 'coachMessages', msg.id), { read: true, readAt: Date.now() }).catch(() => {})
                  }}
                  className="flex h-8 items-center gap-1.5 rounded-full bg-pine px-3 text-xs font-semibold text-white transition-transform duration-150 ease-out active:scale-95"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t.markedAsReadBtn}
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      {/* ── Strava runs waiting for the athlete's feedback ── */}
      {pendingFeedbackLogs.length > 0 && (
        <section aria-label={t.pendingFeedbackSuffix}>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {pendingFeedbackLogs.length} {t.pendingFeedbackSuffix}
          </p>
          <ul className="divide-y divide-border rounded-2xl border border-border bg-card shadow-sm">
            {pendingFeedbackLogs
              .sort((a: any, b: any) => b.date.localeCompare(a.date))
              .slice(0, 5)
              .map((log: any) => (
                <li key={log.id}>
                  <Link href={`/athlete/schedule?date=${log.date}`} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-150 hover:bg-navy-tint">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-navy">{log.stravaName || t.pendingFeedbackSuffix}</p>
                      <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                        {log.date}{log.actualDistance ? ` · ${log.actualDistance} ${t.km}` : ''}
                      </p>
                    </div>
                    <ArrowUpRight className="h-4 w-4 shrink-0 text-[#FC4C02]" />
                  </Link>
                </li>
              ))}
            {pendingFeedbackLogs.length > 5 && (
              <li>
                <Link href="/athlete/schedule" className="block px-4 py-2.5 text-center text-xs text-muted-foreground">
                  +{pendingFeedbackLogs.length - 5} {L.more}
                </Link>
              </li>
            )}
          </ul>
        </section>
      )}

      {/* ── Coach's weekly note ── */}
      {latestCoachNote && (
        <article className="rounded-2xl bg-pine p-4 text-white shadow-sm">
          {latestCoachNote.nextWeekFocus && (
            <>
              <p className="text-xs font-semibold uppercase tracking-wide text-gold-light">{t.nextWeekFocusLabel}</p>
              <p className="mt-1.5 text-[15px] leading-relaxed">{latestCoachNote.nextWeekFocus}</p>
            </>
          )}
          {latestCoachNote.coachNote && (
            <>
              <p className={cn('text-xs font-semibold uppercase tracking-wide text-gold-light', latestCoachNote.nextWeekFocus && 'mt-4')}>{t.coachNoteHeading}</p>
              <p className="mt-1.5 text-base font-medium leading-relaxed">{latestCoachNote.coachNote}</p>
            </>
          )}
          <div className="mt-4 flex items-center justify-between">
            {latestCoachNote.weekStart && (
              <p className="text-xs tabular-nums text-white/65">{latestCoachNote.weekStart} – {latestCoachNote.weekEnd}</p>
            )}
            <button
              onClick={handleDismissWeeklySummary}
              disabled={isDismissingNote}
              className="flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-pine transition-transform duration-150 ease-out active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t.markedAsReadBtn}
            </button>
          </div>
        </article>
      )}

      {/* ── Everything else ── */}
      <nav aria-label={L.more} className="divide-y divide-border rounded-2xl border border-border bg-card shadow-sm">
        {[
          {
            href: '/athlete/chat',
            icon: MessageCircle,
            label: t.chatWithCoachLabel,
            sub: unreadCount > 0 ? `${unreadCount} ${t.newMessagesSuffix}` : t.messageYourCoach,
            badge: unreadCount > 0 ? (unreadCount > 9 ? '9+' : String(unreadCount)) : null,
            show: true,
          },
          { href: '/athlete/progress', icon: TrendingUp, label: L.strengthTitle, sub: L.strengthSub, badge: null, show: !!profile?.strengthToolsVisibleToAthlete },
          { href: '/athlete/lab', icon: FlaskConical, label: t.labLabel, sub: t.labDesc, badge: null, show: !!profile?.labVisibleToAthlete },
        ].filter(r => r.show).map((r) => (
          <Link key={r.href} href={r.href} className="flex items-center gap-3.5 px-4 py-3.5 transition-colors duration-150 hover:bg-navy-tint">
            <span className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-navy-tint text-navy">
              <r.icon className="h-5 w-5" />
              {r.badge && (
                <span className="absolute -top-1.5 -end-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-bold text-white">
                  {r.badge}
                </span>
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold leading-tight text-navy">{r.label}</span>
              <span className={cn('mt-0.5 block text-xs', r.badge ? 'font-semibold text-destructive' : 'text-muted-foreground')}>{r.sub}</span>
            </span>
            <Chevron className="h-5 w-5 shrink-0 text-muted-foreground" />
          </Link>
        ))}
      </nav>
    </div>
  )
}

const HOME_COPY = {
  en: {
    today: 'Today',
    done: 'Done',
    more: 'more',
    raceIn: (weeks: number, race?: string) => weeks === 0 ? `Race week${race ? ` · ${race}` : ''}` : `${weeks} weeks to ${race || 'race day'}`,
    dayLetters: ['S', 'M', 'T', 'W', 'T', 'F', 'S'],
    dayState: { done: 'done', planned: 'planned', skipped: 'skipped', rest: 'rest day' },
    strengthTitle: 'Strength progress',
    strengthSub: 'Weights and progress by exercise',
  },
  he: {
    today: 'היום',
    done: 'בוצע',
    more: 'עוד',
    raceIn: (weeks: number, race?: string) => weeks === 0 ? `שבוע המירוץ${race ? ` · ${race}` : ''}` : `עוד ${weeks} שבועות ל${race ? `-${race}` : 'מירוץ'}`,
    dayLetters: ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'],
    dayState: { done: 'בוצע', planned: 'מתוכנן', skipped: 'דולג', rest: 'מנוחה' },
    strengthTitle: 'התקדמות בכוח',
    strengthSub: 'משקלים והתקדמות לפי תרגיל',
  },
} as const
