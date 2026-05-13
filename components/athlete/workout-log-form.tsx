'use client'

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  limit,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { CheckCircle2, Loader2 } from 'lucide-react'
import type { WorkoutLog } from '@/lib/types'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

interface WorkoutLogFormProps {
  workoutId: string    // ID of the assigned workout
  athleteId: string
  scheduledDate: string
}

export function WorkoutLogForm({ workoutId, athleteId, scheduledDate }: WorkoutLogFormProps) {
  const [existingLog, setExistingLog] = useState<WorkoutLog | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const [actualDistance, setActualDistance] = useState('')
  const [actualPace, setActualPace] = useState('')
  const [effort, setEffort] = useState<'easy' | 'medium' | 'hard' | null>(null)
  const [comment, setComment] = useState('')

  useEffect(() => {
    const loadLog = async () => {
      try {
        const q = query(
          collection(db, 'logs'),
          where('workoutId', '==', workoutId),
          where('athleteId', '==', athleteId),
          limit(1)
        )
        const snapshot = await getDocs(q)
        if (!snapshot.empty) {
          const logData = snapshot.docs[0].data()
          const log: WorkoutLog = {
            id: snapshot.docs[0].id,
            athleteId: logData.athleteId || athleteId,
            workoutId: logData.workoutId || workoutId,
            date: logData.date || scheduledDate,
            actualDistance: logData.actualDistance ?? undefined,
            actualPace: logData.actualPace ?? undefined,
            effort: logData.effort || 'easy',
            comment: logData.comment || '',
            createdAt: logData.createdAt?.toDate?.() || new Date(),
          }
          setExistingLog(log)
          setActualDistance(log.actualDistance?.toString() || '')
          setActualPace(log.actualPace || '')
          setEffort(log.effort)
          setComment(log.comment)
          setSaved(true)
        }
      } catch (error) {
        console.error('Error loading workout log:', error)
      } finally {
        setLoading(false)
      }
    }

    loadLog()
  }, [workoutId, athleteId, scheduledDate])

  const handleSave = async () => {
    if (!effort) {
      toast.error('Please select an effort level')
      return
    }

    // Validate distance: empty is ok, otherwise must be a finite non-negative number
    let parsedDistance: number | null = null
    if (actualDistance.trim() !== '') {
      const n = parseFloat(actualDistance)
      if (!Number.isFinite(n) || n < 0) {
        toast.error('Please enter a valid distance in km')
        return
      }
      parsedDistance = n
    }

    setSaving(true)
    try {
      const baseData = {
        athleteId,
        workoutId,
        date: scheduledDate,
        actualDistance: parsedDistance,
        actualPace: actualPace.trim() || null,
        effort,
        comment,
      }

      if (existingLog?.id) {
        // Preserve original createdAt; only update updatedAt
        await updateDoc(doc(db, 'logs', existingLog.id), {
          ...baseData,
          updatedAt: serverTimestamp(),
        })
        setExistingLog({
          ...existingLog,
          actualDistance: parsedDistance ?? undefined,
          actualPace: baseData.actualPace ?? undefined,
          effort,
          comment,
        })
      } else {
        const docRef = await addDoc(collection(db, 'logs'), {
          ...baseData,
          createdAt: serverTimestamp(),
        })
        setExistingLog({
          id: docRef.id,
          athleteId,
          workoutId,
          date: scheduledDate,
          actualDistance: parsedDistance ?? undefined,
          actualPace: baseData.actualPace ?? undefined,
          effort,
          comment,
          createdAt: new Date(),
        })
      }

      setSaved(true)
      toast.success('Workout logged!')
    } catch (error) {
      console.error('Error saving workout log:', error)
      toast.error('Failed to save log. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-4">
      <div className="flex items-center justify-between">
        <h4 className="font-medium text-navy">Workout Log</h4>
        {saved && (
          <div className="flex items-center gap-1 text-emerald-600 text-sm font-medium">
            <CheckCircle2 className="h-4 w-4" />
            <span>Logged</span>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="actualDistance" className="text-sm">
            Actual Distance (km)
          </Label>
          <Input
            id="actualDistance"
            type="number"
            step="0.1"
            min="0"
            placeholder="e.g. 10"
            value={actualDistance}
            onChange={(e) => setActualDistance(e.target.value)}
            className="h-9"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="actualPace" className="text-sm">
            Actual Pace (/km)
          </Label>
          <Input
            id="actualPace"
            type="text"
            placeholder="e.g. 5:30"
            value={actualPace}
            onChange={(e) => setActualPace(e.target.value)}
            className="h-9"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-sm">Effort Level</Label>
        <div className="flex gap-2">
          {(['easy', 'medium', 'hard'] as const).map((level) => (
            <button
              key={level}
              type="button"
              onClick={() => setEffort(level)}
              className={cn(
                'flex-1 py-2 px-3 rounded-lg border text-sm font-medium capitalize transition-colors',
                effort === level
                  ? level === 'easy'
                    ? 'bg-emerald-100 text-emerald-700 border-emerald-300'
                    : level === 'medium'
                    ? 'bg-amber-100 text-amber-700 border-amber-300'
                    : 'bg-red-100 text-red-700 border-red-300'
                  : 'border-border hover:bg-muted/50 text-muted-foreground'
              )}
            >
              {level}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="comment" className="text-sm">
          Comment
        </Label>
        <Textarea
          id="comment"
          placeholder="How did it feel? What did you notice?"
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          className="resize-none h-20"
        />
      </div>

      <Button
        onClick={handleSave}
        disabled={saving || !effort}
        className="w-full bg-gold hover:bg-gold/90 text-navy"
      >
        {saving ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin mr-2" />
            Saving...
          </>
        ) : existingLog ? (
          'Update Log'
        ) : (
          'Save Log'
        )}
      </Button>
    </div>
  )
}
