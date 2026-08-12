'use client'

import { useEffect, useMemo, useState } from 'react'
import { doc, getDoc, updateDoc, writeBatch, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Loader2, ChevronLeft, ChevronRight, Check, X, TrendingUp, Play, Square, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { isCoachEmail } from '@/lib/constants'
import { instructionLines, resolveExerciseDisplay, resolveText, formatSetTarget, translateBlockLabel } from '@/lib/utils'
import { ExerciseEditDialog } from '@/components/coach/exercise-edit-dialog'
import { listExercises } from '@/lib/exercise-library'
import type { AssignedWorkout, StrengthBlockExercise, ExerciseLibraryItem } from '@/lib/types'

type SetProgress = { completed: boolean; weightKg?: number | null; durationSec?: number | null }
type Progress = Record<string, SetProgress[]>

const LIFT_MODE_TYPES = ['strength', 'stretch'] as const

// Static UI chrome for this screen — not coach-authored data (no AI
// translation needed), just an English/Hebrew pair per string so an
// athlete with the app set to English sees a fully English screen, not a
// mix of translated workout data inside a Hebrew-labeled UI.
interface LmText {
  notFound: string
  noBlocks: string
  notEnabled: string
  loadFailed: string
  finishedToast: string
  finishFailed: string
  back: string
  exit: string
  setsDone: (done: number, total: number) => string
  progress: string
  blockOf: (i: number, n: number) => string
  roundOf: (i: number, n: number) => string
  noVideo: string
  showVideo: string
  straightNext: string
  restThenNext: string
  editInLibrary: string
  tapStartTimer: string
  tapSetToMark: string
  prev: string
  next: string
  finish: string
  stop: string
  again: (sec: number) => string
  start: (sec: number) => string
  setLabel: (i: number) => string
  doneSuffix: string
  weightPlaceholder: string
  whatToday: string
}

const LM: Record<'he' | 'en', LmText> = {
  he: {
    notFound: 'האימון לא נמצא',
    noBlocks: 'לאימון הזה אין תרגילים מובנים למצב אימון',
    notEnabled: 'התכונה הזו עדיין לא זמינה עבורך — דבר עם המאמן שלך',
    loadFailed: 'טעינת האימון נכשלה',
    finishedToast: 'כל הכבוד! האימון הושלם 💪',
    finishFailed: 'שמירת סיום האימון נכשלה',
    back: 'חזרה',
    exit: 'יציאה',
    setsDone: (done: number, total: number) => `${done}/${total} סטים הושלמו`,
    progress: 'התקדמות',
    blockOf: (i: number, n: number) => `בלוק ${i} מתוך ${n}`,
    roundOf: (i: number, n: number) => `סבב ${i} מתוך ${n}`,
    noVideo: 'אין סרטון הדגמה',
    showVideo: 'הצג סרטון הדגמה',
    straightNext: '↓ ישר לתרגיל הבא, ללא מנוחה',
    restThenNext: 'מנוחה, ואז הסבב הבא',
    editInLibrary: 'ערוך בספריית התרגילים',
    tapStartTimer: 'לחצו התחל להפעלת הטיימר לכל סט',
    tapSetToMark: 'לחצו על "סט X" לסימון שהסט בוצע',
    prev: 'הקודם',
    next: 'הבא',
    finish: 'סיים אימון',
    stop: 'עצור',
    again: (sec: number) => `שוב · בוצע ${sec} שניות`,
    start: (sec: number) => `התחל · ${sec} שניות`,
    setLabel: (i: number) => `סט ${i}`,
    doneSuffix: ' · בוצע',
    weightPlaceholder: 'משקל ק"ג',
    whatToday: 'מה עושים היום?',
  },
  en: {
    notFound: 'Workout not found',
    noBlocks: 'This workout has no structured exercises for Lift Mode',
    notEnabled: "This feature isn't available for you yet — talk to your coach",
    loadFailed: 'Failed to load the workout',
    finishedToast: 'Nice work! Workout completed 💪',
    finishFailed: 'Failed to save workout completion',
    back: 'Back',
    exit: 'Exit',
    setsDone: (done: number, total: number) => `${done}/${total} sets done`,
    progress: 'Progress',
    blockOf: (i: number, n: number) => `Block ${i} of ${n}`,
    roundOf: (i: number, n: number) => `Round ${i} of ${n}`,
    noVideo: 'No demo video',
    showVideo: 'Show demo video',
    straightNext: '↓ straight into the next exercise, no rest',
    restThenNext: 'Rest, then the next round',
    editInLibrary: 'Edit in exercise library',
    tapStartTimer: 'Tap start to run the timer for each set',
    tapSetToMark: 'Tap "Set X" to mark it done',
    prev: 'Previous',
    next: 'Next',
    finish: 'Finish workout',
    stop: 'Stop',
    again: (sec: number) => `Again · did ${sec} sec`,
    start: (sec: number) => `Start · ${sec} sec`,
    setLabel: (i: number) => `Set ${i}`,
    doneSuffix: ' · done',
    weightPlaceholder: 'Weight kg',
    whatToday: 'What are you doing today?',
  },
}

function emptyProgressFor(exercise: StrengthBlockExercise): SetProgress[] {
  return Array.from({ length: Math.max(1, exercise.targetSets) }, () => ({ completed: false, weightKg: null, durationSec: null }))
}

// Self-contained start/stop countdown for a timed set (a stretch hold, a
// plank) — used instead of the weight input when the exercise has a
// targetDurationSec. Keeps its own running/remaining state locally since
// only the current block's exercises are ever mounted at once.
function SetTimer({ targetSec, savedSec, completed, onDone, ui }: {
  targetSec: number
  savedSec?: number | null
  completed: boolean
  onDone: (sec: number) => void
  ui: LmText
}) {
  const [running, setRunning] = useState(false)
  const [remaining, setRemaining] = useState(targetSec)

  useEffect(() => {
    if (!running) return
    if (remaining <= 0) {
      setRunning(false)
      onDone(targetSec)
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(250)
      return
    }
    const t = setTimeout(() => setRemaining((r) => r - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, remaining])

  const start = () => { setRemaining(targetSec); setRunning(true) }
  const stop = () => { setRunning(false); onDone(targetSec - remaining) }

  if (running) {
    return (
      <div className="flex items-center gap-2">
        <span className="font-mono text-base font-semibold text-[#0a1628] w-10 text-center">{remaining}</span>
        <Button type="button" size="sm" variant="outline" onClick={stop} className="h-9 text-xs">
          <Square className="h-3.5 w-3.5 mr-1" />{ui.stop}
        </Button>
      </div>
    )
  }

  return (
    <Button type="button" size="sm" variant={completed ? 'outline' : 'default'} onClick={start} className="h-9 text-xs">
      <Play className="h-3.5 w-3.5 mr-1" />
      {completed ? ui.again(savedSec ?? targetSec) : ui.start(targetSec)}
    </Button>
  )
}

// One set's control row — a checkbox+weight for reps-based exercises, or a
// SetTimer for timed ones. Shared between the single-exercise block layout
// and the superset round layout below, since both just need "control for
// exercise X's set N."
function SetControl({ ex, setIdx, set, onToggle, onWeight, onDuration, ui }: {
  ex: StrengthBlockExercise
  setIdx: number
  set: SetProgress
  onToggle: () => void
  onWeight: (weight: string) => void
  onDuration: (sec: number) => void
  ui: LmText
}) {
  if (ex.targetDurationSec != null) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground w-10 shrink-0">{ui.setLabel(setIdx + 1)}</span>
        <SetTimer targetSec={ex.targetDurationSec} savedSec={set.durationSec} completed={set.completed} onDone={onDuration} ui={ui} />
      </div>
    )
  }
  // Stretch/warmup reps-based sets don't track weight — just mark done.
  const tracksWeight = (ex.category || 'strength') === 'strength'
  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={set.completed}
        className={`flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-xs font-semibold transition-colors ${
          set.completed
            ? 'bg-emerald-600 border-emerald-600 text-white'
            : 'border-input text-muted-foreground bg-muted/40'
        }`}
      >
        {set.completed ? <Check className="h-4 w-4" /> : <span className="h-4 w-4 rounded-full border-2 border-current" />}
        {ui.setLabel(setIdx + 1)}
        {set.completed && ui.doneSuffix}
      </button>
      {tracksWeight && (
        <Input
          type="number"
          inputMode="decimal"
          placeholder={ui.weightPlaceholder}
          value={set.weightKg ?? ''}
          onChange={(e) => onWeight(e.target.value)}
          className="h-9 text-sm max-w-[110px]"
        />
      )}
    </div>
  )
}

// Renders an exercise's instructions as bullet points instead of one dense
// paragraph — splits on real newlines if the coach entered one cue per
// line, else falls back to sentence-splitting (see lib/utils.ts).
// Either/or picker for a slot with an alternateExerciseId (e.g. box jump
// OR step up) — lets the athlete choose which one they're doing THIS
// session, before the video/instructions/logging below switch to match.
function AlternatePicker({ primaryName, alternateName, isAlt, onChoose, ui }: {
  primaryName: string
  alternateName: string
  isAlt: boolean
  onChoose: (isAlt: boolean) => void
  ui: LmText
}) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold text-muted-foreground">{ui.whatToday}</p>
      <div className="flex gap-1.5">
        <button
          type="button"
          onClick={() => onChoose(false)}
          className={`flex-1 px-2 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
            !isAlt ? 'bg-[#0a1628] text-white border-[#0a1628]' : 'bg-white text-gray-500 border-gray-200'
          }`}
        >
          {primaryName}
        </button>
        <button
          type="button"
          onClick={() => onChoose(true)}
          className={`flex-1 px-2 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
            isAlt ? 'bg-[#0a1628] text-white border-[#0a1628]' : 'bg-white text-gray-500 border-gray-200'
          }`}
        >
          {alternateName}
        </button>
      </div>
    </div>
  )
}

function InstructionList({ text, className }: { text?: string | null; className?: string }) {
  const lines = instructionLines(text)
  if (!lines.length) return null
  return (
    <ul className={className}>
      {lines.map((line, i) => (
        <li key={i} className="flex items-start gap-1.5">
          <span className="text-[#c9a84c] shrink-0">•</span>
          <span>{line}</span>
        </li>
      ))}
    </ul>
  )
}

export function LiftMode({ assignedWorkoutId }: { assignedWorkoutId: string }) {
  const router = useRouter()
  const { user } = useAuth()
  const { language } = useLanguage()
  const ui = LM[language]
  const [assigned, setAssigned] = useState<AssignedWorkout | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<Progress>({})
  // Which either/or slots (StrengthBlockExercise.alternateExerciseId) the
  // athlete picked the ALTERNATE for this session — keyed by block-
  // exercise instance id, true = alternate. Not persisted on the workout
  // itself (it's a per-session choice, not a template change) — only
  // affects what's displayed/logged for this run-through.
  const [altChosen, setAltChosen] = useState<Record<string, boolean>>({})
  const [blockIndex, setBlockIndex] = useState(0)
  const [finishing, setFinishing] = useState(false)
  // Coach previewing this workout can fix an exercise's video/instructions
  // right from here (see components/coach/exercise-edit-dialog.tsx).
  const [editingExerciseId, setEditingExerciseId] = useState<string | null>(null)
  const isCoachViewer = isCoachEmail(user?.email)
  // Current Exercise Library state, keyed by id — video/instructions/name/
  // category shown below always come from here when the exercise still
  // exists, not from the stored snapshot on the block, so an edited video
  // shows up immediately everywhere it's used ("it's the same exercise").
  // Only targetSets/targetReps/targetDurationSec/notes stay as stored,
  // since those are workout-specific. See lib/utils.ts resolveExerciseDisplay.
  const [libraryById, setLibraryById] = useState<Map<string, ExerciseLibraryItem>>(new Map())

  useEffect(() => {
    listExercises()
      .then((list) => setLibraryById(new Map(list.map((e) => [e.id, e]))))
      .catch((err) => console.error('Error loading exercise library for live resolution:', err))
  }, [])

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, 'assignedWorkouts', assignedWorkoutId))
        if (!snap.exists()) { setError(ui.notFound); return }
        const data = { id: snap.id, ...snap.data() } as AssignedWorkout
        if (!LIFT_MODE_TYPES.includes(data.workout?.type as typeof LIFT_MODE_TYPES[number]) || !data.workout.strengthBlocks?.length) {
          setError(ui.noBlocks)
          return
        }
        // Feature still in testing — coach turns it on per athlete
        // (users.strengthToolsVisibleToAthlete). Checked here directly, not
        // just used to hide the entry button, so a direct URL visit before
        // the coach enables it stays blocked too. The coach account itself
        // always passes, so testing/building this doesn't get locked out.
        if (!isCoachEmail(user?.email)) {
          const athleteSnap = await getDoc(doc(db, 'users', data.athleteId))
          if (!athleteSnap.exists() || athleteSnap.data().strengthToolsVisibleToAthlete !== true) {
            setError(ui.notEnabled)
            return
          }
        }
        setAssigned(data)
        const initial: Progress = {}
        for (const block of data.workout.strengthBlocks) {
          for (const ex of block.exercises) {
            initial[ex.id] = data.strengthProgress?.[ex.id] || emptyProgressFor(ex)
          }
        }
        setProgress(initial)
      } catch (err) {
        console.error('Error loading lift workout:', err)
        setError(ui.loadFailed)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [assignedWorkoutId])

  const blocks = assigned?.workout.strengthBlocks || []
  const block = blocks[blockIndex]
  const isLastBlock = blockIndex === blocks.length - 1
  const isSuperset = (block?.exercises.length || 0) > 1
  const maxSetsInBlock = block ? Math.max(1, ...block.exercises.map((ex) => ex.targetSets)) : 1
  const totalSets = useMemo(() => Object.values(progress).reduce((s, sets) => s + sets.length, 0), [progress])
  const doneSets = useMemo(() => Object.values(progress).reduce((s, sets) => s + sets.filter((x) => x.completed).length, 0), [progress])

  const persistProgress = async (next: Progress) => {
    try {
      await updateDoc(doc(db, 'assignedWorkouts', assignedWorkoutId), { strengthProgress: next, updatedAt: serverTimestamp() })
    } catch (err) {
      console.error('Error saving lift progress:', err)
    }
  }

  const toggleSet = (exerciseId: string, setIdx: number) => {
    setProgress((prev) => {
      const next = { ...prev, [exerciseId]: prev[exerciseId].map((s, i) => (i === setIdx ? { ...s, completed: !s.completed } : s)) }
      persistProgress(next)
      return next
    })
  }

  const setWeight = (exerciseId: string, setIdx: number, weight: string) => {
    setProgress((prev) => {
      const next = { ...prev, [exerciseId]: prev[exerciseId].map((s, i) => (i === setIdx ? { ...s, weightKg: weight === '' ? null : Number(weight) } : s)) }
      persistProgress(next)
      return next
    })
  }

  const setDuration = (exerciseId: string, setIdx: number, durationSec: number) => {
    setProgress((prev) => {
      const next = { ...prev, [exerciseId]: prev[exerciseId].map((s, i) => (i === setIdx ? { ...s, durationSec, completed: true } : s)) }
      persistProgress(next)
      return next
    })
  }

  const finishWorkout = async () => {
    setFinishing(true)
    try {
      const batch = writeBatch(db)
      batch.update(doc(db, 'assignedWorkouts', assignedWorkoutId), {
        strengthProgress: progress,
        status: 'completed',
        completedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      // Durable per-exercise history for the progress chart — separate from
      // strengthProgress above, which gets overwritten if this workout is
      // ever reopened. See ExerciseLogEntry in lib/types.ts.
      for (const block of blocks) {
        for (const rawEx of block.exercises) {
          const sets = progress[rawEx.id] || []
          if (!sets.length) continue
          // Log under whichever exercise the athlete actually picked this
          // session (see AlternatePicker) — not always the primary one —
          // so /athlete/progress history lands under the right exercise.
          const isAlt = !!altChosen[rawEx.id] && !!rawEx.alternateExerciseId
          const loggedExerciseId = isAlt ? rawEx.alternateExerciseId! : rawEx.exerciseId
          const loggedName = isAlt ? (libraryById.get(rawEx.alternateExerciseId!)?.name || rawEx.name) : rawEx.name
          const weights = sets.map((s) => s.weightKg).filter((w): w is number => typeof w === 'number')
          const durations = sets.map((s) => s.durationSec).filter((d): d is number => typeof d === 'number')
          const logId = `${assignedWorkoutId}_${loggedExerciseId}`
          batch.set(doc(db, 'exerciseLogs', logId), {
            id: logId,
            athleteId: assigned?.athleteId,
            exerciseId: loggedExerciseId,
            exerciseName: loggedName,
            assignedWorkoutId,
            workoutDate: assigned?.scheduledDate,
            sets: sets.map((s) => ({ weightKg: s.weightKg ?? null, durationSec: s.durationSec ?? null, completed: s.completed })),
            maxWeightKg: weights.length ? Math.max(...weights) : null,
            maxDurationSec: durations.length ? Math.max(...durations) : null,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }, { merge: true })
        }
      }
      await batch.commit()
      toast.success(ui.finishedToast)
      router.push('/athlete/schedule')
    } catch (err) {
      console.error('Error finishing lift workout:', err)
      toast.error(ui.finishFailed)
    } finally {
      setFinishing(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  )

  if (error || !assigned || !block) return (
    <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-center px-4">
      <p className="text-muted-foreground">{error}</p>
      <Button variant="outline" onClick={() => router.back()}>{ui.back}</Button>
    </div>
  )

  return (
    <div dir={language === 'en' ? 'ltr' : 'rtl'} className="max-w-lg mx-auto px-4 py-4 space-y-4 pb-24">
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" onClick={() => router.back()}><X className="h-4 w-4 mr-1" />{ui.exit}</Button>
        <p className="text-xs text-muted-foreground">{ui.setsDone(doneSets, totalSets)}</p>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/athlete/progress"><TrendingUp className="h-4 w-4 mr-1" />{ui.progress}</Link>
        </Button>
      </div>

      <div>
        <p className="text-xs text-muted-foreground">
          {assigned.workout.type === 'stretch' ? '🧘' : '💪'} {resolveText(language, assigned.workout.title, assigned.workout.titleEn)}
        </p>
        <h1 className="text-lg font-semibold">{translateBlockLabel(block.label, language)}</h1>
        <p className="text-xs text-muted-foreground">{ui.blockOf(blockIndex + 1, blocks.length)}</p>
      </div>

      {isSuperset ? (
        // Superset block: grouped by ROUND, not by exercise — each round is
        // exercise A's set N, then B's, then C's, back to back with no rest,
        // then rest before the next round. This is the order it's actually
        // meant to be performed in; listing "all of A's sets, then all of
        // B's" (the old layout) didn't communicate that at all.
        <div className="space-y-4">
          {Array.from({ length: maxSetsInBlock }).map((_, roundIdx) => (
            <div key={roundIdx} className="rounded-xl border-2 border-[#0a1628]/15 overflow-hidden">
              <div className="bg-[#0a1628]/5 px-3 py-2">
                <p className="text-sm font-bold text-[#0a1628]">{ui.roundOf(roundIdx + 1, maxSetsInBlock)}</p>
              </div>
              <div className="p-3 space-y-3">
                {block.exercises.map((rawEx, exIdx) => {
                  const set = progress[rawEx.id]?.[roundIdx]
                  if (!set) return null
                  const primaryDisplay = resolveExerciseDisplay(rawEx, libraryById, language)
                  const isAlt = !!altChosen[rawEx.id] && !!rawEx.alternateExerciseId
                  const ex = isAlt
                    ? resolveExerciseDisplay({ ...rawEx, exerciseId: rawEx.alternateExerciseId! }, libraryById, language)
                    : primaryDisplay
                  const altLive = rawEx.alternateExerciseId ? libraryById.get(rawEx.alternateExerciseId) : undefined
                  return (
                    <div key={rawEx.id}>
                      <div className="rounded-lg border border-border overflow-hidden">
                        {roundIdx === 0 ? (
                          ex.videoUrl ? (
                            <video src={ex.videoUrl} muted={ex.videoMuted} className="w-full aspect-video bg-black" controls playsInline preload="metadata" />
                          ) : (
                            <div className="w-full h-16 bg-muted flex items-center justify-center text-muted-foreground text-sm">{ui.noVideo}</div>
                          )
                        ) : ex.videoUrl && (
                          <details>
                            <summary className="text-xs text-muted-foreground p-2 cursor-pointer">{ui.showVideo}</summary>
                            <video src={ex.videoUrl} muted={ex.videoMuted} className="w-full aspect-video bg-black" controls playsInline preload="metadata" />
                          </details>
                        )}
                        <div className="p-2.5 space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold">{ex.name}</p>
                            {isCoachViewer && (
                              <button type="button" onClick={() => setEditingExerciseId(ex.exerciseId)} className="text-muted-foreground hover:text-foreground shrink-0" title={ui.editInLibrary}>
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          {roundIdx === 0 && altLive && (
                            <AlternatePicker
                              primaryName={primaryDisplay.name}
                              alternateName={resolveText(language, altLive.name, altLive.nameEn)}
                              isAlt={isAlt}
                              onChoose={(v) => setAltChosen((prev) => ({ ...prev, [rawEx.id]: v }))}
                              ui={ui}
                            />
                          )}
                          {roundIdx === 0 && <InstructionList text={ex.instructions} className="text-xs text-muted-foreground space-y-0.5" />}
                          {ex.notes && <p className="text-xs text-primary">{ex.notes}</p>}
                          <p className="text-xs font-semibold text-[#0a1628]/70">
                            {formatSetTarget(language, ex.targetReps, ex.targetDurationSec)}
                          </p>
                          <SetControl
                            ex={ex}
                            setIdx={roundIdx}
                            set={set}
                            onToggle={() => toggleSet(ex.id, roundIdx)}
                            onWeight={(w) => setWeight(ex.id, roundIdx, w)}
                            onDuration={(sec) => setDuration(ex.id, roundIdx, sec)}
                            ui={ui}
                          />
                        </div>
                      </div>
                      {exIdx < block.exercises.length - 1 && (
                        <p className="text-[11px] text-center text-muted-foreground py-1.5">{ui.straightNext}</p>
                      )}
                    </div>
                  )
                })}
              </div>
              {roundIdx < maxSetsInBlock - 1 && (
                <div className="bg-amber-50 px-3 py-2 text-center border-t border-amber-100">
                  <p className="text-xs font-semibold text-amber-700">{ui.restThenNext}</p>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-4">
          {block.exercises.map((rawEx) => {
            const primaryDisplay = resolveExerciseDisplay(rawEx, libraryById, language)
            const isAlt = !!altChosen[rawEx.id] && !!rawEx.alternateExerciseId
            const ex = isAlt
              ? resolveExerciseDisplay({ ...rawEx, exerciseId: rawEx.alternateExerciseId! }, libraryById, language)
              : primaryDisplay
            const altLive = rawEx.alternateExerciseId ? libraryById.get(rawEx.alternateExerciseId) : undefined
            return (
            <div key={rawEx.id} className="rounded-xl border border-border overflow-hidden">
              {ex.videoUrl ? (
                <video src={ex.videoUrl} muted={ex.videoMuted} className="w-full aspect-video bg-black" controls playsInline preload="metadata" />
              ) : (
                <div className="w-full h-16 bg-muted flex items-center justify-center text-muted-foreground text-sm">{ui.noVideo}</div>
              )}
              <div className="p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="font-semibold">{ex.name}</h2>
                  {isCoachViewer && (
                    <button type="button" onClick={() => setEditingExerciseId(ex.exerciseId)} className="text-muted-foreground hover:text-foreground shrink-0" title={ui.editInLibrary}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                {altLive && (
                  <AlternatePicker
                    primaryName={primaryDisplay.name}
                    alternateName={resolveText(language, altLive.name, altLive.nameEn)}
                    isAlt={isAlt}
                    onChoose={(v) => setAltChosen((prev) => ({ ...prev, [rawEx.id]: v }))}
                    ui={ui}
                  />
                )}
                <InstructionList text={ex.instructions} className="text-xs text-muted-foreground space-y-0.5" />
                {ex.notes && <p className="text-xs text-primary">{ex.notes}</p>}
                <p className="text-xs text-muted-foreground">
                  {formatSetTarget(language, ex.targetReps, ex.targetDurationSec, ex.targetSets)}
                </p>
                <div className="space-y-1.5 pt-1">
                  {(progress[ex.id] || []).map((set, i) => (
                    <SetControl
                      key={i}
                      ex={ex}
                      setIdx={i}
                      set={set}
                      onToggle={() => toggleSet(ex.id, i)}
                      onWeight={(w) => setWeight(ex.id, i, w)}
                      onDuration={(sec) => setDuration(ex.id, i, sec)}
                      ui={ui}
                    />
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground pt-0.5">
                  {ex.targetDurationSec != null ? ui.tapStartTimer : ui.tapSetToMark}
                </p>
              </div>
            </div>
            )
          })}
        </div>
      )}

      <div className="flex gap-2 pt-2">
        <Button variant="outline" disabled={blockIndex === 0} onClick={() => setBlockIndex((i) => Math.max(0, i - 1))} className="flex-1">
          <ChevronRight className="h-4 w-4 mr-1" />{ui.prev}
        </Button>
        {isLastBlock ? (
          <Button onClick={finishWorkout} disabled={finishing} className="flex-1 bg-emerald-600 hover:bg-emerald-700">
            {finishing && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            {ui.finish}
          </Button>
        ) : (
          <Button onClick={() => setBlockIndex((i) => Math.min(blocks.length - 1, i + 1))} className="flex-1">
            {ui.next}<ChevronLeft className="h-4 w-4 ml-1" />
          </Button>
        )}
      </div>

      {isCoachViewer && (
        <ExerciseEditDialog
          exerciseId={editingExerciseId}
          open={!!editingExerciseId}
          onOpenChange={(open) => { if (!open) setEditingExerciseId(null) }}
        />
      )}
    </div>
  )
}
