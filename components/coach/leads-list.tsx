'use client'

import { useEffect, useState } from 'react'
import { collection, getDocs, doc, updateDoc, query, orderBy } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { toast } from 'sonner'
import { Loader2, ChevronDown, ChevronUp, Check, X, Copy } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useLanguage } from '@/contexts/language-context'
import type { Lead } from '@/lib/types'

const STATUS_STYLE: Record<Lead['status'], string> = {
  new: 'bg-blue-100 text-blue-700 border-blue-200',
  accepted: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  declined: 'bg-muted text-muted-foreground',
  converted: 'bg-gold/15 text-navy border-gold/40',
}

const DAY_ORDER = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const
const DAY_SHORT: Record<string, string> = { sunday: 'Sun', monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu', friday: 'Fri', saturday: 'Sat' }

/**
 * Coach-side review for public /apply submissions. Accepting a lead just
 * flips its status — the actual handoff into a real athlete profile
 * happens automatically the moment someone signs up with the matching
 * email (contexts/auth-context.tsx new-user creation checks `leads` for
 * an accepted match and pre-fills from it, then marks it 'converted').
 * Nothing here creates an account directly.
 */
export function LeadsList() {
  const { t, isRTL } = useLanguage()
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
      toast.error(t.leadsLoadFailed)
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
      toast.success(status === 'accepted' ? t.leadsAcceptedToast : t.leadsUpdatedToast)
    } catch (e) {
      console.error(e)
      toast.error(t.leadsUpdateFailed)
    } finally {
      setUpdatingId(null)
    }
  }

  const copyEmail = (email: string) => {
    navigator.clipboard.writeText(email)
    toast.success(t.leadsEmailCopied)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-gold" />
      </div>
    )
  }

  return (
    <div className="space-y-4 max-w-3xl mx-auto" dir={isRTL ? 'rtl' : 'ltr'}>
      <div>
        <h1 className="text-2xl font-serif font-bold text-navy">{t.leadsHeading}</h1>
        <p className="text-sm text-muted-foreground">
          {t.leadsDesc}
        </p>
      </div>

      {leads.length === 0 && (
        <Card><CardContent className="py-10 text-center text-muted-foreground">{t.leadsEmpty}</CardContent></Card>
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
                  {lead.experienceLevel && <div>{t.leadExperienceLabel}: <span className="text-foreground">{lead.experienceLevel}</span></div>}
                  {lead.runningExperienceDuration && <div>{t.leadTrainingSeriouslyLabel}: <span className="text-foreground">{lead.runningExperienceDuration.replace(/_/g, ' ')}</span></div>}
                  {lead.weeklyMileage != null && <div>{t.leadWeeklyKmLabel}: <span className="text-foreground">{lead.weeklyMileage}</span></div>}
                  {lead.daysPerWeek != null && <div>{t.leadDaysPerWeekLabel}: <span className="text-foreground">{lead.daysPerWeek}</span></div>}
                  {lead.height != null && <div>{t.leadHeightLabel}: <span className="text-foreground">{lead.height} cm</span></div>}
                  {lead.weight != null && <div>{t.leadWeightLabel}: <span className="text-foreground">{lead.weight} kg</span></div>}
                  {lead.city && <div>{t.leadCityLabel}: <span className="text-foreground">{lead.city}</span></div>}
                  {lead.dateOfBirth && <div>{t.leadDobLabel}: <span className="text-foreground">{lead.dateOfBirth}</span></div>}
                  {lead.preferredDays && lead.preferredDays.length > 0 && (
                    <div className="col-span-2">{t.leadPreferredDaysLabel}: <span className="text-foreground">{lead.preferredDays.join(', ')}</span></div>
                  )}
                  {lead.recentRaceEvent && (
                    <div className="col-span-2">{t.leadRecentRaceLabel}: <span className="text-foreground">{lead.recentRaceEvent} {lead.recentRaceTime} ({lead.recentRaceDate})</span></div>
                  )}
                  {lead.goalRaceDistance && (
                    <div className="col-span-2">{t.leadGoalLabel}: <span className="text-foreground">{lead.goalRaceDistance} {lead.goalRaceEvent} {lead.goalRaceDate} — {t.leadGoalTargetPrefix} {lead.goalRaceTarget || '—'}</span></div>
                  )}
                  {lead.facilitiesAccess && lead.facilitiesAccess.length > 0 && (
                    <div className="col-span-2">{t.leadFacilitiesLabel}: <span className="text-foreground">{lead.facilitiesAccess.join(', ')}</span></div>
                  )}
                  {lead.devicesUsed && lead.devicesUsed.length > 0 && (
                    <div className="col-span-2">{t.leadDevicesLabel}: <span className="text-foreground">{lead.devicesUsed.join(', ')}</span></div>
                  )}
                </div>
                {lead.typicalWeek && (
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{t.leadTypicalWeekLabel}</p>
                    <div className="space-y-0.5">
                      {DAY_ORDER.filter((day) => lead.typicalWeek?.[day]).map((day) => (
                        <div key={day}>
                          <span className="text-muted-foreground">{DAY_SHORT[day]}:</span>{' '}
                          <span className="text-foreground">{lead.typicalWeek![day]}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {lead.primaryGoal && <div><p className="text-xs text-muted-foreground">{t.leadPrimaryGoalLabel}</p><p>{lead.primaryGoal}</p></div>}
                {lead.longTermGoal && <div><p className="text-xs text-muted-foreground">{t.leadLongTermGoalLabel}</p><p>{lead.longTermGoal}</p></div>}
                {lead.shoesInfo && <div><p className="text-xs text-muted-foreground">{t.leadShoesLabel}</p><p>{lead.shoesInfo}</p></div>}
                {lead.lifestyleNotes && <div><p className="text-xs text-muted-foreground">{t.leadLifestyleLabel}</p><p>{lead.lifestyleNotes}</p></div>}
                {lead.currentInjuries && <div><p className="text-xs text-muted-foreground">{t.leadCurrentInjuryLabel}</p><p>{lead.currentInjuries}</p></div>}
                {lead.injuryHistory && <div><p className="text-xs text-muted-foreground">{t.leadInjuryHistoryLabel}</p><p>{lead.injuryHistory}</p></div>}
                {lead.medicalNotes && <div><p className="text-xs text-muted-foreground">{t.leadMedicalNotesLabel}</p><p>{lead.medicalNotes}</p></div>}
                {lead.additionalNotes && <div><p className="text-xs text-muted-foreground">{t.leadAdditionalNotesLabel}</p><p>{lead.additionalNotes}</p></div>}

                <div className="flex gap-2 pt-2 border-t">
                  <Button size="sm" variant="outline" onClick={() => copyEmail(lead.email)}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> {t.leadsCopyEmailBtn}
                  </Button>
                  {lead.status !== 'accepted' && lead.status !== 'converted' && (
                    <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white" disabled={updatingId === lead.id}
                      onClick={() => setStatus(lead, 'accepted')}>
                      <Check className="h-3.5 w-3.5 mr-1" /> {t.leadsAcceptBtn}
                    </Button>
                  )}
                  {lead.status !== 'declined' && lead.status !== 'converted' && (
                    <Button size="sm" variant="outline" className="border-red-200 text-red-500 hover:bg-red-50" disabled={updatingId === lead.id}
                      onClick={() => setStatus(lead, 'declined')}>
                      <X className="h-3.5 w-3.5 mr-1" /> {t.leadsDeclineBtn}
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
