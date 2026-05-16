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
  week: string
  month: string
  languageToggle: string
  languageToggleAria: string

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
    week: 'Week',
    month: 'Month',
    languageToggle: 'עברית',
    languageToggleAria: 'Switch language to Hebrew',

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
    week: 'שבוע',
    month: 'חודש',
    languageToggle: 'English',
    languageToggleAria: 'החלף שפה לאנגלית',

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
