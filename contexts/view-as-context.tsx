'use client'

/**
 * Coach "athlete view": the coach browses the real athlete screens
 * (/athlete, /athlete/schedule, /athlete/rehab, ...) showing one athlete's
 * live data, exactly as that athlete sees them. The chosen athlete lives in
 * sessionStorage so every existing /athlete link keeps working while the
 * coach clicks around; AthleteLayout provides it to the screens below.
 */

import { createContext, useContext, type ReactNode } from 'react'
import { useAuth } from '@/contexts/auth-context'
import { isCoachEmail } from '@/lib/constants'
import type { User } from '@/lib/types'

const STORAGE_KEY = 'teamhaim.viewAsAthlete'

export interface ViewAsAthlete {
  id: string
  name: string
  email?: string
  photoURL?: string
}

export function readViewAs(): ViewAsAthlete | null {
  try {
    const raw = typeof window !== 'undefined' ? window.sessionStorage.getItem(STORAGE_KEY) : null
    return raw ? (JSON.parse(raw) as ViewAsAthlete) : null
  } catch {
    return null
  }
}

export function startViewAs(athlete: ViewAsAthlete) {
  try { window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(athlete)) } catch { /* private mode */ }
}

export function stopViewAs() {
  try { window.sessionStorage.removeItem(STORAGE_KEY) } catch { /* private mode */ }
}

const ViewAsContext = createContext<ViewAsAthlete | null>(null)

export function ViewAsProvider({ athlete, children }: { athlete: ViewAsAthlete | null; children: ReactNode }) {
  return <ViewAsContext.Provider value={athlete}>{children}</ViewAsContext.Provider>
}

/** The athlete the coach is viewing as, or null outside athlete view. */
export function useViewAs(): ViewAsAthlete | null {
  return useContext(ViewAsContext)
}

/**
 * The athlete an athlete screen is about: the one the coach is viewing as,
 * otherwise the signed-in user. Only the coach account can view as someone
 * else; for everyone else this is just useAuth().user.
 */
export function useAthleteUser(): User | null {
  const { user } = useAuth()
  const viewAs = useViewAs()
  if (!user) return null
  if (!viewAs || !isCoachEmail(user.email)) return user
  return {
    ...user,
    id: viewAs.id,
    name: viewAs.name,
    email: viewAs.email || '',
    photoURL: viewAs.photoURL,
    role: 'athlete',
  }
}
