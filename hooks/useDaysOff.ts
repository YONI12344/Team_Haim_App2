'use client'

/**
 * An athlete's `daysOff` docs — date ranges (sick/trip/other) marked as
 * no-workout, by either the athlete or the coach. Suppresses the reminder
 * pushes (see app/api/send-morning-reminders, send-evening-reminders) and
 * lets the planner show "day off" instead of a blank/missed day.
 */

import { useCallback, useEffect, useState } from 'react'
import { addDoc, collection, deleteDoc, doc, getDocs, query, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { DayOff, DayOffReason } from '@/lib/types'

export function useDaysOff(athleteId: string) {
  const [daysOff, setDaysOff] = useState<DayOff[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!athleteId) return
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'daysOff'), where('athleteId', '==', athleteId)))
      setDaysOff(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<DayOff, 'id'>) })))
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [athleteId])

  useEffect(() => { load() }, [load])

  const dayOffFor = useCallback(
    (dateStr: string) => daysOff.find(d => d.startDate <= dateStr && d.endDate >= dateStr),
    [daysOff],
  )

  const markDayOff = useCallback(async (params: {
    startDate: string; endDate: string; reason: DayOffReason; note?: string; createdBy: string
  }) => {
    await addDoc(collection(db, 'daysOff'), {
      athleteId,
      startDate: params.startDate,
      endDate: params.endDate,
      reason: params.reason,
      note: params.note?.trim() || null,
      createdBy: params.createdBy,
      createdAt: serverTimestamp(),
    })
    await load()
  }, [athleteId, load])

  const removeDayOff = useCallback(async (id: string) => {
    await deleteDoc(doc(db, 'daysOff', id))
    setDaysOff(prev => prev.filter(d => d.id !== id))
  }, [])

  return { daysOff, loading, dayOffFor, markDayOff, removeDayOff }
}
