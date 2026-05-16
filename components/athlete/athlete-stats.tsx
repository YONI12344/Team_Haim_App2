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
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">Statistics</h1>
        <p className="text-muted-foreground">
          Track your training progress and performance trends
        </p>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                <Activity className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-2xl font-bold text-navy">{totalDistance.toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">Total km</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                <Clock className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-2xl font-bold text-navy">{totalHours.toFixed(0)}</p>
                <p className="text-xs text-muted-foreground">Total hours</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                <Flame className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-2xl font-bold text-navy">{avgEffort.toFixed(1)}</p>
                <p className="text-xs text-muted-foreground">Avg effort (1-10)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-gold/10 flex items-center justify-center">
                <Trophy className="h-5 w-5 text-gold" />
              </div>
              <div>
                <p className="text-2xl font-bold text-navy">{totalWorkouts}</p>
                <p className="text-xs text-muted-foreground">Workouts logged</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      {logs.length === 0 && prs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">
              Log workouts to see your progress charts here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Tabs defaultValue="weekly" className="space-y-6">
          <TabsList>
            <TabsTrigger value="weekly">Weekly</TabsTrigger>
            <TabsTrigger value="monthly">Monthly</TabsTrigger>
          </TabsList>

          <TabsContent value="weekly" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Weekly Distance (km)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={weeklyStats}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="week" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                      <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                        }}
                      />
                      <Bar dataKey="totalDistance" fill="oklch(0.75 0.12 85)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Average Effort Level</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={weeklyStats}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="week" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                      <YAxis domain={[0, 10]} tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                        }}
                      />
                      <Line
                        type="monotone"
                        dataKey="averageEffort"
                        stroke="oklch(0.2 0.04 250)"
                        strokeWidth={2}
                        dot={{ fill: 'oklch(0.2 0.04 250)', r: 4 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="monthly" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Monthly Distance (km)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={monthlyStats}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                      <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                        }}
                      />
                      <Area
                        type="monotone"
                        dataKey="totalDistance"
                        stroke="oklch(0.75 0.12 85)"
                        fill="oklch(0.75 0.12 85 / 0.2)"
                        strokeWidth={2}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">PRs Achieved</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-[250px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyStats}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="month" tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                      <YAxis tick={{ fontSize: 12 }} className="fill-muted-foreground" />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'var(--card)',
                          border: '1px solid var(--border)',
                          borderRadius: '8px',
                        }}
                      />
                      <Bar dataKey="prsAchieved" fill="oklch(0.2 0.04 250)" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}

      {/* PR Timeline */}
      {prs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Recent Personal Records</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {prs.slice(0, 4).map((pr, index) => (
                <div
                  key={pr.id}
                  className="flex items-center gap-4 p-3 rounded-lg bg-muted/50"
                >
                  <div className="w-8 h-8 rounded-full bg-gold/10 flex items-center justify-center text-sm font-bold text-gold">
                    {index + 1}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-navy">{pr.event}</span>
                      <span className="font-mono font-bold text-navy">{pr.time}</span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {pr.competition || pr.location} - {new Date(pr.date).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
