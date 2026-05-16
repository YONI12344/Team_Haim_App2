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
  goalRaceDate?: string // ISO date
  goalRaceEvent?: string
  goalRaceTarget?: string // free-text target time
  personalRecords: PersonalRecord[]
  seasonBests: PersonalRecord[]
  trainingPaces: TrainingPace[]
  goals: Goal[]
  coachId?: string
  createdAt: Date
  updatedAt: Date
}

// Personal Record
export interface PersonalRecord {
  id: string
  event: string
  time: string // e.g., "10.52" for 100m
  date: string
  location?: string
  competition?: string
  notes?: string
}

// Training Paces
export interface TrainingPace {
  id: string
  type: 'easy' | 'tempo' | 'threshold' | 'interval' | 'repetition' | 'race'
  pace: string // e.g., "6:30/mile" or "4:00/km"
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
  duration?: number // in minutes
  distance?: number // in km or miles
  sets?: WorkoutSet[]
  warmup?: string
  cooldown?: string
  notes?: string
  createdBy: string // coach ID
  createdAt: Date
  updatedAt: Date
}

// Workout Set (for intervals, etc.)
export interface WorkoutSet {
  id: string
  reps: number
  distance?: string // e.g., "400m"
  duration?: string // e.g., "2:00"
  pace?: string
  rest?: string
  notes?: string
}

// Assigned Workout (to an athlete for a specific date)
export interface AssignedWorkout {
  id: string
  workoutId: string
  workout: Workout
  athleteId: string
  assignedBy: string // coach ID
  scheduledDate: string // ISO date string
  status: 'scheduled' | 'completed' | 'skipped' | 'modified'
  athleteNotes?: string
  coachFeedback?: string
  completedAt?: Date
  actualDuration?: number
  actualDistance?: number
  perceivedEffort?: number // 1-10 scale
  createdAt: Date
  updatedAt: Date
}

// Chat Message (for Realtime Database)
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

// Statistics for charts
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
  startDate: string // ISO date
  endDate: string // ISO date
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
  goalRaceDate: string // ISO date
  goalRaceTarget?: string
  startDate: string // ISO date
  stages: JourneyStage[]
  createdBy: string // uid
  createdAt: Date
  updatedAt: Date
}

// Workout Log (submitted by athlete after completing a workout)
export interface WorkoutLog {
  id: string
  athleteId: string
  workoutId: string    // ID of the assigned workout
  date: string         // ISO date string (scheduled date)
  actualDistance?: number
  actualPace?: string  // e.g. "5:30/km"
  effort: 'easy' | 'medium' | 'hard'
  comment: string
  createdAt: Date
}
