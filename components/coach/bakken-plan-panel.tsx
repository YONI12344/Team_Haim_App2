'use client'

import { useState } from 'react'
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  doc,
  getDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { format, addDays, parseISO } from 'date-fns'
import { toast } from 'sonner'
import { Loader2, Sparkles } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useAuth } from '@/contexts/auth-context'
import { useLatestStepTest } from '@/hooks/useLatestStepTest'
import { buildCustomJourney, saveJourney } from '@/lib/journey'
import { interpolateAtLactate } from '@/lib/physiology'
import type { WorkoutType } from '@/lib/types'
import type { PlanAthleteContext, BlockStageInfo } from '@/lib/bakken/plan-prompt'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

interface BlockWorkoutOut {
  date: string
  session?: 'am' | 'pm' | 'other'
  type: string
  title: string
  description: string
  warmup?: string | null
  cooldown?: string | null
  notes?: string | null
  duration?: number | null
  distance?: number | null
  targetThresholdLevel?: 'T1' | 'T2' | 'T3' | null
  bakkenLactateMin?: number | null
  bakkenLactateMax?: number | null
  sets?: Array<{
    reps: number
    distanceMeters?: number | null
    durationSec?: number | null
    restBetweenReps?: string | null
    restAfterSet?: string | null
    notes?: string | null
  }>
}

interface BlockPlanOut {
  blockSummary: string
  workouts: BlockWorkoutOut[]
}

interface WeekAgg {
  totalPlanned: number
  totalActual: number
  completed: number
  skipped: number
  avgEffort: number | null
}

const BLOCK_DAYS = 14
const MAX_BLOCKS = 10 // safety cap: 20 weeks of upfront generation per click

const addDaysStr = (dateStr: string, n: number) => format(addDays(parseISO(dateStr), n), 'yyyy-MM-dd')
const dateMin = (a: string, b: string) => (a < b ? a : b)
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart

function pickWorkoutTypes(daysPerWeek: number | undefined, experienceLevel: string | undefined): WorkoutType[] {
  const types: WorkoutType[] = ['easy', 'long_run', 'tempo']
  const days = daysPerWeek ?? 4
  if (days >= 4) types.push('intervals')
  if (days >= 5) types.push('hill_repeats', 'threshold')
  if (experienceLevel === 'advanced' || experienceLevel === 'professional') types.push('fartlek')
  return types
}

/**
 * Full-season Bakken/Almgren plan generator. The season skeleton (base/
 * build/peak/taper/race_week, with dates and weekly volume) comes from
 * lib/journey.ts buildCustomJourney — deterministic, not AI — and is saved
 * as the athlete's normal JourneyDoc so the rest of the app (season view,
 * rest-week cadence, etc.) sees it exactly like any coach-built journey.
 * Day-by-day workout content is then filled in by calling the Bakken brain
 * once per ~14-day block, writing directly to workouts/assignedWorkouts —
 * no coach review step. The app's existing visibleWeeksAhead mechanism
 * (rolls forward every Saturday) is what keeps the athlete from seeing
 * past the first 2 weeks; nothing new was built for that part.
 */
export function BakkenPlanPanel({ athleteId }: { athleteId: string }) {
  const { user } = useAuth()
  const { steps: labSteps } = useLatestStepTest(athleteId)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [lastSummary, setLastSummary] = useState<string | null>(null)

  const buildWeekSummary = (
    recentAssigned: any[],
    logs: any[],
    today: Date,
    weekOffset: number,
  ): WeekAgg | null => {
    const from = format(addDays(today, -7 * (weekOffset + 1)), 'yyyy-MM-dd')
    const to = format(addDays(today, -7 * weekOffset), 'yyyy-MM-dd')
    const slice = recentAssigned.filter((w) => w.scheduledDate >= from && w.scheduledDate < to)
    if (slice.length === 0) return null
    const totalPlanned = slice.reduce((s, w) => s + (w.workout?.distance || 0), 0)
    let totalActual = 0
    let completed = 0
    let skipped = 0
    let effortSum = 0
    let effortCount = 0
    for (const w of slice) {
      const log = logs.find((l: any) => l.assignedWorkoutId === w.id)
      if (w.status === 'completed') completed++
      if (w.status === 'skipped') skipped++
      if (log?.actualDistance) totalActual += log.actualDistance
      if (log?.effort != null) {
        effortSum += log.effort
        effortCount++
      }
    }
    return {
      totalPlanned,
      totalActual,
      completed,
      skipped,
      avgEffort: effortCount ? Math.round((effortSum / effortCount) * 10) / 10 : null,
    }
  }

  const writeWorkout = async (w: BlockWorkoutOut) => {
    let targetOverride:
      | { paceMinSec: number; paceMaxSec: number; hrMin?: number; hrMax?: number }
      | undefined
    if (labSteps && labSteps.length >= 2 && w.bakkenLactateMin != null && w.bakkenLactateMax != null) {
      const atMin = interpolateAtLactate(labSteps, w.bakkenLactateMin)
      const atMax = interpolateAtLactate(labSteps, w.bakkenLactateMax)
      if (atMin && atMax) {
        const paceSecs = [atMin.paceSecPerKm, atMax.paceSecPerKm].sort((a, b) => a - b)
        targetOverride = {
          paceMinSec: paceSecs[0],
          paceMaxSec: paceSecs[1],
          ...(atMin.hr != null && atMax.hr != null
            ? { hrMin: Math.min(atMin.hr, atMax.hr), hrMax: Math.max(atMin.hr, atMax.hr) }
            : {}),
        }
      }
    }

    const workoutDoc = {
      title: w.title,
      type: w.type as WorkoutType,
      description: w.description || '',
      duration: w.duration ?? null,
      distance: w.distance ?? null,
      warmup: w.warmup ?? null,
      cooldown: w.cooldown ?? null,
      notes: w.notes ?? null,
      targetThresholdLevel: w.targetThresholdLevel ?? null,
      sets: (w.sets || []).map((s, i) => ({
        id: `s${i}`,
        reps: s.reps,
        distanceMeters: s.distanceMeters ?? null,
        durationSec: s.durationSec ?? null,
        restBetweenReps: s.restBetweenReps ?? null,
        restAfterSet: s.restAfterSet ?? null,
        notes: s.notes ?? null,
      })),
      createdBy: user!.id,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }
    const wRef = await addDoc(collection(db, 'workouts'), workoutDoc)

    await addDoc(collection(db, 'assignedWorkouts'), {
      workoutId: wRef.id,
      workout: { id: wRef.id, ...workoutDoc, createdAt: new Date(), updatedAt: new Date() },
      athleteId,
      assignedBy: user!.id,
      scheduledDate: w.date,
      status: 'scheduled',
      session: w.session || 'other',
      ...(targetOverride ? { targetOverride } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  }

  const generate = async () => {
    if (!user) return
    setLoading(true)
    setLastSummary(null)
    setProgress(null)
    try {
      const profileSnap = await getDoc(doc(db, 'users', athleteId))
      if (!profileSnap.exists()) {
        toast.error('Athlete profile not found')
        return
      }
      const profile = profileSnap.data() as any

      if (!profile.goalRaceDate) {
        toast.error('Set a goal race date for this athlete first (Coach View → Goal Race), then generate the Bakken season plan.')
        return
      }

      const today = new Date()

      const [assignedSnap, logsSnap] = await Promise.all([
        getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId))),
        getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId))),
      ])
      const assigned = assignedSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
      const logs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any))
      const cutoff = format(addDays(today, -21), 'yyyy-MM-dd')
      const recentAssigned = assigned
        .filter((w) => w.scheduledDate >= cutoff)
        .sort((a, b) => a.scheduledDate.localeCompare(b.scheduledDate))
      const recentWorkouts = recentAssigned.map((w) => {
        const log =
          logs.find((l: any) => l.assignedWorkoutId === w.id) ||
          logs.find((l: any) => l.workoutId === w.workoutId && l.date === w.scheduledDate)
        return {
          date: w.scheduledDate,
          title: w.workout?.title || '',
          type: w.workout?.type || '',
          status: w.status,
          plannedKm: w.workout?.distance ?? undefined,
          actualKm: log?.actualDistance ?? undefined,
          effort: log?.effort ?? null,
          comment: log?.comment || undefined,
        }
      })

      // 1. Deterministic season skeleton (not AI) — same logic the coach's
      // own journey builder uses.
      const currentWeeklyKm = profile.weeklyMileage || 30
      const peakWeeklyKm = profile.weeklyKmRange?.max || Math.round(currentWeeklyKm * 1.25)
      const journeyDoc = buildCustomJourney({
        startDate: format(today, 'yyyy-MM-dd'),
        goalRaceEvent: profile.goalRaceEvent || 'Goal Race',
        goalRaceDate: profile.goalRaceDate,
        goalRaceTarget: profile.goalRaceTarget,
        createdBy: user.id,
        currentWeeklyKm,
        peakWeeklyKm,
        workoutTypes: pickWorkoutTypes(profile.daysPerWeek, profile.experienceLevel),
      })
      await saveJourney(athleteId, journeyDoc)

      // 2. Split the season into ~14-day blocks, capped for cost/time.
      const blocks: { startDate: string; endDate: string }[] = []
      let cursor = journeyDoc.startDate
      while (cursor <= journeyDoc.goalRaceDate && blocks.length < MAX_BLOCKS) {
        const end = dateMin(addDaysStr(cursor, BLOCK_DAYS - 1), journeyDoc.goalRaceDate)
        blocks.push({ startDate: cursor, endDate: end })
        cursor = addDaysStr(end, 1)
      }

      const athleteContext: PlanAthleteContext = {
        name: profile.name || 'Athlete',
        experienceLevel: profile.experienceLevel,
        daysPerWeek: profile.daysPerWeek,
        weeklyMileage: profile.weeklyMileage,
        injuryHistory: profile.injuryHistory,
        goalRaceEvent: journeyDoc.goalRaceEvent,
        goalRaceDate: journeyDoc.goalRaceDate,
        goalRaceTarget: journeyDoc.goalRaceTarget,
        physiology: {
          hasLabTest: !!labSteps && labSteps.length >= 2,
          lt1PaceSec: profile.physiology?.lt1PaceSec ?? null,
          lt1Hr: profile.physiology?.lt1Hr ?? null,
          lt2PaceSec: profile.physiology?.lt2PaceSec ?? null,
          lt2Hr: profile.physiology?.lt2Hr ?? null,
          lt3PaceSec: profile.physiology?.lt3PaceSec ?? null,
          lt3Hr: profile.physiology?.lt3Hr ?? null,
          vo2maxEst: profile.physiology?.vo2maxEst ?? null,
          testDate: profile.physiology?.testDate,
        },
        last3WeeksSummary: {
          week1: buildWeekSummary(recentAssigned, logs, today, 2),
          week2: buildWeekSummary(recentAssigned, logs, today, 1),
          week3: buildWeekSummary(recentAssigned, logs, today, 0),
        },
        recentWorkouts,
        language: (profile.preferredLanguage as 'en' | 'he') || 'he',
      }

      // 3. Fill in each block from the Bakken brain, writing as we go.
      let previousBlockTail: Array<{ date: string; type: string; title: string }> | undefined
      let totalWritten = 0
      let firstBlockSummary: string | null = null

      for (let i = 0; i < blocks.length; i++) {
        setProgress(`Generating ${blocks[i].startDate} → ${blocks[i].endDate} (block ${i + 1}/${blocks.length})...`)

        const stagesForBlock: BlockStageInfo[] = journeyDoc.stages
          .filter((s) => overlaps(s.startDate, s.endDate, blocks[i].startDate, blocks[i].endDate))
          .map((s) => ({
            type: s.type,
            name: s.name,
            focus: s.focus,
            weeklyVolumeKm: s.weeklyVolumeKm,
            startDate: s.startDate,
            endDate: s.endDate,
          }))

        const res = await fetch('/api/bakken-coach/generate-plan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            athlete: athleteContext,
            block: {
              blockIndex: i,
              totalBlocks: blocks.length,
              startDate: blocks[i].startDate,
              endDate: blocks[i].endDate,
              stages: stagesForBlock,
              previousBlockTail,
            },
          }),
        })
        const data = await res.json()
        if (data.error) {
          toast.error(`Block ${i + 1} failed: ${data.error}. ${totalWritten} workouts from earlier blocks are already saved.`)
          break
        }
        const plan: BlockPlanOut = data.plan
        if (i === 0) firstBlockSummary = plan.blockSummary

        for (const w of plan.workouts) {
          if (w.type === 'rest') continue
          await writeWorkout(w)
          totalWritten++
        }

        previousBlockTail = plan.workouts
          .filter((w) => w.type !== 'rest')
          .slice(-3)
          .map((w) => ({ date: w.date, type: w.type, title: w.title }))
      }

      // 4. The app's existing rolling-visibility window (default 2 weeks,
      // rolls every Saturday — components/athlete/athlete-dashboard.tsx)
      // is what actually hides the rest of the season from the athlete.
      await updateDoc(doc(db, 'users', athleteId), {
        visibleWeeksAhead: 2,
        bakkenPlanGeneratedAt: serverTimestamp(),
      })

      setLastSummary(
        `${journeyDoc.stages.length} phases through ${journeyDoc.goalRaceDate}, ${blocks.length} blocks, ${totalWritten} workouts written. Athlete sees the first 2 weeks; the rest reveals automatically each Saturday.\n\n${firstBlockSummary ?? ''}`,
      )
      toast.success(`Bakken season plan written: ${totalWritten} workouts`)
    } catch (e) {
      console.error('Bakken plan generation failed:', e)
      toast.error('Failed to generate Bakken AI plan')
    } finally {
      setLoading(false)
      setProgress(null)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4" /> Bakken AI Coach
        </CardTitle>
        <CardDescription>
          Builds the athlete&apos;s full season upfront — phase skeleton from their goal race, day-by-day
          workouts from the Bakken/Almgren brain, lab-derived pace/HR targets. Writes directly to the
          planner. The athlete only sees the first 2 weeks; the rest reveals automatically every Saturday.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Button onClick={generate} disabled={loading}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          Generate full season
        </Button>
        {progress && <div className="text-sm text-muted-foreground">{progress}</div>}
        {lastSummary && (
          <div className="text-sm text-muted-foreground border-t pt-4 whitespace-pre-wrap">{lastSummary}</div>
        )}
      </CardContent>
    </Card>
  )
}
