'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Loader2,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import {
  buildTemplate,
  deleteJourney,
  journeyTemplates,
  listJourneys,
  newEmptyJourney,
  newEmptyStage,
  saveJourney,
} from '@/lib/journey'
import { JourneyTimeline } from '@/components/journey/journey-timeline'
import type { JourneyDoc, JourneyStage, JourneyStageType } from '@/lib/types'
import { toast } from 'sonner'
import { useLanguage } from '@/contexts/language-context'

interface Props {
  athleteId: string
}

const stageTypeOptions: JourneyStageType[] = [
  'base',
  'build',
  'peak',
  'taper',
  'race_week',
  'recovery',
  'custom',
]

function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
function plusWeeksISO(weeks: number): string {
  const d = new Date()
  d.setDate(d.getDate() + weeks * 7)
  return d.toISOString().slice(0, 10)
}

export function CoachJourneyEditor({ athleteId }: Props) {
  const { t } = useLanguage()
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [journeys, setJourneys] = useState<JourneyDoc[]>([])
  const [active, setActive] = useState<JourneyDoc | null>(null)
  const [editingStage, setEditingStage] = useState<JourneyStage | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)

  const reload = async () => {
    setLoading(true)
    try {
      const list = await listJourneys(athleteId)
      setJourneys(list)
      setActive((cur) => list.find((j) => j.id === cur?.id) || list[0] || null)
    } catch (err) {
      console.error('Error loading journeys:', err)
      toast.error('Failed to load journeys')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    reload()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId])

  const persist = async (next: JourneyDoc) => {
    setSaving(true)
    try {
      await saveJourney(athleteId, next)
      setActive(next)
      setJourneys((arr) => {
        const idx = arr.findIndex((j) => j.id === next.id)
        if (idx === -1) return [...arr, next]
        const copy = arr.slice()
        copy[idx] = next
        return copy
      })
      toast.success('Journey saved')
    } catch (err) {
      console.error('Error saving journey:', err)
      toast.error('Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const handleNewBlank = async () => {
    if (!user?.id) return
    const j = newEmptyJourney({
      startDate: todayISO(),
      goalRaceDate: plusWeeksISO(12),
      createdBy: user.id,
    })
    await persist(j)
  }

  const handleTemplate = async (key: string) => {
    if (!user?.id) return
    const template = journeyTemplates.find((t) => t.key === key)
    if (!template) return
    const j = buildTemplate(key, {
      startDate: todayISO(),
      goalRaceDate: plusWeeksISO(template.weeks),
      createdBy: user.id,
    })
    if (j) await persist(j)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this journey? This cannot be undone.')) return
    try {
      await deleteJourney(athleteId, id)
      toast.success('Journey deleted')
      await reload()
    } catch (err) {
      console.error('Error deleting:', err)
      toast.error('Failed to delete')
    }
  }

  const updateActive = (patch: Partial<JourneyDoc>) => {
    if (!active) return
    setActive({ ...active, ...patch })
  }

  const moveStage = (i: number, dir: -1 | 1) => {
    if (!active) return
    const target = i + dir
    if (target < 0 || target >= active.stages.length) return
    const copy = active.stages.slice()
    ;[copy[i], copy[target]] = [copy[target], copy[i]]
    setActive({ ...active, stages: copy })
  }

  const removeStage = (id: string) => {
    if (!active) return
    setActive({ ...active, stages: active.stages.filter((s) => s.id !== id) })
  }

  const upsertStage = (stage: JourneyStage) => {
    if (!active) return
    const idx = active.stages.findIndex((s) => s.id === stage.id)
    const copy = active.stages.slice()
    if (idx === -1) copy.push(stage)
    else copy[idx] = stage
    setActive({ ...active, stages: copy })
    setEditingStage(null)
    setDialogOpen(false)
  }

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Link href={`/coach/athletes/${athleteId}`}>
          <Button variant="ghost" className="text-muted-foreground hover:text-foreground">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t.backToAthlete}
          </Button>
        </Link>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-navy md:text-3xl">
            {t.seasonJourneyTitle}
          </h1>
          <p className="text-muted-foreground">
            {t.seasonJourneySubtitle}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {journeys.length > 1 && (
            <Select value={active?.id} onValueChange={(v) => setActive(journeys.find((j) => j.id === v) || null)}>
              <SelectTrigger className="w-[220px]">
                <SelectValue placeholder={t.selectJourneyPh} />
              </SelectTrigger>
              <SelectContent>
                {journeys.map((j) => (
                  <SelectItem key={j.id} value={j.id}>
                    {j.title || t.untitledJourney}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button onClick={handleNewBlank} variant="outline">
            <Plus className="mr-2 h-4 w-4" /> {t.blankBtn}
          </Button>
          {journeyTemplates.map((tpl) => (
            <Button key={tpl.key} variant="outline" onClick={() => handleTemplate(tpl.key)}>
              <Sparkles className="mr-2 h-4 w-4" /> {tpl.label}
            </Button>
          ))}
        </div>
      </div>

      {!active ? (
        <Card className="rounded-2xl border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-sm text-muted-foreground">
              {t.noJourneyYet}
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="text-base">{t.goalAndDates}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="j-title">{t.journeyTitleLabel}</Label>
                <Input
                  id="j-title"
                  value={active.title}
                  onChange={(e) => updateActive({ title: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="j-event">{t.goalRaceEventLabel}</Label>
                <Input
                  id="j-event"
                  value={active.goalRaceEvent}
                  onChange={(e) => updateActive({ goalRaceEvent: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="j-start">{t.startDateLabel}</Label>
                <Input
                  id="j-start"
                  type="date"
                  value={active.startDate}
                  onChange={(e) => updateActive({ startDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="j-end">{t.goalRaceDateLabel2}</Label>
                <Input
                  id="j-end"
                  type="date"
                  value={active.goalRaceDate}
                  onChange={(e) => updateActive({ goalRaceDate: e.target.value })}
                />
              </div>
              <div className="space-y-1.5 md:col-span-2">
                <Label htmlFor="j-target">{t.targetTimeOptional}</Label>
                <Input
                  id="j-target"
                  placeholder="e.g. 1:35:00"
                  value={active.goalRaceTarget ?? ''}
                  onChange={(e) => updateActive({ goalRaceTarget: e.target.value })}
                />
              </div>
              <div className="flex flex-wrap gap-2 md:col-span-2">
                <Button
                  onClick={() => persist(active)}
                  disabled={saving}
                  className="bg-gold text-navy hover:bg-gold/90"
                >
                  {saving ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="mr-2 h-4 w-4" />
                  )}
                  {t.saveJourneyBtn}
                </Button>
                <Dialog
                  open={dialogOpen}
                  onOpenChange={(o) => {
                    setDialogOpen(o)
                    if (!o) setEditingStage(null)
                  }}
                >
                  <DialogTrigger asChild>
                    <Button
                      variant="outline"
                      onClick={() => {
                        const last = active.stages[active.stages.length - 1]
                        setEditingStage(newEmptyStage(last))
                        setDialogOpen(true)
                      }}
                    >
                      <Plus className="mr-2 h-4 w-4" /> {t.addStageBtn}
                    </Button>
                  </DialogTrigger>
                  <StageDialog
                    stage={editingStage}
                    onCancel={() => {
                      setEditingStage(null)
                      setDialogOpen(false)
                    }}
                    onSave={upsertStage}
                  />
                </Dialog>
                <Button
                  variant="ghost"
                  className="text-destructive"
                  onClick={() => handleDelete(active.id)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> {t.deleteJourneyBtn}
                </Button>
              </div>
            </CardContent>
          </Card>

          <JourneyTimeline
            journey={active}
            renderStageActions={(stage, i) => (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t.moveUpAria}
                  disabled={i === 0}
                  onClick={() => moveStage(i, -1)}
                >
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t.moveDownAria}
                  disabled={i === active.stages.length - 1}
                  onClick={() => moveStage(i, 1)}
                >
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t.editStageAria}
                  onClick={() => {
                    setEditingStage(stage)
                    setDialogOpen(true)
                  }}
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t.deleteStageAria}
                  className="text-destructive"
                  onClick={() => removeStage(stage.id)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          />
        </>
      )}
    </div>
  )
}

function StageDialog({
  stage,
  onSave,
  onCancel,
}: {
  stage: JourneyStage | null
  onSave: (s: JourneyStage) => void
  onCancel: () => void
}) {
  const { t, language } = useLanguage()
  const stageTypeLabel: Record<JourneyStageType, string> = language === 'he'
    ? { base: 'בסיס', build: 'בנייה', peak: 'שיא', taper: 'הפחתה', race_week: 'שבוע מירוץ', recovery: 'התאוששות', custom: 'מותאם' }
    : { base: 'Base', build: 'Build', peak: 'Peak', taper: 'Taper', race_week: 'Race week', recovery: 'Recovery', custom: 'Custom' }
  const [draft, setDraft] = useState<JourneyStage | null>(stage)

  useEffect(() => setDraft(stage), [stage])

  if (!draft) return null

  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>{t.stageDialogTitle}</DialogTitle>
      </DialogHeader>
      <div className="grid gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="st-name">{t.nameLabel}</Label>
            <Input
              id="st-name"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-type">{t.stageTypeLabel}</Label>
            <Select
              value={draft.type}
              onValueChange={(v) => setDraft({ ...draft, type: v as JourneyStageType })}
            >
              <SelectTrigger id="st-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {stageTypeOptions.map((o) => (
                  <SelectItem key={o} value={o}>
                    {stageTypeLabel[o]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="st-start">{t.startLabel}</Label>
            <Input
              id="st-start"
              type="date"
              value={draft.startDate}
              onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="st-end">{t.endLabel}</Label>
            <Input
              id="st-end"
              type="date"
              value={draft.endDate}
              onChange={(e) => setDraft({ ...draft, endDate: e.target.value })}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="st-focus">{t.focusLabel}</Label>
          <Input
            id="st-focus"
            value={draft.focus}
            onChange={(e) => setDraft({ ...draft, focus: e.target.value })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="st-vol">{t.weeklyVolumeLabel}</Label>
          <Input
            id="st-vol"
            type="number"
            min={0}
            value={draft.weeklyVolumeKm ?? ''}
            onChange={(e) =>
              setDraft({
                ...draft,
                weeklyVolumeKm: e.target.value ? Number(e.target.value) : undefined,
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="st-keys">{t.keyWorkoutsLabel}</Label>
          <Textarea
            id="st-keys"
            rows={3}
            value={draft.keyWorkouts.join('\n')}
            onChange={(e) =>
              setDraft({
                ...draft,
                keyWorkouts: e.target.value
                  .split('\n')
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="st-miles">{t.milestonesLabel}</Label>
          <Textarea
            id="st-miles"
            rows={2}
            value={(draft.milestones ?? []).join('\n')}
            onChange={(e) =>
              setDraft({
                ...draft,
                milestones: e.target.value
                  .split('\n')
                  .map((x) => x.trim())
                  .filter(Boolean),
              })
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="st-notes">{t.notesLabel}</Label>
          <Textarea
            id="st-notes"
            rows={2}
            value={draft.notes ?? ''}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
          />
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onCancel}>
          {t.cancel}
        </Button>
        <Button className="bg-gold text-navy hover:bg-gold/90" onClick={() => onSave(draft)}>
          {t.saveStageBtn}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
