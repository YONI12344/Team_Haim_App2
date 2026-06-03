'use client'

import { useEffect, useState, useCallback } from 'react'
import {
  collection, doc, getDocs, getDoc, query, where,
  setDoc, serverTimestamp, Timestamp,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  Loader2, Wand2, Calendar, Check, ChevronDown,
  Activity, Target, Trophy, Clock, Save, RefreshCw, Copy, ExternalLink,
} from 'lucide-react'
import { format, addDays, differenceInWeeks, nextMonday, isMonday } from 'date-fns'
import { useLanguage } from '@/contexts/language-context'
import type { AthleteProfile, WorkoutLog, PersonalRecord, WorkoutType } from '@/lib/types'
import { legacyEffortToNumber } from '@/lib/types'
import { workoutTypeColors, useWorkoutTypeLabels } from '@/lib/workout-labels'
import { cn } from '@/lib/utils'
import { getFunctions, httpsCallable } from 'firebase/functions'
import { useAuth } from '@/contexts/auth-context'

const SETTINGS_DOC_PATH = 'settings/googleSheets'
const SERVICE_ACCOUNT_EMAIL = 'team-haim-sheets@teamhaim.iam.gserviceaccount.com'

const TEAM_HAIM_SYSTEM_PROMPT = `You are Team Haim's AI coaching assistant. Generate personalized 2-week running training plans following the Team Haim methodology EXACTLY.

TEAM HAIM PERIODIZATION (always build backwards from goal race):
- Transition: 1-6 weeks (recovery after race)
- Preparation: 3-4 weeks (introduce training)
- Base 1,2,3: 8-12 weeks total (aerobic foundation, Z1-Z2 ONLY)
- Build 1,2: 6-8 weeks total (add quality: tempo + intervals)
- Peak: 1-2 weeks (sharpen, reduce volume)
- Race week: 1 week (minimal running)

PERIODIZATION RATIO: 3:1 (3 loading + 1 recovery) or 2:1 for beginners/low volume.

TRAINING ZONES (% of HR at lactate threshold):
- Z1 Recovery: 66-85% | Easy, fully conversational
- Z2 Extensive Endurance: 86-90% | LSD pace, comfortable
- Z3 Intensive Endurance: 91-95%
- Z4 Sub-Threshold: 96-99% | Tempo pace, controlled hard
- Z5a Super-Threshold: 100-101% | Threshold intervals
- Z5b Anaerobic: 102-105% | Intense intervals, hard
- Z5c Power: 106-110% | Repetitions, very hard

HR RANGES (bpm): Recovery 113-146 | LSD 113-154 | Tempo ~171 | Wide intervals 171-173 | Intense intervals 175-180 | Reps 182-189

RACE TARGET HR: 5K=180bpm | 10K=171bpm | Half=170bpm | Marathon=163-165bpm

TRAINING METHODS BY PHASE:
- ALL PHASES: Easy runs and LSD (Z1-Z2)
- BASE PHASE: Only easy/LSD, gentle fartlek introduction
- BUILD PHASE: Add tempo (Z4-Z5a), wide intervals 800m+ (Z5a, up to 10km total), fartlek with quality
- PEAK PHASE: Intense intervals (Z5b), race-pace work, reduce volume

VOLUME GUIDELINES:
- Marathon: max 70+km/week, LSD max 34-38km, tempo race-pace max 19km, taper 3 weeks
- Half Marathon: max 45+km/week, LSD beyond race distance, tempo race-pace max 13km, taper 2-3 weeks
- 10K: max 25+km/week, LSD beyond race distance, tempo max 7km, taper 10 days
- 5K: max 12+km/week, LSD beyond race distance, tempo max 3.5km, taper 10 days
- Beginner/Jogger: max 3 sessions/week, Z1-Z2 ONLY, walk-run fartlek, prefer TIME over distance, 2:1 periodization

WEEKLY STRUCTURE RULES:
1. NEVER 2 hard days back to back (hard = tempo, intervals, long run)
2. Long run (LSD) always on weekend (Saturday or Sunday)
3. 1-2 full rest days per week
4. Hard sessions need easy day before AND after
5. Never increase weekly volume more than 10% per week
6. Recovery weeks: reduce volume 30-40%
7. If athlete recent effort was high (7-10/10 average): REDUCE load
8. If athlete recent effort was low (1-4/10 average): can slightly increase
9. Adjust to athlete lifestyle - training must fit their life

RESPOND WITH VALID JSON ONLY. No explanation, no markdown. Exact structure:
{
  "planSummary": {
    "seasonPhase": string,
    "weeksToGoalRace": number or null,
    "week1TotalKm": number,
    "week2TotalKm": number,
    "keyFocus": string,
    "rationale": string
  },
  "workouts": [
    {
      "dayOffset": number (0-13),
      "type": "easy"|"long_run"|"tempo"|"intervals"|"hill_repeats"|"fartlek"|"recovery"|"rest"|"cross_training",
      "title": string,
      "description": string,
      "duration": number or null,
      "distance": number or null,
      "warmup": string or null,
      "mainSet": string or null,
      "cooldown": string or null,
      "notes": string or null
    }
  ]
}
IMPORTANT: Include ALL 14 days (dayOffset 0 through 13). Rest days get type "rest". Exactly 14 entries.`

interface GeneratedWorkout {
  dayOffset: number
  type: WorkoutType
  title: string
  description: string
  duration: number | null
  distance: number | null
  warmup: string | null
  mainSet: string | null
  cooldown: string | null
  notes: string | null
}

interface GeneratedPlan {
  planSummary: {
    seasonPhase: string
    weeksToGoalRace: number | null
    week1TotalKm: number
    week2TotalKm: number
    keyFocus: string
    rationale: string
  }
  workouts: GeneratedWorkout[]
}

interface AthleteOption {
  id: string
  name: string
  email: string
}

export function CoachSettings() {
  const { t } = useLanguage()
  const { user } = useAuth()
  const workoutTypeLabels = useWorkoutTypeLabels()

  const [athletes, setAthletes] = useState<AthleteOption[]>([])
  const [selectedAthleteId, setSelectedAthleteId] = useState<string>('')
  const [athleteProfile, setAthleteProfile] = useState<Partial<AthleteProfile> | null>(null)
  const [athleteLogs, setAthleteLogs] = useState<WorkoutLog[]>([])
  const [loadingAthletes, setLoadingAthletes] = useState(true)
  const [loadingAthlete, setLoadingAthlete] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [plan, setPlan] = useState<GeneratedPlan | null>(null)
  const [startDate, setStartDate] = useState<string>(() => {
    const today = new Date()
    const monday = isMonday(today) ? today : nextMonday(today)
    return format(monday, 'yyyy-MM-dd')
  })

  const [sheetId, setSheetId] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [copied, setCopied] = useState(false)
  const [showSheets, setShowSheets] = useState(false)

  useEffect(() => {
    const loadAthletes = async () => {
      setLoadingAthletes(true)
      try {
        const snap = await getDocs(collection(db, 'users'))
        const list: AthleteOption[] = []
        snap.forEach((d) => {
          const data = d.data()
          if (data.email !== 'info.teamhaim@gmail.com') {
            list.push({ id: d.id, name: data.name || data.email || 'Athlete', email: data.email || '' })
          }
        })
        setAthletes(list.sort((a, b) => a.name.localeCompare(b.name)))
        const snap2 = await getDoc(doc(db, SETTINGS_DOC_PATH))
        if (snap2.exists()) {
          const data = snap2.data()
          setSheetId(typeof data.sheetId === 'string' ? data.sheetId : '')
        }
      } catch (err) {
        console.error(err)
      } finally {
        setLoadingAthletes(false)
      }
    }
    loadAthletes()
  }, [])

  useEffect(() => {
    if (!selectedAthleteId) { setAthleteProfile(null); setAthleteLogs([]); return }
    const load = async () => {
      setLoadingAthlete(true)
      setPlan(null)
      try {
        const snap = await getDoc(doc(db, 'users', selectedAthleteId))
        if (snap.exists()) setAthleteProfile(snap.data() as Partial<AthleteProfile>)
        const logsSnap = await getDocs(query(collection(db, 'logs'), where('athleteId', '==', selectedAthleteId)))
        const logs: WorkoutLog[] = logsSnap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id, athleteId: data.athleteId || selectedAthleteId,
            workoutId: data.workoutId || '', date: data.date || '',
            actualDistance: data.actualDistance ?? undefined,
            actualPace: data.actualPace ?? undefined,
            effort: legacyEffortToNumber(data.effort),
            comment: data.comment || '', createdAt: data.createdAt?.toDate?.() || new Date(),
          }
        })
        setAthleteLogs(logs.sort((a, b) => b.date.localeCompare(a.date)))
      } catch (err) {
        console.error(err)
      } finally {
        setLoadingAthlete(false)
      }
    }
    load()
  }, [selectedAthleteId])

  const buildAthleteContext = useCallback(() => {
    if (!athleteProfile) return ''
    const prs = (athleteProfile.personalRecords || []).map((p: PersonalRecord) => `${p.event}: ${p.time}`).join(', ')
    const sbs = (athleteProfile.seasonBests || []).map((p: PersonalRecord) => `${p.event}: ${p.time}`).join(', ')
    const goals = (athleteProfile.goals || []).filter((g: {status: string}) => g.status === 'active').map((g: {title: string}) => g.title).join(', ')
    const recentLogs = athleteLogs.slice(0, 10).map(l =>
      `${l.date}: ${l.actualDistance ? l.actualDistance + 'km' : ''} effort=${l.effort}/10 ${l.comment ? '"' + l.comment + '"' : ''}`
    ).join('\n')
    const avgEffort = athleteLogs.length > 0
      ? (athleteLogs.slice(0, 5).reduce((s, l) => s + l.effort, 0) / Math.min(5, athleteLogs.length)).toFixed(1)
      : 'unknown'
    const weeksToGoal = athleteProfile.goalRaceDate
      ? differenceInWeeks(new Date(athleteProfile.goalRaceDate), new Date(startDate))
      : null

    return `ATHLETE PROFILE:
Name: ${athleteProfile.name || 'Unknown'}
Experience: ${athleteProfile.experienceLevel || 'unknown'}
Discipline: ${(athleteProfile.discipline || []).join(', ') || 'road'}
Events: ${(athleteProfile.events || []).join(', ') || 'unknown'}
Weekly mileage (current): ${athleteProfile.weeklyMileage ? athleteProfile.weeklyMileage + 'km' : 'unknown'}
Resting HR: ${athleteProfile.restingHR ? athleteProfile.restingHR + 'bpm' : 'unknown'}
Max HR: ${athleteProfile.maxHR ? athleteProfile.maxHR + 'bpm' : 'unknown'}

PERSONAL RECORDS: ${prs || 'none recorded'}
SEASON BESTS: ${sbs || 'none recorded'}
ACTIVE GOALS: ${goals || 'none'}
GOAL RACE: ${athleteProfile.goalRaceEvent || 'none'} on ${athleteProfile.goalRaceDate || 'unknown'} target: ${athleteProfile.goalRaceTarget || 'finish'}
WEEKS TO GOAL RACE: ${weeksToGoal !== null ? weeksToGoal : 'no goal race set'}

RECENT TRAINING LOGS (last 10):
${recentLogs || 'no logs recorded'}
AVERAGE RECENT EFFORT: ${avgEffort}/10

PLAN START DATE: ${startDate}

Generate a 14-day training plan starting from ${startDate} following Team Haim methodology. Base the season phase on weeks to goal race. Adapt intensity and volume to athlete's experience level and recent effort scores.`
  }, [athleteProfile, athleteLogs, startDate])

  const handleGenerate = async () => {
    if (!athleteProfile) { toast.error('Please select an athlete first'); return }
    setGenerating(true)
    setPlan(null)
    try {
      const athleteContext = buildAthleteContext()
      const response = await fetch('/api/generate-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4000,
          system: TEAM_HAIM_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: athleteContext }],
        }),
      })
      const data = await response.json()
      if (data.error) throw new Error('API error: ' + data.error)
      const text = data.text || ''
      // Extract JSON from the response - find first { and last }
      const jsonStart = text.indexOf('{')
      const jsonEnd = text.lastIndexOf('}')
      if (jsonStart === -1 || jsonEnd === -1) throw new Error('No JSON. Raw: ' + text.slice(0, 200))
      const clean = text.slice(jsonStart, jsonEnd + 1)
      const parsed: GeneratedPlan = JSON.parse(clean)
      if (!parsed.workouts || parsed.workouts.length === 0) {
        throw new Error('No workouts in plan')
      }
      setPlan(parsed)
      toast.success('2-week plan generated!')
    } catch (err) {
      console.error('Generation error:', err)
      toast.error('Failed to generate plan. Please try again.')
    } finally {
      setGenerating(false)
    }
  }

  const handleAssign = async () => {
    if (!plan || !selectedAthleteId || !user?.id) return
    setAssigning(true)
    try {
      const base = new Date(startDate)
      let count = 0
      for (const workout of plan.workouts) {
        if (workout.type === 'rest') continue
        const workoutDate = addDays(base, workout.dayOffset)
        const dateStr = format(workoutDate, 'yyyy-MM-dd')
        const id = `assigned_ai_${selectedAthleteId}_${dateStr}_${Date.now()}`
        const workoutDoc = {
          id,
          type: workout.type,
          title: workout.title,
          description: workout.description,
          duration: workout.duration,
          distance: workout.distance,
          warmup: workout.warmup,
          cooldown: workout.cooldown,
          notes: workout.notes ? `${workout.notes}${workout.mainSet ? '\n\nMain set: ' + workout.mainSet : ''}` : workout.mainSet,
          sets: [],
        }
        await setDoc(doc(db, 'assignedWorkouts', id), JSON.parse(JSON.stringify({
          id,
          workoutId: id,
          workout: workoutDoc,
          athleteId: selectedAthleteId,
          assignedBy: user.id,
          scheduledDate: dateStr,
          status: 'scheduled',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })))
        count++
      }
      toast.success(`Assigned ${count} workouts to athlete's schedule!`)
      setPlan(null)
    } catch (err) {
      console.error('Assign error:', err)
      toast.error('Failed to assign workouts')
    } finally {
      setAssigning(false)
    }
  }

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

  const selectedAthlete = athletes.find(a => a.id === selectedAthleteId)
  const recentAvgEffort = athleteLogs.length > 0
    ? (athleteLogs.slice(0, 5).reduce((s, l) => s + l.effort, 0) / Math.min(5, athleteLogs.length)).toFixed(1)
    : null

  const phaseColors: Record<string, string> = {
    'Base': 'bg-emerald-100 text-emerald-800',
    'Build': 'bg-amber-100 text-amber-800',
    'Peak': 'bg-coral/20 text-coral',
    'Race': 'bg-red-100 text-red-800',
    'Taper': 'bg-purple-100 text-purple-800',
    'Transition': 'bg-gray-100 text-gray-700',
  }

  const getPhaseColor = (phase: string) => {
    const key = Object.keys(phaseColors).find(k => phase.toLowerCase().includes(k.toLowerCase()))
    return key ? phaseColors[key] : 'bg-navy/10 text-navy'
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-semibold text-navy flex items-center gap-2">
          <Wand2 className="h-7 w-7 text-gold" />
          AI Training Plan Generator
        </h1>
        <p className="text-muted-foreground mt-1">
          Generate personalized 2-week plans based on Team Haim methodology. Review and assign directly to athlete schedules.
        </p>
      </div>

      {/* Step 1: Select athlete */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-gold text-navy text-xs font-bold flex items-center justify-center">1</span>
            Select athlete & start date
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Athlete</Label>
              {loadingAthletes ? (
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading athletes...
                </div>
              ) : (
                <Select value={selectedAthleteId} onValueChange={setSelectedAthleteId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose an athlete..." />
                  </SelectTrigger>
                  <SelectContent>
                    {athletes.map(a => (
                      <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            <div className="space-y-2">
              <Label>Plan start date</Label>
              <Input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
              <p className="text-xs text-muted-foreground">Recommended: start on a Monday</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Athlete snapshot */}
      {loadingAthlete && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading athlete data...
        </div>
      )}

      {athleteProfile && !loadingAthlete && (
        <Card className="rounded-2xl border-gold/20 bg-gold/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              Athlete snapshot — {selectedAthlete?.name}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground text-xs mb-1">Experience</p>
                <p className="font-medium text-navy capitalize">{athleteProfile.experienceLevel || '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Weekly mileage</p>
                <p className="font-medium text-navy">{athleteProfile.weeklyMileage ? `${athleteProfile.weeklyMileage} km` : '—'}</p>
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Goal race</p>
                <p className="font-medium text-navy">{athleteProfile.goalRaceEvent || '—'}</p>
                {athleteProfile.goalRaceDate && (
                  <p className="text-xs text-muted-foreground">{athleteProfile.goalRaceDate}</p>
                )}
              </div>
              <div>
                <p className="text-muted-foreground text-xs mb-1">Recent avg effort</p>
                <p className={cn('font-medium', recentAvgEffort && Number(recentAvgEffort) >= 7 ? 'text-red-600' : recentAvgEffort && Number(recentAvgEffort) <= 4 ? 'text-emerald-600' : 'text-navy')}>
                  {recentAvgEffort ? `${recentAvgEffort}/10` : '—'}
                </p>
              </div>
            </div>
            {(athleteProfile.personalRecords || []).length > 0 && (
              <div className="mt-3 pt-3 border-t border-border/50">
                <p className="text-xs text-muted-foreground mb-2">PRs</p>
                <div className="flex flex-wrap gap-2">
                  {(athleteProfile.personalRecords || []).map((pr: PersonalRecord) => (
                    <Badge key={pr.id} variant="outline" className="text-xs">
                      <Trophy className="h-3 w-3 mr-1 text-gold" />{pr.event}: {pr.time}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Generate */}
      <Card className="rounded-2xl">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <span className="w-6 h-6 rounded-full bg-gold text-navy text-xs font-bold flex items-center justify-center">2</span>
            Generate plan
          </CardTitle>
          <CardDescription>
            Claude will analyze the athlete profile, PRs, recent logs, and goal race to generate a Team Haim–aligned 2-week plan.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={handleGenerate}
            disabled={!selectedAthleteId || generating || loadingAthlete}
            className="bg-gold hover:bg-gold/90 text-navy"
            size="lg"
          >
            {generating ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Generating plan...</>
            ) : (
              <><Wand2 className="h-4 w-4 mr-2" />Generate 2-week plan</>
            )}
          </Button>
          {generating && (
            <p className="text-sm text-muted-foreground mt-3 animate-pulse">
              Analyzing athlete data and applying Team Haim methodology...
            </p>
          )}
        </CardContent>
      </Card>

      {/* Step 3: Review & Assign */}
      {plan && (
        <div className="space-y-4">
          <Card className="rounded-2xl border-navy/20 bg-navy/5">
            <CardContent className="pt-4 pb-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Badge className={getPhaseColor(plan.planSummary.seasonPhase)}>
                      {plan.planSummary.seasonPhase}
                    </Badge>
                    {plan.planSummary.weeksToGoalRace && (
                      <span className="text-sm text-muted-foreground">{plan.planSummary.weeksToGoalRace} weeks to goal race</span>
                    )}
                  </div>
                  <p className="font-semibold text-navy">{plan.planSummary.keyFocus}</p>
                  <p className="text-sm text-muted-foreground max-w-xl">{plan.planSummary.rationale}</p>
                  <div className="flex gap-4 text-sm text-muted-foreground">
                    <span><Activity className="h-3.5 w-3.5 inline mr-1" />Week 1: {plan.planSummary.week1TotalKm}km</span>
                    <span><Activity className="h-3.5 w-3.5 inline mr-1" />Week 2: {plan.planSummary.week2TotalKm}km</span>
                  </div>
                </div>
                <Button
                  onClick={handleAssign}
                  disabled={assigning}
                  className="bg-navy hover:bg-navy/90 text-white"
                  size="lg"
                >
                  {assigning ? (
                    <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Assigning...</>
                  ) : (
                    <><Calendar className="h-4 w-4 mr-2" />Assign to {selectedAthlete?.name}</>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Week 1 */}
          <h3 className="font-semibold text-navy text-lg">Week 1</h3>
          <div className="grid gap-3">
            {plan.workouts.filter(w => w.dayOffset < 7).map((workout) => {
              const workoutDate = addDays(new Date(startDate), workout.dayOffset)
              const isRest = workout.type === 'rest'
              return (
                <Card key={workout.dayOffset} className={cn('rounded-xl', isRest && 'bg-muted/30 border-dashed')}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-lg bg-muted flex flex-col items-center justify-center flex-shrink-0">
                        <span className="text-xs text-muted-foreground font-medium">{format(workoutDate, 'EEE')}</span>
                        <span className="text-lg font-bold text-navy">{format(workoutDate, 'd')}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="font-semibold text-navy">{workout.title}</h4>
                          {!isRest && (
                            <Badge variant="outline" className={cn('text-xs', workoutTypeColors[workout.type])}>
                              {workoutTypeLabels[workout.type]}
                            </Badge>
                          )}
                          {workout.distance && <span className="text-xs text-muted-foreground">{workout.distance}km</span>}
                          {workout.duration && <span className="text-xs text-muted-foreground">{workout.duration}min</span>}
                        </div>
                        <p className="text-sm text-muted-foreground">{workout.description}</p>
                        {workout.mainSet && (
                          <p className="text-sm text-navy mt-1 font-medium">Main: {workout.mainSet}</p>
                        )}
                        {workout.notes && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{workout.notes}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <h3 className="font-semibold text-navy text-lg mt-4">Week 2</h3>
          <div className="grid gap-3">
            {plan.workouts.filter(w => w.dayOffset >= 7).map((workout) => {
              const workoutDate = addDays(new Date(startDate), workout.dayOffset)
              const isRest = workout.type === 'rest'
              return (
                <Card key={workout.dayOffset} className={cn('rounded-xl', isRest && 'bg-muted/30 border-dashed')}>
                  <CardContent className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="w-12 h-12 rounded-lg bg-muted flex flex-col items-center justify-center flex-shrink-0">
                        <span className="text-xs text-muted-foreground font-medium">{format(workoutDate, 'EEE')}</span>
                        <span className="text-lg font-bold text-navy">{format(workoutDate, 'd')}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <h4 className="font-semibold text-navy">{workout.title}</h4>
                          {!isRest && (
                            <Badge variant="outline" className={cn('text-xs', workoutTypeColors[workout.type])}>
                              {workoutTypeLabels[workout.type]}
                            </Badge>
                          )}
                          {workout.distance && <span className="text-xs text-muted-foreground">{workout.distance}km</span>}
                          {workout.duration && <span className="text-xs text-muted-foreground">{workout.duration}min</span>}
                        </div>
                        <p className="text-sm text-muted-foreground">{workout.description}</p>
                        {workout.mainSet && (
                          <p className="text-sm text-navy mt-1 font-medium">Main: {workout.mainSet}</p>
                        )}
                        {workout.notes && (
                          <p className="text-xs text-muted-foreground mt-1 italic">{workout.notes}</p>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>

          <div className="flex justify-center pt-4">
            <Button
              onClick={handleAssign}
              disabled={assigning}
              className="bg-navy hover:bg-navy/90 text-white"
              size="lg"
            >
              {assigning ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Assigning workouts...</>
              ) : (
                <><Check className="h-4 w-4 mr-2" />Assign all to {selectedAthlete?.name}'s schedule</>
              )}
            </Button>
          </div>
        </div>
      )}

      {/* Google Sheets (secondary) */}
      <div>
        <button
          onClick={() => setShowSheets(v => !v)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', showSheets && 'rotate-180')} />
          Google Sheets sync settings
        </button>
        {showSheets && (
          <Card className="rounded-2xl mt-3">
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
        )}
      </div>
    </div>
  )
}
