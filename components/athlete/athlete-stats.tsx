'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { mockWeeklyStats, mockMonthlyStats, mockAthleteProfile } from '@/lib/mock-data'
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
import { Activity, Clock, Flame, Trophy } from 'lucide-react'

export function AthleteStats() {
  const weeklyStats = mockWeeklyStats
  const monthlyStats = mockMonthlyStats
  const profile = mockAthleteProfile

  // Calculate summary stats
  const totalDistance = weeklyStats.reduce((sum, w) => sum + w.totalDistance, 0)
  const totalWorkouts = weeklyStats.reduce((sum, w) => sum + w.workoutsCompleted, 0)
  const avgEffort = weeklyStats.reduce((sum, w) => sum + w.averageEffort, 0) / weeklyStats.length
  const totalHours = weeklyStats.reduce((sum, w) => sum + w.totalDuration, 0) / 60

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
          Statistics
        </h1>
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
                <p className="text-2xl font-bold text-navy">{totalDistance}</p>
                <p className="text-xs text-muted-foreground">Total km (8 weeks)</p>
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
                <p className="text-xs text-muted-foreground">Workouts completed</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <Tabs defaultValue="weekly" className="space-y-6">
        <TabsList>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
        </TabsList>

        <TabsContent value="weekly" className="space-y-6">
          {/* Weekly Distance Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Weekly Distance (km)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis 
                      dataKey="week" 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar 
                      dataKey="totalDistance" 
                      fill="oklch(0.75 0.12 85)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          {/* Weekly Effort Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Average Effort Level</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={weeklyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis 
                      dataKey="week" 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <YAxis 
                      domain={[0, 10]}
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
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
          {/* Monthly Distance Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Monthly Distance (km)</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={monthlyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis 
                      dataKey="month" 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
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

          {/* Monthly PRs Chart */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">PRs Achieved</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={monthlyStats}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis 
                      dataKey="month" 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <YAxis 
                      tick={{ fontSize: 12 }}
                      className="fill-muted-foreground"
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: '8px',
                      }}
                    />
                    <Bar 
                      dataKey="prsAchieved" 
                      fill="oklch(0.2 0.04 250)"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* PR Timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Recent Personal Records</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {profile.personalRecords.slice(0, 4).map((pr, index) => (
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
    </div>
  )
}
