/**
 * lib/export-athlete.ts
 *
 * Shared helper that loads a single athlete's full data from Firestore
 * (profile, PRs, season bests, training paces, goals, assigned workouts,
 * workout logs/comments, journey stages) and triggers an Excel download.
 *
 * Used by both the coach's athlete-detail page and the per-card "Export"
 * button on the athletes roster so the two stay consistent.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  DocumentData,
  QueryDocumentSnapshot,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import {
  buildAthleteWorkbook,
  setWorkbookProperties,
  downloadWorkbook,
  athleteFilename,
  type ExportAthleteData,
} from '@/lib/export'
import { listJourneys } from '@/lib/journey'
import {
  legacyEffortToNumber,
  type AssignedWorkout,
  type AthleteProfile,
  type Workout,
  type WorkoutLog,
} from '@/lib/types'

function mapDocToWorkoutLog(
  d: QueryDocumentSnapshot<DocumentData>,
  fallbackAthleteId: string,
): WorkoutLog {
  const data = d.data()
  return {
    id: d.id,
    athleteId: data.athleteId || fallbackAthleteId,
    workoutId: data.workoutId || '',
    date: data.date || '',
    actualDistance: data.actualDistance ?? undefined,
    actualPace: data.actualPace ?? undefined,
    effort: legacyEffortToNumber(data.effort),
    comment: data.comment || '',
    createdAt: data.createdAt?.toDate?.() || new Date(),
  }
}

function mapDocToAssignedWorkout(
  d: QueryDocumentSnapshot<DocumentData>,
): AssignedWorkout {
  const data = d.data()
  return {
    id: d.id,
    workoutId: data.workoutId || '',
    workout: (data.workout || {}) as Workout,
    athleteId: data.athleteId || '',
    assignedBy: data.assignedBy || '',
    scheduledDate: data.scheduledDate || '',
    status: data.status || 'scheduled',
    athleteNotes: data.athleteNotes,
    coachFeedback: data.coachFeedback,
    completedAt: data.completedAt?.toDate?.(),
    actualDuration: data.actualDuration,
    actualDistance: data.actualDistance,
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  }
}

function mapDocToAthleteProfile(
  d: QueryDocumentSnapshot<DocumentData> | { id: string; data: () => DocumentData },
): AthleteProfile {
  const data = d.data()
  return {
    id: d.id,
    userId: data.userId || d.id,
    name: data.name || data.email || 'Athlete',
    email: data.email || '',
    photoURL: data.photoURL,
    dateOfBirth: data.dateOfBirth,
    gender: data.gender,
    height: data.height,
    weight: data.weight,
    events: Array.isArray(data.events) ? data.events : [],
    discipline: Array.isArray(data.discipline) ? data.discipline : undefined,
    experienceLevel: data.experienceLevel,
    weeklyMileage: data.weeklyMileage,
    restingHR: data.restingHR,
    maxHR: data.maxHR,
    goalRaceEvent: data.goalRaceEvent,
    goalRaceDate: data.goalRaceDate,
    goalRaceTarget: data.goalRaceTarget,
    personalRecords: Array.isArray(data.personalRecords) ? data.personalRecords : [],
    seasonBests: Array.isArray(data.seasonBests) ? data.seasonBests : [],
    trainingPaces: Array.isArray(data.trainingPaces) ? data.trainingPaces : [],
    goals: Array.isArray(data.goals) ? data.goals : [],
    coachId: data.coachId,
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  }
}

/**
 * Build the ExportAthleteData payload from an already-loaded AthleteProfile
 * plus its assigned workouts, logs, and journey stages.
 */
export function buildExportPayload(
  athlete: AthleteProfile,
  assignedWorkouts: AssignedWorkout[],
  logs: WorkoutLog[],
  journeyStages: ExportAthleteData['journeyStages'] = [],
): ExportAthleteData {
  // Build a lookup so workout logs show the actual workout title (not the ID)
  const workoutTitleById = new Map<string, string>()
  for (const aw of assignedWorkouts) {
    if (aw.workoutId && aw.workout?.title) {
      workoutTitleById.set(aw.workoutId, aw.workout.title)
    }
  }

  return {
    name: athlete.name,
    email: athlete.email,
    dateOfBirth: athlete.dateOfBirth,
    gender: athlete.gender,
    height: athlete.height,
    weight: athlete.weight,
    discipline: athlete.discipline,
    events: athlete.events,
    experienceLevel: athlete.experienceLevel,
    weeklyMileage: athlete.weeklyMileage,
    restingHR: athlete.restingHR,
    maxHR: athlete.maxHR,
    goalRaceEvent: athlete.goalRaceEvent,
    goalRaceDate: athlete.goalRaceDate,
    goalRaceTarget: athlete.goalRaceTarget,
    personalRecords: athlete.personalRecords,
    seasonBests: athlete.seasonBests,
    trainingPaces: athlete.trainingPaces,
    goals: athlete.goals,
    workoutLogs: logs.map((l) => ({
      date: l.date,
      workoutTitle: workoutTitleById.get(l.workoutId) || l.workoutId || '',
      distance: l.actualDistance,
      pace: l.actualPace,
      effort: l.effort,
      comment: l.comment,
    })),
    assignedWorkouts: assignedWorkouts.map((aw) => ({
      date: aw.scheduledDate,
      workoutTitle: aw.workout?.title || '',
      type: aw.workout?.type || '',
      status: aw.status,
      duration: aw.workout?.duration,
      distance: aw.workout?.distance,
      coachFeedback: aw.coachFeedback || '',
    })),
    journeyStages,
  }
}

/**
 * Load journey stages for an athlete in the shape expected by the workbook
 * builder. Returns an empty list on any failure (export should still proceed).
 */
export async function loadJourneyStagesForExport(
  athleteId: string,
): Promise<NonNullable<ExportAthleteData['journeyStages']>> {
  try {
    const journeys = await listJourneys(athleteId)
    return journeys.flatMap((j) =>
      j.stages.map((s) => ({
        stageName: s.name,
        type: s.type,
        startDate: s.startDate,
        endDate: s.endDate,
        focus: s.focus,
        weeklyVolumeKm: s.weeklyVolumeKm,
        keyWorkouts: s.keyWorkouts?.join('; ') || '',
        milestones: s.milestones?.join('; ') || '',
      })),
    )
  } catch {
    return []
  }
}

/**
 * Fetch everything for one athlete from Firestore, build the workbook,
 * and trigger a browser download. Throws on a hard failure so callers
 * can surface an error toast.
 */
export async function exportAthleteToExcel(athleteId: string): Promise<string> {
  const profileSnap = await getDoc(doc(db, 'users', athleteId))
  if (!profileSnap.exists()) {
    throw new Error('Athlete profile not found')
  }
  const athlete = mapDocToAthleteProfile(profileSnap)

  // Load assigned workouts, logs, and journey stages in parallel.
  const [assignedSnap, logsSnap, journeyStages] = await Promise.all([
    getDocs(query(collection(db, 'assignedWorkouts'), where('athleteId', '==', athleteId))).catch(
      () => null,
    ),
    getDocs(query(collection(db, 'logs'), where('athleteId', '==', athleteId))).catch(() => null),
    loadJourneyStagesForExport(athleteId),
  ])

  const assignedWorkouts = assignedSnap ? assignedSnap.docs.map(mapDocToAssignedWorkout) : []
  const logs = logsSnap ? logsSnap.docs.map((d) => mapDocToWorkoutLog(d, athleteId)) : []

  const payload = buildExportPayload(athlete, assignedWorkouts, logs, journeyStages)
  const wb = buildAthleteWorkbook(payload)
  setWorkbookProperties(wb, athlete.name)
  const filename = athleteFilename(athlete.name)
  downloadWorkbook(wb, filename)
  return filename
}
