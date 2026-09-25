'use client'

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type Anthropic from '@anthropic-ai/sdk'
import { toast } from 'sonner'
import {
  AlertTriangle,
  ArrowUp,
  Check,
  GraduationCap,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  SlidersHorizontal,
  Square,
  Trash2,
  X,
} from 'lucide-react'
import { useAuth } from '@/contexts/auth-context'
import { useLanguage } from '@/contexts/language-context'
import { useWorkoutLibrary } from '@/hooks/useWorkoutLibrary'
import { AI_SCHEDULE_CHANGED_EVENT, aiCoachFetch } from '@/lib/ai-coach/client'
import { logAiUsage } from '@/lib/ai-coach/usage-log'
import { runAgentTool } from '@/lib/ai-coach/agent-executors'
import { SCHEDULE_WRITING_TOOLS, type AgentToolName } from '@/lib/ai-coach/agent-tools'
import { appendMessage, clearThread, loadThread, type StoredMessage } from '@/lib/ai-coach/thread-store'
import {
  addCoachFeedback,
  deleteCoachFeedback,
  loadCoachFeedback,
  loadCoachFeedbackForPrompt,
  type CoachFeedbackEntry,
} from '@/lib/ai-coach/feedback-store'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { AiPlanSettings } from '@/components/coach/ai-plan-settings'

const MAX_STEPS = 16

const UI = {
  en: {
    title: 'AI coach',
    about: (name: string) => `Conversation about ${name}`,
    emptyTitle: (name: string) => `Plan ${name}'s training with the AI coach`,
    emptyBody: 'It reads everything this athlete logs, builds full seasons from the Norwegian Method brain, and edits their schedule when you ask. Only you can see this conversation.',
    suggestions: [
      'Review the last 2 weeks against the plan',
      'Build the season through the goal race',
      'What should next week look like?',
    ],
    placeholder: 'Ask about this athlete, or tell the AI what to change…',
    send: 'Send',
    stop: 'Stop',
    thinking: 'Thinking…',
    planSettings: 'Plan settings',
    newConversation: 'New conversation',
    confirmClear: 'Delete this conversation? The athlete\'s schedule is not affected.',
    cleared: 'Conversation cleared',
    stopped: 'Stopped.',
    tooManySteps: 'Stopped after too many steps — ask again to continue.',
    loadFailed: 'Could not load the conversation.',
    retry: 'Retry',
    settingsTitle: 'Plan settings',
    close: 'Close',
    teach: 'Teach the AI',
    teachTitle: 'Teach the AI',
    teachBody: "Tell it what was good or bad about a workout or a plan it made, in plain words. It doesn't retrain itself from usage — this is what actually changes its output over time: every lesson here is sent on every future generation, for every athlete.",
    teachPlaceholder: 'e.g. "Yuli\'s easy weeks should be simpler, not just easy runs" or "always keep strides after easy days"',
    teachAdd: 'Add lesson',
    teachEmpty: 'No lessons taught yet.',
    teachDeleteConfirm: 'Remove this lesson?',
  },
  he: {
    title: 'מאמן AI',
    about: (name: string) => `שיחה על ${name}`,
    emptyTitle: (name: string) => `לתכנן את האימונים של ${name} עם מאמן ה-AI`,
    emptyBody: 'הוא קורא כל מה שהספורטאי מתעד, בונה עונות מלאות מהמוח של השיטה הנורבגית, ומשנה את לוח האימונים כשתבקש. רק אתה רואה את השיחה הזו.',
    suggestions: [
      'תסקור את השבועיים האחרונים מול התוכנית',
      'תבנה את העונה עד מירוץ היעד',
      'איך צריך להיראות השבוע הבא?',
    ],
    placeholder: 'שאל על הספורטאי, או תגיד ל-AI מה לשנות…',
    send: 'שלח',
    stop: 'עצור',
    thinking: 'חושב…',
    planSettings: 'הגדרות תוכנית',
    newConversation: 'שיחה חדשה',
    confirmClear: 'למחוק את השיחה הזו? לוח האימונים של הספורטאי לא ישתנה.',
    cleared: 'השיחה נמחקה',
    stopped: 'נעצר.',
    tooManySteps: 'נעצר אחרי יותר מדי צעדים — בקש שוב כדי להמשיך.',
    loadFailed: 'לא הצלחתי לטעון את השיחה.',
    retry: 'נסה שוב',
    settingsTitle: 'הגדרות תוכנית',
    close: 'סגור',
    teach: 'למד את ה-AI',
    teachTitle: 'למד את ה-AI',
    teachBody: 'תגיד לו מה היה טוב או לא טוב באימון או בתוכנית שהוא יצר, במילים פשוטות. הוא לא לומד לבד מהשימוש - זה מה שבאמת משנה את הפלט שלו לאורך זמן: כל שיעור כאן נשלח בכל יצירה עתידית, לכל ספורטאי.',
    teachPlaceholder: 'לדוגמה: "השבועות הקלים של יולי צריכים להיות פשוטים יותר" או "תמיד תשמור סטרייד אחרי ריצות קלות"',
    teachAdd: 'הוסף שיעור',
    teachEmpty: 'עדיין לא לימדת שום דבר.',
    teachDeleteConfirm: 'להסיר את השיעור הזה?',
  },
} as const

const TOOL_LABELS: Record<'en' | 'he', Record<AgentToolName, (input: any) => string>> = {
  en: {
    get_athlete_profile: () => 'Read the profile',
    get_workouts: (i) => `Read training ${i?.from ?? ''} → ${i?.to ?? ''}`,
    get_lab_tests: () => 'Read lab tests',
    get_season_plan: () => 'Read the season plan',
    generate_season_plan: (i) => (i?.restart ? 'Rebuilding the season' : 'Generating the season'),
    create_workouts: (i) => `Adding ${i?.workouts?.length ?? ''} workout${i?.workouts?.length === 1 ? '' : 's'}`,
    update_workout: (i) => (i?.date ? `Moving a workout to ${i.date}` : 'Updating a workout'),
    delete_workouts: (i) => `Removing ${i?.assignedWorkoutIds?.length ?? ''} workout${i?.assignedWorkoutIds?.length === 1 ? '' : 's'}`,
    update_plan_settings: () => 'Updating plan settings',
  },
  he: {
    get_athlete_profile: () => 'קרא את הפרופיל',
    get_workouts: (i) => `קרא אימונים ${i?.from ?? ''} ← ${i?.to ?? ''}`,
    get_lab_tests: () => 'קרא בדיקות מעבדה',
    get_season_plan: () => 'קרא את תוכנית העונה',
    generate_season_plan: (i) => (i?.restart ? 'בונה את העונה מחדש' : 'יוצר את העונה'),
    create_workouts: (i) => `מוסיף ${i?.workouts?.length ?? ''} אימונים`,
    update_workout: (i) => (i?.date ? `מזיז אימון ל-${i.date}` : 'מעדכן אימון'),
    delete_workouts: (i) => `מסיר ${i?.assignedWorkoutIds?.length ?? ''} אימונים`,
    update_plan_settings: () => 'מעדכן הגדרות תוכנית',
  },
}

type DisplayItem =
  | { kind: 'coach'; key: string; text: string }
  | { kind: 'ai'; key: string; text: string }
  | { kind: 'tool'; key: string; label: string; state: 'running' | 'done' | 'error'; detail?: string }

const blocksOf = (m: Anthropic.MessageParam) =>
  (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content) as any[]

/** The first user message carries a context block naming the athlete; it isn't shown. */
const CONTEXT_MARK = '[conversation-context]'

function toDisplay(messages: StoredMessage[], lang: 'en' | 'he'): DisplayItem[] {
  const results = new Map<string, { isError: boolean; content: string }>()
  for (const { message } of messages) {
    if (message.role !== 'user') continue
    for (const b of blocksOf(message)) {
      if (b.type === 'tool_result') {
        results.set(b.tool_use_id, { isError: !!b.is_error, content: typeof b.content === 'string' ? b.content : '' })
      }
    }
  }
  const items: DisplayItem[] = []
  for (const { id, message } of messages) {
    const blocks = blocksOf(message)
    blocks.forEach((b, i) => {
      const key = `${id}-${i}`
      if (message.role === 'user' && b.type === 'text' && !b.text.startsWith(CONTEXT_MARK)) {
        items.push({ kind: 'coach', key, text: b.text })
      } else if (message.role === 'assistant' && b.type === 'text' && b.text.trim()) {
        items.push({ kind: 'ai', key, text: b.text })
      } else if (message.role === 'assistant' && b.type === 'tool_use') {
        const label = TOOL_LABELS[lang][b.name as AgentToolName]?.(b.input) ?? b.name
        const res = results.get(b.id)
        items.push({
          kind: 'tool',
          key,
          label,
          state: res ? (res.isError ? 'error' : 'done') : 'running',
          detail: res?.isError ? res.content : undefined,
        })
      }
    })
  }
  return items
}

/** Any tool_use without a matching tool_result (an interrupted run) would make
 *  the API reject the whole thread — answer those as interrupted. */
function danglingToolUses(messages: StoredMessage[]): Anthropic.ToolResultBlockParam[] {
  const last = messages[messages.length - 1]?.message
  if (!last || last.role !== 'assistant') return []
  return blocksOf(last)
    .filter((b) => b.type === 'tool_use')
    .map((b) => ({ type: 'tool_result' as const, tool_use_id: b.id, content: 'Interrupted before this ran.', is_error: true }))
}

/** Minimal formatting for the assistant's replies: paragraphs, "- " lists, **bold**. */
function RichText({ text }: { text: string }) {
  const inline = (s: string, keyBase: string): ReactNode[] =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={`${keyBase}-${i}`} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>
        : <span key={`${keyBase}-${i}`}>{part}</span>,
    )
  const paragraphs = text.trim().split(/\n{2,}/)
  return (
    <div className="space-y-2.5">
      {paragraphs.map((p, pi) => {
        const lines = p.split('\n')
        if (lines.every((l) => /^\s*([-•*]|\d+\.)\s+/.test(l))) {
          return (
            <ul key={pi} className="space-y-1 ps-4 list-disc marker:text-gold">
              {lines.map((l, li) => <li key={li}>{inline(l.replace(/^\s*([-•*]|\d+\.)\s+/, ''), `${pi}-${li}`)}</li>)}
            </ul>
          )
        }
        return (
          <p key={pi}>
            {lines.map((l, li) => (
              <span key={li}>{li > 0 && <br />}{inline(l.replace(/^#+\s*/, ''), `${pi}-${li}`)}</span>
            ))}
          </p>
        )
      })}
    </div>
  )
}

export function AiCoachAgent({ athleteId, athleteName, className, onClose }: {
  athleteId: string
  athleteName: string
  className?: string
  /** Shown as a close button in the header when the panel lives in a sheet. */
  onClose?: () => void
}) {
  const { user } = useAuth()
  const { language } = useLanguage()
  const lang: 'en' | 'he' = language === 'en' ? 'en' : 'he'
  const t = UI[lang]
  const { workouts: libraryWorkouts } = useWorkoutLibrary()

  const [messages, setMessages] = useState<StoredMessage[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState(false)
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [teachOpen, setTeachOpen] = useState(false)
  const [teachEntries, setTeachEntries] = useState<CoachFeedbackEntry[]>([])
  const [teachLoading, setTeachLoading] = useState(false)
  const [teachInput, setTeachInput] = useState('')
  const [teachSaving, setTeachSaving] = useState(false)
  const stopRef = useRef(false)
  const messagesRef = useRef<StoredMessage[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  const setAll = (next: StoredMessage[]) => {
    messagesRef.current = next
    setMessages(next)
  }

  const load = useCallback(async () => {
    setLoaded(false)
    setLoadError(false)
    try {
      setAll(await loadThread(athleteId))
    } catch (e) {
      console.error('AI coach: load thread failed', e)
      setLoadError(true)
    } finally {
      setLoaded(true)
    }
  }, [athleteId])

  useEffect(() => { load() }, [load])

  const items = useMemo(() => toDisplay(messages, lang), [messages, lang])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [items.length, progress, running])

  const push = async (message: Anthropic.MessageParam) => {
    const seq = messagesRef.current.length
    const id = await appendMessage(athleteId, seq, message)
    setAll([...messagesRef.current, { id, seq, message }])
  }

  const send = async (raw: string) => {
    const text = raw.trim()
    if (!text || running || !user) return
    setInput('')
    setError(null)
    setRunning(true)
    stopRef.current = false
    try {
      const repair = danglingToolUses(messagesRef.current)
      const content: Anthropic.ContentBlockParam[] = [...repair]
      if (messagesRef.current.length === 0) {
        content.push({
          type: 'text',
          text: `${CONTEXT_MARK} This conversation is about the athlete ${athleteName} (athleteId ${athleteId}). All tools act on this athlete.`,
        })
      }
      content.push({ type: 'text', text })
      await push({ role: 'user', content })

      for (let step = 0; step < MAX_STEPS; step++) {
        if (stopRef.current) { setError(t.stopped); return }
        const coachFeedback = await loadCoachFeedbackForPrompt()
        const res = await aiCoachFetch('/api/ai-coach/agent', { messages: messagesRef.current.map((m) => m.message), coachFeedback })
        if (res.error) { setError(res.error); return }
        if (res.usage) logAiUsage({ route: 'agent', model: res.model, athleteId, coachId: user.id, usage: res.usage })

        const assistant: Anthropic.MessageParam = { role: 'assistant', content: res.content }
        await push(assistant)
        if (res.stop_reason !== 'tool_use') return

        const results: Anthropic.ToolResultBlockParam[] = []
        let changedSchedule = false
        for (const block of res.content as any[]) {
          if (block.type !== 'tool_use') continue
          if (stopRef.current) {
            results.push({ type: 'tool_result', tool_use_id: block.id, content: 'Stopped by the coach.', is_error: true })
            continue
          }
          const out = await runAgentTool(block.name, block.input, {
            athleteId,
            coachId: user.id,
            libraryWorkouts,
            uiLang: lang,
            onProgress: setProgress,
          })
          setProgress(null)
          if (!out.isError && SCHEDULE_WRITING_TOOLS.includes(block.name)) changedSchedule = true
          results.push({ type: 'tool_result', tool_use_id: block.id, content: out.content, ...(out.isError ? { is_error: true } : {}) })
        }
        await push({ role: 'user', content: results })
        if (changedSchedule) {
          window.dispatchEvent(new CustomEvent(AI_SCHEDULE_CHANGED_EVENT, { detail: { athleteId } }))
        }
      }
      setError(t.tooManySteps)
    } catch (e) {
      console.error('AI coach send failed:', e)
      setError(String(e))
    } finally {
      setRunning(false)
      setProgress(null)
      inputRef.current?.focus()
    }
  }

  const openTeach = async () => {
    setTeachOpen(true)
    setTeachLoading(true)
    try {
      setTeachEntries(await loadCoachFeedback())
    } catch {
      toast.error(t.loadFailed)
    } finally {
      setTeachLoading(false)
    }
  }

  const addLesson = async () => {
    const text = teachInput.trim()
    if (!text || teachSaving) return
    setTeachSaving(true)
    try {
      await addCoachFeedback(text)
      setTeachInput('')
      setTeachEntries(await loadCoachFeedback())
    } catch {
      toast.error(t.loadFailed)
    } finally {
      setTeachSaving(false)
    }
  }

  const removeLesson = async (id: string) => {
    if (!confirm(t.teachDeleteConfirm)) return
    try {
      await deleteCoachFeedback(id)
      setTeachEntries((prev) => prev.filter((e) => e.id !== id))
    } catch {
      toast.error(t.loadFailed)
    }
  }

  const clear = async () => {
    if (!confirm(t.confirmClear)) return
    try {
      await clearThread(athleteId)
      setAll([])
      setError(null)
      toast.success(t.cleared)
    } catch {
      toast.error(t.loadFailed)
    }
  }

  const lastIsTool = items[items.length - 1]?.kind === 'tool'

  return (
    <section className={cn('flex flex-col min-h-0 bg-card text-card-foreground', className)} aria-label={t.title}>
      <header className="flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-navy dark:text-foreground">{t.title}</h2>
          <p className="truncate text-xs text-muted-foreground">{t.about(athleteName)}</p>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" className="h-8 gap-1.5 text-xs" onClick={() => setSettingsOpen(true)}>
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {t.planSettings}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="More">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={openTeach}>
                <GraduationCap className="h-3.5 w-3.5 me-2" />
                {t.teach}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={clear} disabled={running || messages.length === 0}>
                <RotateCcw className="h-3.5 w-3.5 me-2" />
                {t.newConversation}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label={t.close}>
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4">
        {!loaded ? (
          <div className="space-y-3" aria-hidden>
            <div className="h-3 w-3/4 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
            <div className="ms-auto h-9 w-2/3 rounded-2xl bg-muted animate-pulse" />
          </div>
        ) : loadError ? (
          <div className="flex flex-col items-start gap-2 text-sm">
            <p className="text-destructive">{t.loadFailed}</p>
            <Button size="sm" variant="outline" onClick={load}>{t.retry}</Button>
          </div>
        ) : items.length === 0 ? (
          <div className="flex h-full flex-col justify-end gap-4 pb-2">
            <div className="space-y-1.5">
              <p className="text-base font-semibold text-navy dark:text-foreground text-balance">{t.emptyTitle(athleteName)}</p>
              <p className="text-sm leading-relaxed text-muted-foreground">{t.emptyBody}</p>
            </div>
            <div className="flex flex-col items-start gap-2">
              {t.suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={running}
                  className="rounded-full border border-navy/15 bg-navy-tint px-3 py-1.5 text-start text-xs font-medium text-navy transition-colors hover:border-gold hover:bg-gold-light focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-50 dark:bg-muted dark:text-foreground"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className="space-y-3">
            {items.map((item) =>
              item.kind === 'coach' ? (
                <li key={item.key} className="flex justify-end">
                  <div dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-ee-md bg-navy px-3.5 py-2 text-sm leading-relaxed text-white">
                    {item.text}
                  </div>
                </li>
              ) : item.kind === 'ai' ? (
                <li key={item.key} dir="auto" className="text-sm leading-relaxed text-foreground/90">
                  <RichText text={item.text} />
                </li>
              ) : (
                <li key={item.key} className="flex items-start gap-2 text-xs text-muted-foreground">
                  {item.state === 'running' && running
                    ? <Loader2 className="mt-px h-3.5 w-3.5 shrink-0 animate-spin text-gold" />
                    : item.state === 'error' || item.state === 'running'
                      ? <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-600" />
                      : <Check className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-600" />}
                  <span dir="auto" className="min-w-0">
                    {item.label}
                    {item.detail && <span className="block text-amber-700 dark:text-amber-400">{item.detail}</span>}
                  </span>
                </li>
              ),
            )}
            {running && (
              <li className="flex items-center gap-2 text-xs text-muted-foreground" aria-live="polite">
                {!lastIsTool && <Loader2 className="h-3.5 w-3.5 animate-spin text-gold" />}
                <span dir="auto">{progress ?? (lastIsTool ? '' : t.thinking)}</span>
              </li>
            )}
          </ol>
        )}
        {error && (
          <p role="alert" dir="auto" className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>

      <form
        className="border-t p-3"
        onSubmit={(e) => { e.preventDefault(); send(input) }}
      >
        <div className="flex items-end gap-2 rounded-xl border bg-background px-2 py-1.5 focus-within:ring-2 focus-within:ring-gold/60">
          <Textarea
            ref={inputRef}
            value={input}
            dir="auto"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                send(input)
              }
            }}
            placeholder={t.placeholder}
            rows={1}
            disabled={!loaded || loadError}
            className="min-h-9 max-h-40 flex-1 resize-none border-0 bg-transparent px-1.5 py-2 text-sm shadow-none focus-visible:ring-0"
          />
          {running ? (
            <Button type="button" size="icon" variant="outline" className="h-8 w-8 shrink-0" onClick={() => { stopRef.current = true }} aria-label={t.stop}>
              <Square className="h-3 w-3 fill-current" />
            </Button>
          ) : (
            <Button type="submit" size="icon" className="h-8 w-8 shrink-0 bg-navy text-white hover:bg-navy-light" disabled={!input.trim() || !loaded} aria-label={t.send}>
              <ArrowUp className="h-4 w-4" />
            </Button>
          )}
        </div>
      </form>

      <Sheet open={settingsOpen} onOpenChange={setSettingsOpen}>
        <SheetContent side={lang === 'he' ? 'left' : 'right'} className="w-full sm:max-w-xl overflow-y-auto p-0">
          {/* pr-12 keeps the title clear of the sheet's own corner X (always physically top-right). */}
          <SheetHeader className="pl-4 pr-12 pt-4">
            <SheetTitle>{t.settingsTitle}</SheetTitle>
          </SheetHeader>
          <div className="p-4 pt-2">
            <AiPlanSettings athleteId={athleteId} />
          </div>
        </SheetContent>
      </Sheet>

      <Sheet open={teachOpen} onOpenChange={setTeachOpen}>
        <SheetContent side={lang === 'he' ? 'left' : 'right'} className="w-full sm:max-w-xl overflow-y-auto p-0">
          <SheetHeader className="pl-4 pr-12 pt-4">
            <SheetTitle>{t.teachTitle}</SheetTitle>
          </SheetHeader>
          <div className="space-y-4 p-4 pt-2">
            <p dir="auto" className="text-sm leading-relaxed text-muted-foreground">{t.teachBody}</p>
            <div className="flex flex-col gap-2">
              <Textarea
                dir="auto"
                value={teachInput}
                onChange={(e) => setTeachInput(e.target.value)}
                placeholder={t.teachPlaceholder}
                rows={3}
                className="resize-none text-sm"
              />
              <Button size="sm" className="self-end" onClick={addLesson} disabled={!teachInput.trim() || teachSaving}>
                {teachSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t.teachAdd}
              </Button>
            </div>
            {teachLoading ? (
              <div className="space-y-2" aria-hidden>
                <div className="h-8 rounded bg-muted animate-pulse" />
                <div className="h-8 rounded bg-muted animate-pulse" />
              </div>
            ) : teachEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.teachEmpty}</p>
            ) : (
              <ul className="space-y-2">
                {teachEntries.map((entry) => (
                  <li key={entry.id} dir="auto" className="flex items-start justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">{entry.text}</span>
                    <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => removeLesson(entry.id)} aria-label={t.teachDeleteConfirm}>
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </section>
  )
}
