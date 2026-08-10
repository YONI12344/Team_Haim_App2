'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { Loader2, ChevronLeft, Dumbbell, Trophy } from 'lucide-react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { ExerciseLogEntry } from '@/lib/types'

interface ExerciseGroup {
  exerciseId: string
  exerciseName: string
  logs: ExerciseLogEntry[]
  personalBest: number | null
  lastDate: string
}

function loadLogs(uid: string): Promise<ExerciseLogEntry[]> {
  return getDocs(query(collection(db, 'exerciseLogs'), where('athleteId', '==', uid))).then((snap) =>
    snap.docs.map((d) => {
      const data = d.data()
      return {
        id: d.id,
        athleteId: data.athleteId,
        exerciseId: data.exerciseId,
        exerciseName: data.exerciseName || 'תרגיל',
        assignedWorkoutId: data.assignedWorkoutId,
        workoutDate: data.workoutDate || '',
        sets: Array.isArray(data.sets) ? data.sets : [],
        maxWeightKg: data.maxWeightKg ?? null,
        createdAt: data.createdAt?.toDate?.() || new Date(),
        updatedAt: data.updatedAt?.toDate?.() || new Date(),
      } as ExerciseLogEntry
    }),
  )
}

export function AthleteExerciseProgress() {
  const { user } = useAuth()
  const [logs, setLogs] = useState<ExerciseLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedExerciseId, setSelectedExerciseId] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    loadLogs(user.id)
      .then(setLogs)
      .catch((err) => {
        console.error('Error loading exercise logs:', err)
        setLogs([])
      })
      .finally(() => setLoading(false))
  }, [user?.id])

  const groups = useMemo<ExerciseGroup[]>(() => {
    const map = new Map<string, ExerciseGroup>()
    for (const log of logs) {
      const existing = map.get(log.exerciseId)
      if (existing) {
        existing.logs.push(log)
      } else {
        map.set(log.exerciseId, {
          exerciseId: log.exerciseId,
          exerciseName: log.exerciseName,
          logs: [log],
          personalBest: null,
          lastDate: log.workoutDate,
        })
      }
    }
    for (const group of map.values()) {
      group.logs.sort((a, b) => a.workoutDate.localeCompare(b.workoutDate))
      const weights = group.logs.map((l) => l.maxWeightKg).filter((w): w is number => typeof w === 'number')
      group.personalBest = weights.length ? Math.max(...weights) : null
      group.lastDate = group.logs[group.logs.length - 1]?.workoutDate || ''
    }
    return [...map.values()].sort((a, b) => b.lastDate.localeCompare(a.lastDate))
  }, [logs])

  const selectedGroup = groups.find((g) => g.exerciseId === selectedExerciseId) || null

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <Loader2 className="h-8 w-8 animate-spin text-[#c9a84c]" />
      </div>
    )
  }

  if (selectedGroup) {
    const chartData = selectedGroup.logs.map((l) => ({
      date: new Date(l.workoutDate).toLocaleDateString('he-IL', { day: 'numeric', month: 'short' }),
      weight: l.maxWeightKg ?? 0,
    }))
    return (
      <div className="space-y-4 pb-24" dir="rtl">
        <button
          type="button"
          onClick={() => setSelectedExerciseId(null)}
          className="flex items-center gap-1 text-sm text-gray-500"
        >
          <ChevronLeft className="h-4 w-4" />חזרה
        </button>

        <div>
          <h1 className="text-xl font-serif font-bold text-[#0a1628]">{selectedGroup.exerciseName}</h1>
          {selectedGroup.personalBest != null && (
            <p className="text-sm text-gray-500 flex items-center gap-1 mt-1">
              <Trophy className="h-3.5 w-3.5 text-[#c9a84c]" />
              שיא אישי: {selectedGroup.personalBest} ק&quot;ג
            </p>
          )}
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
          <div className="h-[260px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="date" tick={{ fontSize: 11, fill: '#9ca3af' }} />
                <YAxis tick={{ fontSize: 11, fill: '#9ca3af' }} domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #f0f0f0', borderRadius: '12px' }} />
                <Line type="monotone" dataKey="weight" stroke="#c9a84c" strokeWidth={2} dot={{ fill: '#c9a84c', r: 4 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
          <p className="text-sm font-bold text-[#0a1628] mb-4">היסטוריית אימונים</p>
          <div className="space-y-3">
            {[...selectedGroup.logs].reverse().map((log) => (
              <div key={log.id} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                <span className="text-sm text-gray-500">{new Date(log.workoutDate).toLocaleDateString('he-IL')}</span>
                <span className="text-sm font-medium text-[#0a1628]">
                  {log.sets.map((s) => (s.weightKg != null ? `${s.weightKg}` : '—')).join(' / ')} ק&quot;ג
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4 pb-24" dir="rtl">
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-[#0a1628]">התקדמות בכוח</h1>
        <p className="text-gray-500 text-sm">משקלים והתקדמות לפי תרגיל</p>
      </div>

      {groups.length === 0 ? (
        <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-12 text-center">
          <Dumbbell className="h-8 w-8 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400">עדיין אין נתונים — סיימו אימון כוח דרך מצב אימון כדי לראות כאן התקדמות</p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <button
              key={group.exerciseId}
              type="button"
              onClick={() => setSelectedExerciseId(group.exerciseId)}
              className="w-full bg-white rounded-2xl shadow-sm border border-gray-100 p-4 flex items-center justify-between text-right"
            >
              <div>
                <p className="font-bold text-[#0a1628] text-sm">{group.exerciseName}</p>
                <p className="text-xs text-gray-400 mt-1">
                  {group.logs.length} אימונים · עודכן {new Date(group.lastDate).toLocaleDateString('he-IL')}
                </p>
              </div>
              {group.personalBest != null && (
                <div className="text-left">
                  <p className="text-lg font-black text-[#c9a84c] leading-none">{group.personalBest}</p>
                  <p className="text-[10px] text-gray-400 mt-1">ק&quot;ג שיא</p>
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
