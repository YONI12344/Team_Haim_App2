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

const SETTINGS_DOC_PATH = 'settings/googleSheets'
const SERVICE_ACCOUNT_EMAIL = 'team-haim-sheets@teamhaim.iam.gserviceaccount.com'

interface GoogleSheetsSettings {
  sheetId: string
  lastSyncAt: Date | null
  lastSyncAthleteId?: string
}

function formatDate(d: Date | null): string {
  if (!d) return 'Never'
  return d.toLocaleString()
}

export function CoachSettings() {
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
        <h1 className="text-3xl font-serif font-semibold text-navy">Settings</h1>
        <p className="text-muted-foreground mt-1">
          Configure Google Sheets auto sync for the team.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Google Sheets Auto Sync</CardTitle>
          <CardDescription>
            Connect a master Google Sheet to automatically sync workouts, logs,
            profiles, and goals. Each athlete gets their own tab.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="rounded-lg border border-border bg-muted/40 p-4 space-y-3">
            <p className="text-sm font-medium text-foreground">Before you start</p>
            <ol className="text-sm text-muted-foreground list-decimal pl-5 space-y-1">
              <li>Create a Google Sheet (or open an existing one).</li>
              <li>
                Click <strong>Share</strong> and add the service account below as
                an <strong>Editor</strong>.
              </li>
              <li>
                Copy the Sheet ID from the URL (the long ID between
                <code className="mx-1 px-1 rounded bg-background">/d/</code>
                and <code className="mx-1 px-1 rounded bg-background">/edit</code>)
                and paste it below.
              </li>
              <li>Click <strong>Save</strong>, then <strong>Sync All Now</strong>.</li>
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
                    <Check className="h-4 w-4 mr-1" /> Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 mr-1" /> Copy
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sheet-id">Master Google Sheet ID</Label>
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
                Open sheet <ExternalLink className="h-3 w-3" />
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
              Save
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
              Sync All Now
            </Button>
          </div>

          <div className="text-sm text-muted-foreground">
            Last sync: <span className="text-foreground">{formatDate(lastSync)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
