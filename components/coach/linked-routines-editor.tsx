'use client'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, Trash2 } from 'lucide-react'
import type { Workout } from '@/lib/types'

export type LinkedRoutine = { id: string; workoutId: string; label: string }

function genLinkId(): string {
  return `link-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * Repeatable "title + routine picker" row list — each row becomes one
 * button on the athlete's side (components/athlete/warmup-viewer.tsx via
 * athlete-planner-view.tsx), in this order, with this exact title. Shared
 * by components/coach/workout-builder.tsx (per-workout routine links) and
 * components/coach/athlete-planner.tsx (an athlete's default routine
 * links, auto-applied to any workout assigned to them that doesn't
 * already carry its own — see lib/types.ts AthleteProfile.defaultLinkedRoutines).
 */
export function LinkedRoutinesEditor({
  value,
  onChange,
  routineOptions,
}: {
  value: LinkedRoutine[]
  onChange: (next: LinkedRoutine[]) => void
  routineOptions: Workout[]
}) {
  return (
    <div className="space-y-2">
      <div className="space-y-2">
        {value.map((link, i) => (
          <div key={link.id} className="flex items-center gap-2">
            <Input
              value={link.label}
              onChange={(e) => onChange(value.map((l, li) => (li === i ? { ...l, label: e.target.value } : l)))}
              placeholder="כותרת הכפתור"
              className="flex-1"
              dir="rtl"
            />
            <Select
              value={link.workoutId || '__none__'}
              onValueChange={(v) => onChange(value.map((l, li) => {
                if (li !== i) return l
                const workoutId = v === '__none__' ? '' : v
                // Picking a routine here felt like "done" to a coach, but
                // saving silently drops any row missing a title (see
                // saveDefaultRoutines/handleSubmit) — a title-less rule
                // would vanish on reload with no error shown. Auto-fill
                // from the routine's own title so that never happens
                // unless the coach deliberately blanks it back out.
                const label = !l.label.trim() && workoutId
                  ? (routineOptions.find((w) => w.id === workoutId)?.title || l.label)
                  : l.label
                return { ...l, workoutId, label }
              }))}
            >
              <SelectTrigger className="flex-1"><SelectValue placeholder="בחרו שגרה" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">בחרו שגרה</SelectItem>
                {routineOptions.map((w) => (
                  <SelectItem key={w.id} value={w.id}>{w.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              onClick={() => onChange(value.filter((_, li) => li !== i))}
              className="text-destructive hover:text-destructive h-9 w-9 shrink-0"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange([...value, { id: genLinkId(), workoutId: '', label: '' }])}
      >
        <Plus className="h-4 w-4 mr-1" />הוסף שגרה מקושרת
      </Button>
    </div>
  )
}
