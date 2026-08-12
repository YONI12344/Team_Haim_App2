import type { PhysiologySummary } from './physiology'

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
  physiology?: PhysiologySummary // latest lactate-test thresholds (T1/T2, VO2max)
  goalRaceDate?: string // ISO date
  goalRaceEvent?: string
  goalRaceDistance?: '1500m' | 'mile' | '3000m' | '5k' | '10k' | '15k' | 'half_marathon' | 'marathon'
  goalRaceTarget?: string // free-text target time
  personalRecords: PersonalRecord[]
  seasonBests: PersonalRecord[]
  trainingPaces: TrainingPace[]
  goals: Goal[]
  coachId?: string
  mutedByCoach?: boolean
  // Coach turns this on per athlete once they're actually being
  // lactate-tested — hidden from the athlete's dashboard/training-plan
  // page and the /athlete/lab route itself until then.
  labVisibleToAthlete?: boolean
  // Coach turns this on per athlete to unlock the strength/stretch
  // platform (Exercise Library workouts, Lift Mode, /athlete/progress) —
  // still being tested, off by default. Checked directly on each of those
  // athlete-facing surfaces, not just used to hide entry points, same
  // defense-in-depth spirit as labVisibleToAthlete. Deliberately separate
  // from injuryToolsVisibleToAthlete below — the coach wants to be able to
  // turn strength/stretch on for an athlete without also exposing the
  // (separately unfinished) injury tool, and vice versa.
  strengthToolsVisibleToAthlete?: boolean
  // Same gating mechanism as strengthToolsVisibleToAthlete, but just for
  // /athlete/injury — independent switch, on purpose (see above).
  injuryToolsVisibleToAthlete?: boolean
  // Coach-set default routine links (same shape as Workout.linkedRoutines)
  // for THIS athlete — auto-applied to a workout when it's assigned to
  // them and doesn't already carry its own linkedRoutines (e.g. a specific
  // hard-day template the coach linked routines to directly). Set from
  // the athlete's planner (components/coach/athlete-planner.tsx) so the
  // coach doesn't have to re-add the same warm-up/cooldown rows to every
  // single workout by hand. Used as the fallback when no
  // defaultLinkedRoutinesByType rule below matches the workout's type.
  defaultLinkedRoutines?: { id: string; workoutId: string; label: string; labelEn?: string }[]
  // Same idea, but keyed by workout type — e.g. easy/long_run/recovery get
  // one lighter warm-up, tempo/intervals/hill_repeats/fartlek/threshold get
  // another with more activation drills. The first rule whose `types`
  // includes the workout's type wins; falls back to defaultLinkedRoutines
  // above if no rule matches.
  defaultLinkedRoutinesByType?: {
    id: string
    types: WorkoutType[]
    routines: { id: string; workoutId: string; label: string; labelEn?: string }[]
  }[]
  onboardingComplete?: boolean
  // Private free-text notes — visible only to the coach, never sent to the
  // athlete (e.g. shoe model, injury history, quirks to remember)
  coachPrivateNotes?: string
  // Weekly training template — which type of session each day of the week
  weekSchedule?: WeekSchedule
  // First day of the calendar week for this athlete (0 = Sunday, 1 = Monday)
  weekStartDay?: 0 | 1
  // Day the weekly-km count resets (0 = Sunday, 1 = Monday)
  kmWeekStartDay?: 0 | 1
  // How many weeks ahead of the plan the athlete can see (rolls every
  // Saturday; 0 = no limit, default 2)
  visibleWeeksAhead?: number
  // Target weekly km range, e.g. { min: 40, max: 60 }
  weeklyKmRange?: { min: number; max: number }
  // Recovery week interval: every Nth week is an off/recovery week (default 4)
  offWeekInterval?: number
  // Monday ('yyyy-MM-dd') of a week the coach explicitly marked as the rest
  // week (vacation, illness, fatigue, etc.) — re-anchors the offWeekInterval
  // cadence from this week forward/back instead of the fixed journey-stage
  // count, so the whole recurring pattern shifts to fit. See isRestWeek in
  // lib/journey.ts.
  offWeekAnchorDate?: string
  // Days per week the athlete can realistically train — collected at
  // onboarding, used by the Bakken AI plan generator to pick a track
  // (recreational/intermediate/elite) and set the weekly session count.
  daysPerWeek?: number
  // Free-text injury history from onboarding — used by the Bakken AI plan
  // generator to flag conservative volume progression. Athlete-visible
  // input (distinct from coachPrivateNotes, which is coach-only).
  injuryHistory?: string
  // Athlete's own self-report of where they're at right now — a Bakken AI
  // input signal alongside (not instead of) their logged training history.
  currentShape?: 'just_starting' | 'returning' | 'consistent' | 'peak_fitness'
  // Coach-set cap on long-run duration in minutes, used by the Bakken AI
  // plan generator.
  longRunMinutes?: number
  // Coach-set weekday the long run must fall on every week — a hard rule
  // for the Bakken AI plan generator, not a preference.
  longRunDay?: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
  // Coach-set cap on how many ~14-day blocks the Bakken AI generator
  // writes per click — an exact number (1 = ~2 weeks, up to the app's own
  // MAX_BLOCKS safety ceiling for "full season"). Defaults to the ceiling
  // when unset.
  bakkenGenerationBlocks?: number
  // Optional tune-up race/time trial mid-season — the Bakken AI gives it a
  // short light taper beforehand and resumes the normal plan right after,
  // without disrupting the season's main periodization.
  testRaceDate?: string
  testRaceEvent?: string
  testRaceDistance?: string
  // Athlete's chosen UI language at the time onboarding was completed —
  // used so AI-generated plans/feedback are written in the athlete's
  // language rather than defaulting to Hebrew.
  preferredLanguage?: 'en' | 'he'
  // Fixed sessions the coach wants on the calendar every week (or every
  // other week) regardless of season phase — a gym day, yoga, a standing
  // cross-training slot. The Bakken AI generator always includes these on
  // their designated day rather than deciding fresh each time; set once,
  // applies to every future generation until changed. Stored at the
  // athlete level (not on a specific journey/stage) so it survives a full
  // season regenerate.
  recurringActivities?: Array<{
    id: string
    dayOfWeek: 'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday'
    frequency: 'every_week' | 'every_other_week'
    type: string // a WorkoutType, e.g. 'strength' | 'cross_training'
    title: string
    notes?: string
    // When set, this activity reuses an existing workouts/{id} doc's real
    // content (description, sets, strengthBlocks — e.g. an actual lift
    // workout built in the strength platform, or a stretching routine)
    // instead of a generic 45min stub. type/title above are then derived
    // from that workout at generation time, not typed manually.
    workoutId?: string
  }>
  // Coach-defined weekday -> workout-type skeleton per season phase, e.g.
  // { build: { tuesday: 'threshold', thursday: 'long_run' } } — when set
  // for a given stage type, the Bakken AI generator uses that EXACT type
  // on that weekday every week that phase is active (filling in the real
  // pace/structure itself), instead of deciding which day gets which
  // quality type on its own. Days not listed stay the AI's own call.
  // Keyed by JourneyStageType so it naturally reapplies to whichever
  // "build"/"peak"/etc. stage exists in a freshly-generated season, since
  // stages themselves are recreated fresh on every skeleton regenerate.
  // A day's value can be a single type, an array of exactly two types when
  // the coach wants two sessions that same day (e.g. lift + easy run, or a
  // double-threshold day), or {rotateWeekly: [...]} to cycle one type per
  // week on that day (e.g. fartlek one week, hills the next — a 2-item
  // list is "every other week X, every other week Y") — see rule 2c in
  // plan-prompt.ts.
  stageDayTypeTemplates?: Partial<Record<JourneyStageType, Partial<Record<
    'sunday' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday',
    string | string[] | { rotateWeekly: string[] }
  >>>>
  // One-off calendar events (a flight, a wedding, an exam) that aren't
  // recurring and aren't the goal/prep race — the Bakken AI generator
  // treats the event date like a mini-taper context: no hard/big session
  // that day, downgraded to easy instead, similar in spirit to the prep
  // race taper but for a single non-race day.
  specialEvents?: Array<{
    id: string
    date: string // YYYY-MM-DD
    label: string
    notes?: string
  }>
  // Cutback/down-week overrides for base/build/peak stages — the automatic
  // default is every 3rd week (beginner) or 4th week (everyone else) at
  // 75% volume (lib/bakken/safety-rules.json). These let the coach
  // customize WHEN it happens and what it actually changes beyond volume.
  cutbackIntervalWeeks?: number // e.g. 3 = a down week every 3rd week, overriding the automatic default
  cutbackFewerDays?: boolean // on a cutback week, also drop one easy day entirely to full rest
  cutbackDowngradeQuality?: boolean // on a cutback week, also downgrade that week's quality sessions to easy
  // Coach override of where THIS athlete actually starts within the
  // Workout Bank's progression (Workout.bankStage/bankOrder) — a generic
  // "beginner" level default (stage 1, the easiest entry) is wrong for,
  // say, a talented former half-marathoner who's been out for a few
  // years but isn't truly starting from zero. Points at a specific
  // workouts/{id} bank entry; generation resumes forward from that
  // entry's own bankOrder instead of always starting at the bottom of
  // the ladder. Same override pattern as weeklyMileage above — set once,
  // wins over any generic default, and this session's actual starting
  // point isn't guessed from the level label alone.
  startingWorkoutId?: string
  createdAt: Date
  updatedAt: Date
}

// Prospective-client application — submitted via the public /apply page,
// before someone becomes an app user. The coach reviews these in
// /coach/leads; accepting one lets its data auto-prefill the athlete's
// profile the moment they actually sign up (matched by email — see
// contexts/auth-context.tsx new-user creation).
export interface Lead {
  id: string
  name: string
  email: string
  phone?: string
  dateOfBirth?: string
  city?: string
  height?: number // cm
  weight?: number // kg
  experienceLevel?: ExperienceLevel
  // How long they've trained seriously — a different axis than
  // experienceLevel (self-assessed skill), useful as a sanity check on it.
  runningExperienceDuration?: 'under_6mo' | '6to12mo' | '1to3yr' | 'over_3yr'
  weeklyMileage?: number
  recentRaceEvent?: string
  recentRaceTime?: string
  recentRaceDate?: string
  shoesInfo?: string
  devicesUsed?: string[]
  stravaOrGarminLink?: string
  primaryGoal?: string
  longTermGoal?: string
  goalRaceEvent?: string
  goalRaceDistance?: '1500m' | 'mile' | '3000m' | '5k' | '10k' | '15k' | 'half_marathon' | 'marathon'
  goalRaceDate?: string
  goalRaceTarget?: string
  daysPerWeek?: number
  preferredDays?: string[] // 'sunday'..'saturday'
  facilitiesAccess?: string[]
  lifestyleNotes?: string // sleep, work/study load
  currentInjuries?: string // active pain/injury right now
  injuryHistory?: string // past 1-2 years
  medicalNotes?: string
  additionalNotes?: string
  status: 'new' | 'accepted' | 'declined' | 'converted'
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
  | 'stretch'
  | 'cross_training'
  | 'swim'
  | 'bike'
  | 'rest'
  | 'race'
  | 'time_trial'
  | 'threshold'

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
  // AI-translated English cache of the Hebrew fields above, auto-generated
  // on save (see lib/translate.ts) and shown instead of the Hebrew text to
  // any athlete with preferredLanguage 'en'. Coach still only ever writes
  // Hebrew — these are never hand-authored duplicates, just a cache the
  // coach can review/edit afterward. Missing/stale until the next save
  // regenerates it; display code always falls back to the Hebrew field.
  titleEn?: string
  descriptionEn?: string
  warmupEn?: string
  cooldownEn?: string
  notesEn?: string
  // @deprecated — a fixed mmol/L number can't be personalized per athlete.
  // Kept for old data; the coach now picks targetThresholdLevel instead,
  // and the actual pace/HR/lactate target is computed live per athlete
  // (see lib/physiology.ts personalTargetForLevel), so the same
  // 'threshold' workout shows each assigned athlete their own numbers.
  targetLactate?: number
  // 'threshold' workouts only: which of the athlete's own thresholds this
  // session targets.
  targetThresholdLevel?: 'T1' | 'T2' | 'T3'
  // Which metrics to show the athlete for that target — defaults to all
  // three when unset (old workouts predating this field).
  targetMetrics?: ('pace' | 'hr' | 'lactate')[]
  // 'threshold' workouts only: the rep distance this session is built
  // around (e.g. 400 for "20×400"). Lets T1/T2/T3 pool across every
  // threshold workout at this same distance instead of only ever
  // comparing to another instance of the exact same workout template.
  thresholdDistance?: number
  // Coach-assigned label identifying this workout as one instance of a
  // repeatable series (e.g. "Fartlek A") — any workout type, not just
  // threshold. Every log of a workout sharing this same label pools into
  // one pace/HR-over-time comparison in the Lab, independent of the
  // lactate-specific grouping above.
  comparisonGroup?: string
  // Who/what created this library entry — 'bakken' for every standalone
  // workouts/{id} doc the Bakken AI generator writes (one per day, see
  // bakken-plan-panel.tsx), unset/'coach' for anything the coach built by
  // hand. Lets workout-library.tsx separate/bulk-clean Bakken's own
  // one-off library clutter from real reusable coach-authored workouts.
  // Older docs predating this field fall back to a live cross-reference
  // against assignedWorkouts (source:'bakken') instead.
  source?: 'bakken' | 'coach'
  // Hides this workout from the Workout Library list (components/coach/
  // workout-library.tsx) — set on per-week clones created by copy-week/
  // paste, which are real workouts/{id} docs but shouldn't clutter the
  // reusable-template list. Was already written/read all over the
  // codebase without ever being declared on this type.
  libraryHidden?: boolean
  // 'strength' workouts only: the structured exercise breakdown that
  // powers Lift Mode (components/athlete/lift-mode.tsx) — grouped into
  // blocks (a plain set, or a superset of 2+ exercises done back to back)
  // so the athlete can step through the actual workout instead of reading
  // a free-text description. Exercise name/video/instructions are
  // denormalized from ExerciseLibraryItem at build time so a workout keeps
  // showing the exact exercise it was built with even if the library entry
  // is edited/deleted later.
  strengthBlocks?: StrengthBlock[]
  // A 'stretch'-type workout that's specifically a pre-run/pre-workout
  // warm-up (vs. a general stretch/cooldown routine) — lets the Workout
  // Library filter to just warm-ups instead of lumping every stretch
  // workout together (components/coach/workout-library.tsx).
  isWarmup?: boolean
  // Any number of routines attached to this workout (a running session, a
  // lift day, anything) — e.g. general mobility before a warm-up jog,
  // running-specific activation drills after the jog but before the main
  // set, static stretching after the workout. Each points at a
  // 'stretch'-type workouts/{id} doc, in coach-chosen order, with a
  // coach-chosen button label (not a fixed "warmup"/"cooldown" pair) —
  // shown to the athlete as buttons on the workout detail card
  // (components/athlete/athlete-planner-view.tsx) that each open a popup
  // (components/athlete/warmup-viewer.tsx) with video + instructions per
  // exercise and a simple, local-only "mark done" toggle — not persisted,
  // not required to complete the actual workout, just a following-along
  // aid. Copied onto AssignedWorkout.workout automatically since that's a
  // full snapshot of this Workout at assignment time.
  linkedRoutines?: { id: string; workoutId: string; label: string; labelEn?: string }[]
  // Marks this workout as a Workout Bank entry for the given athlete
  // level — a real, coach-authored session the Bakken AI generator can
  // pick from and scale (duration/distance only, never restructure)
  // instead of inventing new content for that type/level. type (already
  // above) is the bank's other axis — a "level folder" in the UI is just
  // every workout sharing this bankLevel, grouped by type.
  bankLevel?: ExperienceLevel
  // Progression sub-category within (bankLevel, type) — e.g. "Run/Walk
  // Stage 1" vs "Run/Walk Stage 2" vs "Continuous", so the bank captures
  // that a beginner in week 1 needs very different content than a
  // beginner in week 8, not just a flat pile of "beginner easy" workouts.
  // Free text, coach-defined, purely a grouping/label — bankOrder below
  // is what the picker actually uses to know progression direction.
  bankStage?: string
  // Progression order within the same (bankLevel, type[, bankStage])
  // bucket — lower numbers come first. Lets the generator move to "the
  // next harder one" as weeks pass without needing to parse/match stage
  // names. Ties/gaps are fine; only relative order matters.
  bankOrder?: number
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

// Coach-managed exercise library — reusable across every strength workout
// so a video/instructions only need to be uploaded once per exercise.
export interface ExerciseLibraryItem {
  id: string
  name: string
  // AI-translated English cache, same pattern as Workout.titleEn — see
  // that comment. Regenerated on save, athlete-facing display falls back
  // to the Hebrew field when missing.
  nameEn?: string
  instructionsEn?: string
  videoUrl?: string
  videoPath?: string // Storage path, needed to delete the file on removal
  // Coach-set: play this exercise's demo video muted by default wherever
  // it's shown (Lift Mode, injury view, library preview). Doesn't strip
  // audio from the file itself — browsers/Firestore give no way to do that
  // client-side — it only controls playback, same as any <video muted>.
  videoMuted?: boolean
  instructions?: string
  defaultSets?: number
  defaultReps?: string // free text, e.g. "8-12" or "10 each side"
  // Which workout builder this exercise is offered in — missing means
  // 'strength' (every exercise created before this field existed). 'warmup'
  // is its own bucket, separate from 'stretch', for pre-run activation/
  // mobility drills (see lib/seed-ancillary-routines.ts) — a 'stretch'-type
  // workout can pick from both 'stretch' and 'warmup' exercises (see
  // components/coach/strength-block-builder.tsx), but the library and its
  // filter tabs keep them visually apart.
  category?: 'strength' | 'stretch' | 'warmup'
  // Free-text folder within a category — e.g. "Rope Stretching" / "Dynamic
  // Stretching" / "Static (Post-Run)" for stretch, "Heavy Weight" / "Light
  // Weight" / "Stability" / "Lower Leg" for strength. Purely a picker-
  // organization aid (components/coach/strength-block-builder.tsx groups/
  // filters by it) — coach can use the suggested folders or type a new
  // one; unset exercises just show up ungrouped, nothing breaks.
  subcategory?: string
  // Timed exercise (a stretch hold, a plank) instead of a reps-based one —
  // Lift Mode (components/athlete/lift-mode.tsx) shows a start/stop timer
  // in place of a weight input when set, for this exercise and any
  // StrengthBlockExercise built from it.
  isTimed?: boolean
  defaultDurationSec?: number
  // Injury zones (lib/injury-data.ts BODY_ZONES keys) this exercise is a
  // relevant rehab/prevention movement for — coach-tagged, surfaced on the
  // athlete's injury zone page (components/athlete/athlete-injury-view.tsx).
  injuryZones?: string[]
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

// A "Set 1" (single exercise) or "Superset 1" (2+ exercises done back to
// back with no rest between them) inside a strength or stretch workout.
export interface StrengthBlock {
  id: string
  label: string // e.g. "Set 1", "Superset 1" — coach-editable
  exercises: StrengthBlockExercise[]
}

export interface StrengthBlockExercise {
  id: string
  exerciseId: string // ExerciseLibraryItem.id — for future library lookups
  name: string // denormalized from the library at build time
  videoUrl?: string // denormalized
  videoMuted?: boolean // denormalized
  instructions?: string // denormalized
  // Denormalized from ExerciseLibraryItem.category — 'stretch'/'warmup'
  // exercises skip the weight input in Lift Mode (components/athlete/
  // lift-mode.tsx SetControl); only 'strength' logs weight.
  category?: 'strength' | 'stretch' | 'warmup'
  targetSets: number
  targetReps: string // free text, e.g. "8-12" or "10 each side"
  // Denormalized from ExerciseLibraryItem.isTimed/defaultDurationSec at
  // build time — when set, Lift Mode shows a start/stop timer for this
  // exercise's sets instead of a weight input; targetReps is unused then.
  targetDurationSec?: number
  notes?: string
  // AI-translated English cache of notes — see Workout.titleEn comment.
  // name/instructions don't need their own En cache here: resolveExerciseDisplay
  // already prefers the live ExerciseLibraryItem (which carries nameEn/
  // instructionsEn) over this denormalized snapshot whenever it still exists.
  notesEn?: string
  // An "either/or" second exercise for this exact slot — e.g. box jump OR
  // step up, burpee with vest OR without — points at another
  // ExerciseLibraryItem.id. When set, Lift Mode (components/athlete/
  // lift-mode.tsx) shows a small picker letting the athlete choose which
  // one they're actually doing THIS session before logging sets, instead
  // of the coach having to build two near-identical blocks. The choice
  // isn't stored on the workout template itself — it's picked fresh each
  // time and recorded on the set log (see ExerciseLogEntry).
  alternateExerciseId?: string
}

// Workout Set
export interface WorkoutInterval {
  id: string
  /** Legacy free-text distance (e.g. "400m", "2 דק'") — kept for display and
   *  for reading old data. New rows should also set distanceMeters/durationSec
   *  below so downstream matching never has to guess the unit again. */
  distance?: string
  /** Explicit distance in meters — set by the workout builder's unit-aware
   *  input. When present this is the authoritative value; distance (string)
   *  is just its formatted display text. */
  distanceMeters?: number
  /** Explicit duration in seconds — set by the workout builder's unit-aware
   *  input, for a time-based rep (e.g. "2 min on"). When present, this rep
   *  has NO real distance target at all (duration-based), so matching code
   *  must not attempt to parse a meters value from the display text. */
  durationSec?: number
  pace?: string
  rest?: string
  // Personalize this segment's pace from the athlete's OWN lab thresholds
  // instead of (or alongside) the free-text `pace` above — e.g. a Kenyan
  // Fartlek's "medium" segment at 'below_T1' (recovery jog) and "fast"
  // segment at 'T3', each resolved live per athlete via
  // lib/physiology.ts personalPaceForLevel. `pace` still displays as a
  // fallback/label when this athlete has no lab data yet.
  targetThresholdLevel?: 'T1' | 'T2' | 'T3' | 'below_T1'
  // Seconds/km offset from that level's resolved pace — positive = slower
  // (e.g. +12 for "T1 pace, 12 sec/km slower"), negative = faster, 0/unset
  // = exactly that level's pace.
  targetOffsetSec?: number
}

export interface WorkoutSet {
  id: string
  reps: number
  /** Legacy free-text distance (e.g. "400m") — see WorkoutInterval.distance. */
  distance?: string
  /** Legacy free-text duration (e.g. "2 דק'") — see WorkoutInterval.distance. */
  duration?: string
  /** Explicit distance in meters — see WorkoutInterval.distanceMeters. */
  distanceMeters?: number
  /** Explicit duration in seconds — see WorkoutInterval.durationSec. */
  durationSec?: number
  pace?: string
  /** @deprecated ambiguous legacy field — read as a restAfterSet fallback for
   *  old workouts; new workouts should set restBetweenReps/restAfterSet
   *  instead, since "rest" meant two different things depending on context. */
  rest?: string
  /** Rest between each repetition within this set — only meaningful when reps > 1
   *  (e.g. "3× 2km" with 90s between each 2km). */
  restBetweenReps?: string
  /** Rest after finishing this whole set, before starting the next set block. */
  restAfterSet?: string
  notes?: string
  intervals?: WorkoutInterval[]
  // Same personalization mechanism as WorkoutInterval above, for a plain
  // set with no intervals (e.g. a whole easy run at "T1 + 12 sec/km").
  targetThresholdLevel?: 'T1' | 'T2' | 'T3' | 'below_T1'
  targetOffsetSec?: number
}

/** Resolve a set's "rest after this set" value, falling back to the legacy
 *  ambiguous `rest` field for workouts saved before the split. */
export function setRestAfter(set: Pick<WorkoutSet, 'rest' | 'restAfterSet'>): string | undefined {
  return set.restAfterSet || set.rest || undefined
}

/** Resolve a set's "rest between reps" value. No legacy fallback — the old
 *  `rest` field's separator-only display meant it never represented this
 *  case for existing data, so there's nothing safe to infer for reps>1. */
export function setRestBetweenReps(set: Pick<WorkoutSet, 'restBetweenReps'>): string | undefined {
  return set.restBetweenReps || undefined
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
  // When a day has more than one workout (e.g. easy run AM + gym PM), this
  // tells them apart and drives Strava/manual-log matching to the right one
  session?: 'am' | 'pm' | 'other'
  // Set when the athlete moved this workout to a different day
  movedByAthlete?: boolean
  movedFromDate?: string
  // Coach override: show this workout to the athlete even beyond the
  // rolling visibility window (race/time_trial types bypass automatically)
  showAheadOverride?: boolean
  athleteNotes?: string
  coachFeedback?: string
  // Coach's manual adjustment of this specific assignment's personalized
  // threshold target (see lib/physiology.ts personalTargetRangeForLevel) —
  // e.g. "this athlete should go faster than their lab data suggests."
  // Present only when the coach has explicitly overridden the auto-computed
  // range; otherwise the target is computed live from the athlete's own
  // step-test data every time.
  targetOverride?: { paceMinSec: number; paceMaxSec: number; hrMin?: number; hrMax?: number }
  // Lift Mode progress for a 'strength' or 'stretch' workout — keyed by
  // StrengthBlockExercise.id, one entry per completed/logged set (array
  // index = set number). The athlete (or coach) fills this in live while
  // stepping through components/athlete/lift-mode.tsx. durationSec is set
  // instead of weightKg for timed exercises (StrengthBlockExercise.targetDurationSec).
  strengthProgress?: Record<string, Array<{ completed: boolean; weightKg?: number | null; durationSec?: number | null }>>
  // True when workout.linkedRoutines here came from the athlete's default
  // routine rules (components/coach/athlete-planner.tsx withAthleteDefaultRoutines),
  // not from the workout template's own linkedRoutines. Lets saving a
  // changed/removed default rule safely resync only the routines it put
  // here itself — a routine the coach deliberately attached on a specific
  // workout template is never touched, since this stays unset/false for it.
  linkedRoutinesFromDefault?: boolean
  completedAt?: Date
  actualDuration?: number
  actualDistance?: number
  perceivedEffort?: number
  createdAt: Date
  updatedAt: Date
}

// One durable record per (athlete, exercise, workout completion), written
// when the athlete finishes a strength workout in Lift Mode
// (components/athlete/lift-mode.tsx). Unlike AssignedWorkout.strengthProgress
// (which gets overwritten every time that workout is reopened), this is
// append-only history — it's what powers the athlete's per-exercise
// progress chart (components/athlete/athlete-exercise-progress.tsx).
// Doc id is deterministic (`${assignedWorkoutId}_${exerciseId}`) so
// re-finishing the same workout upserts instead of duplicating.
export interface ExerciseLogEntry {
  id: string
  athleteId: string
  exerciseId: string // StrengthBlockExercise.exerciseId / ExerciseLibraryItem.id
  exerciseName: string // denormalized, survives library edits/deletes
  assignedWorkoutId: string
  workoutDate: string // AssignedWorkout.scheduledDate, for chronological sort
  sets: Array<{ weightKg?: number | null; durationSec?: number | null; completed: boolean }>
  maxWeightKg?: number | null // derived at write time, for quick PB display
  maxDurationSec?: number | null // derived at write time, for timed exercises
  createdAt: Date
  updatedAt: Date
}

// A coach-diagnosed injury for one athlete, tied to a body zone (lib/injury-
// data.ts BODY_ZONES key). Coach-write only; visible to the athlete on
// their own /athlete/injury page only once visibleToAthlete is set — same
// gating spirit as users.labVisibleToAthlete for the Lab page, but per
// record instead of one global flag. rehabWorkoutId optionally points at
// an existing strength assignedWorkouts/{id} (built/assigned the normal
// way) that becomes this injury's "start rehab session" button, launching
// Lift Mode so the session logs into the athlete's regular exerciseLogs
// progress history like any other strength workout.
export interface AthleteInjury {
  id: string
  athleteId: string
  zoneId: string
  title: string
  description?: string
  status: 'active' | 'recovered'
  visibleToAthlete: boolean
  rehabWorkoutId?: string
  createdBy: string
  createdAt: Date
  updatedAt: Date
}

export type DayOffReason = 'sick' | 'trip' | 'other'

// A date range (inclusive, 'yyyy-MM-dd' strings, so plain string compares
// work) an athlete or coach has marked as no-workout — sick, traveling,
// etc. Suppresses the "log your workout" reminders for that range (see
// app/api/send-morning-reminders and send-evening-reminders) and the
// coach's "missed workout" alert, and the planner shows it in place of the
// usual rest-day/workout card instead of leaving it looking like a miss.
export interface DayOff {
  id: string
  athleteId: string
  startDate: string
  endDate: string
  reason: DayOffReason
  note?: string
  createdBy: string
  createdAt: Date
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
  assignedWorkoutId?: string
  date: string
  actualDistance?: number
  actualPace?: string
  effort: number | null
  comment: string
  splitLogs?: SplitLog[]
  // Denormalized from the workout template at save time so the Lab's
  // per-workout progress view (components/coach/athlete-workout-progress.tsx)
  // can group/label logs without extra reads.
  workoutTitle?: string
  // Denormalized from the workout template's thresholdDistance — lets logs
  // be grouped by rep distance (e.g. every 400m threshold session) instead
  // of only by the exact workoutId, without an extra read per log.
  thresholdDistance?: number
  // Denormalized from the workout template's comparisonGroup — lets ANY
  // workout type (not just threshold) be pooled and compared session-over
  // -session in the Lab's workout-comparison graph (pace/HR over time),
  // without an extra read per log.
  comparisonGroup?: string
  // true when any splitLogs entry has a lactate reading — lets that same
  // view query logs cheaply instead of fetching everything.
  hasLactate?: boolean
  source?: string
  feedbackStatus?: string
  // Manual uploads: activity kind from lib/activity-types (run, gym, yoga, ...)
  activityType?: string
  durationMin?: number
  stravaActivityId?: number
  stravaName?: string
  averageHeartRate?: number
  elevationGain?: number
  startTime?: string
  createdAt: Date
}

export interface SplitLog {
  setIndex: number
  repIndex: number
  distance?: string
  time?: string
  /** Pace for this rep, e.g. "4:30" (min/km) — manually entered, or
   *  pre-filled (editable) from a matched Strava lap. */
  pace?: string
  notes?: string
  /** Heart rate for this rep — manually entered, or pre-filled (editable)
   *  from a matched Strava lap. `null` (rather than omitted) once saved,
   *  since Firestore rejects a literal `undefined` field. */
  avgHr?: number | null
  /** Optional blood-lactate reading (mmol/L) the athlete adds for this rep.
   *  `null` (rather than omitted) once saved, since Firestore rejects a
   *  literal `undefined` field. */
  lactate?: number | null
  /** Recovery duration AFTER this rep, before the next one starts (e.g.
   *  "1:30") — manually entered, or pre-filled (editable) from the
   *  matched Strava rest lap. Rest length is part of a threshold
   *  session's real physiological picture (too little/too much recovery
   *  changes the lactate/pace response), so it's kept alongside the
   *  rep's own data instead of only being shown once and discarded. */
  rest?: string
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

/** Sort order for same-day workouts: morning before evening before unspecified/other. */
const SESSION_SORT_ORDER: Record<string, number> = { am: 0, pm: 1, other: 2 }

/** Sort a same-day list of assigned workouts so morning always comes before evening. */
export function sortBySession<T extends { session?: 'am' | 'pm' | 'other' }>(workouts: T[]): T[] {
  return [...workouts].sort((a, b) =>
    (a.session ? SESSION_SORT_ORDER[a.session] : 1.5) - (b.session ? SESSION_SORT_ORDER[b.session] : 1.5)
  )
}
