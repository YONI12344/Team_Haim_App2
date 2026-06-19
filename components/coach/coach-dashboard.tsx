'use client'

import { useEffect, useState } from 'react'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { format, startOfWeek, endOfWeek, addDays, differenceInDays } from 'date-fns'
import {
  MessageCircle, Check, Loader2, Send, Settings, Dumbbell,
  CalendarPlus, Activity, AlertTriangle, Clock,
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
  const [openComposer, setOpenComposer] = useState<string | null>(null)
  const [composerText, setComposerText] = useState<Record<string, string>>({})
  const [composerWorkoutId, setComposerWorkoutId] = useState<Record<string, string>>({})
  const [sendingMessage, setSendingMessage] = useState(false)
  const [messageSent, setMessageSent] = useState<string | null>(null)

  // Realtime chat unread counts
  useEffect(() => {
    if (!user?.id || !athletes.length) return
    const counts: Record<string, number> = {}
    const unsubs: (() => void)[] = []
    athletes.forEach(athlete => {
      const chatId = `${user.id}_${athlete.id}`
      const lastRead = parseInt(localStorage.getItem(`lastRead_${chatId}_${user.id}`) || '0')
      const msgsRef = ref(realtimeDb, `conversations/${chatId}/messages`)
      const unsub = onValue(rtQuery(msgsRef, orderByChild('timestamp'), limitToLast(20)), (snapshot) => {
        let count = 0
        snapshot.forEach((child) => {
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

  const getInitials = (name: string | undefined | null) => {
    const safeName = name || '?'
    return safeName.split(' ').map(n => n[0] || '').join('').toUpperCase().slice(0, 2) || '?'
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const yesterdayStr = format(addDays(new Date(), -1), 'yyyy-MM-dd')
  const next7Str = format(addDays(new Date(), 7), 'yyyy-MM-dd')
  const thisWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const thisWeekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')

  const handleSendMessage = async (athleteId: string) => {
    const text = composerText[athleteId]?.trim()
    if (!text || !user) return
    setSendingMessage(true)
    try {
      const workoutId = composerWorkoutId[athleteId] || null
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
      setComposerWorkoutId(prev => ({ ...prev, [athleteId]: '' }))
      setMessageSent(athleteId)
      setTimeout(() => { setMessageSent(null); setOpenComposer(null) }, 1800)
    } catch {}
    setSendingMessage(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#c9a84c]" />
      </div>
    )
  }

  // Today overview counts
  const todayAllWorkouts = assignedWorkouts.filter(w => w.scheduledDate === todayStr)
  const todayCompletedCount = todayAllWorkouts.filter(w => w.status === 'completed').length
  const todayPendingCount = todayAllWorkouts.filter(w => w.status !== 'completed').length
  const todayStravaPendingCount = logs.filter(l => l.date === todayStr && l.source === 'strava' && l.feedbackStatus === 'pending').length

  // Athletes without plan for next 7 days
  const athletesNoPlan = athletes.filter(a =>
    !assignedWorkouts.some(w => w.athleteId === a.id && w.scheduledDate > todayStr && w.scheduledDate <= next7Str)
  )

  return (
    <div className="space-y-5 pb-24" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-serif font-bold text-[#0a1628]">לוח בקרה</h1>
        <p className="text-sm text-muted-foreground">
          {new Date().toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </p>
      </div>

      {/* Hero Overview Card */}
      <div className="rounded-2xl bg-gradient-to-br from-[#0a1628] to-[#1a2d4a] p-5">
        <p className="text-[10px] font-semibold text-white/40 uppercase tracking-widest mb-4">סיכום יום האימונים</p>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-3xl font-black text-[#c9a84c]">{athletes.length}</p>
            <p className="text-[11px] text-white/60 mt-1">ספורטאים</p>
          </div>
          <div className="text-center border-x border-white/10">
            <p className="text-3xl font-black text-emerald-400">{todayCompletedCount}</p>
            <p className="text-[11px] text-white/60 mt-1">הושלמו היום</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-black text-amber-400">{todayPendingCount}</p>
            <p className="text-[11px] text-white/60 mt-1">ממתינים</p>
          </div>
        </div>
        {todayStravaPendingCount > 0 && (
          <div className="mt-4 pt-3 border-t border-white/10 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#c9a84c] flex-shrink-0" />
            <p className="text-xs text-[#c9a84c] font-semibold">
              {todayStravaPendingCount} ספורטאים ממתינים למשוב על אימון Strava
            </p>
          </div>
        )}
      </div>

      {/* Athletes grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {athletes.map(athlete => {
          const athleteLogs = logs.filter(l => l.athleteId === athlete.id)
          const lastLog = [...athleteLogs].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))[0]
          const daysSinceLog = lastLog?.date ? differenceInDays(new Date(), new Date(lastLog.date)) : 99
          const isActive = daysSinceLog < 7
          const hasUnreadMsg = (unreadMessages[athlete.id] || 0) > 0

          const thisWeekAthlete = assignedWorkouts.filter(
            w => w.athleteId === athlete.id && w.scheduledDate >= thisWeekStart && w.scheduledDate <= thisWeekEnd
          )
          const weekDone = thisWeekAthlete.filter(w => w.status === 'completed').length
          const weekTotal = thisWeekAthlete.length

          const todayWorkout = assignedWorkouts.find(
            w => w.athleteId === athlete.id && w.scheduledDate === todayStr
          )

          const todayLog = todayWorkout
            ? (athleteLogs.find((l: any) => l.assignedWorkoutId === todayWorkout.id && l.source !== 'strava') ||
               athleteLogs.find((l: any) => l.date === todayStr && l.source !== 'strava' && l.actualDistance))
            : null

          const todayStravaLog = athleteLogs.find((l: any) => l.date === todayStr && l.source === 'strava') || null
          const todayStravaPending = todayStravaLog?.feedbackStatus === 'pending'

          let todayStatus: 'done' | 'strava-pending' | 'scheduled' | 'skipped' | 'rest' = 'rest'
          if (todayWorkout) {
            if (todayWorkout.status === 'completed' && todayStravaPending) todayStatus = 'strava-pending'
            else if (todayWorkout.status === 'completed') todayStatus = 'done'
            else if (todayWorkout.status === 'skipped') todayStatus = 'skipped'
            else todayStatus = 'scheduled'
          } else if (todayStravaPending) {
            todayStatus = 'strava-pending'
          }

          const yesterdayMissed = assignedWorkouts.find(
            w => w.athleteId === athlete.id &&
              w.scheduledDate === yesterdayStr &&
              w.status !== 'completed' &&
              w.status !== 'skipped'
          )

          const effectiveLog = todayLog || todayStravaLog
          const athleteAssignedWorkouts = assignedWorkouts.filter(w => w.athleteId === athlete.id)
          const isComposerOpen = openComposer === athlete.id
          const sent = messageSent === athlete.id

          return (
            <div
              key={athlete.id}
              className="rounded-2xl bg-card border border-border/20 shadow-sm hover:shadow-md hover:border-[#c9a84c]/30 transition-all overflow-hidden"
            >
              <div className="px-4 pt-4 pb-3 space-y-3">
                {/* Row 1: Avatar + Name + status badge */}
                <div className="flex items-center gap-3">
                  <Link href={`/coach/athletes/${athlete.id}/planner`} className="flex-shrink-0">
                    <div className="relative">
                      <Avatar className="h-11 w-11">
                        <AvatarImage src={athlete.photoURL} alt={athlete.name} />
                        <AvatarFallback className="bg-[#c9a84c]/10 text-[#c9a84c] text-sm font-bold">
                          {getInitials(athlete.name)}
                        </AvatarFallback>
                      </Avatar>
                      <span className={cn(
                        'absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white',
                        isActive ? 'bg-emerald-500' : 'bg-gray-300'
                      )} />
                    </div>
                  </Link>
                  <div className="flex-1 min-w-0">
                    <Link href={`/coach/athletes/${athlete.id}/planner`}>
                      <p className="font-bold text-[#0a1628] text-base leading-tight truncate hover:text-[#c9a84c] transition-colors">
                        {athlete.name}
                      </p>
                    </Link>
                    <div className="flex items-center gap-2 mt-0.5">
                      {weekTotal > 0 && (
                        <span className="text-xs text-muted-foreground">{weekDone}/{weekTotal} השבוע</span>
                      )}
                      {hasUnreadMsg && (
                        <span className="text-[10px] font-semibold text-blue-600 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-full">
                          הודעה חדשה
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Status badge */}
                  {todayStatus === 'done' && (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex-shrink-0">
                      <Check className="h-3 w-3" />בוצע
                    </span>
                  )}
                  {todayStatus === 'strava-pending' && (
                    <span className="text-[11px] font-bold text-[#c9a84c] bg-[#c9a84c]/10 border border-[#c9a84c]/30 px-2.5 py-1 rounded-full flex-shrink-0">
                      ממתין למשוב
                    </span>
                  )}
                  {todayStatus === 'scheduled' && (
                    <span className="flex items-center gap-1 text-[11px] font-bold text-gray-500 bg-gray-50 border border-gray-200 px-2.5 py-1 rounded-full flex-shrink-0">
                      <Clock className="h-3 w-3" />מתוכנן
                    </span>
                  )}
                  {todayStatus === 'skipped' && (
                    <span className="text-[11px] font-bold text-red-600 bg-red-50 border border-red-200 px-2.5 py-1 rounded-full flex-shrink-0">
                      לא בוצע
                    </span>
                  )}
                  {todayStatus === 'rest' && (
                    <span className="text-[11px] text-muted-foreground bg-muted/60 border border-border/40 px-2.5 py-1 rounded-full flex-shrink-0">
                      מנוחה
                    </span>
                  )}
                </div>

                {/* Today's workout block */}
                {todayWorkout ? (
                  <div className={cn(
                    'rounded-xl p-3 space-y-2',
                    todayStatus === 'done'           ? 'bg-emerald-50/60 border border-emerald-200/60' :
                    todayStatus === 'strava-pending' ? 'bg-amber-50/40 border border-[#c9a84c]/25' :
                    todayStatus === 'scheduled'      ? 'bg-gray-50 border border-gray-200/60' :
                    todayStatus === 'skipped'        ? 'bg-red-50/60 border border-red-200/60' :
                                                       'bg-muted/20 border border-border/30'
                  )}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-[#0a1628] truncate">{todayWorkout.workout?.title || 'אימון'}</p>
                        {todayWorkout.workout?.distance && (
                          <p className="text-[11px] text-muted-foreground mt-0.5">{todayWorkout.workout.distance} ק"מ מתוכנן</p>
                        )}
                      </div>
                    </div>
                    {/* Stats if completed */}
                    {(todayStatus === 'done' || todayStatus === 'strava-pending') && effectiveLog && (
                      <div className="flex flex-wrap gap-1.5">
                        {(effectiveLog as any).actualDistance && (
                          <span className="text-[10px] font-semibold bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                            {(effectiveLog as any).actualDistance} ק"מ
                          </span>
                        )}
                        {(effectiveLog as any).actualPace && (
                          <span className="text-[10px] font-semibold bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                            {(effectiveLog as any).actualPace}
                          </span>
                        )}
                        {(effectiveLog as any).effort != null && (
                          <span className="text-[10px] font-semibold bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                            מאמץ {(effectiveLog as any).effort}/10
                          </span>
                        )}
                        {todayStravaLog?.averageHeartRate && (
                          <span className="text-[10px] font-semibold bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-full">
                            {todayStravaLog.averageHeartRate} bpm
                          </span>
                        )}
                        {todayStravaLog?.elevationGain != null && todayStravaLog.elevationGain > 0 && (
                          <span className="text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded-full">
                            +{todayStravaLog.elevationGain}m
                          </span>
                        )}
                      </div>
                    )}
                    {(effectiveLog as any)?.comment && (
                      <p className="text-[10px] text-gray-500 italic line-clamp-1">
                        "{(effectiveLog as any).comment}"
                      </p>
                    )}
                  </div>
                ) : todayStravaLog ? (
                  /* No assigned workout but has Strava activity today */
                  <div className="rounded-xl p-3 bg-amber-50/40 border border-[#c9a84c]/25 space-y-2">
                    <div className="flex items-center gap-2">
                      <Activity className="h-3.5 w-3.5 text-[#FC4C02]" />
                      <p className="text-xs font-bold text-[#0a1628]">{todayStravaLog.stravaName || 'פעילות Strava'}</p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {todayStravaLog.actualDistance && (
                        <span className="text-[10px] font-semibold bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                          {todayStravaLog.actualDistance} ק"מ
                        </span>
                      )}
                      {todayStravaLog.actualPace && (
                        <span className="text-[10px] font-semibold bg-white border border-gray-200 px-2 py-0.5 rounded-full">
                          {todayStravaLog.actualPace}
                        </span>
                      )}
                      {todayStravaLog.averageHeartRate && (
                        <span className="text-[10px] font-semibold bg-red-50 text-red-600 border border-red-100 px-2 py-0.5 rounded-full">
                          {todayStravaLog.averageHeartRate} bpm
                        </span>
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Yesterday missed alert */}
                {yesterdayMissed && (
                  <div className="flex items-center gap-2 rounded-lg bg-red-50 border border-red-200/60 px-3 py-2">
                    <AlertTriangle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" />
                    <p className="text-[11px] text-red-700 font-medium">
                      לא סיים אימון אתמול: {yesterdayMissed.workout?.title}
                    </p>
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-2 pt-0.5">
                  <Link href={`/coach/athletes/${athlete.id}/planner`} className="flex-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full h-8 text-xs border-[#0a1628]/20 hover:border-[#0a1628]/50 hover:bg-[#0a1628]/5"
                    >
                      מרכז תכנון
                    </Button>
                  </Link>
                  {todayStatus === 'scheduled' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs border-amber-300 text-amber-700 hover:bg-amber-50 flex-shrink-0"
                      onClick={() => {
                        setOpenComposer(prev => prev === athlete.id ? null : athlete.id)
                        if (todayWorkout) setComposerWorkoutId(prev => ({ ...prev, [athlete.id]: todayWorkout.id }))
                      }}
                    >
                      שלח תזכורת
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 text-xs border-[#c9a84c]/30 hover:border-[#c9a84c]/60 hover:bg-[#c9a84c]/5 flex-shrink-0"
                    onClick={() => setOpenComposer(prev => prev === athlete.id ? null : athlete.id)}
                  >
                    <MessageCircle className="h-3.5 w-3.5 ml-1" />
                    הודעה
                  </Button>
                </div>
              </div>

              {/* Inline composer */}
              {isComposerOpen && (
                <div className="border-t border-border/40 bg-[#c9a84c]/5 px-4 py-3 space-y-2">
                  {sent ? (
                    <p className="text-xs font-semibold text-emerald-700 text-center py-1">ההודעה נשלחה!</p>
                  ) : (
                    <>
                      <Textarea
                        value={composerText[athlete.id] || ''}
                        onChange={e => setComposerText(prev => ({ ...prev, [athlete.id]: e.target.value }))}
                        placeholder="כתוב הודעה לספורטאי..."
                        className="text-xs min-h-[60px] bg-white border-border/60"
                        dir="rtl"
                      />
                      {athleteAssignedWorkouts.filter(w => w.scheduledDate >= todayStr).length > 0 && (
                        <select
                          value={composerWorkoutId[athlete.id] || ''}
                          onChange={e => setComposerWorkoutId(prev => ({ ...prev, [athlete.id]: e.target.value }))}
                          className="w-full text-xs rounded-lg border border-border/60 bg-white px-2 py-1.5"
                          dir="rtl"
                        >
                          <option value="">ללא קשר לאימון ספציפי</option>
                          {athleteAssignedWorkouts
                            .filter(w => w.scheduledDate >= todayStr)
                            .slice(0, 10)
                            .map(w => (
                              <option key={w.id} value={w.id}>
                                {w.scheduledDate} — {w.workout?.title}
                              </option>
                            ))}
                        </select>
                      )}
                      <Button
                        size="sm"
                        className="w-full h-8 text-xs bg-[#0a1628] text-white hover:bg-[#0a1628]/90"
                        onClick={() => handleSendMessage(athlete.id)}
                        disabled={sendingMessage || !composerText[athlete.id]?.trim()}
                      >
                        {sendingMessage && openComposer === athlete.id
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1" />
                          : <Send className="h-3.5 w-3.5 ml-1" />}
                        שלח
                      </Button>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Athletes without plan for next 7 days */}
      {athletesNoPlan.length > 0 && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CalendarPlus className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-bold text-amber-800">ספורטאים ללא תוכנית ל-7 הימים הבאים</p>
          </div>
          <div className="space-y-2">
            {athletesNoPlan.map(athlete => (
              <div
                key={athlete.id}
                className="flex items-center justify-between gap-3 bg-white rounded-xl px-3 py-2.5 border border-amber-100"
              >
                <div className="flex items-center gap-2.5">
                  <Avatar className="h-8 w-8">
                    <AvatarImage src={athlete.photoURL} alt={athlete.name} />
                    <AvatarFallback className="bg-[#c9a84c]/10 text-[#c9a84c] text-xs font-bold">
                      {getInitials(athlete.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-semibold text-[#0a1628]">{athlete.name}</p>
                    <p className="text-[11px] text-muted-foreground">אין תוכנית ל-7 ימים הבאים</p>
                  </div>
                </div>
                <Link href={`/coach/athletes/${athlete.id}/planner`}>
                  <Button size="sm" className="h-7 text-xs bg-[#0a1628] text-white hover:bg-[#0a1628]/90">
                    תכנן שבוע
                  </Button>
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Control center */}
      <div className="rounded-2xl bg-card border border-border/20 shadow-sm p-5 space-y-3">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">מרכז בקרה</p>
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
