'use client'

import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

type Language = 'en' | 'he'

interface Translations {
  // Common
  teamHaim: string
  eliteAthletic: string
  signOut: string
  profile: string
  save: string
  cancel: string
  close: string
  today: string
  yesterday: string
  week: string
  month: string
  all: string
  languageToggle: string
  languageToggleAria: string

  // Chat
  directMessage: string
  loadingMessages: string
  startConversation: string
  sendMessageTo: string
  typeMessage: string

  // Journey stage editor
  stageNameLabel: string
  stageTypeLabel: string
  stageStartDate: string
  stageEndDate: string
  stageFocusLabel: string
  stageFocusPlaceholder: string
  weeklyVolumeLabel: string
  weeklyVolumePlaceholder: string
  keyWorkoutsLabel: string
  milestonesLabel: string
  milestonesPlaceholder: string
  saveStageBtn: string

  // Coach chat hub
  messagesTitle: string
  chatWithAthletes: string
  searchAthletesPh: string
  loadingConversations: string
  noConversationsFound: string
  tryDifferentSearch: string
  athletesWillAppear: string
  startAConversation: string

  // Athlete roster
  athletesTitle: string
  athletesSubtitle: string
  generatingDots: string
  exportAllAthletes: string
  searchAthletesEventsPh: string
  viewProfileBtn: string
  exportAria: string
  exportingAria: string
  exportingDots: string
  exportToExcel: string
  editBtn: string
  removeBtn: string
  noAthletesSignedUp: string
  noAthletesMatching: string
  editAthleteTitle: string
  nameLabel: string
  emailLabel: string
  removeAthleteTitle: string
  removeAthleteDesc: string
  removingDots: string

  // Coach settings
  settingsTitle: string
  googleSheetsAutoSync: string
  beforeYouStart: string
  sheetsStep1Pre: string
  sheetsStep1Share: string
  sheetsStep1Mid: string
  sheetsStep1Editor: string
  sheetsStep2Save: string
  sheetsStep2SyncAll: string
  masterSheetId: string
  settingsSubtitle: string
  googleSheetsDescription: string
  sheetsStepCreate: string
  sheetsStepCopyId1: string
  sheetsStepCopyId2: string
  sheetsStepCopyId3: string
  sheetsStepClick: string
  sheetsStepThen: string
  copyBtn: string
  copiedBtn: string
  openSheet: string
  syncAllNowBtn: string
  lastSyncLabel: string
  neverLabel: string

  // Coach journey editor
  selectJourneyPh: string
  journeyTitleLabel: string
  goalRaceEventLabel: string
  startDateLabel: string
  goalRaceDateLabel2: string
  stageDialogTitle: string
  startLabel: string
  focusLabel: string
  notesLabel: string
  endLabel: string
  backToAthlete: string
  seasonJourneyTitle: string
  seasonJourneySubtitle: string
  untitledJourney: string
  blankBtn: string
  noJourneyYet: string
  goalAndDates: string
  targetTimeOptional: string
  saveJourneyBtn: string
  deleteJourneyBtn: string
  moveUpAria: string
  moveDownAria: string
  editStageAria: string
  deleteStageAria: string

  // Workout builder
  basicInformation: string
  descriptionLabel: string
  describeWorkoutPh: string
  warmupLabel: string
  cooldownLabel: string
  workoutSetsTitle: string
  additionalNotesTitle: string
  additionalNotesPh: string
  backToLibrary: string
  editWorkoutTitle: string
  createWorkoutTitle: string
  updateWorkoutTemplate: string
  buildNewWorkoutTemplate: string
  workoutTitleLabel: string
  workoutTitlePh: string
  workoutTypeLabel: string
  durationMinutesLabel: string
  distanceKmLabel: string
  warmupCooldownTitle: string
  warmupPh: string
  cooldownPh: string
  addSetBtn: string
  noSetsAdded: string
  setLabel: string
  repsLabel: string
  distanceDurationLabel: string
  distanceDurationPh: string
  paceEffortLabel: string
  paceEffortPh: string
  restLabel: string
  restPh: string
  updatingDots: string
  creatingDots: string
  updateWorkoutBtn: string
  onlyCoachCanSave: string

  // Workout library
  searchWorkoutsPh: string
  workoutLibrarySubtitle: string
  editWorkoutAria: string
  deleteWorkoutAria: string
  assignToAthleteBtn: string
  noWorkoutsYet: string
  noWorkoutsMatching: string
  deleteWorkoutTitle: string
  deleteWorkoutDesc: string
  deleteBtn: string
  deletingDots: string

  // Workout assign
  selectWorkoutTitle: string
  selectAthletesTitle: string
  selectDateTitle: string
  assignmentSummaryTitle: string
  backBtn: string
  assignWorkoutTitle: string
  assignWorkoutSubtitle: string
  noWorkoutsInLibrary: string
  workoutColon: string
  athletesColon: string
  dateColon: string
  notSelected: string
  athletesSelectedSuffix: string
  noneSelected: string
  assigningDots: string
  assignWorkoutBtn: string
  onlyCoachCanAssign: string

  // Athlete detail
  scheduleTab: string
  pacesTab: string
  progressTab: string
  upcomingWorkoutsTitle: string
  athleteLogLabel: string
  exportedToast: string
  exportFailedToast: string
  backToAthletes: string
  athleteNotFound: string
  exportBtn: string
  journeyBtn: string
  messageBtn: string
  activeGoalsLabel: string
  assignNewBtn: string
  noWorkoutsAssignedYet: string
  weeklyDistanceChart: string
  eventColon: string
  targetColon: string
  byColon: string
  // Landing page
  welcome: string
  signInDescription: string
  continueWithGoogle: string
  termsNotice: string
  selectYourRole: string
  chooseHowYoull: string
  athlete: string
  coach: string
  athleteRoleDesc: string
  coachRoleDesc: string
  settingUpAccount: string
  trackProgress: string
  trackProgressDesc: string
  smartScheduling: string
  smartSchedulingDesc: string
  directCommunication: string
  directCommunicationDesc: string
  allRightsReserved: string

  // Navigation
  dashboard: string
  schedule: string
  journey: string
  statistics: string
  chat: string
  athletes: string
  workouts: string
  settings: string
  coachPortal: string
  
  // Schedule
  weeklySchedule: string
  totalPlanned: string
  totalCompleted: string
  remaining: string
  noWorkout: string
  rest: string
  morning: string
  evening: string
  
  // Workout types
  easy: string
  longRun: string
  tempo: string
  intervals: string
  hillRepeats: string
  fartlek: string
  recovery: string
  strength: string
  crossTraining: string
  race: string
  timeTrial: string
  
  // Workout log
  logWorkout: string
  actualDistance: string
  actualPace: string
  howYouFelt: string
  notes: string
  great: string
  good: string
  okay: string
  tired: string
  struggling: string
  
  // Days
  sunday: string
  monday: string
  tuesday: string
  wednesday: string
  thursday: string
  friday: string
  saturday: string
  sun: string
  mon: string
  tue: string
  wed: string
  thu: string
  fri: string
  sat: string
  
  // Stats
  km: string
  min: string
  completed: string
  scheduled: string

  // Profile page
  myProfile: string
  yourAthleticProfile: string
  editProfile: string
  completeYourProfile: string
  completeYourProfileDesc: string
  exportMyData: string
  generating: string
  saveProfile: string
  changePhoto: string
  removePhotoAria: string
  noEventsListed: string
  goalLabel: string
  targetWord: string
  inWord: string
  athleteFallback: string

  // Profile form
  fieldName: string
  fieldDateOfBirth: string
  fieldGender: string
  selectPlaceholder: string
  male: string
  female: string
  otherGender: string
  fieldHeight: string
  fieldWeight: string
  fieldWeeklyMileage: string
  fieldRestingHR: string
  fieldMaxHR: string
  fieldCurrentHR: string
  fieldTargetHR: string
  fieldTargetPace: string
  fieldExperienceLevel: string
  fieldDiscipline: string
  fieldEvents: string
  fieldGoalRaceEvent: string
  fieldGoalRaceDate: string
  fieldTargetTime: string
  placeholderRecentHR: string
  placeholderGoalHR: string
  placeholderPace430: string
  placeholderEvents: string
  placeholderGoalRace: string
  placeholderTargetTime: string

  // Experience levels
  beginner: string
  intermediate: string
  advanced: string
  professional: string

  // Disciplines
  disciplineTrack: string
  disciplineRoad: string
  disciplineJogger: string
  disciplineTrail: string
  disciplineMixed: string

  // Profile tabs / sections
  tabPRs: string
  tabSeasonBest: string
  tabPaces: string
  tabGoals: string
  personalRecordsTitle: string
  seasonBestsTitle: string
  trainingPacesTitle: string
  goalsTitle: string
  noPRsYet: string
  noSeasonBestsYet: string
  noTrainingPacesYet: string
  noGoalsYet: string

  // PR / Pace editors
  recordPR: string
  recordSB: string
  addRecord: string
  eventDistance: string
  timeLabel: string
  dateField: string
  locationOptional: string
  placeholderEvent5K: string
  placeholderTime1845: string
  placeholderLocationTLV: string
  addTrainingPace: string
  paceTypeLabel: string
  pacePerKm: string
  noteOptional: string
  savePaceBtn: string
  placeholderPace500: string
  placeholderPaceDesc: string

  // Pace types
  paceEasy: string
  paceTempo: string
  paceThreshold: string
  paceInterval: string
  paceRepetition: string
  paceRace: string

  // Toasts
  toastProfilePhotoUpdated: string
  toastProfilePhotoRemoved: string
  toastProfileSaved: string
  toastProfileSaveFailed: string
  toastPhotoUploadFailed: string
  toastPhotoRemoveFailed: string
  toastChooseImage: string
  toastImageTooBig: string
  toastSaveChangesFailed: string
  toastUpdated: string
  toastAdded: string

  // Athlete dashboard
  welcomeBack: string
  welcomeTeamHaim: string
  coachWillAssign: string
  completeProfileBtn: string
  todaysWorkoutTitle: string
  viewFullDetails: string
  thisWeekStat: string
  workoutsCompletedCaption: string
  distanceStat: string
  kmLoggedCaption: string
  prsStat: string
  personalRecordsCaption: string
  goalsStat: string
  activeGoalsCaption: string
  upcomingWorkouts: string
  viewAll: string
  noUpcomingWorkouts: string
  tomorrow: string
  weeklyProgress: string
  workoutsCompletedLabel: string
  ofWord: string
  avgEffortLabel: string
  totalTimeLabel: string
  activeGoalsTitle: string
  noActiveGoals: string

  // Workout log form
  workoutLogHeading: string
  loggedBadge: string
  actualDistanceKm: string
  actualPaceKm: string
  examplePlaceholder10: string
  examplePlaceholder530: string
  effortRange: string
  effortHelper: string
  commentOptional: string
  commentPlaceholder: string
  savingDots: string
  updateLog: string
  saveLog: string
  toastEffortRequired: string
  toastDistanceInvalid: string
  toastWorkoutLogged: string
  toastSaveLogFailed: string

  // Training zones
  trainingZonesTitle: string
  toggleZonesAria: string
  zonesCalcFrom: string
  zonesAddPR: string
  zonesNoReference: string
  heartRateZones: string
  badgeKarvonen: string
  badgePercentMax: string
  howCalculated: string
  zonesFormulaIntro: string
  zonesFormulaTargets: string
  zonesFormulaHR: string

  // Schedule view
  scheduleTitle: string
  scheduleSubtitle: string
  noWorkoutScheduled: string
  warmupHeading: string
  workoutHeading: string
  cooldownHeading: string
  notesHeading: string
  yourNotesHeading: string
  coachFeedbackHeading: string
  restPrefix: string
  effortBadgeTitle: string
  effortBadge: string

  // Stats
  statisticsTitle: string
  statisticsSubtitle: string
  totalKm: string
  totalHours: string
  avgEffortStat: string
  workoutsLoggedStat: string
  logToSeeCharts: string
  weeklyTab: string
  monthlyTab: string
  weeklyDistance: string
  monthlyDistance: string
  averageEffortLevel: string
  prsAchievedChart: string
  recentPersonalRecords: string

  // Journey
  seasonJourneyHeading: string
  roadToGoalRace: string
  roadToGoalRaceLong: string
  startSeasonJourney: string
  planRoadDesc: string
  goalRaceLabel: string
  goalRacePlaceholder: string
  goalRaceDateLabel: string
  createMyJourney: string
  addStageBtn: string
  toastJourneyCreated: string
  toastStageSaved: string
  toastPickGoalDate: string
  toastLoadJourneyFailed: string
  toastSaveJourneyFailed: string
  mySeasonDefault: string

  // Journey timeline
  seasonJourneyUpper: string
  goalRaceFallback: string
  targetPrefix: string
  daysToRace: string
  progressLabel: string
  currentlyIn: string
  nextStage: string
  onWord: string
  noStagesYet: string
  useAddStage: string
  coachNotSetup: string
  nowBadge: string
  keyWorkouts: string
  milestones: string
  stageProgress: string
  raceDay: string

  // Coach dashboard
  coachDashboardTitle: string
  athletesStat: string
  workoutLibraryStat: string
  completedToday: string
  pendingToday: string
  athletesCardTitle: string
  viewAllAction: string
  todaysWorkoutsCard: string
  doneBadge: string
  pendingBadge: string
  noWorkoutsToday: string
  quickActions: string
  createWorkoutAction: string
  manageAthletesAction: string
  messagesAction: string
  viewProgressAction: string
  workoutLibraryCardTitle: string

  // Goal status
  goalActive: string
  goalAchieved: string
  goalArchived: string
}

const translations: Record<Language, Translations> = {
  en: {
    teamHaim: 'Team Haim',
    eliteAthletic: 'Elite Athletic Performance',
    signOut: 'Sign Out',
    profile: 'Profile',
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    today: 'Today',
    yesterday: 'Yesterday',
    week: 'Week',
    month: 'Month',
    all: 'All',
    languageToggle: 'עברית',
    languageToggleAria: 'Switch language to Hebrew',

    directMessage: 'Direct Message',
    loadingMessages: 'Loading messages...',
    startConversation: 'Start the conversation',
    sendMessageTo: 'Send a message to',
    typeMessage: 'Type a message...',

    stageNameLabel: 'Stage name',
    stageTypeLabel: 'Type',
    stageStartDate: 'Start date',
    stageEndDate: 'End date',
    stageFocusLabel: 'Focus',
    stageFocusPlaceholder: 'e.g. aerobic base, threshold work',
    weeklyVolumeLabel: 'Weekly volume (km)',
    weeklyVolumePlaceholder: 'e.g. 60',
    keyWorkoutsLabel: 'Key workouts (one per line)',
    milestonesLabel: 'Milestones (one per line)',
    milestonesPlaceholder: '10K time trial\nLong run 30 km',
    saveStageBtn: 'Save stage',

    messagesTitle: 'Messages',
    chatWithAthletes: 'Chat with your athletes',
    searchAthletesPh: 'Search athletes...',
    loadingConversations: 'Loading conversations...',
    noConversationsFound: 'No conversations found',
    tryDifferentSearch: 'Try a different search term',
    athletesWillAppear: 'Athletes will appear here when they sign up',
    startAConversation: 'Start a conversation...',

    athletesTitle: 'Athletes',
    athletesSubtitle: 'Manage your roster and view athlete profiles',
    generatingDots: 'Generating…',
    exportAllAthletes: 'Export all athletes',
    searchAthletesEventsPh: 'Search athletes or events...',
    viewProfileBtn: 'View Profile',
    exportAria: 'Export',
    exportingAria: 'Exporting',
    exportingDots: 'Exporting…',
    exportToExcel: 'Export to Excel',
    editBtn: 'Edit',
    removeBtn: 'Remove',
    noAthletesSignedUp: 'No athletes have signed up yet.',
    noAthletesMatching: 'No athletes found matching your search.',
    editAthleteTitle: 'Edit athlete',
    nameLabel: 'Name',
    emailLabel: 'Email',
    removeAthleteTitle: 'Remove this athlete?',
    removeAthleteDesc: 'This permanently deletes the athlete from the team in Firestore. Their profile and goals will be lost.',
    removingDots: 'Removing…',

    settingsTitle: 'Settings',
    googleSheetsAutoSync: 'Google Sheets Auto Sync',
    beforeYouStart: 'Before you start',
    sheetsStep1Pre: 'Click ',
    sheetsStep1Share: 'Share',
    sheetsStep1Mid: ' and add the service account below as an ',
    sheetsStep1Editor: 'Editor',
    sheetsStep2Save: 'Save',
    sheetsStep2SyncAll: 'Sync All Now',
    masterSheetId: 'Master Google Sheet ID',
    settingsSubtitle: 'Configure Google Sheets auto sync for the team.',
    googleSheetsDescription: 'Connect a master Google Sheet to automatically sync workouts, logs, profiles, and goals. Each athlete gets their own tab.',
    sheetsStepCreate: 'Create a Google Sheet (or open an existing one).',
    sheetsStepCopyId1: 'Copy the Sheet ID from the URL (the long ID between',
    sheetsStepCopyId2: 'and',
    sheetsStepCopyId3: ') and paste it below.',
    sheetsStepClick: 'Click ',
    sheetsStepThen: ', then ',
    copyBtn: 'Copy',
    copiedBtn: 'Copied',
    openSheet: 'Open sheet',
    syncAllNowBtn: 'Sync All Now',
    lastSyncLabel: 'Last sync',
    neverLabel: 'Never',

    selectJourneyPh: 'Select journey',
    journeyTitleLabel: 'Title',
    goalRaceEventLabel: 'Goal race event',
    startDateLabel: 'Start date',
    goalRaceDateLabel2: 'Goal race date',
    stageDialogTitle: 'Stage',
    startLabel: 'Start',
    focusLabel: 'Focus',
    notesLabel: 'Notes',
    endLabel: 'End',
    backToAthlete: 'Back to athlete',
    seasonJourneyTitle: 'Season Journey',
    seasonJourneySubtitle: "Build and edit the road to this athlete's goal race.",
    untitledJourney: 'Untitled',
    blankBtn: 'Blank',
    noJourneyYet: 'No journey yet. Create a blank one or pick a template above.',
    goalAndDates: 'Goal & dates',
    targetTimeOptional: 'Target time (optional)',
    saveJourneyBtn: 'Save journey',
    deleteJourneyBtn: 'Delete journey',
    moveUpAria: 'Move up',
    moveDownAria: 'Move down',
    editStageAria: 'Edit stage',
    deleteStageAria: 'Delete stage',

    basicInformation: 'Basic Information',
    descriptionLabel: 'Description',
    describeWorkoutPh: 'Describe the workout objective and focus...',
    warmupLabel: 'Warmup',
    cooldownLabel: 'Cooldown',
    workoutSetsTitle: 'Workout Sets',
    additionalNotesTitle: 'Additional Notes',
    additionalNotesPh: 'Any additional instructions or notes for the athlete...',
    backToLibrary: 'Back to Library',
    editWorkoutTitle: 'Edit Workout',
    createWorkoutTitle: 'Create Workout',
    updateWorkoutTemplate: 'Update this workout template',
    buildNewWorkoutTemplate: 'Build a new workout template for your athletes',
    workoutTitleLabel: 'Workout Title',
    workoutTitlePh: 'e.g., 800m Intervals',
    workoutTypeLabel: 'Workout Type',
    durationMinutesLabel: 'Duration (minutes)',
    distanceKmLabel: 'Distance (km)',
    warmupCooldownTitle: 'Warmup & Cooldown',
    warmupPh: 'e.g., 2 mile easy jog, dynamic stretching, 4x100m strides',
    cooldownPh: 'e.g., 1.5 mile easy jog, stretching',
    addSetBtn: 'Add Set',
    noSetsAdded: 'No sets added. Click "Add Set" to build interval or structured workouts.',
    setLabel: 'Set',
    repsLabel: 'Reps',
    distanceDurationLabel: 'Distance/Duration',
    distanceDurationPh: 'e.g., 400m or 2:00',
    paceEffortLabel: 'Pace/Effort',
    paceEffortPh: 'e.g., 68-70 sec',
    restLabel: 'Rest',
    restPh: 'e.g., 90 sec jog',
    updatingDots: 'Updating...',
    creatingDots: 'Creating...',
    updateWorkoutBtn: 'Update Workout',
    onlyCoachCanSave: 'Only the coach account can save workouts.',

    searchWorkoutsPh: 'Search workouts...',
    workoutLibrarySubtitle: 'Create and manage your workout templates',
    editWorkoutAria: 'Edit workout',
    deleteWorkoutAria: 'Delete workout',
    assignToAthleteBtn: 'Assign to Athlete',
    noWorkoutsYet: 'No workouts yet — create your first one.',
    noWorkoutsMatching: 'No workouts found matching your search.',
    deleteWorkoutTitle: 'Delete this workout?',
    deleteWorkoutDesc: 'This permanently removes the workout template from Firestore. Existing assigned workouts that referenced it will keep their embedded copy.',
    deleteBtn: 'Delete',
    deletingDots: 'Deleting…',

    selectWorkoutTitle: 'Select Workout',
    selectAthletesTitle: 'Select Athletes',
    selectDateTitle: 'Select Date',
    assignmentSummaryTitle: 'Assignment Summary',
    backBtn: 'Back',
    assignWorkoutTitle: 'Assign Workout',
    assignWorkoutSubtitle: 'Select a workout, athletes, and date to schedule',
    noWorkoutsInLibrary: 'No workouts in the library yet.',
    workoutColon: 'Workout:',
    athletesColon: 'Athletes:',
    dateColon: 'Date:',
    notSelected: 'Not selected',
    athletesSelectedSuffix: 'athlete(s) selected',
    noneSelected: 'None selected',
    assigningDots: 'Assigning...',
    assignWorkoutBtn: 'Assign Workout',
    onlyCoachCanAssign: 'Only the coach account can assign workouts.',

    scheduleTab: 'Schedule',
    pacesTab: 'Paces',
    progressTab: 'Progress',
    upcomingWorkoutsTitle: 'Upcoming Workouts',
    athleteLogLabel: 'Athlete Log',
    exportedToast: 'Exported',
    exportFailedToast: 'Export failed. Please try again.',
    backToAthletes: 'Back to Athletes',
    athleteNotFound: 'Athlete not found.',
    exportBtn: 'Export',
    journeyBtn: 'Journey',
    messageBtn: 'Message',
    activeGoalsLabel: 'Active Goals',
    assignNewBtn: 'Assign New',
    noWorkoutsAssignedYet: 'No workouts assigned yet',
    weeklyDistanceChart: 'Weekly Distance (km)',
    eventColon: 'Event:',
    targetColon: 'Target:',
    byColon: 'By:',

    welcome: 'Welcome',
    signInDescription: 'Sign in to access your training dashboard',
    continueWithGoogle: 'Continue with Google',
    termsNotice: 'By signing in, you agree to our Terms of Service and Privacy Policy',
    selectYourRole: 'Select Your Role',
    chooseHowYoull: "Choose how you'll use Team Haim",
    athlete: 'Athlete',
    coach: 'Coach',
    athleteRoleDesc: 'View workouts, track progress, chat with coach',
    coachRoleDesc: 'Manage athletes, create workouts, track team',
    settingUpAccount: 'Setting up your account...',
    trackProgress: 'Track Progress',
    trackProgressDesc: 'Monitor your performance with detailed statistics and PR tracking',
    smartScheduling: 'Smart Scheduling',
    smartSchedulingDesc: 'View and manage workouts with weekly and monthly calendars',
    directCommunication: 'Direct Communication',
    directCommunicationDesc: 'Real-time chat between athletes and coaches',
    allRightsReserved: 'All rights reserved.',

    dashboard: 'Dashboard',
    schedule: 'Schedule',
    journey: 'Journey',
    statistics: 'Statistics',
    chat: 'Chat',
    athletes: 'Athletes',
    workouts: 'Workouts',
    settings: 'Settings',
    coachPortal: 'Coach Portal',
    
    weeklySchedule: 'Weekly Schedule',
    totalPlanned: 'Total Planned',
    totalCompleted: 'Completed',
    remaining: 'Remaining',
    noWorkout: 'No workout',
    rest: 'Rest',
    morning: 'Morning',
    evening: 'Evening',
    
    easy: 'Easy',
    longRun: 'Long Run',
    tempo: 'Tempo',
    intervals: 'Intervals',
    hillRepeats: 'Hill Repeats',
    fartlek: 'Fartlek',
    recovery: 'Recovery',
    strength: 'Strength',
    crossTraining: 'Cross Training',
    race: 'Race',
    timeTrial: 'Time Trial',
    
    logWorkout: 'Log Workout',
    actualDistance: 'Actual Distance',
    actualPace: 'Actual Pace',
    howYouFelt: 'How did you feel?',
    notes: 'Notes',
    great: 'Great',
    good: 'Good',
    okay: 'Okay',
    tired: 'Tired',
    struggling: 'Struggling',
    
    sunday: 'Sunday',
    monday: 'Monday',
    tuesday: 'Tuesday',
    wednesday: 'Wednesday',
    thursday: 'Thursday',
    friday: 'Friday',
    saturday: 'Saturday',
    sun: 'Sun',
    mon: 'Mon',
    tue: 'Tue',
    wed: 'Wed',
    thu: 'Thu',
    fri: 'Fri',
    sat: 'Sat',
    
    km: 'km',
    min: 'min',
    completed: 'Completed',
    scheduled: 'Scheduled',

    myProfile: 'My Profile',
    yourAthleticProfile: 'Your athletic profile and training information',
    editProfile: 'Edit Profile',
    completeYourProfile: 'Complete your profile',
    completeYourProfileDesc: 'Add your details so your coach can tailor your training.',
    exportMyData: 'Export my data',
    generating: 'Generating…',
    saveProfile: 'Save Profile',
    changePhoto: 'Change photo',
    removePhotoAria: 'Remove profile photo',
    noEventsListed: 'No events listed yet',
    goalLabel: 'Goal:',
    targetWord: 'target',
    inWord: 'in',
    athleteFallback: 'Athlete',

    fieldName: 'Name',
    fieldDateOfBirth: 'Date of Birth',
    fieldGender: 'Gender',
    selectPlaceholder: 'Select…',
    male: 'Male',
    female: 'Female',
    otherGender: 'Other',
    fieldHeight: 'Height (cm)',
    fieldWeight: 'Weight (kg)',
    fieldWeeklyMileage: 'Weekly mileage (km)',
    fieldRestingHR: 'Resting HR (bpm)',
    fieldMaxHR: 'Max HR (bpm)',
    fieldCurrentHR: 'Current HR (bpm)',
    fieldTargetHR: 'Target HR (bpm)',
    fieldTargetPace: 'Target pace (min/km)',
    fieldExperienceLevel: 'Experience level',
    fieldDiscipline: 'Discipline',
    fieldEvents: 'Events (comma separated)',
    fieldGoalRaceEvent: 'Goal race event',
    fieldGoalRaceDate: 'Goal race date',
    fieldTargetTime: 'Target time',
    placeholderRecentHR: 'recent training avg',
    placeholderGoalHR: 'goal effort HR',
    placeholderPace430: 'e.g. 4:30',
    placeholderEvents: 'e.g. 800m, 1500m, 3000m',
    placeholderGoalRace: 'e.g. Tel Aviv Half',
    placeholderTargetTime: 'e.g. 1:35:00',

    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
    professional: 'Professional',

    disciplineTrack: 'Track & Field',
    disciplineRoad: 'Distance / Road',
    disciplineJogger: 'Jogger',
    disciplineTrail: 'Trail',
    disciplineMixed: 'Mixed',

    tabPRs: 'PRs',
    tabSeasonBest: 'Season Best',
    tabPaces: 'Paces',
    tabGoals: 'Goals',
    personalRecordsTitle: 'Personal Records',
    seasonBestsTitle: 'Season Bests',
    trainingPacesTitle: 'Training Paces',
    goalsTitle: 'Goals',
    noPRsYet: 'No personal records yet',
    noSeasonBestsYet: 'No season bests recorded yet',
    noTrainingPacesYet: 'No training paces yet',
    noGoalsYet: 'No goals yet',

    recordPR: 'Personal Record',
    recordSB: 'Season Best',
    addRecord: 'Add',
    eventDistance: 'Event / distance',
    timeLabel: 'Time',
    dateField: 'Date',
    locationOptional: 'Location (optional)',
    placeholderEvent5K: 'e.g. 5K',
    placeholderTime1845: 'e.g. 18:45',
    placeholderLocationTLV: 'e.g. Tel Aviv',
    addTrainingPace: 'Add training pace',
    paceTypeLabel: 'Type',
    pacePerKm: 'Pace (min/km)',
    noteOptional: 'Note (optional)',
    savePaceBtn: 'Save pace',
    placeholderPace500: 'e.g. 5:00',
    placeholderPaceDesc: 'e.g. half-marathon goal pace',

    paceEasy: 'Easy',
    paceTempo: 'Tempo',
    paceThreshold: 'Threshold',
    paceInterval: 'Interval',
    paceRepetition: 'Repetition',
    paceRace: 'Race',

    toastProfilePhotoUpdated: 'Profile photo updated',
    toastProfilePhotoRemoved: 'Profile photo removed',
    toastProfileSaved: 'Profile saved!',
    toastProfileSaveFailed: 'Failed to save profile',
    toastPhotoUploadFailed: 'Failed to upload photo',
    toastPhotoRemoveFailed: 'Failed to remove photo',
    toastChooseImage: 'Please choose an image file',
    toastImageTooBig: 'Image is larger than 5 MB',
    toastSaveChangesFailed: 'Failed to save changes',
    toastUpdated: 'Updated',
    toastAdded: 'Added',

    welcomeBack: 'Welcome back',
    welcomeTeamHaim: 'Welcome to Team Haim!',
    coachWillAssign: 'Your coach will assign your first workout soon.',
    completeProfileBtn: 'Complete your profile',
    todaysWorkoutTitle: "Today's Workout",
    viewFullDetails: 'View full details',
    thisWeekStat: 'This Week',
    workoutsCompletedCaption: 'workouts completed',
    distanceStat: 'Distance',
    kmLoggedCaption: 'km logged',
    prsStat: 'PRs',
    personalRecordsCaption: 'personal records',
    goalsStat: 'Goals',
    activeGoalsCaption: 'active goals',
    upcomingWorkouts: 'Upcoming Workouts',
    viewAll: 'View all',
    noUpcomingWorkouts: 'No upcoming workouts yet.',
    tomorrow: 'Tomorrow',
    weeklyProgress: 'Weekly Progress',
    workoutsCompletedLabel: 'Workouts Completed',
    ofWord: 'of',
    avgEffortLabel: 'Avg Effort',
    totalTimeLabel: 'Total Time',
    activeGoalsTitle: 'Active Goals',
    noActiveGoals: 'No goals yet — add some on your profile.',

    workoutLogHeading: 'Workout Log',
    loggedBadge: 'Logged',
    actualDistanceKm: 'Actual Distance (km)',
    actualPaceKm: 'Actual Pace (/km)',
    examplePlaceholder10: 'e.g. 10',
    examplePlaceholder530: 'e.g. 5:30',
    effortRange: 'Effort (1–10)',
    effortHelper: '1 = very easy · 5 = moderate · 10 = max effort',
    commentOptional: 'Comment (optional)',
    commentPlaceholder: 'How did it feel? What did you notice?',
    savingDots: 'Saving...',
    updateLog: 'Update Log',
    saveLog: 'Save Log',
    toastEffortRequired: 'Please rate your effort from 1 to 10',
    toastDistanceInvalid: 'Please enter a valid distance in km',
    toastWorkoutLogged: 'Workout logged!',
    toastSaveLogFailed: 'Failed to save log. Please try again.',

    trainingZonesTitle: 'Training Zones',
    toggleZonesAria: 'Toggle zones',
    zonesCalcFrom: 'Calculated from',
    zonesAddPR: 'Add a recent PR (e.g. 5K, 10K) to compute your training paces.',
    zonesNoReference: 'No reference race yet — add a PR or set one manually in your profile.',
    heartRateZones: 'Heart-rate zones',
    badgeKarvonen: 'Karvonen',
    badgePercentMax: '% max HR',
    howCalculated: 'How is this calculated?',
    zonesFormulaIntro:
      "We use Jack Daniels' VDOT model. From the athlete's reference race we derive their VO₂max:",
    zonesFormulaTargets:
      'Each zone has a target %VO2max (Easy ~70%, Marathon ~84%, Threshold ~88%, Interval ~98%, Repetition ~105%). We invert the cost equation to find the pace that matches each anchor.',
    zonesFormulaHR:
      'Heart-rate zones use the Karvonen reserve formula when resting HR is known: zone = resting + pct × (max − resting); otherwise we fall back to %max HR.',

    scheduleTitle: 'Schedule',
    scheduleSubtitle: 'View and track your training plan',
    noWorkoutScheduled: 'No workout scheduled',
    warmupHeading: 'Warmup',
    workoutHeading: 'Workout',
    cooldownHeading: 'Cooldown',
    notesHeading: 'Notes',
    yourNotesHeading: 'Your Notes',
    coachFeedbackHeading: 'Coach Feedback',
    restPrefix: 'Rest:',
    effortBadgeTitle: 'Perceived effort (1–10)',
    effortBadge: 'Effort',

    statisticsTitle: 'Statistics',
    statisticsSubtitle: 'Track your training progress and performance trends',
    totalKm: 'Total km',
    totalHours: 'Total hours',
    avgEffortStat: 'Avg effort (1-10)',
    workoutsLoggedStat: 'Workouts logged',
    logToSeeCharts: 'Log workouts to see your progress charts here.',
    weeklyTab: 'Weekly',
    monthlyTab: 'Monthly',
    weeklyDistance: 'Weekly Distance (km)',
    monthlyDistance: 'Monthly Distance (km)',
    averageEffortLevel: 'Average Effort Level',
    prsAchievedChart: 'PRs Achieved',
    recentPersonalRecords: 'Recent Personal Records',

    seasonJourneyHeading: 'Season Journey',
    roadToGoalRace: 'Your road to the next goal race.',
    roadToGoalRaceLong:
      'Your road to the next goal race. Distances are in km, paces in min/km.',
    startSeasonJourney: 'Start your season journey',
    planRoadDesc:
      'Plan your road to your next goal race. You can add and update stages and milestones any time.',
    goalRaceLabel: 'Goal race',
    goalRacePlaceholder: 'e.g. Tel Aviv Half',
    goalRaceDateLabel: 'Goal race date',
    createMyJourney: 'Create my journey',
    addStageBtn: 'Add stage',
    toastJourneyCreated: 'Journey created — add your first stage',
    toastStageSaved: 'Stage saved',
    toastPickGoalDate: 'Pick a goal race date first',
    toastLoadJourneyFailed: 'Failed to load your journey',
    toastSaveJourneyFailed: 'Failed to save journey',
    mySeasonDefault: 'My Season',

    seasonJourneyUpper: 'Season Journey',
    goalRaceFallback: 'Goal race',
    targetPrefix: 'Target',
    daysToRace: 'days to race',
    progressLabel: 'Progress',
    currentlyIn: 'Currently in',
    nextStage: 'next:',
    onWord: 'on',
    noStagesYet: 'No stages yet.',
    useAddStage: 'Use “Add stage” to begin.',
    coachNotSetup: 'Your coach hasn’t set this up yet.',
    nowBadge: 'Now',
    keyWorkouts: 'Key workouts',
    milestones: 'Milestones',
    stageProgress: 'Stage progress',
    raceDay: 'Race day',

    coachDashboardTitle: 'Coach Dashboard',
    athletesStat: 'Athletes',
    workoutLibraryStat: 'Workout Library',
    completedToday: 'Completed Today',
    pendingToday: 'Pending Today',
    athletesCardTitle: 'Athletes',
    viewAllAction: 'View All',
    todaysWorkoutsCard: "Today's Workouts",
    doneBadge: 'Done',
    pendingBadge: 'Pending',
    noWorkoutsToday: 'No workouts scheduled for today',
    quickActions: 'Quick Actions',
    createWorkoutAction: 'Create Workout',
    manageAthletesAction: 'Manage Athletes',
    messagesAction: 'Messages',
    viewProgressAction: 'View Progress',
    workoutLibraryCardTitle: 'Workout Library',

    goalActive: 'Active',
    goalAchieved: 'Achieved',
    goalArchived: 'Archived',
  },
  he: {
    teamHaim: 'צוות חיים',
    eliteAthletic: 'ביצועי ספורט עילית',
    signOut: 'התנתק',
    profile: 'פרופיל',
    save: 'שמור',
    cancel: 'בטל',
    close: 'סגור',
    today: 'היום',
    yesterday: 'אתמול',
    week: 'שבוע',
    month: 'חודש',
    all: 'הכל',
    languageToggle: 'English',
    languageToggleAria: 'החלף שפה לאנגלית',

    directMessage: 'הודעה ישירה',
    loadingMessages: 'טוען הודעות...',
    startConversation: 'התחל שיחה',
    sendMessageTo: 'שלח הודעה אל',
    typeMessage: 'הקלד הודעה...',

    stageNameLabel: 'שם השלב',
    stageTypeLabel: 'סוג',
    stageStartDate: 'תאריך התחלה',
    stageEndDate: 'תאריך סיום',
    stageFocusLabel: 'דגש',
    stageFocusPlaceholder: 'לדוגמה: בסיס אירובי, סף אנאירובי',
    weeklyVolumeLabel: 'נפח שבועי (ק"מ)',
    weeklyVolumePlaceholder: 'לדוגמה: 60',
    keyWorkoutsLabel: 'אימונים מרכזיים (אחד לשורה)',
    milestonesLabel: 'אבני דרך (אחת לשורה)',
    milestonesPlaceholder: 'מבחן 10 ק"מ\nריצה ארוכה 30 ק"מ',
    saveStageBtn: 'שמור שלב',

    messagesTitle: 'הודעות',
    chatWithAthletes: 'שוחח עם הספורטאים שלך',
    searchAthletesPh: 'חיפוש ספורטאים...',
    loadingConversations: 'טוען שיחות...',
    noConversationsFound: 'לא נמצאו שיחות',
    tryDifferentSearch: 'נסה מונח חיפוש אחר',
    athletesWillAppear: 'ספורטאים יופיעו כאן לאחר ההרשמה',
    startAConversation: 'התחל שיחה...',

    athletesTitle: 'ספורטאים',
    athletesSubtitle: 'נהל את הרשימה וצפה בפרופילי הספורטאים',
    generatingDots: 'יוצר…',
    exportAllAthletes: 'ייצא את כל הספורטאים',
    searchAthletesEventsPh: 'חיפוש ספורטאים או אירועים...',
    viewProfileBtn: 'הצג פרופיל',
    exportAria: 'ייצא',
    exportingAria: 'מייצא',
    exportingDots: 'מייצא…',
    exportToExcel: 'ייצא לאקסל',
    editBtn: 'ערוך',
    removeBtn: 'הסר',
    noAthletesSignedUp: 'עדיין לא נרשמו ספורטאים.',
    noAthletesMatching: 'לא נמצאו ספורטאים התואמים לחיפוש שלך.',
    editAthleteTitle: 'ערוך ספורטאי',
    nameLabel: 'שם',
    emailLabel: 'אימייל',
    removeAthleteTitle: 'להסיר את הספורטאי?',
    removeAthleteDesc: 'פעולה זו תמחק לצמיתות את הספורטאי מהקבוצה ב-Firestore. הפרופיל והמטרות שלו יאבדו.',
    removingDots: 'מסיר…',

    settingsTitle: 'הגדרות',
    googleSheetsAutoSync: 'סנכרון אוטומטי ל-Google Sheets',
    beforeYouStart: 'לפני שמתחילים',
    sheetsStep1Pre: 'לחץ ',
    sheetsStep1Share: 'שתף',
    sheetsStep1Mid: ' והוסף את חשבון השירות שלמטה כ-',
    sheetsStep1Editor: 'עורך',
    sheetsStep2Save: 'שמור',
    sheetsStep2SyncAll: 'סנכרן הכל עכשיו',
    masterSheetId: 'מזהה Google Sheet ראשי',
    settingsSubtitle: 'הגדר סנכרון אוטומטי של Google Sheets עבור הקבוצה.',
    googleSheetsDescription: 'חבר Google Sheet ראשי כדי לסנכרן אוטומטית אימונים, יומנים, פרופילים ומטרות. כל ספורטאי מקבל לשונית משלו.',
    sheetsStepCreate: 'צור Google Sheet (או פתח קיים).',
    sheetsStepCopyId1: 'העתק את מזהה הגיליון מה-URL (המזהה הארוך בין',
    sheetsStepCopyId2: 'ל-',
    sheetsStepCopyId3: ') והדבק אותו למטה.',
    sheetsStepClick: 'לחץ ',
    sheetsStepThen: ', אז ',
    copyBtn: 'העתק',
    copiedBtn: 'הועתק',
    openSheet: 'פתח גיליון',
    syncAllNowBtn: 'סנכרן הכל עכשיו',
    lastSyncLabel: 'סנכרון אחרון',
    neverLabel: 'אף פעם',

    selectJourneyPh: 'בחר מסע',
    journeyTitleLabel: 'כותרת',
    goalRaceEventLabel: 'אירוע מירוץ היעד',
    startDateLabel: 'תאריך התחלה',
    goalRaceDateLabel2: 'תאריך מירוץ היעד',
    stageDialogTitle: 'שלב',
    startLabel: 'התחלה',
    focusLabel: 'דגש',
    notesLabel: 'הערות',
    endLabel: 'סיום',
    backToAthlete: 'חזרה לספורטאי',
    seasonJourneyTitle: 'מסע העונה',
    seasonJourneySubtitle: 'בנה וערוך את הדרך למירוץ היעד של הספורטאי.',
    untitledJourney: 'ללא כותרת',
    blankBtn: 'ריק',
    noJourneyYet: 'אין עדיין מסע. צור מסע חדש או בחר תבנית למעלה.',
    goalAndDates: 'יעד ותאריכים',
    targetTimeOptional: 'זמן יעד (אופציונלי)',
    saveJourneyBtn: 'שמור מסע',
    deleteJourneyBtn: 'מחק מסע',
    moveUpAria: 'הזז למעלה',
    moveDownAria: 'הזז למטה',
    editStageAria: 'ערוך שלב',
    deleteStageAria: 'מחק שלב',

    basicInformation: 'מידע בסיסי',
    descriptionLabel: 'תיאור',
    describeWorkoutPh: 'תאר את מטרת האימון והדגשים...',
    warmupLabel: 'חימום',
    cooldownLabel: 'שחרור',
    workoutSetsTitle: 'סטים של האימון',
    additionalNotesTitle: 'הערות נוספות',
    additionalNotesPh: 'הוראות או הערות נוספות לספורטאי...',
    backToLibrary: 'חזרה לספרייה',
    editWorkoutTitle: 'ערוך אימון',
    createWorkoutTitle: 'צור אימון',
    updateWorkoutTemplate: 'עדכן תבנית אימון זו',
    buildNewWorkoutTemplate: 'בנה תבנית אימון חדשה לספורטאים שלך',
    workoutTitleLabel: 'כותרת האימון',
    workoutTitlePh: 'לדוגמה: אינטרוולים 800 מ\'',
    workoutTypeLabel: 'סוג האימון',
    durationMinutesLabel: 'משך (דקות)',
    distanceKmLabel: 'מרחק (ק"מ)',
    warmupCooldownTitle: 'חימום ושחרור',
    warmupPh: 'לדוגמה: ריצה קלה 3 ק"מ, מתיחות דינמיות, 4x100 מ\' זינוקים',
    cooldownPh: 'לדוגמה: ריצה קלה 2 ק"מ, מתיחות',
    addSetBtn: 'הוסף סט',
    noSetsAdded: 'לא נוספו סטים. לחץ "הוסף סט" כדי לבנות אימוני אינטרוולים או אימונים מובנים.',
    setLabel: 'סט',
    repsLabel: 'חזרות',
    distanceDurationLabel: 'מרחק/משך',
    distanceDurationPh: 'לדוגמה: 400 מ\' או 2:00',
    paceEffortLabel: 'קצב/מאמץ',
    paceEffortPh: 'לדוגמה: 68-70 שניות',
    restLabel: 'מנוחה',
    restPh: 'לדוגמה: 90 שניות ריצה קלה',
    updatingDots: 'מעדכן...',
    creatingDots: 'יוצר...',
    updateWorkoutBtn: 'עדכן אימון',
    onlyCoachCanSave: 'רק חשבון המאמן יכול לשמור אימונים.',

    searchWorkoutsPh: 'חיפוש אימונים...',
    workoutLibrarySubtitle: 'צור ונהל תבניות אימון',
    editWorkoutAria: 'ערוך אימון',
    deleteWorkoutAria: 'מחק אימון',
    assignToAthleteBtn: 'הקצה לספורטאי',
    noWorkoutsYet: 'אין עדיין אימונים — צור את הראשון.',
    noWorkoutsMatching: 'לא נמצאו אימונים התואמים לחיפוש שלך.',
    deleteWorkoutTitle: 'למחוק את האימון?',
    deleteWorkoutDesc: 'פעולה זו מסירה לצמיתות את תבנית האימון מ-Firestore. אימונים שהוקצו ומפנים אליה ישמרו את העותק המוטמע.',
    deleteBtn: 'מחק',
    deletingDots: 'מוחק…',

    selectWorkoutTitle: 'בחר אימון',
    selectAthletesTitle: 'בחר ספורטאים',
    selectDateTitle: 'בחר תאריך',
    assignmentSummaryTitle: 'סיכום הקצאה',
    backBtn: 'חזור',
    assignWorkoutTitle: 'הקצה אימון',
    assignWorkoutSubtitle: 'בחר אימון, ספורטאים ותאריך לתזמון',
    noWorkoutsInLibrary: 'אין עדיין אימונים בספרייה.',
    workoutColon: 'אימון:',
    athletesColon: 'ספורטאים:',
    dateColon: 'תאריך:',
    notSelected: 'לא נבחר',
    athletesSelectedSuffix: 'ספורטאים נבחרו',
    noneSelected: 'לא נבחר אף אחד',
    assigningDots: 'מקצה...',
    assignWorkoutBtn: 'הקצה אימון',
    onlyCoachCanAssign: 'רק חשבון המאמן יכול להקצות אימונים.',

    scheduleTab: 'לו"ז',
    pacesTab: 'קצבים',
    progressTab: 'התקדמות',
    upcomingWorkoutsTitle: 'אימונים קרובים',
    athleteLogLabel: 'יומן ספורטאי',
    exportedToast: 'יוצא',
    exportFailedToast: 'הייצוא נכשל. אנא נסה שוב.',
    backToAthletes: 'חזרה לספורטאים',
    athleteNotFound: 'הספורטאי לא נמצא.',
    exportBtn: 'ייצא',
    journeyBtn: 'מסע',
    messageBtn: 'הודעה',
    activeGoalsLabel: 'מטרות פעילות',
    assignNewBtn: 'הקצה חדש',
    noWorkoutsAssignedYet: 'עדיין לא הוקצו אימונים',
    weeklyDistanceChart: 'מרחק שבועי (ק"מ)',
    eventColon: 'אירוע:',
    targetColon: 'יעד:',
    byColon: 'עד:',

    welcome: 'ברוכים הבאים',
    signInDescription: 'התחבר כדי לגשת ללוח האימונים שלך',
    continueWithGoogle: 'המשך עם Google',
    termsNotice: 'בהתחברות, אתה מסכים לתנאי השימוש ולמדיניות הפרטיות שלנו',
    selectYourRole: 'בחר את התפקיד שלך',
    chooseHowYoull: 'בחר כיצד תשתמש ב-Team Haim',
    athlete: 'ספורטאי',
    coach: 'מאמן',
    athleteRoleDesc: 'צפה באימונים, עקוב אחר התקדמות, שוחח עם המאמן',
    coachRoleDesc: 'נהל ספורטאים, צור אימונים, עקוב אחר הקבוצה',
    settingUpAccount: 'מגדיר את החשבון שלך...',
    trackProgress: 'עקוב אחר ההתקדמות',
    trackProgressDesc: 'עקוב אחר הביצועים שלך עם סטטיסטיקות מפורטות ושיאים אישיים',
    smartScheduling: 'תזמון חכם',
    smartSchedulingDesc: 'צפה ונהל אימונים עם לוחות שבועיים וחודשיים',
    directCommunication: 'תקשורת ישירה',
    directCommunicationDesc: 'צ\'אט בזמן אמת בין ספורטאים למאמנים',
    allRightsReserved: 'כל הזכויות שמורות.',

    dashboard: 'לוח בקרה',
    schedule: 'לוח זמנים',
    journey: 'המסע',
    statistics: 'סטטיסטיקות',
    chat: 'צ\'אט',
    athletes: 'ספורטאים',
    workouts: 'אימונים',
    settings: 'הגדרות',
    coachPortal: 'אזור המאמן',
    
    weeklySchedule: 'לוח שבועי',
    totalPlanned: 'סה"כ מתוכנן',
    totalCompleted: 'הושלם',
    remaining: 'נותר',
    noWorkout: 'אין אימון',
    rest: 'מנוחה',
    morning: 'בוקר',
    evening: 'ערב',
    
    easy: 'קל',
    longRun: 'ריצה ארוכה',
    tempo: 'טמפו',
    intervals: 'אינטרוולים',
    hillRepeats: 'חזרות גבעה',
    fartlek: 'פרטלק',
    recovery: 'התאוששות',
    strength: 'כוח',
    crossTraining: 'אימון משולב',
    race: 'תחרות',
    timeTrial: 'מבחן זמן',
    
    logWorkout: 'תעד אימון',
    actualDistance: 'מרחק בפועל',
    actualPace: 'קצב בפועל',
    howYouFelt: 'איך הרגשת?',
    notes: 'הערות',
    great: 'מעולה',
    good: 'טוב',
    okay: 'בסדר',
    tired: 'עייף',
    struggling: 'מתקשה',
    
    sunday: 'ראשון',
    monday: 'שני',
    tuesday: 'שלישי',
    wednesday: 'רביעי',
    thursday: 'חמישי',
    friday: 'שישי',
    saturday: 'שבת',
    sun: 'א',
    mon: 'ב',
    tue: 'ג',
    wed: 'ד',
    thu: 'ה',
    fri: 'ו',
    sat: 'ש',
    
    km: 'ק"מ',
    min: 'דק',
    completed: 'הושלם',
    scheduled: 'מתוכנן',

    myProfile: 'הפרופיל שלי',
    yourAthleticProfile: 'הפרופיל הספורטיבי ומידע האימון שלך',
    editProfile: 'ערוך פרופיל',
    completeYourProfile: 'השלם את הפרופיל שלך',
    completeYourProfileDesc: 'הוסף את הפרטים שלך כדי שהמאמן יוכל להתאים את האימונים.',
    exportMyData: 'ייצא את הנתונים שלי',
    generating: 'מייצא…',
    saveProfile: 'שמור פרופיל',
    changePhoto: 'החלף תמונה',
    removePhotoAria: 'הסר תמונת פרופיל',
    noEventsListed: 'עדיין לא נרשמו אירועים',
    goalLabel: 'יעד:',
    targetWord: 'יעד',
    inWord: 'ב-',
    athleteFallback: 'ספורטאי',

    fieldName: 'שם',
    fieldDateOfBirth: 'תאריך לידה',
    fieldGender: 'מגדר',
    selectPlaceholder: 'בחר…',
    male: 'זכר',
    female: 'נקבה',
    otherGender: 'אחר',
    fieldHeight: 'גובה (ס"מ)',
    fieldWeight: 'משקל (ק"ג)',
    fieldWeeklyMileage: 'נפח שבועי (ק"מ)',
    fieldRestingHR: 'דופק מנוחה (פעימות/דקה)',
    fieldMaxHR: 'דופק מקסימלי (פעימות/דקה)',
    fieldCurrentHR: 'דופק נוכחי (פעימות/דקה)',
    fieldTargetHR: 'דופק יעד (פעימות/דקה)',
    fieldTargetPace: 'קצב יעד (דק׳/ק"מ)',
    fieldExperienceLevel: 'רמת ניסיון',
    fieldDiscipline: 'דיסציפלינה',
    fieldEvents: 'אירועים (מופרדים בפסיק)',
    fieldGoalRaceEvent: 'מירוץ יעד',
    fieldGoalRaceDate: 'תאריך מירוץ היעד',
    fieldTargetTime: 'זמן יעד',
    placeholderRecentHR: 'ממוצע אימונים אחרונים',
    placeholderGoalHR: 'דופק יעד למאמץ',
    placeholderPace430: 'לדוגמה 4:30',
    placeholderEvents: 'לדוגמה 800 מ׳, 1500 מ׳, 3000 מ׳',
    placeholderGoalRace: 'לדוגמה חצי מרתון תל אביב',
    placeholderTargetTime: 'לדוגמה 1:35:00',

    beginner: 'מתחיל',
    intermediate: 'בינוני',
    advanced: 'מתקדם',
    professional: 'מקצועני',

    disciplineTrack: 'אתלטיקה',
    disciplineRoad: 'ריצת כביש / מרחקים',
    disciplineJogger: 'ריצת בריאות',
    disciplineTrail: 'שטח',
    disciplineMixed: 'מעורב',

    tabPRs: 'שיאים',
    tabSeasonBest: 'שיא עונה',
    tabPaces: 'קצבים',
    tabGoals: 'יעדים',
    personalRecordsTitle: 'שיאים אישיים',
    seasonBestsTitle: 'שיאי עונה',
    trainingPacesTitle: 'קצבי אימון',
    goalsTitle: 'יעדים',
    noPRsYet: 'עדיין אין שיאים אישיים',
    noSeasonBestsYet: 'עדיין לא נרשמו שיאי עונה',
    noTrainingPacesYet: 'עדיין אין קצבי אימון',
    noGoalsYet: 'עדיין אין יעדים',

    recordPR: 'שיא אישי',
    recordSB: 'שיא עונה',
    addRecord: 'הוסף',
    eventDistance: 'אירוע / מרחק',
    timeLabel: 'זמן',
    dateField: 'תאריך',
    locationOptional: 'מיקום (לא חובה)',
    placeholderEvent5K: 'לדוגמה 5 ק"מ',
    placeholderTime1845: 'לדוגמה 18:45',
    placeholderLocationTLV: 'לדוגמה תל אביב',
    addTrainingPace: 'הוסף קצב אימון',
    paceTypeLabel: 'סוג',
    pacePerKm: 'קצב (דק׳/ק"מ)',
    noteOptional: 'הערה (לא חובה)',
    savePaceBtn: 'שמור קצב',
    placeholderPace500: 'לדוגמה 5:00',
    placeholderPaceDesc: 'לדוגמה קצב יעד לחצי מרתון',

    paceEasy: 'קל',
    paceTempo: 'טמפו',
    paceThreshold: 'סף',
    paceInterval: 'אינטרוול',
    paceRepetition: 'חזרה',
    paceRace: 'תחרות',

    toastProfilePhotoUpdated: 'תמונת הפרופיל עודכנה',
    toastProfilePhotoRemoved: 'תמונת הפרופיל הוסרה',
    toastProfileSaved: 'הפרופיל נשמר!',
    toastProfileSaveFailed: 'שמירת הפרופיל נכשלה',
    toastPhotoUploadFailed: 'העלאת התמונה נכשלה',
    toastPhotoRemoveFailed: 'הסרת התמונה נכשלה',
    toastChooseImage: 'יש לבחור קובץ תמונה',
    toastImageTooBig: 'התמונה גדולה מ-5 מגה',
    toastSaveChangesFailed: 'שמירת השינויים נכשלה',
    toastUpdated: 'עודכן',
    toastAdded: 'נוסף',

    welcomeBack: 'ברוך שובך',
    welcomeTeamHaim: 'ברוך הבא לצוות חיים!',
    coachWillAssign: 'המאמן ישבץ לך אימון בקרוב.',
    completeProfileBtn: 'השלם את הפרופיל שלך',
    todaysWorkoutTitle: 'אימון היום',
    viewFullDetails: 'צפה בפרטים המלאים',
    thisWeekStat: 'השבוע',
    workoutsCompletedCaption: 'אימונים הושלמו',
    distanceStat: 'מרחק',
    kmLoggedCaption: 'ק"מ שתועדו',
    prsStat: 'שיאים',
    personalRecordsCaption: 'שיאים אישיים',
    goalsStat: 'יעדים',
    activeGoalsCaption: 'יעדים פעילים',
    upcomingWorkouts: 'אימונים קרובים',
    viewAll: 'צפה בהכל',
    noUpcomingWorkouts: 'אין עדיין אימונים קרובים.',
    tomorrow: 'מחר',
    weeklyProgress: 'התקדמות שבועית',
    workoutsCompletedLabel: 'אימונים שהושלמו',
    ofWord: 'מתוך',
    avgEffortLabel: 'מאמץ ממוצע',
    totalTimeLabel: 'זמן כולל',
    activeGoalsTitle: 'יעדים פעילים',
    noActiveGoals: 'אין יעדים — הוסף אותם בפרופיל שלך.',

    workoutLogHeading: 'תיעוד אימון',
    loggedBadge: 'תועד',
    actualDistanceKm: 'מרחק בפועל (ק"מ)',
    actualPaceKm: 'קצב בפועל (/ק"מ)',
    examplePlaceholder10: 'לדוגמה 10',
    examplePlaceholder530: 'לדוגמה 5:30',
    effortRange: 'מאמץ (1–10)',
    effortHelper: '1 = קל מאוד · 5 = בינוני · 10 = מאמץ מקסימלי',
    commentOptional: 'הערה (לא חובה)',
    commentPlaceholder: 'איך הרגשת? מה שמת לב?',
    savingDots: 'שומר...',
    updateLog: 'עדכן תיעוד',
    saveLog: 'שמור תיעוד',
    toastEffortRequired: 'יש לדרג את המאמץ בין 1 ל-10',
    toastDistanceInvalid: 'יש להזין מרחק תקין בק"מ',
    toastWorkoutLogged: 'האימון תועד!',
    toastSaveLogFailed: 'שמירת התיעוד נכשלה. נסה שוב.',

    trainingZonesTitle: 'אזורי אימון',
    toggleZonesAria: 'הצג/הסתר אזורים',
    zonesCalcFrom: 'מחושב לפי',
    zonesAddPR: 'הוסף שיא עדכני (לדוגמה 5 ק"מ, 10 ק"מ) כדי לחשב את קצבי האימון.',
    zonesNoReference: 'אין מירוץ ייחוס — הוסף שיא או הגדר אחד ידנית בפרופיל.',
    heartRateZones: 'אזורי דופק',
    badgeKarvonen: 'קרוונן',
    badgePercentMax: '% דופק מירבי',
    howCalculated: 'איך זה מחושב?',
    zonesFormulaIntro: 'אנחנו משתמשים במודל VDOT של ג׳ק דניאלס. ממירוץ הייחוס של הספורטאי אנו גוזרים את ה-VO₂max:',
    zonesFormulaTargets: 'לכל אזור יש יעד %VO2max (קל ~70%, מרתון ~84%, סף ~88%, אינטרוול ~98%, חזרות ~105%). אנו הופכים את משוואת המאמץ כדי למצוא את הקצב המתאים.',
    zonesFormulaHR: 'אזורי דופק משתמשים בנוסחת הרזרבה של קרוונן כאשר דופק המנוחה ידוע: אזור = מנוחה + אחוז × (מירבי − מנוחה); אחרת חוזרים ל-%דופק מירבי.',

    scheduleTitle: 'לוח אימונים',
    scheduleSubtitle: 'צפה ועקוב אחר תוכנית האימון שלך',
    noWorkoutScheduled: 'לא משובץ אימון',
    warmupHeading: 'חימום',
    workoutHeading: 'אימון',
    cooldownHeading: 'שחרור',
    notesHeading: 'הערות',
    yourNotesHeading: 'ההערות שלך',
    coachFeedbackHeading: 'משוב מהמאמן',
    restPrefix: 'מנוחה:',
    effortBadgeTitle: 'מאמץ נתפס (1–10)',
    effortBadge: 'מאמץ',

    statisticsTitle: 'סטטיסטיקות',
    statisticsSubtitle: 'עקוב אחר התקדמות האימונים והביצועים שלך',
    totalKm: 'סה"כ ק"מ',
    totalHours: 'סה"כ שעות',
    avgEffortStat: 'מאמץ ממוצע (1-10)',
    workoutsLoggedStat: 'אימונים תועדו',
    logToSeeCharts: 'תעד אימונים כדי לראות כאן את גרפי ההתקדמות.',
    weeklyTab: 'שבועי',
    monthlyTab: 'חודשי',
    weeklyDistance: 'מרחק שבועי (ק"מ)',
    monthlyDistance: 'מרחק חודשי (ק"מ)',
    averageEffortLevel: 'רמת מאמץ ממוצעת',
    prsAchievedChart: 'שיאים שהושגו',
    recentPersonalRecords: 'שיאים אישיים אחרונים',

    seasonJourneyHeading: 'מסע העונה',
    roadToGoalRace: 'הדרך שלך למירוץ הבא.',
    roadToGoalRaceLong: 'הדרך שלך למירוץ הבא. המרחקים בק"מ, הקצבים בדק׳/ק"מ.',
    startSeasonJourney: 'התחל את מסע העונה',
    planRoadDesc: 'תכנן את הדרך למירוץ הבא. אפשר להוסיף ולעדכן שלבים ותחנות בכל זמן.',
    goalRaceLabel: 'מירוץ יעד',
    goalRacePlaceholder: 'לדוגמה חצי מרתון תל אביב',
    goalRaceDateLabel: 'תאריך מירוץ היעד',
    createMyJourney: 'צור את המסע שלי',
    addStageBtn: 'הוסף שלב',
    toastJourneyCreated: 'המסע נוצר — הוסף את השלב הראשון',
    toastStageSaved: 'השלב נשמר',
    toastPickGoalDate: 'בחר תחילה תאריך למירוץ היעד',
    toastLoadJourneyFailed: 'טעינת המסע נכשלה',
    toastSaveJourneyFailed: 'שמירת המסע נכשלה',
    mySeasonDefault: 'העונה שלי',

    seasonJourneyUpper: 'מסע העונה',
    goalRaceFallback: 'מירוץ יעד',
    targetPrefix: 'יעד',
    daysToRace: 'ימים למירוץ',
    progressLabel: 'התקדמות',
    currentlyIn: 'כעת בשלב',
    nextStage: 'הבא:',
    onWord: 'ב-',
    noStagesYet: 'עדיין אין שלבים.',
    useAddStage: 'השתמש ב„הוסף שלב” כדי להתחיל.',
    coachNotSetup: 'המאמן עדיין לא הגדיר זאת.',
    nowBadge: 'עכשיו',
    keyWorkouts: 'אימוני מפתח',
    milestones: 'תחנות דרך',
    stageProgress: 'התקדמות בשלב',
    raceDay: 'יום המירוץ',

    coachDashboardTitle: 'לוח בקרה למאמן',
    athletesStat: 'ספורטאים',
    workoutLibraryStat: 'ספריית אימונים',
    completedToday: 'הושלמו היום',
    pendingToday: 'ממתינים להיום',
    athletesCardTitle: 'ספורטאים',
    viewAllAction: 'הצג הכל',
    todaysWorkoutsCard: 'אימוני היום',
    doneBadge: 'בוצע',
    pendingBadge: 'ממתין',
    noWorkoutsToday: 'אין אימונים מתוכננים להיום',
    quickActions: 'פעולות מהירות',
    createWorkoutAction: 'צור אימון',
    manageAthletesAction: 'נהל ספורטאים',
    messagesAction: 'הודעות',
    viewProgressAction: 'צפה בהתקדמות',
    workoutLibraryCardTitle: 'ספריית אימונים',

    goalActive: 'פעיל',
    goalAchieved: 'הושג',
    goalArchived: 'בארכיון',
  },
}

interface LanguageContextType {
  language: Language
  setLanguage: (lang: Language) => void
  t: Translations
  isRTL: boolean
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined)

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('en')

  useEffect(() => {
    const saved = localStorage.getItem('teamhaim-language') as Language
    if (saved && (saved === 'en' || saved === 'he')) {
      setLanguage(saved)
    }
  }, [])

  useEffect(() => {
    localStorage.setItem('teamhaim-language', language)
    document.documentElement.dir = language === 'he' ? 'rtl' : 'ltr'
    document.documentElement.lang = language
  }, [language])

  const value = {
    language,
    setLanguage,
    t: translations[language],
    isRTL: language === 'he',
  }

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const context = useContext(LanguageContext)
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider')
  }
  return context
}
