'use client'

import { useEffect, useState } from 'react'
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
import { useLanguage } from '@/contexts/language-context'

const stageTypes: JourneyStageType[] = [
  'base',
  'build',
  'peak',
  'taper',
  'race_week',
  'recovery',
  'custom',
]

interface StageEditorProps {
  stage: JourneyStage
  onSave: (stage: JourneyStage) => Promise<void> | void
  onCancel: () => void
}

/** Compact inline form to edit one journey stage. */
export function StageEditor({ stage, onSave, onCancel }: StageEditorProps) {
  const { t, language } = useLanguage()
  const stageTypeLabel: Record<JourneyStageType, string> = language === 'he'
    ? { base: 'בסיס', build: 'בנייה', peak: 'שיא', taper: 'הפחתה', race_week: 'שבוע מירוץ', recovery: 'התאוששות', custom: 'מותאם' }
    : { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', race_week: 'Race week', recovery: 'Recovery', custom: 'Custom' }
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

  // When the caller switches which stage is being edited (e.g. clicking
  // "edit" on a different stage), reseed the local form fields so we don't
  // leak the previous stage's values.
  useEffect(() => {
    setName(stage.name)
    setType(stage.type)
    setStartDate(stage.startDate)
    setEndDate(stage.endDate)
    setFocus(stage.focus)
    setWeeklyVolumeKm(
      stage.weeklyVolumeKm != null ? String(stage.weeklyVolumeKm) : '',
    )
    setMilestones((stage.milestones ?? []).join('\n'))
    setKeyWorkouts((stage.keyWorkouts ?? []).join('\n'))
  }, [stage.id, stage.name, stage.type, stage.startDate, stage.endDate, stage.focus, stage.weeklyVolumeKm, stage.milestones, stage.keyWorkouts])

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
          <Label className="text-xs">{t.stageNameLabel}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t.stageTypeLabel}</Label>
          <Select value={type} onValueChange={(v) => setType(v as JourneyStageType)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {stageTypes.map((s) => (
                <SelectItem key={s} value={s}>
                  {stageTypeLabel[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t.stageStartDate}</Label>
          <Input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t.stageEndDate}</Label>
          <Input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label className="text-xs">{t.stageFocusLabel}</Label>
          <Input
            placeholder={t.stageFocusPlaceholder}
            value={focus}
            onChange={(e) => setFocus(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t.weeklyVolumeLabel}</Label>
          <Input
            type="number"
            min="0"
            placeholder={t.weeklyVolumePlaceholder}
            value={weeklyVolumeKm}
            onChange={(e) => setWeeklyVolumeKm(e.target.value)}
          />
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label className="text-xs">{t.keyWorkoutsLabel}</Label>
          <Textarea
            className="h-20"
            value={keyWorkouts}
            onChange={(e) => setKeyWorkouts(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t.milestonesLabel}</Label>
          <Textarea
            className="h-20"
            placeholder={t.milestonesPlaceholder}
            value={milestones}
            onChange={(e) => setMilestones(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          <X className="h-4 w-4 mr-1" /> {t.cancel}
        </Button>
        <Button
          size="sm"
          className="bg-gold hover:bg-gold/90 text-navy"
          onClick={handleSave}
          disabled={!name.trim() || !startDate || !endDate}
        >
          <Check className="h-4 w-4 mr-1" /> {t.saveStageBtn}
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
