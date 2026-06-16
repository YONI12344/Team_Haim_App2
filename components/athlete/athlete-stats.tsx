'use client'

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
} from 'recharts'
import { Activity, Clock, Flame, Loader2, Trophy } from 'lucide-react'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import {
  format,
  startOfWeek,
  startOfMonth,
  parseISO,
} from 'date-fns'
import type { PersonalRecord, WorkoutLog } from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'

function effortToScore(effort: WorkoutLog['effort']): number {
  // `effort` is now numeric (1–10). `legacyEffortToNumber` also handles older
  // string values that may still exist in Firestore for back-compat.
  return legacyEffortToNumber(effort)
}

interface BucketStats {
  key: string
  label: string
  totalDistance: number
  totalDuration: number
  workoutsCompleted: number
  averageEffort: number
  prsAchieved: number
}

function bucketBy(
  logs: WorkoutLog[],
  prs: PersonalRecord[],
  mode: 'week' | 'month',
): BucketStats[] {
  const map = new Map<string, BucketStats>()
  for (const log of logs) {
    if (!log.date) continue
    const date = parseISO(log.date)
    const bucketDate =
      mode === 'week'
        ? startOfWeek(date, { weekStartsOn: 1 })
        : startOfMonth(date)
    const key = bucketDate.toISOString().slice(0, 10)
    const label =
      mode === 'week' ? format(bucketDate, 'MMM d') : format(bucketDate, 'MMM yyyy')
    const cur = map.get(key) || {
      key,
      label,
      totalDistance: 0,
      totalDuration: 0,
      workoutsCompleted: 0,
      averageEffort: 0,
      prsAchieved: 0,
    }
    cur.totalDistance += log.actualDistance || 0
    cur.workoutsCompleted += 1
    cur.averageEffort += effortToScore(log.effort)
    map.set(key, cur)
  }
  for (const pr of prs) {
    if (!pr.date) continue
    const date = new Date(pr.date)
    const bucketDate =
      mode === 'week'
        ? startOfWeek(date, { weekStartsOn: 1 })
        : startOfMonth(date)
    const key = bucketDate.toISOString().slice(0, 10)
    const label =
      mode === 'week' ? format(bucketDate, 'MMM d') : format(bucketDate, 'MMM yyyy')
    const cur = map.get(key) || {
      key,
      label,
      totalDistance: 0,
      totalDuration: 0,
      workoutsCompleted: 0,
      averageEffort: 0,
      prsAchieved: 0,
    }
    cur.prsAchieved += 1
    map.set(key, cur)
  }
  const buckets = [...map.values()].sort((a, b) => a.key.localeCompare(b.key))
  for (const b of buckets) {
    if (b.workoutsCompleted > 0) b.averageEffort = b.averageEffort / b.workoutsCompleted
  }
  return buckets
}

export function AthleteStats() {
  const { user } = useAuth()
  const { t } = useLanguage()
  const [logs, setLogs] = useState<WorkoutLog[]>([])
  const [prs, setPrs] = useState<PersonalRecord[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    const load = async () => {
      setLoading(true)
      try {
        const lg = await getDocs(
          query(collection(db, 'logs'), where('athleteId', '==', user.id)),
        )
        setLogs(
          lg.docs.map((d) => {
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
              createdAt: data.createdAt?.toDate?.() || new Date(),
            }
          }),
        )
      } catch (err) {
        console.error('Error loading logs:', err)
        setLogs([])
      }
      try {
        const profileSnap = await getDoc(doc(db, 'users', user.id))
        if (profileSnap.exists()) {
          const data = profileSnap.data()
          setPrs(Array.isArray(data.personalRecords) ? data.personalRecords : [])
        } else {
          setPrs([])
        }
      } catch (err) {
        console.error('Error loading PRs:', err)
        setPrs([])
      }
      setLoading(false)
    }
    load()
  }, [user?.id])

  const weeklyStats = useMemo(() => bucketBy(logs, prs, 'week').map((b) => ({ ...b, week: b.label })), [logs, prs])
  const monthlyStats = useMemo(() => bucketBy(logs, prs, 'month').map((b) => ({ ...b, month: b.label })), [logs, prs])

  const totalDistance = logs.reduce((s, l) => s + (l.actualDistance || 0), 0)
  const totalWorkouts = logs.length
  const avgEffort = logs.length
    ? logs.reduce((s, l) => s + effortToScore(l.effort), 0) / logs.length
    : 0
  const totalHours = 0 // Total hours not tracked in logs yet

  if (loading) {
    return (
      <div className="space-y-4 pb-24 animate-pulse" dir="rtl">
        <div className="h-8 w-40 bg-gray-200 rounded-xl" />
        <div className="grid grid-cols-2 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="bg-gray-100 rounded-2xl h-24" />)}
        </div>
        <div className="bg-gray-100 rounded-3xl h-64" />
        <div className="bg-gray-100 rounded-3xl h-48" />
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24" dir="rtl">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-[#0a1628]">{t.statisticsTitle}</h1>
        <p className="text-gray-500 text-sm">{t.statisticsSubtitle}</p>
      </div>

      {/* Summary Cards 2×2 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="w-9 h-9 rounded-xl bg-[#0a1628]/5 flex items-center justify-center mb-3">
            <Activity className="h-4 w-4 text-[#0a1628]" />
          </div>
          <p className="text-3xl font-black text-[#0a1628] leading-none">{totalDistance.toFixed(0)}</p>
          <p className="text-xs text-gray-400 mt-1.5">{t.totalKm}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="w-9 h-9 rounded-xl bg-[#0a1628]/5 flex items-center justify-center mb-3">
            <Clock className="h-4 w-4 text-[#0a1628]" />
          </div>
          <p className="text-3xl font-black text-[#0a1628] leading-none">{totalHours.toFixed(0)}</p>
          <p className="text-xs text-gray-400 mt-1.5">{t.totalHours}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="w-9 h-9 rounded-xl bg-[#0a1628]/5 flex items-center justify-center mb-3">
            <Flame className="h-4 w-4 text-[#0a1628]" />
          </div>
          <p className="text-3xl font-black text-[#0a1628] leading-none">{avgEffort.toFixed(1)}</p>
          <p className="text-xs text-gray-400 mt-1.5">{t.avgEffortStat}</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="w-9 h-9 rounded-xl bg-[#0a1628]/5 flex items-center justify-center mb-3">
            <Trophy className="h-4 w-4 text-[#c9a84c]" />
          </div>
          <p className="text-3xl font-black text-[#0a1628] leading-none">{totalWorkouts}</p>
          <p className="text-xs text-gray-400 mt-1.5">{t.workoutsLoggedStat}</p>
        </div>
      </div>

      {/* Charts */}
      {logs.length === 0 && prs.length === 0 ? (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center">
          <p className="text-gray-400">{t.logToSeeCharts}</p>
        </div>
      ) : (
        <Tabs defaultValue="weekly" className="space-y-4">
          <TabsList className="bg-white border border-gray-100 rounded-2xl p-1 w-full grid grid-cols-2 shadow-sm h-auto">
            <TabsTrigger value="weekly" className="rounded-xl data-[state=active]:bg-[#0a1628] data-[state=active]:text-white data-[state=active]:shadow-none text-gray-500 font-semibold py-2.5">{t.weeklyTab}</TabsTrigger>
            <TabsTrigger value="monthly" className="rounded-xl data-[state=active]:bg-[#0a1628] data-[state=active]:text-white data-[state=active]:shadow-none text-gray-500 font-semibold py-2.5">{t.monthlyTab}</TabsTrigger>
          </TabsList>

          <TabsContent value="weekly" className="space-y-4">
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
              <p className="text-sm font-bold text-[#0a1628] mb-4">{t.weeklyDistance}</p>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #f0f0f0', borderRadius: '12px' }} />
                    <Bar dataKey="totalDistance" fill="#c9a84c" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
              <p className="text-sm font-bold text-[#0a1628] mb-4">{t.averageEffortLevel}</p>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="week" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <YAxis domain={[0, 10]} tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #f0f0f0', borderRadius: '12px' }} />
                    <Line type="monotone" dataKey="averageEffort" stroke="#0a1628" strokeWidth={2} dot={{ fill: '#0a1628', r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>

          <TabsContent value="monthly" className="space-y-4">
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
              <p className="text-sm font-bold text-[#0a1628] mb-4">{t.monthlyDistance}</p>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #f0f0f0', borderRadius: '12px' }} />
                    <Area type="monotone" dataKey="totalDistance" stroke="#c9a84c" fill="#c9a84c33" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
              <p className="text-sm font-bold text-[#0a1628] mb-4">{t.prsAchievedChart}</p>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyStats}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #f0f0f0', borderRadius: '12px' }} />
                    <Bar dataKey="prsAchieved" fill="#0a1628" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      )}

      {/* PR Timeline */}
      {prs.length > 0 && (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
          <p className="text-sm font-bold text-[#0a1628] mb-4">{t.recentPersonalRecords}</p>
          <div className="space-y-3">
            {prs.slice(0, 4).map((pr, index) => (
              <div key={pr.id} className="flex items-center gap-4 py-3 border-b border-gray-50 last:border-0">
                <div className="w-8 h-8 rounded-full bg-[#c9a84c]/10 flex items-center justify-center text-sm font-black text-[#c9a84c] flex-shrink-0">
                  {index + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-[#0a1628] text-sm">{pr.event}</span>
                    <span className="font-mono font-black text-[#0a1628]">{pr.time}</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-0.5 truncate">
                    {pr.competition || pr.location} · {new Date(pr.date).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
