'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Plus, X, Save } from 'lucide-react'
import type { PersonalRecord, TrainingPace } from '@/lib/types'

function genId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

// ---------- PR / SB editor ----------

interface RecordEditorProps {
  /** Used for accessible labels. */
  kind: 'pr' | 'sb'
  onAdd: (record: PersonalRecord) => Promise<void> | void
  onRemove: (id: string) => Promise<void> | void
  records: PersonalRecord[]
}

export function RecordEditor({ kind, onAdd, onRemove, records }: RecordEditorProps) {
  const [event, setEvent] = useState('')
  const [time, setTime] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [location, setLocation] = useState('')
  const label = kind === 'pr' ? 'Personal Record' : 'Season Best'

  const handleAdd = async () => {
    if (!event.trim() || !time.trim()) return
    await onAdd({
      id: genId(kind),
      event: event.trim(),
      time: time.trim(),
      date,
      location: location.trim() || undefined,
    })
    setEvent('')
    setTime('')
    setLocation('')
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3">
      <p className="text-sm font-medium text-navy">Add {label}</p>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label htmlFor={`${kind}-event`} className="text-xs">Event / distance</Label>
          <Input
            id={`${kind}-event`}
            placeholder="e.g. 5K"
            value={event}
            onChange={(e) => setEvent(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${kind}-time`} className="text-xs">Time</Label>
          <Input
            id={`${kind}-time`}
            placeholder="e.g. 18:45"
            value={time}
            onChange={(e) => setTime(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${kind}-date`} className="text-xs">Date</Label>
          <Input
            id={`${kind}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`${kind}-loc`} className="text-xs">Location (optional)</Label>
          <Input
            id={`${kind}-loc`}
            placeholder="e.g. Tel Aviv"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={handleAdd}
          disabled={!event.trim() || !time.trim()}
          size="sm"
          className="bg-gold hover:bg-gold/90 text-navy"
        >
          <Plus className="h-4 w-4 mr-1" /> Add {label}
        </Button>
      </div>

      {records.length > 0 && (
        <ul className="space-y-1 text-sm pt-1">
          {records.map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between rounded-md border border-border/70 bg-background px-3 py-1.5"
            >
              <span>
                <span className="font-medium text-navy">{r.event}</span>{' '}
                <span className="font-mono">{r.time}</span>
                <span className="text-muted-foreground"> · {r.date}</span>
                {r.location && (
                  <span className="text-muted-foreground"> · {r.location}</span>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={`Remove ${r.event}`}
                onClick={() => onRemove(r.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---------- Training paces editor ----------

const paceTypes: TrainingPace['type'][] = [
  'easy',
  'tempo',
  'threshold',
  'interval',
  'repetition',
  'race',
]

interface PaceEditorProps {
  paces: TrainingPace[]
  onAdd: (pace: TrainingPace) => Promise<void> | void
  onRemove: (id: string) => Promise<void> | void
}

export function PaceEditor({ paces, onAdd, onRemove }: PaceEditorProps) {
  const [type, setType] = useState<TrainingPace['type']>('easy')
  const [pace, setPace] = useState('')
  const [description, setDescription] = useState('')

  const handleAdd = async () => {
    if (!pace.trim()) return
    // Persist in min/km; store the suffix so units are unambiguous later.
    const raw = pace.trim()
    const normalised = /\/(km|mi)/i.test(raw) ? raw : `${raw}/km`
    await onAdd({
      id: genId('pace'),
      type,
      pace: normalised,
      description: description.trim() || undefined,
    })
    setPace('')
    setDescription('')
  }

  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4 space-y-3">
      <p className="text-sm font-medium text-navy">Add training pace</p>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="space-y-1">
          <Label className="text-xs">Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as TrainingPace['type'])}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {paceTypes.map((p) => (
                <SelectItem key={p} value={p} className="capitalize">
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label htmlFor="pace-value" className="text-xs">Pace (min/km)</Label>
          <Input
            id="pace-value"
            placeholder="e.g. 5:00"
            value={pace}
            onChange={(e) => setPace(e.target.value)}
          />
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label htmlFor="pace-desc" className="text-xs">Note (optional)</Label>
          <Input
            id="pace-desc"
            placeholder="e.g. half-marathon goal pace"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
      </div>
      <div className="flex justify-end">
        <Button
          onClick={handleAdd}
          disabled={!pace.trim()}
          size="sm"
          className="bg-gold hover:bg-gold/90 text-navy"
        >
          <Save className="h-4 w-4 mr-1" /> Save pace
        </Button>
      </div>

      {paces.length > 0 && (
        <ul className="space-y-1 text-sm pt-1">
          {paces.map((p) => (
            <li
              key={p.id}
              className="flex items-center justify-between rounded-md border border-border/70 bg-background px-3 py-1.5"
            >
              <span>
                <span className="capitalize font-medium text-navy">{p.type}</span>
                <span className="text-muted-foreground"> — </span>
                <span className="font-mono">{p.pace}</span>
                {p.description && (
                  <span className="text-muted-foreground"> · {p.description}</span>
                )}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={`Remove ${p.type} pace`}
                onClick={() => onRemove(p.id)}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
