'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, Check, Save, RefreshCw, Copy, Bot, ArrowUpRight } from 'lucide-react'
import { useLanguage } from '@/contexts/language-context'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { AiUsageCard } from '@/components/coach/ai-usage-card'

const SETTINGS_DOC_PATH = 'settings/googleSheets'
const SERVICE_ACCOUNT_EMAIL = 'team-haim-sheets@teamhaim.iam.gserviceaccount.com'

const COPY = {
  en: {
    title: 'Settings',
    aiTitle: 'AI coach',
    aiBody: "Each athlete now has their own AI coach conversation, right next to their schedule in the planner. It reads everything they log and builds or adjusts their plan when you ask.",
    aiLink: 'Open athletes',
  },
  he: {
    title: 'הגדרות',
    aiTitle: 'מאמן AI',
    aiBody: 'לכל ספורטאי יש עכשיו שיחה משלו עם מאמן ה-AI, ממש ליד לוח האימונים שלו בתכנון. הוא קורא כל מה שהספורטאי מתעד ובונה או משנה את התוכנית כשאתה מבקש.',
    aiLink: 'לספורטאים',
  },
} as const

export function CoachSettings() {
  const { t, language } = useLanguage()
  const c = COPY[language === 'en' ? 'en' : 'he']

  const [sheetId, setSheetId] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    getDoc(doc(db, SETTINGS_DOC_PATH))
      .then((snap) => {
        if (snap.exists() && typeof snap.data().sheetId === 'string') setSheetId(snap.data().sheetId)
      })
      .catch((err) => console.error(err))
  }, [])

  const handleSaveSheet = async () => {
    const trimmed = sheetId.trim()
    if (!trimmed) { toast.error('Enter a Google Sheet ID'); return }
    setSaving(true)
    try {
      await setDoc(doc(db, SETTINGS_DOC_PATH), { sheetId: trimmed, updatedAt: serverTimestamp() }, { merge: true })
      toast.success('Sheet ID saved')
    } catch { toast.error('Failed to save') } finally { setSaving(false) }
  }

  const handleSyncAll = async () => {
    setSyncing(true)
    try {
      const functions = getFunctions(undefined, 'europe-west1')
      const call = httpsCallable(functions, 'syncAllAthletesNow')
      const result = await call({}) as { data: { total: number; succeeded: number } }
      toast.success(`Synced ${result.data.succeeded}/${result.data.total} athletes`)
    } catch { toast.error('Sync failed') } finally { setSyncing(false) }
  }

  return (
    <div className="space-y-6 max-w-3xl">
      <h1 className="text-2xl md:text-3xl font-serif font-semibold text-navy">{c.title}</h1>

      <AiUsageCard />

      <Card className="rounded-2xl">
        <CardContent className="flex items-start gap-3 p-4">
          <Bot className="mt-0.5 h-5 w-5 shrink-0 text-gold" />
          <div className="min-w-0 space-y-1.5">
            <p className="text-sm font-semibold text-navy">{c.aiTitle}</p>
            <p className="text-sm text-muted-foreground leading-relaxed">{c.aiBody}</p>
            <Link href="/coach/athletes" className="inline-flex items-center gap-1 text-sm font-medium text-navy underline-offset-4 hover:underline">
              {c.aiLink}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-2xl">
        <CardHeader>
          <CardTitle className="text-base">{t.googleSheetsAutoSync}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-2">
            <code className="flex-1 px-3 py-2 rounded bg-background border border-border text-xs break-all">
              {SERVICE_ACCOUNT_EMAIL}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={async () => {
              await navigator.clipboard.writeText(SERVICE_ACCOUNT_EMAIL)
              setCopied(true); setTimeout(() => setCopied(false), 2000)
            }}>
              {copied ? <><Check className="h-4 w-4 mr-1" />Copied</> : <><Copy className="h-4 w-4 mr-1" />Copy</>}
            </Button>
          </div>
          <div className="space-y-2">
            <Label htmlFor="sheet-id">{t.masterSheetId}</Label>
            <Input id="sheet-id" placeholder="1AbCdEf...XyZ" value={sheetId} onChange={e => setSheetId(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <Button onClick={handleSaveSheet} disabled={saving} size="sm">
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}{t.save}
            </Button>
            <Button variant="outline" onClick={handleSyncAll} disabled={syncing || !sheetId.trim()} size="sm">
              {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}{t.syncAllNowBtn}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
