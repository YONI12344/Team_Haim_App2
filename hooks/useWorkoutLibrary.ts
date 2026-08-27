'use client'

import useSWR, { mutate } from 'swr'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { Workout } from '@/lib/types'

// The full 'workouts' collection is global reference data shared by every
// coach page (planner, builder, bank, library, assign, journey wizard...).
// It used to be re-fetched from scratch, unbounded, at ~11 separate call
// sites — including 3 times in the athlete planner alone. This hook makes
// it a single shared SWR cache entry: first read hits Firestore, every
// other consumer (mounted at the same time or later, within a few minutes)
// gets it for free.
export const WORKOUT_LIBRARY_KEY = 'workout-library'

async function fetchWorkoutLibrary(): Promise<Workout[]> {
  const snap = await getDocs(collection(db, 'workouts'))
  return snap.docs.map((d) => ({ ...(d.data() as Workout), id: d.id }))
}

export function useWorkoutLibrary() {
  const { data, error, isLoading, mutate: mutateLocal } = useSWR(WORKOUT_LIBRARY_KEY, fetchWorkoutLibrary, {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })
  return {
    workouts: data ?? [],
    isLoading,
    error,
    mutate: mutateLocal,
  }
}

// Call after any create/update/delete on the 'workouts' collection so every
// mounted consumer picks up the change instead of showing stale data until
// the dedupingInterval expires.
export function invalidateWorkoutLibrary() {
  return mutate(WORKOUT_LIBRARY_KEY)
}

// Optimistic local update (e.g. right after addDoc/updateDoc/deleteDoc) —
// applies `updater` to the cached list immediately, without waiting on a
// round trip to Firestore. `revalidate: false` since the caller already
// knows the write succeeded.
export function mutateWorkoutLibrary(updater: (prev: Workout[]) => Workout[]) {
  return mutate(WORKOUT_LIBRARY_KEY, (prev?: Workout[]) => updater(prev ?? []), { revalidate: false })
}
