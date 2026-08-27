'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
import { Plus, Trash2, Loader2, Pencil } from 'lucide-react'
import type { ExerciseLibraryItem, StrengthBlock, StrengthBlockExercise } from '@/lib/types'
import { listExercises } from '@/lib/exercise-library'
import { ExerciseEditDialog } from '@/components/coach/exercise-edit-dialog'
import { resolveExerciseDisplay } from '@/lib/utils'

function genId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

interface Props {
  blocks: StrengthBlock[]
  onChange: (blocks: StrengthBlock[]) => void
  // Which half of the exercise library to offer — a strength workout only
  // picks from category 'strength' exercises. A stretch workout picks from
  // both 'stretch' and 'warmup' — there's no separate WorkoutType for
  // warm-ups, a warm-up routine is just a 'stretch' workout built entirely
  // from 'warmup'-category exercises, so both need to be selectable here.
  // Defaults to 'strength' for any caller that predates this.
  category?: 'strength' | 'stretch' | 'warmup'
}

// Builds the structured strength/stretch-workout content that powers Lift
// Mode (components/athlete/lift-mode.tsx) — a list of blocks, each either a
// single exercise ("Set 1") or a superset (2+ exercises back to back with
// no rest between them). Every exercise is picked from the coach's own
// exercise library so it always carries a real video + instructions.
export function StrengthBlockBuilder({ blocks, onChange, category = 'strength' }: Props) {
  const [allExercises, setAllExercises] = useState<ExerciseLibraryItem[]>([])
  const [loadingLibrary, setLoadingLibrary] = useState(true)
  // Coach clicked the pencil on an exercise already in a block — opens the
  // same edit form as the Exercise Library page, right from here.
  const [editTarget, setEditTarget] = useState<{ blockId: string; instanceId: string; exerciseId: string } | null>(null)
  // Coach clicked "new exercise" from a specific block's picker because it
  // wasn't in the library yet — opens the same dialog in create mode, and
  // the new exercise gets added straight into that block once saved.
  const [creatingForBlockId, setCreatingForBlockId] = useState<string | null>(null)
  // Narrows the picker below to one folder at a time (see lib/types.ts
  // ExerciseLibraryItem.subcategory) — purely a "help me find it" filter,
  // doesn't affect what's actually in the library.
  const [subcategoryFilter, setSubcategoryFilter] = useState<string | null>(null)

  useEffect(() => {
    listExercises().then(setAllExercises).catch(console.error).finally(() => setLoadingLibrary(false))
  }, [])

  const library = allExercises.filter((ex) => {
    const exCategory = ex.category || 'strength'
    return category === 'strength' ? exCategory === 'strength' : exCategory !== 'strength'
  })
  const subcategories = Array.from(new Set(library.map((ex) => ex.subcategory).filter((s): s is string => !!s))).sort()
  const pickableLibrary = subcategoryFilter ? library.filter((ex) => ex.subcategory === subcategoryFilter) : library
  const libraryById = new Map(allExercises.map((e) => [e.id, e]))
  const blockLabelPrefix = category === 'stretch' ? 'מתיחה' : 'סט'

  const addBlock = () => {
    onChange([...blocks, { id: genId('block'), label: `${blockLabelPrefix} ${blocks.length + 1}`, exercises: [] }])
  }

  const removeBlock = (blockId: string) => {
    onChange(blocks.filter((b) => b.id !== blockId))
  }

  const updateBlockLabel = (blockId: string, label: string) => {
    onChange(blocks.map((b) => (b.id === blockId ? { ...b, label } : b)))
  }

  const addExercise = (blockId: string, exerciseIdOrItem: string | ExerciseLibraryItem) => {
    // Accepts either an id (normal picker selection, looked up in the
    // already-loaded library) or a full item (just-created via the quick-
    // add dialog, whose setAllExercises update hasn't landed in this
    // closure yet — looking it up by id would silently find nothing).
    const ex = typeof exerciseIdOrItem === 'string' ? library.find((e) => e.id === exerciseIdOrItem) : exerciseIdOrItem
    if (!ex) return
    const newExercise: StrengthBlockExercise = {
      id: genId('ex'),
      exerciseId: ex.id,
      name: ex.name,
      // Coerced to a real boolean (not left as ex.videoMuted directly) —
      // exercises saved before this field existed have it as `undefined`
      // in Firestore, and undefined is illegal on write, same reasoning as
      // the targetDurationSec fix above.
      videoMuted: ex.videoMuted ?? false,
      category: ex.category ?? 'strength',
      targetSets: ex.defaultSets || 3,
      targetReps: ex.defaultReps || '10',
      notes: '',
      // Omit the key entirely rather than set undefined — Firestore's
      // client SDK throws "Unsupported field value: undefined" on write,
      // it only accepts null or a missing key for an empty optional field.
      // videoUrl/instructions hit this exact case for any exercise that
      // doesn't have one yet ("failed to save workout" on every add).
      ...(ex.videoUrl ? { videoUrl: ex.videoUrl } : {}),
      ...(ex.instructions ? { instructions: ex.instructions } : {}),
      ...(ex.isTimed ? { targetDurationSec: ex.defaultDurationSec || 30 } : {}),
    }
    onChange(blocks.map((b) => (b.id === blockId ? { ...b, exercises: [...b.exercises, newExercise] } : b)))
    // A block with 2+ exercises is a superset by definition — relabel it
    // automatically unless the coach already gave it a custom name.
    const block = blocks.find((b) => b.id === blockId)
    if (block && block.exercises.length === 1 && /^(סט|מתיחה) \d+$/.test(block.label)) {
      onChange(blocks.map((b) => (b.id === blockId
        ? { ...b, label: `סופרסט`, exercises: [...b.exercises, newExercise] }
        : b)))
    }
  }

  const removeExercise = (blockId: string, exerciseInstanceId: string) => {
    onChange(blocks.map((b) => (b.id === blockId
      ? { ...b, exercises: b.exercises.filter((e) => e.id !== exerciseInstanceId) }
      : b)))
  }

  const updateExercise = (blockId: string, exerciseInstanceId: string, patch: Partial<StrengthBlockExercise>) => {
    onChange(blocks.map((b) => (b.id === blockId
      ? { ...b, exercises: b.exercises.map((e) => {
          if (e.id !== exerciseInstanceId) return e
          const merged: any = { ...e, ...patch }
          // Firestore rejects `undefined` field values on write — a patch
          // clearing an optional field (e.g. removing an alternate
          // exercise) must drop the key entirely, not leave it undefined.
          Object.keys(merged).forEach((k) => { if (merged[k] === undefined) delete merged[k] })
          return merged
        }) }
      : b)))
  }

  // After editing an exercise from the pencil below: refresh the picker's
  // library list, and sync THIS specific block-exercise's denormalized
  // copy (name/video/instructions) to match — otherwise the fix would only
  // show up the next time this exercise gets freshly added to a block,
  // not in the one the coach was just looking at.
  const handleExerciseSaved = (saved: ExerciseLibraryItem) => {
    setAllExercises((prev) => (prev.some((e) => e.id === saved.id) ? prev.map((e) => (e.id === saved.id ? saved : e)) : [...prev, saved]))
    if (editTarget) {
      updateExercise(editTarget.blockId, editTarget.instanceId, {
        name: saved.name,
        videoUrl: saved.videoUrl,
        videoMuted: saved.videoMuted ?? false,
        instructions: saved.instructions,
        category: saved.category ?? 'strength',
      })
    } else if (creatingForBlockId) {
      addExercise(creatingForBlockId, saved)
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>בלוקים (סטים / סופרסטים)</CardTitle>
        <Button type="button" variant="outline" size="sm" onClick={addBlock}>
          <Plus className="h-4 w-4 mr-2" />
          הוסף בלוק
        </Button>
      </CardHeader>
      <CardContent>
        {loadingLibrary ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
        ) : library.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">
            אין עדיין תרגילי {category === 'stretch' ? 'מתיחות' : 'כוח'} בספרייה — הוסיפו תרגילים בלשונית &quot;ספריית תרגילים&quot; (קטגוריית {category === 'stretch' ? 'מתיחות' : 'כוח'}) לפני בניית אימון מובנה.
          </p>
        ) : blocks.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">לא נוספו בלוקים עדיין</p>
        ) : (
          <div className="space-y-4">
            {subcategories.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setSubcategoryFilter(null)}
                  className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                    !subcategoryFilter ? 'bg-[#0a1628] text-white border-[#0a1628]' : 'bg-white text-gray-500 border-gray-200'
                  }`}
                >
                  הכל
                </button>
                {subcategories.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSubcategoryFilter(s)}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-semibold border transition-colors ${
                      subcategoryFilter === s ? 'bg-[#0a1628] text-white border-[#0a1628]' : 'bg-white text-gray-500 border-gray-200'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {blocks.map((block, bIdx) => (
              <div key={block.id} className="rounded-lg border border-border overflow-hidden">
                <div className="flex items-center justify-between gap-2 bg-muted/40 px-3 py-2">
                  <Input
                    value={block.label}
                    onChange={(e) => updateBlockLabel(block.id, e.target.value)}
                    className="h-7 text-sm font-semibold max-w-[160px]"
                  />
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeBlock(block.id)} className="text-destructive hover:text-destructive h-7 w-7 p-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <div className="p-3 space-y-3">
                  {block.exercises.map((rawEx) => {
                    const ex = resolveExerciseDisplay(rawEx, libraryById)
                    return (
                    <div key={ex.id} className="rounded-md border border-border/60 p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium">{ex.name}</span>
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setEditTarget({ blockId: block.id, instanceId: ex.id, exerciseId: ex.exerciseId })}
                            className="text-muted-foreground hover:text-foreground h-6 w-6 p-0"
                            title="ערוך תרגיל בספרייה"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button type="button" variant="ghost" size="sm" onClick={() => removeExercise(block.id, ex.id)} className="text-destructive hover:text-destructive h-6 w-6 p-0">
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-[11px]">סטים</Label>
                          <Input type="number" min={1} value={ex.targetSets}
                            onChange={(e) => updateExercise(block.id, ex.id, { targetSets: Number(e.target.value) || 1 })}
                            className="h-8 text-sm" />
                        </div>
                        {ex.targetDurationSec != null ? (
                          <div className="space-y-1">
                            <Label className="text-[11px]">משך (שניות)</Label>
                            <Input type="number" min={1} value={ex.targetDurationSec}
                              onChange={(e) => updateExercise(block.id, ex.id, { targetDurationSec: Number(e.target.value) || 1 })}
                              className="h-8 text-sm" />
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <Label className="text-[11px]">חזרות</Label>
                            <Input value={ex.targetReps}
                              onChange={(e) => updateExercise(block.id, ex.id, { targetReps: e.target.value })}
                              placeholder="8-12" className="h-8 text-sm" dir="rtl" />
                          </div>
                        )}
                      </div>
                      <Input value={ex.notes || ''}
                        onChange={(e) => updateExercise(block.id, ex.id, { notes: e.target.value })}
                        placeholder="הערה לתרגיל הזה (לא חובה)" className="h-8 text-sm" dir="rtl" />
                      <div className="space-y-1">
                        <Label className="text-[11px]">חלופה (אופציונלי — הספורטאי יבחר מה עשה באותו יום)</Label>
                        <Select
                          value={ex.alternateExerciseId || '__none__'}
                          onValueChange={(v) => updateExercise(block.id, ex.id, { alternateExerciseId: v === '__none__' ? undefined : v })}
                        >
                          <SelectTrigger className="h-8 text-sm"><SelectValue placeholder="ללא חלופה" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">ללא חלופה</SelectItem>
                            {library.filter((e) => e.id !== ex.exerciseId).map((e) => (
                              <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    )
                  })}
                  <div className="flex gap-1.5">
                    <Select value="" onValueChange={(exerciseId) => addExercise(block.id, exerciseId)}>
                      <SelectTrigger className="h-8 text-sm flex-1">
                        <SelectValue placeholder={block.exercises.length === 0 ? 'הוסף תרגיל' : 'הוסף תרגיל נוסף לסופרסט'} />
                      </SelectTrigger>
                      <SelectContent>
                        {pickableLibrary.map((ex) => (
                          <SelectItem key={ex.id} value={ex.id}>
                            {ex.name}{category !== 'strength' && ex.category === 'warmup' ? ' (חימום)' : ''}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setCreatingForBlockId(block.id)}
                      className="h-8 text-xs shrink-0"
                      title="התרגיל לא ברשימה? צרו אותו כאן"
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" />תרגיל חדש
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
      <ExerciseEditDialog
        exerciseId={editTarget?.exerciseId ?? null}
        open={!!editTarget || !!creatingForBlockId}
        defaultCategory={creatingForBlockId ? (category === 'strength' ? 'strength' : 'stretch') : undefined}
        onOpenChange={(open) => { if (!open) { setEditTarget(null); setCreatingForBlockId(null) } }}
        onSaved={handleExerciseSaved}
      />
    </Card>
  )
}
