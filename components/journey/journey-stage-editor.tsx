'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Pencil, Plus, Trash2, X, Check } from 'lucide-react'
import type { JourneyStage, JourneyStageType } from '@/lib/types'

const stageTypes: { value: JourneyStageType; label: string }[] = [
  { value: 'base', label: 'Base' },
  { value: 'build', label: 'Build' },
  { value: 'peak', label: 'Peak' },
  { value: 'taper', label: 'Taper' },
  { value: 'race_week', label: 'Race week' },
  { value: 'recovery', label: 'Recovery' },
  { value: 'custom', label: 'Custom' },
]

interface StageEditorProps {
  stage: JourneyStage
  onSave: (stage: JourneyStage) => Promise<void> | void
  onCancel: () => void
}

/** Compact inline form to edit one journey stage. */
export function StageEditor({ stage, onSave, onCancel }: StageEditorProps) {
  const [name, setName] = useState(stage.name)
  const [type, setType] = useState<JourneyStageType>(stage.type)
  const [startDate, setStartDate] = useState(stage.startDate)
  const [endDate, setEndDate] = useState(stage.endDate)
  const [focus, setFocus] = useState(stage.focus)
  const [weeklyVolumeKm, setWeeklyVolumeKm] = useState(
    stage.weeklyVolumeKm != null ? String(stage.weeklyVolumeKm) : '',
  )
  const [milestones, setMilestones] = useState(
    (stage.milestones ?? []).join('\n'),
  )
  const [keyWorkouts, setKeyWorkouts] = useState(
    (stage.keyWorkouts ?? []).join('\n'),
  )

  const handleSave = async () => {
    if (!name.trim() || !startDate || !endDate) return
    const next: JourneyStage = {
      ...stage,
      name: name.trim(),
      type,
      startDate,
      endDate,
      focus: focus.trim(),
      weeklyVolumeKm:
        weeklyVolumeKm.trim() === ''
          ? undefined
          : Math.max(0, Number(weeklyVolumeKm)),
      milestones: milestones
        .split('\n')
        .map((m) => m.trim())
        .filter(Boolean),
      keyWorkouts: keyWorkouts
        .split('\n')
        .map((m) => m.trim())
        .filter(Boolean),
    }
    await onSave(next)
  }

  return (
    <div className="space-y-3 rounded-lg border border-dashed border-border bg-muted/20 p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Stage name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as JourneyStageType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stageTypes.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Start date</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">End date</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">Focus</Label>
          <Input
            placeholder="e.g. aerobic base, threshold work"
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Weekly volume (km)</Label>
          <Input
            type="number"
            min="0"
            placeholder="e.g. 60"
            value={weeklyVolumeKm}
            onChange={(e) => setWeeklyVolumeKm(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">Key workouts (one per line)</Label>
          <Textarea
            className="h-20"
            value={keyWorkouts}
            onChange={(e) => setKeyWorkouts(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Milestones (one per line)</Label>
          <Textarea
            className="h-20"
            placeholder={'10K time trial\nLong run 30 km'}
            value={milestones}
            onChange={(e) => setMilestones(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X className="h-4 w-4 mr-1" /> Cancel
        </Button>
        <Button
          size="sm"
          className="bg-gold hover:bg-gold/90 text-navy"
          onClick={handleSave}
          disabled={!name.trim() || !startDate || !endDate}
        >
          <Check className="h-4 w-4 mr-1" /> Save stage
        </Button>
      </div>
    </div>
  )
}

interface StageActionsProps {
  onEdit: () => void
  onRemove: () => void
}

/** Edit / delete buttons shown next to each stage in the timeline. */
export function StageActions({ onEdit, onRemove }: StageActionsProps) {
  return (
    <>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7"
        onClick={onEdit}
        aria-label="Edit stage"
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-7 w-7 text-red-600 hover:text-red-700"
        onClick={onRemove}
        aria-label="Delete stage"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </>
  )
}

export { Plus }
