// User roles
export type UserRole = 'athlete' | 'coach' | 'admin'

// User profile
export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  photoURL?: string
  createdAt: Date
  updatedAt: Date
}

// Discipline / running style
export type Discipline = 'track' | 'road' | 'jogger' | 'trail' | 'mixed'

// Experience level
export type ExperienceLevel = 'beginner' | 'intermediate' | 'advanced' | 'professional'

// Training day type — used in the weekly schedule template
export type TrainingDayType = 'rest' | 'easy' | 'workout' | 'long_run' | 'off'

// Weekly training schedule template (set by coach per athlete)
export interface WeekSchedule {
  monday: TrainingDayType
  tuesday: TrainingDayType
  wednesday: TrainingDayType
  thursday: TrainingDayType
  friday: TrainingDayType
  saturday: TrainingDayType
  sunday: TrainingDayType
}

// Athlete profile with detailed info
export interface AthleteProfile {
  id: string
  userId: string
  name: string
  email: string
  photoURL?: string
  dateOfBirth?: string
  gender?: 'male' | 'female' | 'other'
  height?: number // in cm
  weight?: number // in kg
  discipline?: Discipline[]
  events: string[] // e.g., ['100m', '200m', '400m']
  experienceLevel?: ExperienceLevel
  weeklyMileage?: number // km / week
  restingHR?: number // bpm
  maxHR?: number // bpm
  currentHR?: number // bpm – most recent measured / typical training HR
  targetHR?: number // bpm – target average HR for key efforts
  targetPaceKm?: string // target race pace, e.g. "4:30/km"
  goalRaceDate?: string // ISO date
  goalRaceEvent?: string
  goalRaceTarget?: string // free-text target time
  personalRecords: PersonalRecord[]
  seasonBests: PersonalRecord[]
  trainingPaces: TrainingPace[]
  goals: Goal[]
  coachId?: string
  onboardingComplete?: boolean
  // Weekly training template — which type of session each day of the week
  weekSchedule?: WeekSchedule
  // Target weekly km range, e.g. { min: 40, max: 60 }
  weeklyKmRange?: { min: number; max: number }
  // Recovery week interval: every Nth week is an off/recovery week (default 4)
  offWeekInterval?: number
  createdAt: Date
  updatedAt: Date
}

// Personal Record
export interface PersonalRecord {
  id: string
  event: string
  time: string
  date: string
  location?: string
  competition?: string
  notes?: string
}

// Training Paces
export interface TrainingPace {
  id: string
  type: 'easy' | 'tempo' | 'threshold' | 'interval' | 'repetition' | 'race'
  pace: string
  description?: string
}

// Goal
export interface Goal {
  id: string
  title: string
  targetTime?: string
  targetEvent?: string
  targetDate?: string
  status: 'active' | 'achieved' | 'archived'
  notes?: string
  createdAt: Date
}

// Workout Types
export type WorkoutType =
  | 'easy'
  | 'long_run'
  | 'tempo'
  | 'intervals'
  | 'hill_repeats'
  | 'fartlek'
  | 'recovery'
  | 'strength'
  | 'cross_training'
  | 'rest'
  | 'race'
  | 'time_trial'

// Workout
export interface Workout {
  id: string
  title: string
  type: WorkoutType
  description: string
  duration?: number
  distance?: number
  sets?: WorkoutSet[]
  warmup?: string
  cooldown?: string
  notes?: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

// Workout Set
export interface WorkoutInterval {
  id: string
  distance?: string
  pace?: string
  rest?: string
}

export interface WorkoutSet {
  id: string
  reps: number
  distance?: string
  duration?: string
  pace?: string
  rest?: string
  notes?: string
  intervals?: WorkoutInterval[]
}

// Assigned Workout
export interface AssignedWorkout {
  id: string
  workoutId: string
  workout: Workout
  athleteId: string
  assignedBy: string
  scheduledDate: string
  status: 'scheduled' | 'completed' | 'skipped' | 'modified'
  athleteNotes?: string
  coachFeedback?: string
  completedAt?: Date
  actualDuration?: number
  actualDistance?: number
  perceivedEffort?: number
  createdAt: Date
  updatedAt: Date
}

// Chat Message
export interface ChatMessage {
  id: string
  senderId: string
  senderName: string
  senderPhotoURL?: string
  receiverId: string
  content: string
  timestamp: number
  read: boolean
}

// Chat Conversation
export interface Conversation {
  id: string
  participants: string[]
  lastMessage?: string
  lastMessageTime?: number
  unreadCount: Record<string, number>
}

// Statistics
export interface WeeklyStats {
  week: string
  totalDistance: number
  totalDuration: number
  workoutsCompleted: number
  averageEffort: number
}

export interface MonthlyStats {
  month: string
  totalDistance: number
  totalDuration: number
  workoutsCompleted: number
  prsAchieved: number
}

// --- Season Journey ---

export type JourneyStageType =
  | 'base'
  | 'build'
  | 'peak'
  | 'taper'
  | 'race_week'
  | 'recovery'
  | 'custom'

export interface JourneyStage {
  id: string
  name: string
  type: JourneyStageType
  startDate: string
  endDate: string
  focus: string
  weeklyVolumeKm?: number
  keyWorkouts: string[]
  milestones?: string[]
  notes?: string
}

export interface JourneyDoc {
  id: string
  title: string
  goalRaceEvent: string
  goalRaceDate: string
  goalRaceTarget?: string
  startDate: string
  stages: JourneyStage[]
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

// Workout Log
export interface WorkoutLog {
  id: string
  athleteId: string
  workoutId: string
  date: string
  actualDistance?: number
  actualPace?: string
  effort: number
  comment: string
  splitLogs?: SplitLog[]
  createdAt: Date
}

export interface SplitLog {
  setIndex: number
  repIndex: number
  distance?: string
  time?: string
  pace?: string
  notes?: string
}

/** Map a legacy string effort label to its numeric (1–10) equivalent. */
export function legacyEffortToNumber(
  v: 'easy' | 'medium' | 'hard' | number | undefined | null,
): number {
  if (typeof v === 'number' && Number.isFinite(v)) {
    return Math.min(10, Math.max(1, Math.round(v)))
  }
  if (v === 'easy') return 3
  if (v === 'medium') return 6
  if (v === 'hard') return 9
  return 5
}
