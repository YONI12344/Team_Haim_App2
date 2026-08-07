'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Loader2, Save, Sparkles } from 'lucide-react'
import { toast } from 'sonner'

interface SafetyRules {
  easyDayMinutesCap: { beginner: number; intermediate: number; advancedPlus: number }
  cutbackWeek: { intervalWeeksBeginner: number; intervalWeeksDefault: number; volumeMultiplier: number }
}

const PROFILE_OPTIONS = [
  { key: 'beginner', label: 'Beginner (0km, 5k goal)' },
  { key: 'recreational', label: 'Recreational (25km/wk, 10k)' },
  { key: 'intermediate', label: 'Intermediate (45km/wk, half)' },
  { key: 'advanced', label: 'Advanced (70km/wk, marathon)' },
  { key: 'elite', label: 'Elite (100km/wk, double-threshold)' },
]

export default function BrainEditorPage() {
  const [loading, setLoading] = useState(true)
  const [safetyRules, setSafetyRules] = useState<SafetyRules | null>(null)
  const [brainText, setBrainText] = useState('')
  const [coachVoiceText, setCoachVoiceText] = useState('')
  const [savingSafety, setSavingSafety] = useState(false)
  const [savingBrain, setSavingBrain] = useState(false)
  const [savingVoice, setSavingVoice] = useState(false)

  const [profileKey, setProfileKey] = useState('recreational')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/dev/brain-editor/files')
      .then((r) => r.json())
      .then((data) => {
        if (data.error) { toast.error(data.error); return }
        setSafetyRules(data.safetyRules)
        setBrainText(JSON.stringify(data.brain, null, 2))
        setCoachVoiceText(JSON.stringify(data.coachVoice, null, 2))
      })
      .catch((e) => toast.error(String(e)))
      .finally(() => setLoading(false))
  }, [])

  const saveFile = async (file: string, content: unknown, setSaving: (b: boolean) => void) => {
    setSaving(true)
    try {
      const res = await fetch('/api/dev/brain-editor/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file, content }),
      })
      const data = await res.json()
      if (data.error) { toast.error(data.error); return }
      toast.success('Saved. Next preview run will use the new content.')
    } catch (e) {
      toast.error(String(e))
    } finally {
      setSaving(false)
    }
  }

  const saveSafetyRules = () => safetyRules && saveFile('safetyRules', safetyRules, setSavingSafety)

  const saveBrain = () => {
    try {
      const parsed = JSON.parse(brainText)
      saveFile('brain', parsed, setSavingBrain)
    } catch {
      toast.error('Not valid JSON — fix the syntax before saving.')
    }
  }

  const saveCoachVoice = () => {
    try {
      const parsed = JSON.parse(coachVoiceText)
      saveFile('coachVoice', parsed, setSavingVoice)
    } catch {
      toast.error('Not valid JSON — fix the syntax before saving.')
    }
  }

  const runPreview = async () => {
    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)
    try {
      const res = await fetch('/api/dev/brain-editor/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profileKey }),
      })
      const data = await res.json()
      if (data.error) { setPreviewError(data.error); return }
      setPreview(data)
    } catch (e) {
      setPreviewError(String(e))
    } finally {
      setPreviewLoading(false)
    }
  }

  if (loading) {
    return <div className="p-8 flex items-center gap-2"><Loader2 className="h-5 w-5 animate-spin" /> Loading brain files...</div>
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6" dir="ltr">
      <div>
        <h1 className="text-2xl font-bold">Bakken Brain Editor</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Local only — this page reads and writes the real files on disk (brain.json, coach-voice.json,
          safety-rules.json). It does nothing on the deployed site. Saved changes take effect on the next
          preview run below, and are only live for real athletes once committed + pushed + deployed.
        </p>
      </div>

      <Tabs defaultValue="safety">
        <TabsList>
          <TabsTrigger value="safety">Safety Rules</TabsTrigger>
          <TabsTrigger value="brain">Brain (methodology)</TabsTrigger>
          <TabsTrigger value="voice">Coach Voice</TabsTrigger>
        </TabsList>

        <TabsContent value="safety" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Easy-day minute caps (by experience level)</CardTitle>
              <CardDescription>Max minutes for a plain easy/recovery day with no fixed rep structure.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              {safetyRules && (['beginner', 'intermediate', 'advancedPlus'] as const).map((lvl) => (
                <div key={lvl}>
                  <Label className="capitalize">{lvl === 'advancedPlus' ? 'Advanced+' : lvl}</Label>
                  <Input
                    type="number"
                    value={safetyRules.easyDayMinutesCap[lvl]}
                    onChange={(e) => setSafetyRules({
                      ...safetyRules,
                      easyDayMinutesCap: { ...safetyRules.easyDayMinutesCap, [lvl]: Number(e.target.value) },
                    })}
                  />
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cutback (deload) weeks</CardTitle>
              <CardDescription>Every Nth week within a base/build/peak stage gets its flexible volume cut.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4">
              {safetyRules && (
                <>
                  <div>
                    <Label>Interval — beginner (weeks)</Label>
                    <Input type="number" value={safetyRules.cutbackWeek.intervalWeeksBeginner}
                      onChange={(e) => setSafetyRules({ ...safetyRules, cutbackWeek: { ...safetyRules.cutbackWeek, intervalWeeksBeginner: Number(e.target.value) } })} />
                  </div>
                  <div>
                    <Label>Interval — everyone else (weeks)</Label>
                    <Input type="number" value={safetyRules.cutbackWeek.intervalWeeksDefault}
                      onChange={(e) => setSafetyRules({ ...safetyRules, cutbackWeek: { ...safetyRules.cutbackWeek, intervalWeeksDefault: Number(e.target.value) } })} />
                  </div>
                  <div>
                    <Label>Volume multiplier (0-1)</Label>
                    <Input type="number" step="0.05" value={safetyRules.cutbackWeek.volumeMultiplier}
                      onChange={(e) => setSafetyRules({ ...safetyRules, cutbackWeek: { ...safetyRules.cutbackWeek, volumeMultiplier: Number(e.target.value) } })} />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Button onClick={saveSafetyRules} disabled={savingSafety}>
            {savingSafety ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Safety Rules
          </Button>
        </TabsContent>

        <TabsContent value="brain" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Raw JSON — the methodology/workout-library content the AI is grounded in. Must stay valid JSON to save.
          </p>
          <Textarea value={brainText} onChange={(e) => setBrainText(e.target.value)} className="font-mono text-xs" rows={30} dir="ltr" />
          <Button onClick={saveBrain} disabled={savingBrain}>
            {savingBrain ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Brain
          </Button>
        </TabsContent>

        <TabsContent value="voice" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Raw JSON — the coach's real voice/style/phrasing examples. Must stay valid JSON to save.
          </p>
          <Textarea value={coachVoiceText} onChange={(e) => setCoachVoiceText(e.target.value)} className="font-mono text-xs" rows={30} dir="ltr" />
          <Button onClick={saveCoachVoice} disabled={savingVoice}>
            {savingVoice ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Save Coach Voice
          </Button>
        </TabsContent>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>Preview an example week</CardTitle>
          <CardDescription>
            Calls the real Anthropic API with whatever the brain files currently say (including any unsaved
            edits above only after you save them) and runs the same deterministic checks production uses.
            Costs real API credits per click.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <select
              value={profileKey}
              onChange={(e) => setProfileKey(e.target.value)}
              className="border rounded-md px-3 py-2 text-sm"
            >
              {PROFILE_OPTIONS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <Button onClick={runPreview} disabled={previewLoading}>
              {previewLoading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
              Generate 2-Week Preview
            </Button>
          </div>

          {previewError && <p className="text-sm text-red-600">{previewError}</p>}

          {preview && (
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Skeleton: {preview.skeleton?.stages?.map((s: any) => `${s.name}(${s.type},${s.weeks}wk,${s.weeklyVolumeKm}km)`).join(' -> ')}
              </div>
              <div className={preview.issues.length === 0 ? 'text-sm text-emerald-600 font-medium' : 'text-sm text-red-600 font-medium'}>
                {preview.issues.length === 0 ? 'No issues found' : `${preview.issues.length} issue(s) found:`}
              </div>
              {preview.issues.length > 0 && (
                <ul className="text-xs text-red-600 list-disc pl-5">
                  {preview.issues.map((iss: string, i: number) => <li key={i}>{iss}</li>)}
                </ul>
              )}
              <div className="border rounded-lg divide-y">
                {preview.workouts.map((w: any, i: number) => (
                  <div key={i} className="p-2 text-sm flex items-center gap-3">
                    <span className="w-24 text-muted-foreground">{w.date}</span>
                    <span className="w-20 font-mono text-xs">{w.type}{w.session && w.session !== 'other' ? `(${w.session})` : ''}</span>
                    <span className="flex-1">{w.title}</span>
                    <span className="text-muted-foreground text-xs">{w.duration ? `${w.duration}min` : ''} {w.distance ? `${w.distance}km` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
