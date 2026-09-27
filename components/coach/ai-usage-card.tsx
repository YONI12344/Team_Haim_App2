'use client'

import { useEffect, useMemo, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { loadAiUsage, loadAthleteAppUsage, type AiUsageEntry, type AthleteAppDay } from '@/lib/ai-coach/usage-log'
import { formatTokens, formatUsd } from '@/lib/ai-coach/pricing'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Loader2, DollarSign } from 'lucide-react'
import { useLanguage } from '@/contexts/language-context'

const COPY = {
  en: {
    title: 'AI usage & cost',
    desc: 'What the AI coach has actually cost, from real API token counts — not an estimate.',
    last30: 'Last 30 days',
    allTracked: 'All tracked time',
    calls: 'calls',
    tokens: 'tokens',
    perAthlete: 'By athlete',
    noUsage: 'No AI calls logged yet.',
    unknownAthlete: 'General',
    routeLabels: { agent: 'Chat', 'generate-skeleton': 'Season plan', 'generate-plan': 'Season plan', 'haim-brain': 'AI Coach page', 'coach-voice': 'In my words' } as Record<string, string>,
    byApp: 'By app',
    coachApp: 'Coach AI (this app)',
    athleteApp: 'Athlete app (ai.teamhaim.com)',
    athleteAppMissing: "The athlete app's spend shows here once the aiCoachUsage database rule is deployed.",
  },
  he: {
    title: 'שימוש ועלות AI',
    desc: 'כמה עלה בפועל מאמן ה-AI, לפי ספירת טוקנים אמיתית מה-API — לא הערכה.',
    last30: '30 הימים האחרונים',
    allTracked: 'כל התקופה שנרשמה',
    calls: 'קריאות',
    tokens: 'טוקנים',
    perAthlete: 'לפי ספורטאי',
    noUsage: 'עדיין לא נרשם שימוש ב-AI.',
    unknownAthlete: 'כללי',
    routeLabels: { agent: 'שיחה', 'generate-skeleton': 'תוכנית עונה', 'generate-plan': 'תוכנית עונה', 'haim-brain': 'עמוד מאמן AI', 'coach-voice': 'במילים שלי' } as Record<string, string>,
    byApp: 'לפי אפליקציה',
    coachApp: 'AI של המאמן (האפליקציה הזו)',
    athleteApp: 'אפליקציית הספורטאים (ai.teamhaim.com)',
    athleteAppMissing: 'העלות של אפליקציית הספורטאים תופיע כאן אחרי פריסת כלל הגישה aiCoachUsage.',
  },
} as const

interface Totals { costUsd: number; tokens: number; calls: number }
const sumApp = (days: AthleteAppDay[]): Totals => days.reduce(
  (acc, d) => ({ costUsd: acc.costUsd + d.costUsd, tokens: acc.tokens + d.tokens, calls: acc.calls + d.calls }),
  { costUsd: 0, tokens: 0, calls: 0 },
)
const plus = (a: Totals, b: Totals): Totals => ({ costUsd: a.costUsd + b.costUsd, tokens: a.tokens + b.tokens, calls: a.calls + b.calls })

const sum = (entries: AiUsageEntry[]): Totals => entries.reduce(
  (acc, e) => ({
    costUsd: acc.costUsd + e.costUsd,
    tokens: acc.tokens + e.inputTokens + e.outputTokens + e.cacheWriteTokens + e.cacheReadTokens,
    calls: acc.calls + 1,
  }),
  { costUsd: 0, tokens: 0, calls: 0 },
)

export function AiUsageCard() {
  const { language } = useLanguage()
  const c = COPY[language === 'en' ? 'en' : 'he']
  const [entries, setEntries] = useState<AiUsageEntry[] | null>(null)
  const [names, setNames] = useState<Record<string, string>>({})
  // The athlete app's daily totals; null = can't be read yet (its database rule isn't deployed).
  const [appDays, setAppDays] = useState<AthleteAppDay[] | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    // 3650 days ≈ "all tracked time" without an unbounded query.
    loadAiUsage(3650)
      .then((rows) => { if (!cancelled) setEntries(rows) })
      .catch((err) => { console.error('AI usage load failed:', err); if (!cancelled) setEntries([]) })
    loadAthleteAppUsage(3650).then((d) => { if (!cancelled) setAppDays(d) })
    getDocs(collection(db, 'users')).then((snap) => {
      if (cancelled) return
      const map: Record<string, string> = {}
      snap.forEach((d) => { map[d.id] = (d.data() as any).name || d.id })
      setNames(map)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const last30 = useMemo(() => {
    if (!entries) return []
    const cutoff = Date.now() - 30 * 86400000
    return entries.filter((e) => e.createdAt.getTime() >= cutoff)
  }, [entries])

  const perAthlete = useMemo(() => {
    if (!entries) return []
    const byAthlete = new Map<string, AiUsageEntry[]>()
    for (const e of entries) {
      const key = e.athleteId || '__general__'
      const list = byAthlete.get(key) ?? []
      list.push(e)
      byAthlete.set(key, list)
    }
    return [...byAthlete.entries()]
      .map(([athleteId, list]) => ({ athleteId, name: athleteId === '__general__' ? c.unknownAthlete : (names[athleteId] || athleteId), ...sum(list) }))
      .sort((a, b) => b.costUsd - a.costUsd)
  }, [entries, names, c.unknownAthlete])

  if (entries === null) {
    return (
      <Card className="rounded-2xl">
        <CardContent className="flex items-center justify-center p-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    )
  }

  const cutoff30 = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const appAll = sumApp(appDays || [])
  const app30 = sumApp((appDays || []).filter((d) => d.date >= cutoff30))
  const coachAll = sum(entries)
  const totalsAll = plus(coachAll, appAll)
  const totals30 = plus(sum(last30), app30)

  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <DollarSign className="h-4 w-4 text-gold" />
          {c.title}
        </CardTitle>
        <CardDescription>{c.desc}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {entries.length === 0 && !appAll.calls ? (
          <p className="text-sm text-muted-foreground">{c.noUsage}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: c.last30, t: totals30 },
                { label: c.allTracked, t: totalsAll },
              ].map((row) => (
                <div key={row.label} className="rounded-xl border border-border bg-background p-3">
                  <p className="text-xs text-muted-foreground">{row.label}</p>
                  <p className="mt-1 text-2xl font-bold tabular-nums text-navy">{formatUsd(row.t.costUsd)}</p>
                  <p className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                    {formatTokens(row.t.tokens)} {c.tokens} · {row.t.calls} {c.calls}
                  </p>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.byApp}</p>
              <div className="divide-y divide-border rounded-xl border border-border">
                {[{ label: c.coachApp, t: coachAll }, ...(appDays ? [{ label: c.athleteApp, t: appAll }] : [])].map((row) => (
                  <div key={row.label} className="flex items-center justify-between gap-3 px-3 py-2">
                    <span className="min-w-0 truncate text-sm font-medium text-navy">{row.label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatTokens(row.t.tokens)} · {row.t.calls}</span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-navy">{formatUsd(row.t.costUsd)}</span>
                  </div>
                ))}
              </div>
              {appDays === null ? <p className="mt-2 text-xs text-muted-foreground">{c.athleteAppMissing}</p> : null}
            </div>

            {perAthlete.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{c.perAthlete}</p>
                <div className="divide-y divide-border rounded-xl border border-border">
                  {perAthlete.map((row) => (
                    <div key={row.athleteId} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0 truncate text-sm font-medium text-navy">{row.name}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {formatTokens(row.tokens)} · {row.calls}
                      </span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums text-navy">{formatUsd(row.costUsd)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}
