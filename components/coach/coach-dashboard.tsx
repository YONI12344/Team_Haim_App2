'use client'

import { useEffect, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { format, parseISO, addDays, differenceInDays } from 'date-fns'
import {
  Check, Loader2, Send, Settings, Dumbbell,
  AlertTriangle, Clock, Activity,
} from 'lucide-react'
import Link from 'next/link'
import {
  collection, getDocs, query, where, orderBy,
  addDoc, serverTimestamp, DocumentData, QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db, realtimeDb } from '@/lib/firebase'
import { ref, onValue, query as rtQuery, orderByChild, limitToLast } from 'firebase/database'
import { useAuth } from '@/contexts/auth-context'
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
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  }
}

export function CoachDashboard() {
  const { user } = useAuth()
  const [athletes, setAthletes] = useState<AthleteProfile[]>([])
  const [assignedWorkouts, setAssignedWorkouts] = useState<AssignedWorkout[]>([])
  const [logs, setLogs] = useState<any[]>([])
  const [unreadMessages, setUnreadMessages] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [composerText, setComposerText] = useState<Record<string, string>>({})
  const [sendingMessage, setSendingMessage] = useState<string | null>(null)
  const [messageSent, setMessageSent] = useState<string | null>(null)

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

  // Load all data
  useEffect(() => {
    const loadData = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'athlete')))
        setAthletes(snap.docs.map(mapDocToAthlete))
      } catch { setAthletes([]) }
      try {
        const snap = await getDocs(query(collection(db, 'assignedWorkouts'), orderBy('scheduledDate', 'asc')))
        setAssignedWorkouts(snap.docs.map(d => ({ ...(d.data() as AssignedWorkout), id: d.id })))
      } catch { setAssignedWorkouts([]) }
      try {
        const snap = await getDocs(collection(db, 'logs'))
        setLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch { setLogs([]) }
      setLoading(false)
    }
    loadData()
  }, [])

  // Low-plan coach notifications — fire once per day per athlete via localStorage throttle
  useEffect(() => {
    if (!user?.id || loading || !athletes.length) return
    athletes.forEach(athlete => {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#c9a84c]" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24" dir="rtl">
      {/* Page header */}
      <div className="pt-1">
        <h1 className="text-2xl font-serif font-bold text-[#0a1628]">לוח בקרה</h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })}
        </p>
      </div>

      {/* Per-athlete command center cards */}
      <div className="space-y-4">
        {athletes.map(athlete => {
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
          const planEndDisplay = lastFutureDate
            ? `מתוכנן עד ${format(parseISO(lastFutureDate), 'd/M')}`
            : 'אין תכנית'

          // Today's workout + logs
          const todayWorkout = athleteAssignedWorkouts.find(w => w.scheduledDate === todayStr)
          const todayLog = todayWorkout
            ? (athleteLogs.find((l: any) => l.assignedWorkoutId === todayWorkout.id && l.source !== 'strava') ||
               athleteLogs.find((l: any) => l.date === todayStr && l.source !== 'strava' && l.actualDistance))
            : null
          const todayStravaLog = athleteLogs.find((l: any) => l.date === todayStr && l.source === 'strava') || null
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
          }

          const effectiveLog: any = todayLog || todayStravaLog
          const splits: any[] = (todayStravaLog as any)?.splitLogs?.slice(0, 8) || []
          const hasUnreadMsg = (unreadMessages[athlete.id] || 0) > 0
          const isSending = sendingMessage === athlete.id
          const isSent = messageSent === athlete.id

          return (
            <div
              key={athlete.id}
              className={cn(
                'rounded-3xl bg-card overflow-hidden shadow-sm border transition-all',
                needsNewPlan
                  ? 'border-amber-300/70 shadow-amber-100/50'
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
                        <Check className="h-3 w-3" />בוצע
                      </span>
                    )}
                    {todayStatus === 'strava-pending' && (
                      <span className="text-[11px] font-bold text-[#c9a84c] bg-[#c9a84c]/10 border border-[#c9a84c]/30 px-2.5 py-1.5 rounded-full">
                        ממתין למשוב
                      </span>
                    )}
                    {todayStatus === 'scheduled' && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-gray-500 bg-gray-50 border border-gray-200 px-2.5 py-1.5 rounded-full">
                        <Clock className="h-3 w-3" />מתוכנן
                      </span>
                    )}
                    {todayStatus === 'skipped' && (
                      <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-full">
                        לא בוצע
                      </span>
                    )}
                    {todayStatus === 'rest' && (
                      <span className="text-[11px] text-muted-foreground bg-muted/40 border border-border/30 px-2.5 py-1.5 rounded-full">
                        מנוחה
                      </span>
                    )}
                  </div>
                </div>

                {/* Low-plan warning banner */}
                {needsNewPlan && (
                  <div className="flex items-center gap-2 rounded-xl bg-amber-50 border border-amber-200 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-amber-600 flex-shrink-0" />
                    <p className="text-xs font-bold text-amber-800 flex-1">
                      {lastFutureDate
                        ? 'נדרשת תכנית חדשה — פחות משבוע נותר'
                        : 'נדרשת תכנית חדשה — אין אימונים מתוכננים'}
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

              {/* ── TODAY'S WORKOUT ── */}
              <div className="px-4 py-3 space-y-2">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                  אימון היום
                </p>

                {todayWorkout ? (
                  <div className={cn(
                    'rounded-2xl p-3.5 space-y-2.5',
                    todayStatus === 'done'           ? 'bg-emerald-50/70 border border-emerald-200/60' :
                    todayStatus === 'strava-pending' ? 'bg-amber-50/50 border border-amber-200/50' :
                    todayStatus === 'skipped'        ? 'bg-red-50/50 border border-red-200/50' :
                                                       'bg-[#0a1628]/[0.03] border border-[#0a1628]/10'
                  )}>
                    {/* Workout title + meta row */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-[#0a1628]">
                          {todayWorkout.workout?.title || 'אימון'}
                        </p>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {todayWorkout.workout?.distance && (
                            <span className="text-[11px] text-muted-foreground">
                              {todayWorkout.workout.distance} ק"מ מתוכנן
                            </span>
                          )}
                          {todayWorkout.workout?.type && (
                            <span className="text-[11px] text-muted-foreground capitalize">
                              · {todayWorkout.workout.type}
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Strava source badge */}
                      {todayStravaLog && (
                        <span className="flex items-center gap-1 text-[10px] font-bold text-[#FC4C02] bg-[#FC4C02]/10 border border-[#FC4C02]/20 px-2 py-0.5 rounded-full flex-shrink-0">
                          <Activity className="h-2.5 w-2.5" />Strava
                        </span>
                      )}
                    </div>

                    {/* Stats grid when completed */}
                    {effectiveLog && (todayStatus === 'done' || todayStatus === 'strava-pending') && (
                      <div className="flex flex-wrap gap-1.5">
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
                            effectiveLog.effort >= 8
                              ? 'bg-red-50 text-red-700 border-red-200'
                              : effectiveLog.effort >= 6
                              ? 'bg-orange-50 text-orange-700 border-orange-200'
                              : 'bg-emerald-50 text-emerald-700 border-emerald-200'
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

                    {/* Strava km splits */}
                    {splits.length > 0 && (
                      <div className="overflow-x-auto -mx-1 px-1" dir="ltr">
                        <div className="flex gap-1.5 w-max pb-0.5">
                          {splits.map((split: any, i: number) => (
                            <div
                              key={i}
                              className="flex-shrink-0 rounded-xl bg-white/80 border border-gray-200 px-2.5 py-2 text-center min-w-[52px]"
                            >
                              <p className="text-[9px] font-semibold text-muted-foreground leading-none mb-1">
                                {split.lapIndex ? `L${split.lapIndex}` : `km ${i + 1}`}
                              </p>
                              <p className="text-[11px] font-black text-[#0a1628] leading-none">
                                {split.pace || split.time || '—'}
                              </p>
                              {split.heartRate && (
                                <p className="text-[9px] text-red-400 mt-0.5 leading-none">{split.heartRate}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Athlete comment */}
                    {effectiveLog?.comment && (
                      <p className="text-[11px] text-gray-600 italic border-t border-border/30 pt-2 leading-snug">
                        "{effectiveLog.comment}"
                      </p>
                    )}
                  </div>
                ) : todayStravaLog ? (
                  /* Strava activity but no assigned workout */
                  <div className="rounded-2xl p-3.5 bg-amber-50/50 border border-amber-200/50 space-y-2">
                    <div className="flex items-center gap-2">
                      <Activity className="h-3.5 w-3.5 text-[#FC4C02]" />
                      <p className="text-sm font-bold text-[#0a1628]">
                        {todayStravaLog.stravaName || 'פעילות Strava'}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
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
                      {todayStravaLog.averageHeartRate && (
                        <span className="text-[11px] font-semibold bg-red-50 text-red-600 border border-red-200 px-2.5 py-1 rounded-full">
                          ♥ {todayStravaLog.averageHeartRate} bpm
                        </span>
                      )}
                    </div>
                    {todayStravaLog.comment && (
                      <p className="text-[11px] text-gray-600 italic">"{todayStravaLog.comment}"</p>
                    )}
                  </div>
                ) : (
                  <div className="rounded-2xl px-4 py-3.5 bg-muted/20 border border-border/30 text-center">
                    <p className="text-[11px] text-muted-foreground">אין אימון מתוכנן היום · יום מנוחה</p>
                  </div>
                )}
              </div>

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

      {/* Quick links */}
      <div className="rounded-2xl bg-card border border-border/20 shadow-sm p-4">
        <div className="grid grid-cols-2 gap-2">
          <Link href="/coach/workouts">
            <Button variant="outline" size="sm" className="w-full h-9 text-xs border-[#0a1628]/20 hover:border-[#0a1628]/40">
              <Dumbbell className="h-3.5 w-3.5 ml-1.5" />
              ספריית אימונים
            </Button>
          </Link>
          <Link href="/coach/settings">
            <Button variant="outline" size="sm" className="w-full h-9 text-xs border-[#0a1628]/20 hover:border-[#0a1628]/40">
              <Settings className="h-3.5 w-3.5 ml-1.5" />
              הגדרות
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
