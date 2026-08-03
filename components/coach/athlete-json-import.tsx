'use client'

import { useState } from 'react'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from 'sonner'
import { Loader2, UploadCloud, ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// Only real AthleteProfile fields — never id/role/createdAt (structural,
// must never come from a pasted blob) or anything not in the type. A
// pasted JSON with extra/unknown keys just has those keys silently
// dropped rather than written to Firestore unchecked.
const ALLOWED_KEYS = [
  'name', 'dateOfBirth', 'gender', 'height', 'weight', 'discipline', 'events',
  'experienceLevel', 'weeklyMileage', 'restingHR', 'maxHR', 'currentHR', 'targetHR', 'targetPaceKm',
  'goalRaceDate', 'goalRaceEvent', 'goalRaceDistance', 'goalRaceTarget',
  'personalRecords', 'seasonBests', 'trainingPaces', 'goals',
  'coachPrivateNotes', 'weekSchedule', 'weekStartDay', 'kmWeekStartDay', 'visibleWeeksAhead',
  'weeklyKmRange', 'offWeekInterval', 'injuryHistory', 'currentShape', 'longRunMinutes',
  'preferredLanguage', 'daysPerWeek', 'labVisibleToAthlete',
]

function sanitize(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
  const out: Record<string, unknown> = {}
  for (const key of ALLOWED_KEYS) {
    if (key in (parsed as Record<string, unknown>)) out[key] = (parsed as Record<string, unknown>)[key]
  }
  return out
}

/**
 * Bulk-import an existing athlete's profile from a pasted JSON blob —
 * for migrating data from a spreadsheet/another platform instead of
 * clicking through every field by hand. Only ever touches this one
 * athlete's users/{athleteId} doc, merge-only (never overwrites fields
 * absent from the pasted JSON), and only ever the whitelisted profile
 * fields above.
 */
export function AthleteJsonImport({ athleteId }: { athleteId: string }) {
  const [open, setOpen] = useState(false)
  const [raw, setRaw] = useState('')
  const [preview, setPreview] = useState<Record<string, unknown> | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const handlePreview = () => {
    setParseError(null)
    setPreview(null)
    try {
      const parsed = JSON.parse(raw)
      const cleaned = sanitize(parsed)
      if (Object.keys(cleaned).length === 0) {
        setParseError('No recognized profile fields found in this JSON.')
        return
      }
      setPreview(cleaned)
    } catch {
      setParseError('Invalid JSON — check the syntax and try again.')
    }
  }

  const handleApply = async () => {
    if (!preview) return
    setSaving(true)
    try {
      await setDoc(doc(db, 'users', athleteId), { ...preview, updatedAt: serverTimestamp() }, { merge: true })
      toast.success(`Imported ${Object.keys(preview).length} fields`)
      setRaw('')
      setPreview(null)
      setOpen(false)
    } catch (e) {
      console.error(e)
      toast.error('Import failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader className="cursor-pointer" onClick={() => setOpen((o) => !o)}>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <UploadCloud className="h-4 w-4" /> Import profile from JSON
            </CardTitle>
            <CardDescription>Paste a JSON object to bulk-fill this athlete's profile — e.g. migrating from a spreadsheet.</CardDescription>
          </div>
          {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3">
          <textarea
            value={raw}
            onChange={(e) => { setRaw(e.target.value); setPreview(null); setParseError(null) }}
            placeholder={'{\n  "experienceLevel": "intermediate",\n  "weeklyMileage": 40,\n  "goalRaceDistance": "marathon",\n  "goalRaceDate": "2027-03-01",\n  "injuryHistory": "...",\n  "personalRecords": [{ "id": "pr1", "event": "10K", "time": "42:30", "date": "2026-05-01" }]\n}'}
            className="w-full min-h-[160px] rounded-md border border-input bg-background px-3 py-2 text-xs font-mono"
            dir="ltr"
          />
          {parseError && <p className="text-sm text-red-600">{parseError}</p>}
          {!preview ? (
            <Button variant="outline" onClick={handlePreview} disabled={!raw.trim()}>Preview</Button>
          ) : (
            <div className="space-y-3">
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <p className="font-medium mb-1.5">Will set {Object.keys(preview).length} field(s) — everything else on this athlete stays untouched:</p>
                <pre className="whitespace-pre-wrap break-all">{JSON.stringify(preview, null, 2)}</pre>
              </div>
              <div className="flex gap-2">
                <Button onClick={handleApply} disabled={saving} className="bg-gold hover:bg-gold/90 text-navy">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Apply to profile
                </Button>
                <Button variant="outline" onClick={() => setPreview(null)}>Back</Button>
              </div>
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}
