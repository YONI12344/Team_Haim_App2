'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Loader2, Sparkles } from 'lucide-react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { BakkenPlanPanel } from '@/components/coach/bakken-plan-panel'

interface AthleteOption { id: string; name: string }

// Relocated out of the per-athlete tabs (where it used to be a default-
// visible "Bakken AI ✨" tab) into coach settings — full-plan AI
// generation is now a secondary/occasional tool rather than the main
// workflow; day-to-day assignment happens from the Workout Bank/library.
export function BakkenAiSettings() {
  const [athletes, setAthletes] = useState<AthleteOption[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const snap = await getDocs(query(collection(db, 'users'), where('role', '==', 'athlete')))
        setAthletes(
          snap.docs
            .map((d) => ({ id: d.id, name: (d.data() as any).name || 'Athlete' }))
            .sort((a, b) => a.name.localeCompare(b.name)),
        )
      } catch (err) {
        console.error('Error loading athletes:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  return (
    <Card className="rounded-2xl">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-gold" />
          Assistant Coach AI
        </CardTitle>
        <CardDescription>יצירת תוכנית מלאה עם AI לספורטאי נבחר — כלי משני, לא זרימת העבודה היומיומית (זו נמצאת בבנק האימונים).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : (
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm">
            <option value="">בחר ספורטאי...</option>
            {athletes.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
        {selectedId && (
          <div className="border-t pt-4">
            <BakkenPlanPanel athleteId={selectedId} />
          </div>
        )}
      </CardContent>
    </Card>
  )
}
