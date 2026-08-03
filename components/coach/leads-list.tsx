'use client'

import { useEffect, useState } from 'react'
import { collection, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from 'sonner'
import { Loader2, ChevronDown, ChevronUp, Check, X, Copy } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { Lead } from '@/lib/types'

const STATUS_STYLE: Record<Lead['status'], string> = {
  new: 'bg-blue-100 text-blue-700 border-blue-200',
  accepted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  declined: 'bg-muted text-muted-foreground',
  converted: 'bg-gold/15 text-navy border-gold/40',
}

/**
 * Coach-side review for public /apply submissions. Accepting a lead just
 * flips its status — the actual handoff into a real athlete profile
 * happens automatically the moment someone signs up with the matching
 * email (contexts/auth-context.tsx new-user creation checks `leads` for
 * an accepted match and pre-fills from it, then marks it 'converted').
 * Nothing here creates an account directly.
 */
export function LeadsList() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [updatingId, setUpdatingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const snap = await getDocs(query(collection(db, 'leads'), orderBy('createdAt', 'desc')))
      setLeads(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Lead)))
    } catch (e) {
      console.error(e)
      toast.error('Failed to load leads')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const setStatus = async (lead: Lead, status: Lead['status']) => {
    setUpdatingId(lead.id)
    try {
      await updateDoc(doc(db, 'leads', lead.id), { status, updatedAt: new Date() })
      setLeads((prev) => prev.map((l) => (l.id === lead.id ? { ...l, status } : l)))
      toast.success(status === 'accepted' ? 'Accepted — auto-fills their profile once they sign up with this email' : 'Updated')
    } catch (e) {
      console.error(e)
      toast.error('Failed to update')
    } finally {
      setUpdatingId(null)
    }
  }

  const copyEmail = (email: string) => {
    navigator.clipboard.writeText(email)
    toast.success('Email copied')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl font-serif font-bold text-navy">Leads</h1>
        <p className="text-sm text-muted-foreground">
          Applications from the public /apply page. Accept one and its info auto-fills the athlete's
          profile the moment they sign up with the same email — no re-typing.
        </p>
      </div>

      {leads.length === 0 && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">No applications yet.</CardContent></Card>
      )}

      {leads.map((lead) => {
        const expanded = expandedId === lead.id
        return (
          <Card key={lead.id}>
            <CardHeader className="cursor-pointer" onClick={() => setExpandedId(expanded ? null : lead.id)}>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    {lead.name}
                    <Badge variant="outline" className={STATUS_STYLE[lead.status]}>{lead.status}</Badge>
                  </CardTitle>
                  <CardDescription>{lead.email}{lead.phone ? ` · ${lead.phone}` : ''}</CardDescription>
                </div>
                {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              </div>
            </CardHeader>
            {expanded && (
              <CardContent className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-muted-foreground">
                  {lead.experienceLevel && <div>Experience: <span className="text-foreground">{lead.experienceLevel}</span></div>}
                  {lead.runningExperienceDuration && <div>Training seriously: <span className="text-foreground">{lead.runningExperienceDuration.replace(/_/g, ' ')}</span></div>}
                  {lead.weeklyMileage != null && <div>Weekly km: <span className="text-foreground">{lead.weeklyMileage}</span></div>}
                  {lead.daysPerWeek != null && <div>Days/week: <span className="text-foreground">{lead.daysPerWeek}</span></div>}
                  {lead.height != null && <div>Height: <span className="text-foreground">{lead.height} cm</span></div>}
                  {lead.weight != null && <div>Weight: <span className="text-foreground">{lead.weight} kg</span></div>}
                  {lead.city && <div>City: <span className="text-foreground">{lead.city}</span></div>}
                  {lead.dateOfBirth && <div>DOB: <span className="text-foreground">{lead.dateOfBirth}</span></div>}
                  {lead.preferredDays && lead.preferredDays.length > 0 && (
                    <div className="col-span-2">Preferred days: <span className="text-foreground">{lead.preferredDays.join(', ')}</span></div>
                  )}
                  {lead.recentRaceEvent && (
                    <div className="col-span-2">Recent race: <span className="text-foreground">{lead.recentRaceEvent} {lead.recentRaceTime} ({lead.recentRaceDate})</span></div>
                  )}
                  {lead.goalRaceDistance && (
                    <div className="col-span-2">Goal: <span className="text-foreground">{lead.goalRaceDistance} {lead.goalRaceEvent} {lead.goalRaceDate} — target {lead.goalRaceTarget || '—'}</span></div>
                  )}
                  {lead.facilitiesAccess && lead.facilitiesAccess.length > 0 && (
                    <div className="col-span-2">Facilities: <span className="text-foreground">{lead.facilitiesAccess.join(', ')}</span></div>
                  )}
                  {lead.devicesUsed && lead.devicesUsed.length > 0 && (
                    <div className="col-span-2">Devices: <span className="text-foreground">{lead.devicesUsed.join(', ')}</span></div>
                  )}
                  {lead.stravaOrGarminLink && (
                    <div className="col-span-2">Strava/Garmin: <a className="text-foreground underline" href={lead.stravaOrGarminLink} target="_blank" rel="noreferrer">{lead.stravaOrGarminLink}</a></div>
                  )}
                </div>
                {lead.primaryGoal && <div><p className="text-xs text-muted-foreground">Primary goal</p><p>{lead.primaryGoal}</p></div>}
                {lead.longTermGoal && <div><p className="text-xs text-muted-foreground">Long-term goal</p><p>{lead.longTermGoal}</p></div>}
                {lead.shoesInfo && <div><p className="text-xs text-muted-foreground">Shoes</p><p>{lead.shoesInfo}</p></div>}
                {lead.lifestyleNotes && <div><p className="text-xs text-muted-foreground">Lifestyle / sleep</p><p>{lead.lifestyleNotes}</p></div>}
                {lead.currentInjuries && <div><p className="text-xs text-muted-foreground">Current injury/pain</p><p>{lead.currentInjuries}</p></div>}
                {lead.injuryHistory && <div><p className="text-xs text-muted-foreground">Injury history</p><p>{lead.injuryHistory}</p></div>}
                {lead.medicalNotes && <div><p className="text-xs text-muted-foreground">Medical notes</p><p>{lead.medicalNotes}</p></div>}
                {lead.additionalNotes && <div><p className="text-xs text-muted-foreground">Notes</p><p>{lead.additionalNotes}</p></div>}

                <div className="flex gap-2 pt-2 border-t">
                  <Button size="sm" variant="outline" onClick={() => copyEmail(lead.email)}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Copy email
                  </Button>
                  {lead.status !== 'accepted' && lead.status !== 'converted' && (
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={updatingId === lead.id}
                      onClick={() => setStatus(lead, 'accepted')}>
                      <Check className="h-3.5 w-3.5 mr-1" /> Accept
                    </Button>
                  )}
                  {lead.status !== 'declined' && lead.status !== 'converted' && (
                    <Button size="sm" variant="outline" className="border-red-200 text-red-500 hover:bg-red-50" disabled={updatingId === lead.id}
                      onClick={() => setStatus(lead, 'declined')}>
                      <X className="h-3.5 w-3.5 mr-1" /> Decline
                    </Button>
                  )}
                </div>
              </CardContent>
            )}
          </Card>
        )
      })}
    </div>
  )
}
