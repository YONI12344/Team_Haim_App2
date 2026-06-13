'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { format, isToday, parseISO, startOfWeek, endOfWeek, addDays, differenceInDays } from 'date-fns'
import {
  Users,
  Dumbbell,
  MessageCircle,
  ChevronRight,
  Activity,
  Check,
  Loader2,
  Send,
  Settings,
} from 'lucide-react'
import Link from 'next/link'
import {
  collection, getDocs, query, where, orderBy, limit,
  addDoc, serverTimestamp,
  DocumentData, QueryDocumentSnapshot,
} from 'firebase/firestore'

import { db, realtimeDb } from '@/lib/firebase'
import { ref, onValue, query as rtQuery, orderByChild, limitToLast } from 'firebase/database'
import { useAuth } from '@/contexts/auth-context'
import type { AthleteProfile, Workout, AssignedWorkout } from '@/lib/types'
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
  const workoutTypeLabels = useWorkoutTypeLabels()
  const { user } = useAuth()
  const [totalUnread, setTotalUnread] = useState(0)
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
    let unsubs: (() => void)[] = []
    const counts: Record<string, number> = {}
    athletes.forEach(athlete => {
      const chatId = `${user.id}_${athlete.id}`
      const lastReadKey = `lastRead_${chatId}_${user.id}`
      const lastRead = parseInt(localStorage.getItem(lastReadKey) || '0')
      const msgsRef = ref(realtimeDb, `conversations/${chatId}/messages`)
      const msgsQuery = rtQuery(msgsRef, orderByChild('timestamp'), limitToLast(20))
      const unsub = onValue(msgsQuery, (snapshot) => {
        let count = 0
        snapshot.forEach((child) => {
          const msg = child.val()
          if (msg.senderId !== user.id && msg.timestamp > lastRead) count++
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
      try {
        const athletesSnap = await getDocs(
          query(collection(db, 'users'), where('role', '==', 'athlete'))
        )
        setAthletes(athletesSnap.docs.map(mapDocToAthlete))
      } catch { setAthletes([]) }

      try {
        const assignedSnap = await getDocs(
          query(collection(db, 'assignedWorkouts'), orderBy('scheduledDate', 'asc'))
        )
        setAssignedWorkouts(
          assignedSnap.docs.map((d) => ({ ...(d.data() as AssignedWorkout), id: d.id }))
        )
      } catch { setAssignedWorkouts([]) }

      try {
        const logsSnap = await getDocs(collection(db, 'logs'))
        setLogs(logsSnap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch { setLogs([]) }

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
      } catch { setUnreadMessages({}) }

      setLoading(false)
    }
    loadData()
  }, [])

  const getInitials = (name: string | undefined | null) => {
    const safeName = name || '?'
    return safeName.split(' ').map((n) => n[0] || '').join('').toUpperCase().slice(0, 2) || '?'
  }

  const todayStr = format(new Date(), 'yyyy-MM-dd')
  const thisWeekStart = format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const thisWeekEnd = format(endOfWeek(new Date(), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const nextWeekStart = format(addDays(new Date(thisWeekEnd), 1), 'yyyy-MM-dd')
  const nextWeekEnd = format(addDays(new Date(thisWeekEnd), 7), 'yyyy-MM-dd')
  const sevenDaysAgo = format(addDays(new Date(), -7), 'yyyy-MM-dd')
  const fiveDaysAgo = format(addDays(new Date(), -5), 'yyyy-MM-dd')

  const completedThisWeekAll = assignedWorkouts.filter(
    w => w.status === 'completed' && w.scheduledDate >= thisWeekStart && w.scheduledDate <= thisWeekEnd
  )
  const totalKmThisWeek = completedThisWeekAll.reduce((s, w) => s + (w.workout?.distance || 0), 0)

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
      setComposerText(prev => ({ ...prev, [athleteId]: '' }))
      setComposerWorkoutId(prev => ({ ...prev, [athleteId]: '' }))
      setMessageSent(athleteId)
      setTimeout(() => {
        setMessageSent(null)
        setOpenComposer(null)
      }, 1800)
    } catch {}
    setSendingMessage(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">לוח בקרה</h1>
        <p className="text-sm text-muted-foreground">{format(new Date(), 'EEEE, d MMMM yyyy')}</p>
      </div>

      {/* Athletes grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {athletes.map(athlete => {
          // Compute per-athlete data
          const athleteLogs = logs.filter(l => l.athleteId === athlete.id)
          const sortedLogs = [...athleteLogs].sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
          const lastLog = sortedLogs[0]
          const lastLogDate = lastLog?.date || null
          const daysSinceLog = lastLogDate
            ? differenceInDays(new Date(), new Date(lastLogDate))
            : 99

          const isActive = lastLogDate ? lastLogDate >= sevenDaysAgo : false
          const hasUnreadMsg = (unreadMessages[athlete.id] || 0) > 0

          const thisWeekAthlete = assignedWorkouts.filter(
            w => w.athleteId === athlete.id && w.scheduledDate >= thisWeekStart && w.scheduledDate <= thisWeekEnd
          )
          const weekDone = thisWeekAthlete.filter(w => w.status === 'completed').length
          const weekTotal = thisWeekAthlete.length

          const nextWeekAthlete = assignedWorkouts.filter(
            w => w.athleteId === athlete.id && w.scheduledDate >= nextWeekStart && w.scheduledDate <= nextWeekEnd
          )
          const hasNextWeekPlan = nextWeekAthlete.length > 0

          const futureWeeks = assignedWorkouts.filter(
            w => w.athleteId === athlete.id && w.scheduledDate > todayStr
          )
          const futureWeekCount = new Set(
            futureWeeks.map(w => format(startOfWeek(parseISO(w.scheduledDate), { weekStartsOn: 1 }), 'yyyy-MM-dd'))
          ).size

          const todayWorkout = assignedWorkouts.find(
            w => w.athleteId === athlete.id && w.scheduledDate === todayStr
          )

          const athleteAssignedWorkouts = assignedWorkouts.filter(w => w.athleteId === athlete.id)
          const isComposerOpen = openComposer === athlete.id
          const sent = messageSent === athlete.id

          return (
            <div
              key={athlete.id}
              className="rounded-2xl bg-card border border-border/20 shadow-sm hover:shadow-md hover:border-gold/30 transition-all p-4 space-y-3"
            >
              {/* Row 1: Avatar + Name + status dot */}
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <Avatar className="h-11 w-11">
                    <AvatarImage src={athlete.photoURL} alt={athlete.name} />
                    <AvatarFallback className="bg-gold/10 text-gold text-sm font-bold">
                      {getInitials(athlete.name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-white ${isActive ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-navy text-base leading-tight truncate">{athlete.name}</p>
                  <p className="text-xs text-muted-foreground">{isActive ? 'פעיל לאחרונה' : 'לא פעיל'}</p>
                </div>
              </div>

              {/* Row 2: Stat pills */}
              <div className="flex gap-2 flex-wrap">
                <span className="text-xs bg-muted/60 border border-border/40 rounded-full px-2.5 py-1">
                  {futureWeekCount} שבועות מתוכננים
                </span>
                <span className="text-xs bg-muted/60 border border-border/40 rounded-full px-2.5 py-1">
                  {weekTotal > 0 ? `${weekDone}/${weekTotal} השבוע` : 'אין אימונים השבוע'}
                </span>
                <span className="text-xs bg-muted/60 border border-border/40 rounded-full px-2.5 py-1">
                  {daysSinceLog < 99 ? `${daysSinceLog} ימים מאז לוג אחרון` : 'אין לוגים'}
                </span>
              </div>

              {/* Row 3: Alert badges */}
              <div className="flex flex-wrap gap-1.5">
                {!hasNextWeekPlan && (
                  <Badge className="bg-red-50 text-red-600 border-red-200 border text-[10px] px-2 py-0.5 font-medium">
                    ללא תוכנית לשבוע הבא
                  </Badge>
                )}
                {daysSinceLog >= 5 && (
                  <Badge className="bg-amber-50 text-amber-700 border-amber-200 border text-[10px] px-2 py-0.5 font-medium">
                    לא העלה אימון 5+ ימים
                  </Badge>
                )}
                {hasUnreadMsg && (
                  <Badge className="bg-blue-50 text-blue-700 border-blue-200 border text-[10px] px-2 py-0.5 font-medium">
                    הודעה שלא נקראה
                  </Badge>
                )}
              </div>

              {/* Row 4: Action buttons */}
              <div className="flex gap-2">
                <Link href={`/coach/athletes/${athlete.id}/planner`} className="flex-1">
                  <Button variant="outline" size="sm" className="w-full h-8 text-xs border-navy/20 hover:border-navy/50 hover:bg-navy/5">
                    מרכז תכנון
                    <ChevronRight className="h-3 w-3 mr-1" />
                  </Button>
                </Link>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs border-gold/30 hover:border-gold/60 hover:bg-gold/5 flex-shrink-0"
                  onClick={() => setOpenComposer(prev => prev === athlete.id ? null : athlete.id)}
                >
                  <MessageCircle className="h-3.5 w-3.5 ml-1" />
                  שלח הודעה
                </Button>
              </div>

              {/* Row 5: Today's workout */}
              {todayWorkout ? (
                <div className={`rounded-xl px-3 py-2 flex items-center justify-between gap-2 ${
                  todayWorkout.status === 'completed'
                    ? 'bg-emerald-50 border border-emerald-200'
                    : 'bg-muted/30 border border-border/40'
                }`}>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-navy truncate">{todayWorkout.workout?.title}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {workoutTypeLabels[todayWorkout.workout?.type] || todayWorkout.workout?.type}
                      {todayWorkout.workout?.distance ? ` · ${todayWorkout.workout.distance}ק"מ` : ''}
                    </p>
                  </div>
                  {todayWorkout.status === 'completed' ? (
                    <span className="text-[10px] font-bold text-emerald-600 flex-shrink-0 flex items-center gap-1">
                      <Check className="h-3 w-3" />
                      הושלם
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground flex-shrink-0">טרם דווח</span>
                  )}
                </div>
              ) : (
                <div className="rounded-xl px-3 py-2 bg-muted/20 border border-border/30">
                  <p className="text-[10px] text-muted-foreground text-center">מנוחה היום</p>
                </div>
              )}

              {/* Inline composer */}
              {isComposerOpen && (
                <div className="rounded-xl border border-gold/30 bg-gold/5 p-3 space-y-2">
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
                        className="w-full h-8 text-xs bg-navy text-white hover:bg-navy/90"
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

      {/* Control center */}
      <div className="rounded-2xl bg-card border border-border/20 shadow-sm p-5 space-y-4">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">מרכז בקרה</p>
        <div className="grid grid-cols-3 gap-3">
          <div className="text-center">
            <p className="text-2xl font-bold text-emerald-600">{completedThisWeekAll.length}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">אימונים הושלמו השבוע</p>
          </div>
          <div className="text-center border-x border-border/40">
            <p className="text-2xl font-bold text-gold">{totalKmThisWeek.toFixed(0)}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">ק"מ כלל הספורטאים</p>
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-navy">{athletes.length}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">ספורטאים פעילים</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Link href="/coach/workouts">
            <Button variant="outline" size="sm" className="w-full h-9 text-xs border-navy/20 hover:border-navy/40">
              <Dumbbell className="h-3.5 w-3.5 ml-1.5" />
              ספריית אימונים
            </Button>
          </Link>
          <Link href="/coach/settings">
            <Button variant="outline" size="sm" className="w-full h-9 text-xs border-navy/20 hover:border-navy/40">
              <Settings className="h-3.5 w-3.5 ml-1.5" />
              הגדרות
            </Button>
          </Link>
        </div>
      </div>
    </div>
  )
}
