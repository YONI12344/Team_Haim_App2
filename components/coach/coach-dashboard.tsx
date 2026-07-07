'use client'

import { useEffect, useState } from 'react'
import { useNotifications } from '@/hooks/useNotifications'
import { ManualLogCard } from '@/components/shared/manual-log-card'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { format, parseISO, addDays, differenceInDays } from 'date-fns'
import {
  Check, Loader2, Send, AlertTriangle, Clock,
  Activity, ChevronDown, ExternalLink, Edit3, Bell, X,
} from 'lucide-react'
import Link from 'next/link'
import {
  collection, getDocs, query, where, orderBy,
  addDoc, serverTimestamp, DocumentData, QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db, realtimeDb } from '@/lib/firebase'
import { ref, push, onValue, query as rtQuery, orderByChild, limitToLast } from 'firebase/database'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { useWorkoutTypeLabels, workoutTypeColors } from '@/lib/workout-labels'
import { getActivityInfo, activityLabel, formatDurationMin } from '@/lib/activity-types'
import type { AthleteProfile, AssignedWorkout } from '@/lib/types'
import { cn } from '@/lib/utils'

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
    mutedByCoach: data.mutedByCoach ?? false,
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  }
}

export function CoachDashboard() {
  const { user } = useAuth()
  const { t, isRTL } = useLanguage()
  const typeLabels = useWorkoutTypeLabels()
  const { permission, enableNotifications } = useNotifications()
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(false)
  const [athletes, setAthletes] = useState<AthleteProfile[]>([])
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [unreadMessages, setUnreadMessages] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [composerText, setComposerText] = useState<Record<string, string>>({})
  const [sendingMessage, setSendingMessage] = useState<string | null>(null)
  const [messageSent, setMessageSent] = useState<string | null>(null)
  const [expandedCard, setExpandedCard] = useState<string | null>(null)

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setNotifBannerDismissed(localStorage.getItem('coachNotifBannerDismissed') === '1')
    }
  }, [])

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const yesterdayStr = format(addDays(new Date(), -1), 'yyyy-MM-dd')

  // Realtime unread chat counts
  useEffect(() => {
    if (!user?.id || !athletes.length) return
    const counts: Record<string, number> = {}
    const unsubs: (() => void)[] = []
    athletes.forEach(athlete => {
      const chatId = `${user.id}_${athlete.id}`
      const lastRead = parseInt(localStorage.getItem(`lastRead_${chatId}_${user.id}`) || '0')
      const msgsRef = ref(realtimeDb, `conversations/${chatId}/messages`)
      const unsub = onValue(rtQuery(msgsRef, orderByChild('timestamp'), limitToLast(20)), snap => {
        let count = 0
        snap.forEach(child => {
          const msg = child.val()
          if (msg.senderId !== user.id && msg.timestamp > lastRead) count++
        })
        counts[athlete.id] = count
        setUnreadMessages({ ...counts })
      })
      unsubs.push(unsub)
    })
    return () => unsubs.forEach(u => u())
  }, [user?.id, athletes.length])

  // Load all data — parallel queries with date limits to avoid full-table scans
  useEffect(() => {
    if (!user?.id) return
    const loadData = async () => {
      const thirtyDaysAgo = format(addDays(new Date(), -30), 'yyyy-MM-dd')
      try {
        const [athleteSnap, assignedSnap, logsSnap] = await Promise.all([
          getDocs(query(collection(db, 'users'), where('role', '==', 'athlete'))),
          getDocs(query(collection(db, 'assignedWorkouts'), where('scheduledDate', '>=', thirtyDaysAgo), orderBy('scheduledDate', 'asc'))),
          getDocs(query(collection(db, 'logs'), where('date', '>=', thirtyDaysAgo))),
        ])
        setAthletes(athleteSnap.docs.map(mapDocToAthlete))
        setAssignedWorkouts(assignedSnap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id })))
        setLogs(logsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (err) {
        console.error('Error loading coach dashboard data:', err)
        setAthletes([])
        setAssignedWorkouts([])
        setLogs([])
      }
      setLoading(false)
    }
    loadData()
  }, [user?.id])

  // Low-plan notifications — once per day per athlete (localStorage throttle)
  useEffect(() => {
    if (!user?.id || loading || !athletes.length) return
    athletes.forEach(athlete => {
      if (athlete.mutedByCoach) return
      const future = assignedWorkouts.filter(
        w => w.athleteId === athlete.id && w.scheduledDate >= todayStr
      )
      const lastDate = future.length > 0 ? future[future.length - 1].scheduledDate : null
      const daysLeft = lastDate ? differenceInDays(parseISO(lastDate), new Date()) : -1
      if (daysLeft < 7) {
        const key = `lowPlanAlert_${user.id}_${athlete.id}_${todayStr}`
        if (!localStorage.getItem(key)) {
          localStorage.setItem(key, '1')
          fetch('/api/send-notification', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              userId: user.id,
              title: `תכנית ${athlete.name} מסתיימת בקרוב`,
              body: `ל${athlete.name} נותרו פחות משבוע אימונים מתוכננים`,
              data: { type: 'low_plan_warning' },
              url: `/coach/athletes/${athlete.id}/planner`,
            }),
          }).catch(() => {})
        }
      }
    })
  }, [user?.id, loading, athletes.length, assignedWorkouts.length])

  const getInitials = (name: string | undefined | null) => {
    const safeName = name || '?'
    return safeName.split(' ').map(n => n[0] || '').join('').toUpperCase().slice(0, 2) || '?'
  }

  const handleSendMessage = async (athleteId: string, workoutId?: string | null) => {
    const text = composerText[athleteId]?.trim()
    if (!text || !user) return
    setSendingMessage(athleteId)
    try {
      const workout = workoutId ? assignedWorkouts.find(w => w.id === workoutId) : null
      await addDoc(collection(db, 'coachMessages'), {
        athleteId,
        coachId: user.id,
        assignedWorkoutId: workoutId || null,
        workoutTitle: workout?.workout?.title || null,
        message: text,
        createdAt: serverTimestamp(),
        read: false,
      })
      // Mirror to RTDB chat thread with full workout payload
      const chatId = `${user.id}_${athleteId}`
      await push(ref(realtimeDb, `conversations/${chatId}/messages`), {
        senderId: user.id,
        senderName: user.name || 'המאמן',
        content: text,
        type: 'coach_message',
        payload: workout ? {
          assignedWorkoutId: workout.id,
          workoutTitle: workout.workout?.title || '',
          workoutType: workout.workout?.type || '',
          description: workout.workout?.description || '',
          distance: workout.workout?.distance ?? null,
          duration: workout.workout?.duration ?? null,
          sets: workout.workout?.sets ?? [],
          warmup: workout.workout?.warmup || '',
          cooldown: workout.workout?.cooldown || '',
          notes: workout.workout?.notes || '',
          scheduledDate: workout.scheduledDate,
          status: workout.status,
        } : null,
        timestamp: Date.now(),
      })
      fetch('/api/send-notification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: athleteId,
          title: 'הודעה מהמאמן',
          body: text.slice(0, 100),
          data: { type: 'coach_message' },
          url: '/athlete/schedule',
        }),
      }).catch(() => {})
      setComposerText(prev => ({ ...prev, [athleteId]: '' }))
      setMessageSent(athleteId)
      setTimeout(() => setMessageSent(null), 2200)
    } catch {}
    setSendingMessage(null)
  }

  // Per-athlete daily snapshot — computed once, then sorted so athletes who
  // need the coach's attention appear first
  const athleteData = athletes.map(athlete => {
    const athleteLogs = logs.filter(l => l.athleteId === athlete.id)
    const athleteAssignedWorkouts = assignedWorkouts.filter(w => w.athleteId === athlete.id)

    // Plan end date
    const futureWorkouts = athleteAssignedWorkouts.filter(w => w.scheduledDate >= todayStr)
    const lastFutureDate = futureWorkouts.length > 0
      ? futureWorkouts[futureWorkouts.length - 1].scheduledDate
      : null
    const daysUntilPlanEnd = lastFutureDate
      ? differenceInDays(parseISO(lastFutureDate), new Date())
      : -1
    const needsNewPlan = daysUntilPlanEnd < 7

    // Today's workout + logs (Strava sync or manual athlete upload)
    const todayWorkout = athleteAssignedWorkouts.find(w => w.scheduledDate === todayStr)
    const todayLog = todayWorkout
      ? (athleteLogs.find((l: any) => l.assignedWorkoutId === todayWorkout.id && l.source !== 'strava' && l.source !== 'manual') ||
         athleteLogs.find((l: any) => l.date === todayStr && l.source !== 'strava' && l.source !== 'manual' && l.actualDistance))
      : null
    // All of today's activities (Strava + manual) — pending-feedback first
    const todayActivityLogs: any[] = athleteLogs
      .filter((l: any) => l.date === todayStr && (l.source === 'strava' || l.source === 'manual'))
      .sort((a: any, b: any) =>
        (a.feedbackStatus === 'pending' ? 0 : 1) - (b.feedbackStatus === 'pending' ? 0 : 1))
    const todayStravaLog: any = todayActivityLogs[0] || null
    const todayStravaPending = todayStravaLog?.feedbackStatus === 'pending'

    // Yesterday missed
    const yesterdayMissed = athleteAssignedWorkouts.find(
      w => w.scheduledDate === yesterdayStr && w.status !== 'completed' && w.status !== 'skipped'
    )

    // Status
    let todayStatus: 'done' | 'strava-pending' | 'scheduled' | 'skipped' | 'rest' = 'rest'
    if (todayWorkout) {
      if (todayWorkout.status === 'completed' && todayStravaPending) todayStatus = 'strava-pending'
      else if (todayWorkout.status === 'completed') todayStatus = 'done'
      else if (todayWorkout.status === 'skipped') todayStatus = 'skipped'
      else todayStatus = 'scheduled'
    } else if (todayStravaPending) {
      todayStatus = 'strava-pending'
    } else if (todayStravaLog) {
      todayStatus = 'done'
    }

    // Attention score — higher = shown first
    const attention =
      (todayStravaPending ? 8 : 0) +
      (needsNewPlan ? 4 : 0) +
      (yesterdayMissed ? 2 : 0) +
      (todayStatus === 'scheduled' ? 1 : 0)

    return {
      athlete, athleteLogs, athleteAssignedWorkouts, lastFutureDate, needsNewPlan,
      todayWorkout, todayLog, todayStravaLog, todayActivityLogs, todayStravaPending,
      yesterdayMissed, todayStatus, attention,
    }
  }).sort((a, b) => b.attention - a.attention)

  const summary = {
    trained: athleteData.filter(d => d.todayStatus === 'done').length,
    pending: athleteData.filter(d => d.todayStatus === 'strava-pending').length,
    scheduled: athleteData.filter(d => d.todayStatus === 'scheduled').length,
    needPlan: athleteData.filter(d => d.needsNewPlan).length,
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#c9a84c]" />
      </div>
    )
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
            <p className="text-sm font-semibold text-[#0a1628] leading-tight">{t.notificationsTitle}</p>
            <p className="text-xs text-gray-500 mt-0.5">{t.notificationsDesc}</p>
          </div>
          <button
            onClick={enableNotifications}
            className="bg-[#0a1628] text-white rounded-xl px-4 h-9 text-sm font-semibold flex-shrink-0 active:scale-95 transition-transform"
          >
            {t.enableBtn}
          </button>
          <button
            onClick={() => {
              localStorage.setItem('coachNotifBannerDismissed', '1')
              setNotifBannerDismissed(true)
            }}
            className="text-gray-400 hover:text-gray-600 flex-shrink-0"
            aria-label="סגור"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Page header */}
      <div className="pt-1">
        <h1 className="text-2xl font-serif font-bold text-[#0a1628]">לוח בקרה</h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Daily summary strip */}
      <div className="grid grid-cols-4 gap-2">
        <div className="bg-emerald-600 rounded-2xl p-3 text-center">
          <p className="text-xl font-black text-white leading-none">{summary.trained}</p>
          <p className="text-[10px] text-white/80 mt-1">התאמנו היום</p>
        </div>
        <div className={cn('rounded-2xl p-3 text-center', summary.pending > 0 ? 'bg-[#c9a84c]' : 'bg-white border border-gray-100')}>
          <p className={cn('text-xl font-black leading-none', summary.pending > 0 ? 'text-[#0a1628]' : 'text-gray-300')}>{summary.pending}</p>
          <p className={cn('text-[10px] mt-1', summary.pending > 0 ? 'text-[#0a1628]/70' : 'text-gray-400')}>ממתין למשוב</p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-3 text-center">
          <p className="text-xl font-black text-[#0a1628] leading-none">{summary.scheduled}</p>
          <p className="text-[10px] text-gray-400 mt-1">מתוכנן היום</p>
        </div>
        <div className={cn('rounded-2xl p-3 text-center', summary.needPlan > 0 ? 'bg-red-500' : 'bg-white border border-gray-100')}>
          <p className={cn('text-xl font-black leading-none', summary.needPlan > 0 ? 'text-white' : 'text-gray-300')}>{summary.needPlan}</p>
          <p className={cn('text-[10px] mt-1', summary.needPlan > 0 ? 'text-white/85' : 'text-gray-400')}>צריך תכנית</p>
        </div>
      </div>

      {/* Per-athlete command center cards — sorted by attention */}
      <div className="space-y-4">
        {athleteData.map(({
          athlete, lastFutureDate, needsNewPlan, todayWorkout, todayLog,
          todayStravaLog, todayActivityLogs, yesterdayMissed, todayStatus,
        }) => {
          const planEndDisplay = lastFutureDate
            ? `${t.scheduledBadge} ${format(parseISO(lastFutureDate), 'd/M')}`
            : '—'
          const effectiveLog: any = todayLog || todayStravaLog
          const allSplits: any[] = todayStravaLog?.splitLogs || []
          const hasUnreadMsg = (unreadMessages[athlete.id] || 0) > 0
          const isSending = sendingMessage === athlete.id
          const isSent = messageSent === athlete.id
          const isExpanded = expandedCard === athlete.id

          // Workout sets for expanded view
          const workoutSets = todayWorkout?.workout?.sets || []

          // Activity (Strava / manual) type info
          const actInfo = todayStravaLog ? getActivityInfo(todayStravaLog) : null
          const isManualAct = todayStravaLog?.source === 'manual'
          const actDuration = formatDurationMin(todayStravaLog?.durationMin, true)
          const actName = todayStravaLog?.stravaName || (actInfo ? activityLabel(actInfo.kind, true) : '')

          return (
            <div
              key={athlete.id}
              className={cn(
                'rounded-3xl bg-card overflow-hidden shadow-sm border transition-all',
                needsNewPlan
                  ? 'border-amber-300/70'
                  : 'border-border/20 hover:border-[#c9a84c]/30 hover:shadow-md'
              )}
            >
              {/* ── HEADER ── */}
              <div className="px-4 pt-4 pb-3 space-y-2.5">
                <div className="flex items-start gap-3">
                  {/* Avatar */}
                  <Link href={`/coach/athletes/${athlete.id}/planner`} className="flex-shrink-0 mt-0.5">
                    <div className="relative">
                      <Avatar className="h-12 w-12 ring-2 ring-[#c9a84c]/20">
                        <AvatarImage src={athlete.photoURL} alt={athlete.name} />
                        <AvatarFallback className="bg-[#0a1628] text-[#c9a84c] text-sm font-black">
                          {getInitials(athlete.name)}
                        </AvatarFallback>
                      </Avatar>
                      {hasUnreadMsg && (
                        <span className="absolute -top-0.5 -left-0.5 w-3.5 h-3.5 rounded-full bg-blue-500 border-2 border-white" />
                      )}
                    </div>
                  </Link>

                  {/* Name + plan end */}
                  <div className="flex-1 min-w-0">
                    <Link href={`/coach/athletes/${athlete.id}/planner`}>
                      <p className="font-bold text-[#0a1628] text-lg leading-tight hover:text-[#c9a84c] transition-colors truncate">
                        {athlete.name}
                      </p>
                    </Link>
                    <span className={cn(
                      'mt-1 inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                      !lastFutureDate
                        ? 'bg-red-50 text-red-600 border-red-200'
                        : needsNewPlan
                        ? 'bg-amber-50 text-amber-700 border-amber-200'
                        : 'bg-muted/60 text-muted-foreground border-border/40'
                    )}>
                      {planEndDisplay}
                    </span>
                  </div>

                  {/* Today status badge */}
                  <div className="flex-shrink-0 mt-0.5">
                    {todayStatus === 'done' && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1.5 rounded-full">
                        <Check className="h-3 w-3" />{t.completedBadge}
                      </span>
                    )}
                    {todayStatus === 'strava-pending' && (
                      <span className="text-[11px] font-bold text-[#c9a84c] bg-[#c9a84c]/10 border border-[#c9a84c]/30 px-2.5 py-1.5 rounded-full">
                        {t.pendingBadge}
                      </span>
                    )}
                    {todayStatus === 'scheduled' && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-gray-500 bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded-full">
                        <Clock className="h-3 w-3" />{t.scheduledBadge}
                      </span>
                    )}
                    {todayStatus === 'skipped' && (
                      <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-full">
                        {t.skippedBadge}
                      </span>
                    )}
                    {todayStatus === 'rest' && (
                      <span className="text-[11px] text-muted-foreground bg-muted/40 border border-border/30 px-2.5 py-1.5 rounded-full">
                        {t.restDayLabel}
                      </span>
                    )}
                  </div>
                </div>

                {/* Low-plan warning */}
                {needsNewPlan && (
                  <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                    <p className="text-xs font-bold text-amber-800 flex-1">
                      {lastFutureDate ? 'נדרשת תכנית חדשה — פחות משבוע נותר' : 'נדרשת תכנית חדשה — אין אימונים מתוכננים'}
                    </p>
                    <Link href={`/coach/athletes/${athlete.id}/planner`}>
                      <Button size="sm" className="h-6 px-2.5 text-[10px] bg-amber-600 hover:bg-amber-700 text-white rounded-lg">
                        תכנן
                      </Button>
                    </Link>
                  </div>
                )}

                {/* Yesterday missed */}
                {yesterdayMissed && (
                  <div className="flex items-center gap-2 rounded-xl bg-red-50 border border-red-200/70 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                    <p className="text-xs font-semibold text-red-700">
                      לא סיים אימון אתמול: {yesterdayMissed.workout?.title}
                    </p>
                  </div>
                )}
              </div>

              {/* ── DIVIDER ── */}
              <div className="mx-4 border-t border-border/20" />

              {/* ── TODAY'S WORKOUT (clickable to expand) ── */}
              <div className="px-4 py-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  אימון היום
                </p>

                {todayWorkout ? (
                  <button
                    type="button"
                    className="w-full text-right"
                    onClick={() => setExpandedCard(prev => prev === athlete.id ? null : athlete.id)}
                  >
                    <div className={cn(
                      'rounded-2xl p-3.5 space-y-2.5 transition-all',
                      isExpanded ? 'ring-2 ring-[#c9a84c]/40' : '',
                      todayStatus === 'done'           ? 'bg-emerald-50/70 border border-emerald-200/60' :
                      todayStatus === 'strava-pending' ? 'bg-amber-50/50 border border-amber-200/50' :
                      todayStatus === 'skipped'        ? 'bg-red-50/50 border border-red-200/50' :
                                                         'bg-[#0a1628]/[0.03] border border-[#0a1628]/10'
                    )}>
                      {/* Title + chevron */}
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1 text-right">
                          <p className="text-sm font-bold text-[#0a1628]">
                            {todayWorkout.workout?.title || 'אימון'}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                            {todayWorkout.workout?.type && (
                              <span className={cn('text-[10px] font-semibold px-2 py-0.5 rounded-full border',
                                workoutTypeColors[todayWorkout.workout.type] || 'bg-gray-100 text-gray-600 border-gray-200')}>
                                {typeLabels[todayWorkout.workout.type] || todayWorkout.workout.type}
                              </span>
                            )}
                            {todayWorkout.workout?.distance && (
                              <span className="text-[11px] text-muted-foreground">
                                {todayWorkout.workout.distance} {t.km}
                              </span>
                            )}
                            {todayWorkout.movedByAthlete && (
                              <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                                {t.movedByAthleteTag}
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {todayStravaLog && (
                            isManualAct ? (
                              <span className="flex items-center gap-1 text-[10px] font-bold text-[#0a1628] bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full">
                                {actInfo?.emoji} {t.manualActivityTag}
                              </span>
                            ) : (
                              <span className="flex items-center gap-1 text-[10px] font-bold text-[#FC4C02] bg-[#FC4C02]/10 border border-[#FC4C02]/20 px-2 py-0.5 rounded-full">
                                <Activity className="h-2.5 w-2.5" />Strava
                              </span>
                            )
                          )}
                          <ChevronDown className={cn(
                            'h-4 w-4 text-muted-foreground transition-transform duration-200',
                            isExpanded && 'rotate-180'
                          )} />
                        </div>
                      </div>

                      {/* Compact stats (always visible) */}
                      {effectiveLog && (todayStatus === 'done' || todayStatus === 'strava-pending') && (
                        <div className="flex flex-wrap gap-1.5">
                          {actInfo && !actInfo.hasDistance && actDuration && (
                            <span className="text-[11px] font-semibold bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                              {actInfo.emoji} {actDuration}
                            </span>
                          )}
                          {effectiveLog.actualDistance && (
                            <span className="text-[11px] font-semibold bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                              {effectiveLog.actualDistance} ק"מ
                            </span>
                          )}
                          {effectiveLog.actualPace && (
                            <span className="text-[11px] font-semibold bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                              {effectiveLog.actualPace}
                            </span>
                          )}
                          {effectiveLog.effort != null && (
                            <span className={cn(
                              'text-[11px] font-semibold border px-2.5 py-1 rounded-full',
                              effectiveLog.effort >= 8 ? 'bg-red-50 text-red-700 border-red-200' :
                              effectiveLog.effort >= 6 ? 'bg-orange-50 text-orange-700 border-orange-200' :
                              'bg-emerald-50 text-emerald-700 border-emerald-200'
                            )}>
                              מאמץ {effectiveLog.effort}/10
                            </span>
                          )}
                          {todayStravaLog?.averageHeartRate && (
                            <span className="text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 px-2.5 py-1 rounded-full">
                              ♥ {todayStravaLog.averageHeartRate} bpm
                            </span>
                          )}
                          {todayStravaLog?.elevationGain != null && todayStravaLog.elevationGain > 0 && (
                            <span className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full">
                              ↑ {todayStravaLog.elevationGain}m
                            </span>
                          )}
                        </div>
                      )}

                      {/* Comment preview */}
                      {!isExpanded && effectiveLog?.comment && (
                        <p className="text-[11px] text-gray-500 italic truncate">
                          "{effectiveLog.comment}"
                        </p>
                      )}

                      {!isExpanded && (
                        <p className="text-[10px] text-muted-foreground/60 text-left">
                          {todayStravaLog
                            ? 'לחץ לפרטי Strava המלאים ↓'
                            : 'לחץ לפרטי האימון ↓'}
                        </p>
                      )}
                    </div>
                  </button>
                ) : todayStravaLog ? (
                  /* Strava activity but no assigned workout */
                  <button
                    type="button"
                    className="w-full text-right"
                    onClick={() => setExpandedCard(prev => prev === athlete.id ? null : athlete.id)}
                  >
                    <div className={cn(
                      'rounded-2xl p-3.5 bg-amber-50/50 border border-amber-200/50 space-y-2 transition-all',
                      isExpanded && 'ring-2 ring-[#c9a84c]/40'
                    )}>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 flex-1 flex-wrap">
                          {isManualAct
                            ? <span className="text-sm">{actInfo?.emoji}</span>
                            : <Activity className="h-3.5 w-3.5 text-[#FC4C02]" />}
                          {actInfo && (
                            <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', actInfo.badgeClass)}>
                              {activityLabel(actInfo.kind, true)}
                            </span>
                          )}
                          <p className="text-sm font-bold text-[#0a1628]">{actName}</p>
                          {isManualAct && (
                            <span className="text-[10px] font-semibold text-gray-500 bg-gray-100 border border-gray-200 px-2 py-0.5 rounded-full">
                              {t.manualActivityTag}
                            </span>
                          )}
                        </div>
                        <ChevronDown className={cn(
                          'h-4 w-4 text-muted-foreground transition-transform duration-200',
                          isExpanded && 'rotate-180'
                        )} />
                      </div>
                      {!isExpanded && (
                        <div className="flex flex-wrap gap-1.5">
                          {actInfo && !actInfo.hasDistance && actDuration && (
                            <span className="text-[11px] font-semibold bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                              {actDuration}
                            </span>
                          )}
                          {todayStravaLog.actualDistance && (
                            <span className="text-[11px] font-semibold bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                              {todayStravaLog.actualDistance} ק"מ
                            </span>
                          )}
                          {todayStravaLog.actualPace && (
                            <span className="text-[11px] font-semibold bg-white border border-gray-200 px-2.5 py-1 rounded-full">
                              {todayStravaLog.actualPace}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                ) : (
                  <div className="rounded-2xl px-4 py-3.5 bg-muted/20 border border-border/30 text-center">
                    <p className="text-[11px] text-muted-foreground">{t.restDayLabel}</p>
                  </div>
                )}

                {/* Additional activities today — each in its own box */}
                {todayActivityLogs.length > 1 && todayActivityLogs.slice(1).map((extra: any) => {
                  const exInfo = getActivityInfo(extra)
                  const exManual = extra.source === 'manual'
                  const exDur = formatDurationMin(extra.durationMin, true)
                  return (
                    <div key={extra.id} className="rounded-2xl p-3 bg-white border border-border/40 flex items-center gap-2 flex-wrap">
                      <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border flex-shrink-0', exInfo.badgeClass)}>
                        {exInfo.emoji} {activityLabel(exInfo.kind, true)}
                      </span>
                      <span className="text-xs font-bold text-[#0a1628] truncate flex-1 min-w-0">
                        {extra.stravaName || activityLabel(exInfo.kind, true)}
                      </span>
                      {exInfo.hasDistance && extra.actualDistance ? (
                        <span className="text-[11px] font-semibold bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full flex-shrink-0">
                          {extra.actualDistance} ק"מ
                        </span>
                      ) : exDur ? (
                        <span className="text-[11px] font-semibold bg-gray-50 border border-gray-200 px-2 py-0.5 rounded-full flex-shrink-0">
                          {exDur}
                        </span>
                      ) : null}
                      <span className={cn('text-[10px] font-bold flex-shrink-0',
                        exManual ? 'text-gray-400' : 'text-[#FC4C02]')}>
                        {exManual ? t.manualActivityTag : 'Strava'}
                      </span>
                    </div>
                  )
                })}
              </div>

              {/* ── EXPANDED DETAIL (athlete-view style) ── */}
              {isExpanded && (todayWorkout || todayStravaLog) && (
                <div className="border-t border-border/20 bg-[#0a1628]/[0.015]">

                  {/* Full Strava card */}
                  {todayStravaLog && (
                    <div className="px-4 py-3 space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                        {isManualAct ? 'פרטי פעילות' : 'פרטי Strava'}
                      </p>

                      <div className="rounded-2xl border border-border overflow-hidden bg-white shadow-sm" dir="rtl">
                        {/* Header */}
                        <div className={cn('px-4 py-3 flex items-center gap-3 border-b border-border/50',
                          isManualAct ? 'bg-[#0a1628]/5' : 'bg-[#FC4C02]/5')}>
                          <div className={cn('h-10 w-10 rounded-xl flex items-center justify-center flex-shrink-0',
                            isManualAct ? 'bg-[#0a1628]' : 'bg-[#FC4C02]')}>
                            {isManualAct
                              ? <span className="text-lg">{actInfo?.emoji}</span>
                              : <Activity className="h-5 w-5 text-white" />}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              {actInfo && (
                                <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-full border', actInfo.badgeClass)}>
                                  {activityLabel(actInfo.kind, true)}
                                </span>
                              )}
                              <p className="text-sm font-bold text-[#0a1628] truncate">{actName}</p>
                            </div>
                            <p className="text-[11px] text-muted-foreground">
                              {todayStravaLog.feedbackStatus === 'pending'
                                ? t.pendingBadge
                                : isManualAct ? t.manualActivityTag : 'Strava ✓'}
                            </p>
                          </div>
                        </div>

                        {/* Stats grid 2×2 */}
                        <div className="px-4 py-3 grid grid-cols-2 gap-x-6 gap-y-3">
                          {actDuration && (
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">משך</p>
                              <p className="text-xl font-black text-[#0a1628]">{actDuration}</p>
                            </div>
                          )}
                          {todayStravaLog.actualDistance != null && todayStravaLog.actualDistance !== 0 && (
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">מרחק</p>
                              <p className="text-xl font-black text-[#0a1628]">{todayStravaLog.actualDistance} ק"מ</p>
                            </div>
                          )}
                          {todayStravaLog.actualPace && (
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">טמפו</p>
                              <p className="text-xl font-black text-[#0a1628]">{todayStravaLog.actualPace}</p>
                            </div>
                          )}
                          {todayStravaLog.averageHeartRate && (
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">דופק ממוצע</p>
                              <p className="text-xl font-black text-red-500">{todayStravaLog.averageHeartRate} <span className="text-sm font-semibold">bpm</span></p>
                            </div>
                          )}
                          {todayStravaLog.elevationGain != null && todayStravaLog.elevationGain > 0 && (
                            <div>
                              <p className="text-[10px] text-muted-foreground mb-0.5">עלייה</p>
                              <p className="text-xl font-black text-emerald-600">+{todayStravaLog.elevationGain}<span className="text-sm font-semibold">m</span></p>
                            </div>
                          )}
                        </div>

                        {/* All splits — vertical list */}
                        {allSplits.length > 0 && (
                          <div className="border-t border-border/30">
                            {/* Header row */}
                            <div className="px-4 pt-3 pb-1.5 grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr] gap-x-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wide">
                              <span>{allSplits[0]?.lapIndex ? 'Lap' : t.km}</span>
                              <span>{t.tempoLabel}</span>
                              <span>{t.timeInputLabel}</span>
                              <span>{t.heartRateLabel}</span>
                              <span>{t.elevationShort}</span>
                            </div>
                            <div className="divide-y divide-border/20">
                              {allSplits.map((split: any, i: number) => (
                                <div
                                  key={i}
                                  className={cn(
                                    'px-4 py-2.5 grid grid-cols-[2.5rem_1fr_1fr_1fr_1fr] gap-x-2 items-center text-xs',
                                    i % 2 === 0 ? 'bg-white' : 'bg-muted/10'
                                  )}
                                >
                                  <span className="w-7 h-7 rounded-full bg-[#0a1628]/8 flex items-center justify-center text-[11px] font-black text-[#0a1628]">
                                    {split.lapIndex || i + 1}
                                  </span>
                                  <span className="font-bold text-[#0a1628]">
                                    {split.pace || '—'}
                                  </span>
                                  <span className="text-muted-foreground">
                                    {split.time || '—'}
                                  </span>
                                  <span className={split.heartRate ? 'font-semibold text-red-500' : 'text-muted-foreground/40'}>
                                    {split.heartRate ? `${split.heartRate}` : '—'}
                                  </span>
                                  <span className={
                                    split.elevationDiff == null || split.elevationDiff === 0
                                      ? 'text-muted-foreground/40'
                                      : split.elevationDiff > 0
                                      ? 'font-semibold text-emerald-600'
                                      : 'font-semibold text-red-400'
                                  }>
                                    {split.elevationDiff != null && split.elevationDiff !== 0
                                      ? `${split.elevationDiff > 0 ? '+' : ''}${split.elevationDiff}m`
                                      : '—'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Effort + comment from athlete */}
                        {(effectiveLog?.effort != null || effectiveLog?.comment) && (
                          <div className="border-t border-border/30 px-4 py-3 space-y-1.5">
                            <p className="text-[10px] font-semibold text-muted-foreground">משוב ספורטאי</p>
                            {effectiveLog.effort != null && (
                              <div className="flex items-center gap-2">
                                <span className={cn(
                                  'w-2.5 h-2.5 rounded-full flex-shrink-0',
                                  effectiveLog.effort <= 4 ? 'bg-emerald-400' :
                                  effectiveLog.effort <= 6 ? 'bg-amber-400' :
                                  effectiveLog.effort <= 7 ? 'bg-orange-400' : 'bg-red-400'
                                )} />
                                <p className="text-sm font-bold text-[#0a1628]">מאמץ {effectiveLog.effort}/10</p>
                              </div>
                            )}
                            {effectiveLog.comment && (
                              <p className="text-sm text-gray-600 italic leading-snug">
                                "{effectiveLog.comment}"
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Workout description + sets */}
                  {todayWorkout && (todayWorkout.workout?.description || workoutSets.length > 0) && (
                    <div className="px-4 py-3 space-y-2">
                      <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                        מבנה האימון
                      </p>
                      <div className="rounded-2xl border border-border bg-white overflow-hidden">
                        {todayWorkout.workout?.description && (
                          <div className="px-4 py-3 border-b border-border/40">
                            <p className="text-sm text-gray-700 leading-relaxed">
                              {todayWorkout.workout.description}
                            </p>
                          </div>
                        )}
                        {todayWorkout.workout?.warmup && (
                          <div className="px-4 py-2 border-b border-border/30 flex gap-3">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase w-14 flex-shrink-0 mt-0.5">חימום</span>
                            <p className="text-xs text-gray-700">{todayWorkout.workout.warmup}</p>
                          </div>
                        )}
                        {workoutSets.length > 0 && workoutSets.map((set: any, si: number) => (
                          <div key={set.id || si} className="px-4 py-2.5 border-b border-border/30 last:border-0">
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="text-xs font-bold text-[#0a1628]">
                                {t.setLabelPrefix} {si + 1}
                                {set.reps > 1 ? ` · ${set.reps}×` : ''}
                                {set.distance ? ` ${set.distance}` : ''}
                                {set.duration ? ` ${set.duration}` : ''}
                              </span>
                              {set.rest && (
                                <span className="text-[10px] text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                                  {t.restLabel} {set.rest}
                                </span>
                              )}
                            </div>
                            {set.pace && (
                              <p className="text-[11px] text-muted-foreground">{t.tempoLabel}: {set.pace}</p>
                            )}
                            {set.notes && (
                              <p className="text-[11px] text-gray-500 italic">{set.notes}</p>
                            )}
                            {/* Sub-intervals */}
                            {set.intervals && set.intervals.length > 0 && (
                              <div className="mt-1.5 space-y-1">
                                {set.intervals.map((interval: any, ii: number) => (
                                  <div key={interval.id || ii} className="flex items-center gap-2 text-[11px] text-gray-600">
                                    <span className="w-5 h-5 rounded-full bg-[#0a1628]/10 flex items-center justify-center text-[9px] font-bold text-[#0a1628] flex-shrink-0">
                                      {ii + 1}
                                    </span>
                                    <span>{interval.distance || interval.pace || ''}</span>
                                    {interval.rest && <span className="text-muted-foreground">· {t.restLabel} {interval.rest}</span>}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                        {todayWorkout.workout?.cooldown && (
                          <div className="px-4 py-2 flex gap-3 border-t border-border/30">
                            <span className="text-[10px] font-semibold text-muted-foreground uppercase w-14 flex-shrink-0 mt-0.5">שחרור</span>
                            <p className="text-xs text-gray-700">{todayWorkout.workout.cooldown}</p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Manual log feedback (non-Strava) */}
                  {todayLog && !todayStravaLog && todayLog.effort != null && (
                    <div className="px-4 py-3">
                      <ManualLogCard
                        distance={todayLog.actualDistance}
                        pace={todayLog.actualPace}
                        effort={todayLog.effort}
                        comment={todayLog.comment}
                        splitLogs={todayLog.splitLogs}
                      />
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="px-4 py-3 flex gap-2">
                    <Link
                      href={`/coach/athletes/${athlete.id}/planner`}
                      className="flex-1"
                    >
                      <Button
                        size="sm"
                        className="w-full h-9 text-xs bg-[#0a1628] text-white hover:bg-[#0a1628]/90 gap-1.5"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        תצוגת ספורטאי מלאה
                      </Button>
                    </Link>
                    {todayWorkout?.workoutId && (
                      <Link href={`/coach/workouts/${todayWorkout.workoutId}/edit`}>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-9 px-3 text-xs border-[#0a1628]/20 hover:border-[#0a1628]/50 gap-1.5"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          ערוך אימון
                        </Button>
                      </Link>
                    )}
                  </div>
                </div>
              )}

              {/* ── DIVIDER ── */}
              <div className="mx-4 border-t border-border/20" />

              {/* ── INLINE MESSAGE COMPOSER ── */}
              <div className="px-4 py-3">
                {isSent ? (
                  <div className="rounded-2xl bg-emerald-50 border border-emerald-200 px-4 py-3 text-center">
                    <p className="text-sm font-semibold text-emerald-700">ההודעה נשלחה! ✓</p>
                  </div>
                ) : (
                  <div className="flex gap-2 items-end">
                    <Textarea
                      value={composerText[athlete.id] || ''}
                      onChange={e => setComposerText(prev => ({ ...prev, [athlete.id]: e.target.value }))}
                      placeholder={
                        todayWorkout
                          ? `כתוב הערה על "${todayWorkout.workout?.title || 'האימון'}"...`
                          : 'שלח הודעה לספורטאי...'
                      }
                      className="text-xs min-h-[44px] max-h-[88px] bg-white border-border/50 resize-none flex-1 rounded-2xl"
                      dir="rtl"
                      onKeyDown={e => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                          e.preventDefault()
                          handleSendMessage(athlete.id, todayWorkout?.id)
                        }
                      }}
                    />
                    <Button
                      size="sm"
                      className="h-11 w-11 p-0 bg-[#0a1628] text-white hover:bg-[#0a1628]/90 rounded-2xl flex-shrink-0"
                      onClick={() => handleSendMessage(athlete.id, todayWorkout?.id)}
                      disabled={!!isSending || !composerText[athlete.id]?.trim()}
                    >
                      {isSending
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Send className="h-4 w-4" />}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
