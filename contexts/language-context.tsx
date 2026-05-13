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
  
  // Navigation
  dashboard: string
  schedule: string
  statistics: string
  chat: string
  athletes: string
  workouts: string
  
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
    
    dashboard: 'Dashboard',
    schedule: 'Schedule',
    statistics: 'Statistics',
    chat: 'Chat',
    athletes: 'Athletes',
    workouts: 'Workouts',
    
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
    
    dashboard: 'לוח בקרה',
    schedule: 'לוח זמנים',
    statistics: 'סטטיסטיקות',
    chat: 'צאט',
    athletes: 'ספורטאים',
    workouts: 'אימונים',
    
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
