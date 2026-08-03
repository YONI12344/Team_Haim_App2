'use client'

import { useState, useEffect } from 'react'
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
import { saveJourney } from '@/lib/journey'
import { interpolateAtLactate } from '@/lib/physiology'
import type { WorkoutType, JourneyDoc, JourneyStage } from '@/lib/types'
import type { PlanAthleteContext, BlockStageInfo, SkeletonRequest, SkeletonOut } from '@/lib/bakken/plan-prompt'
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
  comparisonGroup?: string | null
  thresholdDistance?: number | null
  sets?: Array<{
    reps: number
    distanceMeters?: number | null
    durationSec?: number | null
    restBetweenReps?: string | null
    restAfterSet?: string | null
    notes?: string | null
    intervals?: Array<{
      distanceMeters?: number | null
      durationSec?: number | null
      notes?: string | null
    }>
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

type DayKey = 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
type DayType = 'workout' | 'rest' | 'off'
const DAY_ORDER: DayKey[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DAY_TYPES: DayType[] = ['workout', 'rest', 'off']
const DAY_LABELS: Record<'en' | 'he', Record<DayKey, string>> = {
  en: { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' },
  he: { sunday: 'א׳', monday: 'ב׳', tuesday: 'ג׳', wednesday: 'ד׳', thursday: 'ה׳', friday: 'ו׳', saturday: 'ש׳' },
}
const DAY_TYPE_LABELS: Record<'en' | 'he', Record<DayType, string>> = {
  en: { workout: 'Available', rest: 'Rest day', off: "Can't run" },
  he: { workout: 'זמין', rest: 'יום מנוחה', off: 'לא זמין' },
}
const DEFAULT_WEEK_SCHEDULE: Record<DayKey, DayType> = {
  sunday: 'workout', monday: 'workout', tuesday: 'workout', wednesday: 'workout',
  thursday: 'workout', friday: 'rest', saturday: 'workout',
}

type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'professional'
type RaceDistance = '5k' | '10k' | 'half_marathon' | 'marathon'
const EXPERIENCE_LEVELS: ExperienceLevel[] = ['beginner', 'intermediate', 'advanced', 'professional']
const MILEAGE_PRESETS = [15, 25, 35, 45, 55, 65, 80]
const RACE_DISTANCES: RaceDistance[] = ['5k', '10k', 'half_marathon', 'marathon']
const RACE_DISTANCE_LABELS: Record<RaceDistance, string> = {
  '5k': '5K', '10k': '10K', half_marathon: 'Half Marathon', marathon: 'Marathon',
}
const GOAL_TIME_PRESETS: Record<RaceDistance, string[]> = {
  '5k': ['16:00', '18:00', '20:00', '22:00', '25:00', '28:00', '32:00'],
  '10k': ['34:00', '38:00', '42:00', '46:00', '50:00', '55:00', '60:00'],
  half_marathon: ['1:15:00', '1:25:00', '1:35:00', '1:45:00', '1:55:00', '2:10:00', '2:30:00'],
  marathon: ['2:45:00', '3:00:00', '3:15:00', '3:30:00', '3:45:00', '4:00:00', '4:30:00', '5:00:00'],
}

const addDaysStr = (dateStr: string, n: number) => format(addDays(parseISO(dateStr), n), 'yyyy-MM-dd')
const dateMin = (a: string, b: string) => (a < b ? a : b)
const overlaps = (aStart: string, aEnd: string, bStart: string, bEnd: string) => aStart <= bEnd && aEnd >= bStart
const localId = (prefix: string) =>
  `${prefix}_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : Date.now() + Math.random()}`

/**
 * Full-season Bakken/Almgren plan generator. ONE brain (lib/bakken/brain.json)
 * drives everything: a one-shot call decides the season's periodization
 * skeleton (phase lengths, volume ramp, key workout types — see
 * buildSkeletonSystemPrompt in lib/bakken/plan-prompt.ts), saved as the
 * athlete's normal JourneyDoc so the rest of the app (season view, rest-week
 * cadence, etc.) sees it exactly like any coach-built journey. Only the
 * calendar-date arithmetic (turning "8 weeks" into real yyyy-MM-dd ranges)
 * happens in code — that's not a coaching decision. Day-by-day workout
 * content is then filled in by calling the same brain once per ~14-day
 * block, writing directly to workouts/assignedWorkouts — no coach review
 * step. The app's existing visibleWeeksAhead mechanism (rolls forward every
 * Saturday) is what keeps the athlete from seeing past the first 2 weeks;
 * nothing new was built for that part.
 */
interface AthleteSummary {
  name: string
  experienceLevel: ExperienceLevel | ''
  weeklyMileage?: number
  injuryHistory: string
  goalRaceEvent: string
  goalRaceDistance: RaceDistance | ''
  goalRaceDate: string
  goalRaceTarget: string
  physiology?: {
    lt1PaceSec?: number | null; lt1Hr?: number | null
    lt2PaceSec?: number | null; lt2Hr?: number | null
    lt3PaceSec?: number | null; lt3Hr?: number | null
    testDate?: string
  }
  personalRecords: Array<{ event: string; time: string; date: string }>
}

const formatPace = (sec?: number | null) => {
  if (!sec) return null
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}/km`
}

export function BakkenPlanPanel({ athleteId }: { athleteId: string }) {
  const { user } = useAuth()
  const { steps: labSteps } = useLatestStepTest(athleteId)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [lastSummary, setLastSummary] = useState<string | null>(null)
  const [scheduleLanguage, setScheduleLanguage] = useState<'en' | 'he'>('he')
  const [weekSchedule, setWeekSchedule] = useState<Record<DayKey, DayType>>(DEFAULT_WEEK_SCHEDULE)
  const [scheduleLoaded, setScheduleLoaded] = useState(false)
  const [summary, setSummary] = useState<AthleteSummary | null>(null)
  const [coachNotes, setCoachNotes] = useState('')
  const [savingNotes, setSavingNotes] = useState(false)

  // Let the coach review/adjust the athlete's availability — and see
  // everything else the brain will actually use — right before
  // generating, instead of only being able to change it via the athlete's
  // own onboarding flow or having to guess what data exists.
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const snap = await getDoc(doc(db, 'users', athleteId))
      if (cancelled || !snap.exists()) return
      const d = snap.data() as any
      if (d.weekSchedule && DAY_ORDER.every((day) => d.weekSchedule[day])) {
        const collapsed = Object.fromEntries(
          DAY_ORDER.map((day) => [day, d.weekSchedule[day] === 'off' ? 'off' : d.weekSchedule[day] === 'rest' ? 'rest' : 'workout']),
        ) as Record<DayKey, DayType>
        setWeekSchedule(collapsed)
      }
      if (d.preferredLanguage === 'en' || d.preferredLanguage === 'he') setScheduleLanguage(d.preferredLanguage)
      setSummary({
        name: d.name || 'Athlete',
        experienceLevel: EXPERIENCE_LEVELS.includes(d.experienceLevel) ? d.experienceLevel : '',
        weeklyMileage: d.weeklyMileage,
        injuryHistory: d.injuryHistory || '',
        goalRaceEvent: d.goalRaceEvent || '',
        goalRaceDistance: RACE_DISTANCES.includes(d.goalRaceDistance) ? d.goalRaceDistance : '',
        goalRaceDate: d.goalRaceDate || '',
        goalRaceTarget: d.goalRaceTarget || '',
        physiology: d.physiology,
        personalRecords: Array.isArray(d.personalRecords)
          ? d.personalRecords.slice(0, 5).map((p: any) => ({ event: p.event, time: p.time, date: p.date }))
          : [],
      })
      setCoachNotes(d.coachPrivateNotes || '')
      setScheduleLoaded(true)
    }
    load()
    return () => { cancelled = true }
  }, [athleteId])

  const setDayType = (day: DayKey, type: DayType) => setWeekSchedule((s) => ({ ...s, [day]: type }))
  const setAthleteField = <K extends keyof AthleteSummary>(key: K, value: AthleteSummary[K]) =>
    setSummary((s) => (s ? { ...s, [key]: value } : s))

  const saveCoachNotes = async () => {
    setSavingNotes(true)
    try {
      await updateDoc(doc(db, 'users', athleteId), { coachPrivateNotes: coachNotes })
      toast.success('Notes saved')
    } catch {
      toast.error('Failed to save notes')
    } finally {
      setSavingNotes(false)
    }
  }

  const hasLabTest = !!labSteps && labSteps.length >= 2

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
      comparisonGroup: w.comparisonGroup ?? null,
      thresholdDistance: w.thresholdDistance ?? null,
      sets: (w.sets || []).map((s, i) => ({
        id: `s${i}`,
        reps: s.reps,
        distanceMeters: s.distanceMeters ?? null,
        durationSec: s.durationSec ?? null,
        restBetweenReps: s.restBetweenReps ?? null,
        restAfterSet: s.restAfterSet ?? null,
        notes: s.notes ?? null,
        intervals: (s.intervals || []).map((iv, j) => ({
          id: `s${i}-iv${j}`,
          distanceMeters: iv.distanceMeters ?? null,
          durationSec: iv.durationSec ?? null,
          notes: iv.notes ?? null,
        })),
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
    if (!user || !summary) return
    setLoading(true)
    setLastSummary(null)
    setProgress(null)
    try {
      // Persist whatever the coach set/adjusted above (schedule, notes, and
      // every editable athlete field) before reading the profile back —
      // this is exactly what the brain sees as athlete_context.*.
      const derivedDaysPerWeek = DAY_ORDER.filter((day) => weekSchedule[day] !== 'off').length
      await updateDoc(doc(db, 'users', athleteId), {
        weekSchedule,
        daysPerWeek: derivedDaysPerWeek,
        coachPrivateNotes: coachNotes,
        experienceLevel: summary.experienceLevel || null,
        weeklyMileage: summary.weeklyMileage ?? null,
        injuryHistory: summary.injuryHistory || null,
        goalRaceEvent: summary.goalRaceEvent || null,
        goalRaceDistance: summary.goalRaceDistance || null,
        goalRaceDate: summary.goalRaceDate || null,
        goalRaceTarget: summary.goalRaceTarget || null,
      })

      const profileSnap = await getDoc(doc(db, 'users', athleteId))
      if (!profileSnap.exists()) {
        toast.error('Athlete profile not found')
        return
      }
      const profile = profileSnap.data() as any

      if (!profile.goalRaceDate) {
        toast.error('Set a Goal Race Date for this athlete first — go to their profile page → Profile tab → Edit Profile → Goal Race Date — then generate the Bakken season plan.')
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

      const athleteContext: PlanAthleteContext = {
        name: profile.name || 'Athlete',
        experienceLevel: profile.experienceLevel,
        daysPerWeek: profile.daysPerWeek,
        weekSchedule: profile.weekSchedule,
        weeklyMileage: profile.weeklyMileage,
        injuryHistory: profile.injuryHistory,
        coachNotes: profile.coachPrivateNotes,
        goalRaceEvent: profile.goalRaceEvent || 'Goal Race',
        goalRaceDistance: profile.goalRaceDistance,
        goalRaceDate: profile.goalRaceDate,
        goalRaceTarget: profile.goalRaceTarget,
        personalRecords: Array.isArray(profile.personalRecords)
          ? profile.personalRecords.slice(0, 5).map((p: any) => ({ event: p.event, time: p.time, date: p.date }))
          : [],
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

      // 1. Season skeleton — one Bakken-brain call decides phase lengths
      // (in weeks), volume ramp, and key workout types per phase. Only the
      // date arithmetic below is code, not the model.
      const startDateStr = format(today, 'yyyy-MM-dd')
      const totalWeeksAvailable = Math.max(
        1,
        Math.ceil((new Date(profile.goalRaceDate).getTime() - today.getTime()) / (7 * 86400000)),
      )
      const currentWeeklyKm = profile.weeklyMileage || 30
      const skeletonReq: SkeletonRequest = {
        totalWeeksAvailable,
        currentWeeklyKm,
        peakWeeklyKmHint: profile.weeklyKmRange?.max,
      }
      setProgress('Designing season skeleton...')
      const skeletonRes = await fetch('/api/bakken-coach/generate-skeleton', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ athlete: athleteContext, skeleton: skeletonReq }),
      })
      const skeletonData = await skeletonRes.json()
      if (skeletonData.error || !Array.isArray(skeletonData.skeleton?.stages) || skeletonData.skeleton.stages.length === 0) {
        toast.error(`Skeleton generation failed: ${skeletonData.error || 'malformed response'}. Try again.`)
        return
      }
      const skeletonOut: SkeletonOut = skeletonData.skeleton

      // Normalize week-counts so they sum exactly to totalWeeksAvailable —
      // the model can be off by a week or two; the last stage absorbs any
      // remainder so the season still lands exactly on goalRaceDate.
      const rawStages = skeletonOut.stages.filter((s) => s.weeks > 0)
      const weekSum = rawStages.reduce((s, st) => s + st.weeks, 0)
      if (weekSum !== totalWeeksAvailable && rawStages.length > 0) {
        const diff = totalWeeksAvailable - weekSum
        rawStages[rawStages.length - 1].weeks = Math.max(1, rawStages[rawStages.length - 1].weeks + diff)
      }

      let dateCursor = startDateStr
      const stages: JourneyStage[] = rawStages.map((s, i) => {
        const isLast = i === rawStages.length - 1
        const stageEnd = isLast ? profile.goalRaceDate : addDaysStr(dateCursor, s.weeks * 7 - 1)
        const stage: JourneyStage = {
          id: localId('stage'),
          name: s.name,
          type: s.type,
          startDate: dateCursor,
          endDate: stageEnd,
          focus: s.focus,
          weeklyVolumeKm: s.weeklyVolumeKm,
          keyWorkouts: s.keyWorkouts,
          milestones: s.milestones,
        }
        dateCursor = addDaysStr(stageEnd, 1)
        return stage
      })

      const journeyDoc: JourneyDoc = {
        id: localId('journey'),
        title: skeletonOut.title,
        goalRaceEvent: profile.goalRaceEvent || 'Goal Race',
        goalRaceDate: profile.goalRaceDate,
        goalRaceTarget: profile.goalRaceTarget,
        startDate: startDateStr,
        stages,
        createdBy: user.id,
        createdAt: new Date(),
        updatedAt: new Date(),
      }
      await saveJourney(athleteId, journeyDoc)

      // 2. Split the season into ~14-day blocks, capped for cost/time.
      const blocks: { startDate: string; endDate: string }[] = []
      let cursor = journeyDoc.startDate
      while (cursor <= journeyDoc.goalRaceDate && blocks.length < MAX_BLOCKS) {
        const end = dateMin(addDaysStr(cursor, BLOCK_DAYS - 1), journeyDoc.goalRaceDate)
        blocks.push({ startDate: cursor, endDate: end })
        cursor = addDaysStr(end, 1)
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
        if (data.error || !Array.isArray(data.plan?.workouts)) {
          toast.error(
            `Block ${i + 1} failed: ${data.error || 'malformed response'}. ${totalWritten} workouts from earlier blocks are already saved.`,
          )
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
        {/* Everything the brain actually sees, in one place — so the coach
            can verify it and doesn't have to guess what data exists. */}
        {summary && (
          <div className="rounded-lg border p-3 space-y-3 text-sm">
            <p className="text-sm font-medium">
              Everything Bakken AI knows about {summary.name} — edit here before generating if it changed
            </p>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Experience level</p>
              <div className="flex flex-wrap gap-1.5">
                {EXPERIENCE_LEVELS.map((lvl) => (
                  <button key={lvl} type="button" onClick={() => setAthleteField('experienceLevel', lvl)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium capitalize transition-colors ${summary.experienceLevel === lvl ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                    {lvl}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Weekly mileage (km)</p>
              <div className="flex flex-wrap gap-1.5">
                {MILEAGE_PRESETS.map((km) => (
                  <button key={km} type="button" onClick={() => setAthleteField('weeklyMileage', km)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.weeklyMileage === km ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                    {km}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Injury history</p>
              <textarea
                value={summary.injuryHistory}
                onChange={(e) => setAthleteField('injuryHistory', e.target.value)}
                placeholder="Any current or recurring injuries?"
                className="w-full min-h-[50px] rounded-md border border-input bg-background px-2.5 py-1.5 text-xs"
              />
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Goal race distance</p>
              <div className="flex flex-wrap gap-1.5">
                {RACE_DISTANCES.map((dist) => (
                  <button key={dist} type="button" onClick={() => setAthleteField('goalRaceDistance', dist)}
                    className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.goalRaceDistance === dist ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                    {RACE_DISTANCE_LABELS[dist]}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Race name (optional)</p>
                <input type="text" value={summary.goalRaceEvent} onChange={(e) => setAthleteField('goalRaceEvent', e.target.value)}
                  placeholder="e.g. Tel Aviv Marathon"
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs" />
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground mb-1">Race date</p>
                <input type="date" value={summary.goalRaceDate} onChange={(e) => setAthleteField('goalRaceDate', e.target.value)}
                  className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-xs" />
              </div>
            </div>

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1">Goal time</p>
              {summary.goalRaceDistance ? (
                <div className="flex flex-wrap gap-1.5">
                  {GOAL_TIME_PRESETS[summary.goalRaceDistance].map((t) => (
                    <button key={t} type="button" onClick={() => setAthleteField('goalRaceTarget', t)}
                      className={`px-2.5 py-1 rounded-md border text-xs font-medium transition-colors ${summary.goalRaceTarget === t ? 'bg-primary text-primary-foreground border-primary' : 'border-input text-muted-foreground hover:border-primary'}`}>
                      {t}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">Pick a goal distance first</p>
              )}
            </div>

            {summary.personalRecords.length > 0 && (
              <div className="text-xs">
                <span className="text-muted-foreground">Recent PRs: </span>
                <span className="text-foreground">
                  {summary.personalRecords.map((p) => `${p.event} ${p.time} (${p.date})`).join(' · ')}
                </span>
              </div>
            )}

            {hasLabTest ? (
              <div className="text-xs rounded-md bg-emerald-50 border border-emerald-200 text-emerald-800 px-2 py-1.5">
                ✓ Lab step test on file — Bakken AI will compute exact lab-derived pace/HR targets for every quality session.
              </div>
            ) : (
              <div className="text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1.5">
                No lab step test on file. Not required — Bakken AI will fall back to HR% / talk test / RPE (per the brain's intensity_triangulation)
                {summary.personalRecords.length > 0 ? ', anchored to the recent PRs above.' : ' and coarse pace bands.'}
                {' '}A lactate step test (Lab tab) would sharpen every target once you're ready for one.
              </div>
            )}
          </div>
        )}

        <div>
          <div className="flex items-center justify-between mb-1">
            <p className="text-sm font-medium">Coach notes for Bakken AI (private, never shown to athlete)</p>
            <Button size="sm" variant="outline" className="h-6 text-xs" onClick={saveCoachNotes} disabled={savingNotes}>
              {savingNotes ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
            </Button>
          </div>
          <textarea
            value={coachNotes}
            onChange={(e) => setCoachNotes(e.target.value)}
            placeholder="Anything the brain should know for this athlete specifically — e.g. recovering from IT band issue, prefers mornings, has a 10K tune-up race in week 6..."
            className="w-full min-h-[70px] rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </div>

        <div>
          <p className="text-sm font-medium mb-1">Availability (edit before generating if needed)</p>
          <p className="text-xs text-muted-foreground mb-3">
            {scheduleLoaded ? 'Loaded from athlete onboarding — adjust here if it changed.' : 'Loading...'}
          </p>
          <div className="space-y-1.5">
            {DAY_ORDER.map((day) => (
              <div key={day} className="flex items-center gap-2">
                <span className="w-8 text-xs font-semibold text-muted-foreground shrink-0">
                  {DAY_LABELS[scheduleLanguage][day]}
                </span>
                <div className="flex gap-1">
                  {DAY_TYPES.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setDayType(day, type)}
                      className={`px-2 py-1 rounded-md border text-xs font-medium transition-colors ${
                        weekSchedule[day] === type
                          ? 'bg-primary text-primary-foreground border-primary'
                          : 'border-input text-muted-foreground hover:border-primary'
                      }`}
                    >
                      {DAY_TYPE_LABELS[scheduleLanguage][type]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
        <Button onClick={generate} disabled={loading || !summary}>
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
