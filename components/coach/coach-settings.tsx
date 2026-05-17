'use client'

import { useEffect, useState } from 'react'
import { doc, getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { toast } from 'sonner'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Loader2, RefreshCw, Save, ExternalLink, Copy, Check } from 'lucide-react'
import { db } from '@/lib/firebase'
import { useLanguage } from '@/contexts/language-context'

const SETTINGS_DOC_PATH = 'settings/googleSheets'
const SERVICE_ACCOUNT_EMAIL = 'team-haim-sheets@teamhaim.iam.gserviceaccount.com'

interface GoogleSheetsSettings {
  sheetId: string
  lastSyncAt: Date | null
  lastSyncAthleteId?: string
}

function formatDate(d: Date | null, neverLabel: string): string {
  if (!d) return neverLabel
  return d.toLocaleString()
}

export function CoachSettings() {
  const { t } = useLanguage()
  const [sheetId, setSheetId] = useState('')
  const [lastSync, setLastSync] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDoc(doc(db, SETTINGS_DOC_PATH))
        if (snap.exists()) {
          const data = snap.data() as Partial<GoogleSheetsSettings> & {
            lastSyncAt?: Timestamp | Date | null
          }
          setSheetId(typeof data.sheetId === 'string' ? data.sheetId : '')
          const ts = data.lastSyncAt
          if (ts && typeof (ts as Timestamp).toDate === 'function') {
            setLastSync((ts as Timestamp).toDate())
          } else if (ts instanceof Date) {
            setLastSync(ts)
          } else {
            setLastSync(null)
          }
        }
      } catch (err) {
        console.error('Failed to load Google Sheets settings', err)
        toast.error('Failed to load settings')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const handleSave = async () => {
    const trimmed = sheetId.trim()
    if (!trimmed) {
      toast.error('Please enter a Google Sheet ID')
      return
    }
    setSaving(true)
    try {
      await setDoc(
        doc(db, SETTINGS_DOC_PATH),
        { sheetId: trimmed, updatedAt: serverTimestamp() },
        { merge: true }
      )
      toast.success('Google Sheet ID saved')
    } catch (err) {
      console.error('Failed to save settings', err)
      toast.error('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  const handleSyncAll = async () => {
    if (!sheetId.trim()) {
      toast.error('Save a Google Sheet ID before syncing')
      return
    }
    setSyncing(true)
    try {
      const functions = getFunctions(undefined, 'europe-west1')
      const call = httpsCallable<unknown, { total: number; succeeded: number; errors: unknown[] }>(
        functions,
        'syncAllAthletesNow'
      )
      const result = await call({})
      const { total, succeeded, errors } = result.data
      if (errors && errors.length > 0) {
        toast.warning(`Synced ${succeeded}/${total} athletes (${errors.length} failed)`)
      } else {
        toast.success(`Synced ${succeeded}/${total} athletes`)
      }
      // Refresh last sync time.
      const snap = await getDoc(doc(db, SETTINGS_DOC_PATH))
      const ts = snap.data()?.lastSyncAt as Timestamp | undefined
      if (ts && typeof ts.toDate === 'function') setLastSync(ts.toDate())
    } catch (err) {
      console.error('Manual sync failed', err)
      toast.error('Manual sync failed - is the Cloud Function deployed?')
    } finally {
      setSyncing(false)
    }
  }

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(SERVICE_ACCOUNT_EMAIL)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error('Could not copy to clipboard')
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 space-y-6 max-w-3xl">
      <div>
        <h1 className="text-3xl font-serif font-semibold text-navy">{t.settingsTitle}</h1>
        <p className="text-muted-foreground mt-1">
          {t.settingsSubtitle}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t.googleSheetsAutoSync}</CardTitle>
          <CardDescription>
            {t.googleSheetsDescription}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
            <p className="text-sm font-medium text-foreground">{t.beforeYouStart}</p>
            <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
              <li>{t.sheetsStepCreate}</li>
              <li>
                {t.sheetsStep1Pre}<strong>{t.sheetsStep1Share}</strong>{t.sheetsStep1Mid}<strong>{t.sheetsStep1Editor}</strong>.
              </li>
              <li>
                {t.sheetsStepCopyId1}
                <code className="mx-1 px-1 rounded bg-background">/d/</code>
                {t.sheetsStepCopyId2}<code className="mx-1 px-1 rounded bg-background">/edit</code>{t.sheetsStepCopyId3}
              </li>
              <li>{t.sheetsStepClick}<strong>{t.sheetsStep2Save}</strong>{t.sheetsStepThen}<strong>{t.sheetsStep2SyncAll}</strong>.</li>
            </ol>
            <div className="flex items-center gap-2 pt-1">
              <code className="flex-1 px-3 py-2 rounded bg-background border border-border text-xs sm:text-sm break-all">
                {SERVICE_ACCOUNT_EMAIL}
              </code>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleCopyEmail}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4 mr-1" /> {t.copiedBtn}
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-1" /> {t.copyBtn}
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sheet-id">{t.masterSheetId}</Label>
            <Input
              id="sheet-id"
              placeholder="1AbCdEf...XyZ"
              value={sheetId}
              onChange={(e) => setSheetId(e.target.value)}
              disabled={saving || syncing}
            />
            {sheetId.trim() && (
              <a
                href={`https://docs.google.com/spreadsheets/d/${encodeURIComponent(
                  sheetId.trim()
                )}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-gold hover:underline"
              >
                {t.openSheet} <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={handleSave} disabled={saving || syncing}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Save className="h-4 w-4 mr-2" />
              )}
              {t.save}
            </Button>
            <Button
              variant="outline"
              onClick={handleSyncAll}
              disabled={saving || syncing || !sheetId.trim()}
            >
              {syncing ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              {t.syncAllNowBtn}
            </Button>
          </div>

          <div className="text-sm text-muted-foreground">
            {t.lastSyncLabel}: <span className="text-foreground">{formatDate(lastSync, t.neverLabel)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
