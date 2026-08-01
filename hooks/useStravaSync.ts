'use client'

/**
 * Extracted verbatim from components/athlete/athlete-planner-view.tsx's
 * handleStravaSync so the Dashboard can offer the same "sync from Strava"
 * action the Schedule page already has, without a second, drifting copy of
 * this matching logic (already the subject of many careful bug fixes this
 * project has been through). The only two things a calling page used to do
 * directly — refreshing its own local weekLogs/assignedWorkouts state — are
 * now optional callbacks, since the Dashboard doesn't hold that state at
 * all; everything else (the fetch, the multi-phase activity-to-workout
 * matching, the Firestore writes) is unchanged.
 */

import { useState } from 'react'
import { collection, doc, getDoc, addDoc, serverTimestamp, query, where, getDocs, updateDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import { format } from 'date-fns'
import { toast } from 'sonner'
import { useLanguage } from '@/contexts/language-context'
import { expectedRepMetersForWorkout, scoreActivityFitForReps } from '@/lib/strava-lap-matching'
import { STRAVA_RUNNING_TYPES, STRAVA_GYM_TYPES } from '@/lib/activity-types'

export interface UseStravaSyncOptions {
  /** Called once the sync + matching is fully done, so a page holding its
   *  own copy of logs (e.g. the Schedule calendar) can refresh it. */
  onSynced?: () => void
  /** Called whenever an assignedWorkout's status changes as a side effect
   *  of matching (completed, or reverted back to scheduled) — lets a page
   *  update its own optimistic local copy instead of waiting for onSynced's
   *  full refetch. */
  onAssignedWorkoutStatusChange?: (id: string, patch: { status: string; completedAt: Date | null }) => void
}

export function useStravaSync(athleteId: string, options: UseStravaSyncOptions = {}) {
  const { t } = useLanguage()
  const [syncing, setSyncing] = useState(false)
  const { onSynced, onAssignedWorkoutStatusChange } = options

  /** priorityDate (yyyy-MM-dd) — the one day, if any, that must get the full
   *  detail+laps Strava fetch regardless of the sync route's own 7-day
   *  recency cutoff (e.g. right after a coach's "reset day" debug + resync,
   *  specifically to force a fresh recompute for that day). Defaults to
   *  today when the caller has no specific day in view (e.g. the Dashboard). */
  const sync = async (priorityDate?: string) => {
    if (!athleteId) return
    setSyncing(true)
    try {
      const userSnap = await getDoc(doc(db, 'users', athleteId))
      const stravaId = userSnap.data()?.stravaId
      if (!stravaId) { toast.error(t.stravaConnectBtn + ' — ' + t.stravaNotFoundError); return }
      const snap = await getDoc(doc(db, 'strava_connections', `strava_${stravaId}`))
      if (!snap.exists()) { toast.error(t.stravaConnectBtn); return }
      const stravaData = snap.data()
      const priorityDateStr = priorityDate || format(new Date(), 'yyyy-MM-dd')
      const res = await fetch('/api/strava/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: athleteId, accessToken: stravaData.accessToken, refreshToken: stravaData.refreshToken, expiresAt: stravaData.expiresAt,
          priorityDate: priorityDateStr,
        }),
      })
      const data = await res.json()
      if (data.success) {
        let saved = 0

        // First pass: save/find each activity's log doc. A log with a
        // LOW-confidence link (distance-only, rep-fit, or no candidate at
        // all) is still eligible to be re-matched below — only an explicit
        // SESSION TAG match (tier 3) is trusted as final. Rep-fit (tier 2)
        // isn't reliable enough to freeze forever: a short warmup can
        // coincidentally score a nonzero rep-fit against the WRONG
        // candidate, and once that happened before the session-inference
        // fix existed, it would otherwise never get another chance to
        // re-match now that a better signal (session) is available.
        //
        // That re-matching is only worth doing for RECENT activities,
        // though — an old one's data isn't going to suddenly improve, so
        // re-checking it on every single sync forever is pure waste (and
        // log noise). Anything older than this just keeps its existing
        // link, however low-confidence, permanently.
        const REPAIR_WINDOW_DAYS = 7
        const repairCutoffStr = new Date(Date.now() - REPAIR_WINDOW_DAYS * 86400000).toISOString().slice(0, 10)
        const toMatch: { activity: any; logRef: any; oldAssignedWorkoutId: string | null }[] = []
        for (const activity of data.activities) {
          const existing = await getDocs(query(collection(db, 'logs'), where('stravaActivityId', '==', activity.stravaActivityId), where('athleteId', '==', athleteId)))
          let logRef
          let oldAssignedWorkoutId: string | null = null
          if (!existing.empty) {
            const existingDoc = existing.docs[0]
            const alreadyConfident = (existingDoc.data().matchTier ?? 0) >= 3
            const tooOldToRepair = activity.date < repairCutoffStr
            if (existingDoc.data().assignedWorkoutId && (alreadyConfident || tooOldToRepair)) continue
            oldAssignedWorkoutId = existingDoc.data().assignedWorkoutId || null
            logRef = existingDoc.ref
          } else {
            logRef = await addDoc(collection(db, 'logs'), {
              athleteId,
              workoutId: `strava_${activity.stravaActivityId}`,
              stravaActivityId: activity.stravaActivityId,
              startTime: activity.startTime || null,
              stravaName: activity.stravaName || '',
              date: activity.date,
              actualDistance: activity.distanceKm,
              actualPace: activity.avgPace,
              durationMin: activity.durationMin || null,
              effort: null,
              comment: '',
              splitLogs: activity.splitLogs || [],
              averageHeartRate: activity.averageHeartRate || null,
              elevationGain: activity.elevationGain || null,
              stravaType: activity.stravaType || '',
              source: 'strava',
              feedbackStatus: 'pending',
              createdAt: serverTimestamp(),
            })
            saved++
            // Coach notification is handled server-side (Cloud Function
            // notifyCoachOnLogChange, functions/src/index.ts) on this
            // same new logs doc — no client-side push needed here.
          }
          toMatch.push({ activity, logRef, oldAssignedWorkoutId })
        }

        // Smart auto-complete, grouped by date so same-day activities can
        // be reconciled together — a warmup/cooldown recorded as a
        // SEPARATE Strava activity from the main set has no rep structure
        // and a small distance of its own, so matched independently it can
        // land on a completely different scheduled workout later that day
        // just because that workout's plan happens to be a closer distance.
        const byDate = new Map<string, typeof toMatch>()
        for (const item of toMatch) {
          const d = item.activity.date
          if (!byDate.has(d)) byDate.set(d, [])
          byDate.get(d)!.push(item)
        }

        for (const [date, dayItems] of byDate) {
          try {
            const isRunAct = (a: any) => STRAVA_RUNNING_TYPES.includes(a.stravaType || 'Run')
            const isGymAct = (a: any) => STRAVA_GYM_TYPES.includes(a.stravaType || '')
            const isSwimAct = (a: any) => a.stravaType === 'Swim'
            const isBikeAct = (a: any) => ['Ride', 'VirtualRide', 'MountainBikeRide', 'GravelRide', 'EBikeRide'].includes(a.stravaType || '')
            const awSnap = await getDocs(query(
              collection(db, 'assignedWorkouts'),
              where('athleteId', '==', athleteId),
              where('scheduledDate', '==', date)
            ))
            if (awSnap.empty) continue

            // Two real, separate workouts (e.g. AM run + PM run) need at
            // least this much of a gap to count as distinct sessions.
            const SAME_SESSION_GAP_HOURS = 4
            const buildTimeClusters = <T extends { activity: any }>(items: T[]): T[][] => {
              const sorted = [...items].sort((a, b) => (a.activity.startTime || '').localeCompare(b.activity.startTime || ''))
              const out: T[][] = []
              for (const t of sorted) {
                const startMs = t.activity.startTime ? new Date(t.activity.startTime).getTime() : null
                const last = out[out.length - 1]
                const lastT = last?.[last.length - 1]
                const lastEndMs = lastT?.activity.startTime
                  ? new Date(lastT.activity.startTime).getTime() + (lastT.activity.durationMin || 0) * 60000
                  : null
                if (last && startMs != null && lastEndMs != null && (startMs - lastEndMs) <= SAME_SESSION_GAP_HOURS * 3600 * 1000) {
                  last.push(t)
                } else {
                  out.push([t])
                }
              }
              return out
            }

            type Tentative = { activity: any; logRef: any; match: any; tier: number; oldAssignedWorkoutId: string | null }
            const tentative: Tentative[] = []

            // Pre-pass — pure chronological pairing. A real session's own
            // internal Strava auto-laps can coincidentally fit a DIFFERENT
            // workout's rep count better than the one it actually belongs
            // to, which rep-fit/distance scoring alone can't tell apart.
            // But when every activity today is a run, and the number of
            // distinct time-separated sessions (grouped purely by the
            // SAME_SESSION_GAP_HOURS rule, before any rep/distance
            // reasoning) exactly matches the number of scheduled,
            // not-yet-completed running workouts, there's a much more
            // reliable signal available: pair them up by time order alone
            // — the earliest session goes to whichever workout is
            // earliest in the day (by session tag), and so on.
            const runCandidates = awSnap.docs.filter(aw => {
              if (aw.data().status === 'completed') return false
              const wType = aw.data().workout?.type || ''
              return !['strength', 'cross_training'].includes(wType) && wType !== 'swim' && wType !== 'bike'
            })
            const allRunToday = dayItems.every(item => isRunAct(item.activity))
            const rawClusters = allRunToday ? buildTimeClusters(dayItems) : []
            let handledChronologically = false
            if (allRunToday && rawClusters.length > 1 && rawClusters.length === runCandidates.length) {
              const sessionOrder = (aw: typeof runCandidates[number]) =>
                aw.data().session === 'am' ? 0 : aw.data().session === 'pm' ? 1 : 2
              const sortedCandidates = [...runCandidates].sort((a, b) => sessionOrder(a) - sessionOrder(b))
              const sortedClusters = [...rawClusters].sort((a, b) => (a[0].activity.startTime || '').localeCompare(b[0].activity.startTime || ''))
              for (let i = 0; i < sortedClusters.length; i++) {
                const match = sortedCandidates[i]
                for (const { activity, logRef, oldAssignedWorkoutId } of sortedClusters[i]) {
                  console.log('[strava-match] chronological', {
                    activity: activity.stravaName, startTime: activity.startTime,
                    sessionIndex: i, matchedTo: match.data().workout?.title,
                  })
                  tentative.push({ activity, logRef, match, tier: 4, oldAssignedWorkoutId })
                }
              }
              handledChronologically = true
            }

            // Phase 1 (fallback path only) — each activity's OWN best
            // match, independent of its same-day siblings. tier:
            // 3=explicit session tag, 2=rep-fit, 1=distance closeness,
            // 0=only candidate / no signal at all.
            for (const { activity, logRef, oldAssignedWorkoutId } of (handledChronologically ? [] : dayItems)) {
              const candidates = awSnap.docs.filter(aw => {
                // A completed workout is normally excluded (don't steal it
                // from whatever legitimately finished it) — UNLESS it's
                // already this exact activity's own current link, in which
                // case it must stay eligible for re-matching. Otherwise,
                // re-evaluating a low-confidence link whose target happens
                // to already be complete (by this very activity, from an
                // earlier sync) would see only the OTHER workout left as a
                // candidate and wrongly reassign there by elimination.
                if (aw.data().status === 'completed' && aw.id !== oldAssignedWorkoutId) return false
                const wType = aw.data().workout?.type || ''
                const isStrengthW = ['strength', 'cross_training'].includes(wType)
                if (isStrengthW) return isGymAct(activity)
                if (wType === 'swim') return isSwimAct(activity)
                if (wType === 'bike') return isBikeAct(activity)
                return isRunAct(activity)
              })
              if (candidates.length === 0) continue

              let activitySession: 'am' | 'pm' | null = null
              if (activity.startTime) {
                const hourPart = String(activity.startTime).split('T')[1]
                const hour = hourPart ? parseInt(hourPart.split(':')[0], 10) : NaN
                if (!isNaN(hour)) activitySession = hour < 14 ? 'am' : 'pm'
              }
              // The coach's UI only prompts for a session tag when a SECOND
              // workout is added to an already-occupied day, so on a
              // two-workout day often only ONE of them ever gets tagged —
              // leaving the other with no session field at all, which then
              // never matches here even though there's no real ambiguity:
              // the untagged one must be the opposite session from the
              // tagged one.
              const effectiveSession = (aw: typeof candidates[number]): 'am' | 'pm' | 'other' | undefined => {
                const own = aw.data().session
                if (own) return own
                if (candidates.length === 2) {
                  const otherSession = candidates.find(c => c.id !== aw.id)?.data().session
                  if (otherSession === 'am') return 'pm'
                  if (otherSession === 'pm') return 'am'
                }
                return undefined
              }
              const bySession = activitySession ? candidates.find(aw => effectiveSession(aw) === activitySession) : undefined
              const byRepFit = !bySession && candidates.length > 1
                ? candidates.reduce<{ aw: typeof candidates[number]; score: number } | null>((best, aw) => {
                    const expectedMeters = expectedRepMetersForWorkout(aw.data().workout)
                    if (expectedMeters.length === 0) return best
                    const score = scoreActivityFitForReps(activity.splitLogs || [], expectedMeters)
                    if (score === 0) return best
                    return (!best || score > best.score) ? { aw, score } : best
                  }, null)?.aw
                : undefined
              const byDistance = !bySession && !byRepFit && candidates.length > 1
                ? candidates.reduce<{ aw: typeof candidates[number]; diff: number } | null>((best, aw) => {
                    const plannedKm = aw.data().workout?.distance
                    if (plannedKm == null) return best
                    const diff = Math.abs(plannedKm - activity.distanceKm)
                    return (!best || diff < best.diff) ? { aw, diff } : best
                  }, null)?.aw
                : undefined
              const match = bySession || byRepFit || byDistance || candidates[0]
              const tier = bySession ? 3 : byRepFit ? 2 : byDistance ? 1 : 0
              console.log('[strava-match] tentative', {
                activity: activity.stravaName, stravaActivityId: activity.stravaActivityId,
                startTime: activity.startTime, distanceKm: activity.distanceKm,
                candidates: candidates.map(c => ({ id: c.id, title: c.data().workout?.title, session: c.data().session, plannedKm: c.data().workout?.distance })),
                matchedTo: match.data().workout?.title, tier,
              })
              tentative.push({ activity, logRef, match, tier, oldAssignedWorkoutId })
            }

            // Phase 2 (fallback path only) — reconcile same-day activities
            // that started close together in time as ONE physical
            // training block: they must all agree on whichever match has
            // the strongest evidence in the group, instead of a
            // low-confidence fragment (a cooldown, say) drifting off to a
            // different scheduled workout on its own. Already handled by
            // the chronological pre-pass above when that applied cleanly.
            if (!handledChronologically) {
              const clusters = buildTimeClusters(tentative)
              for (const cluster of clusters) {
                if (cluster.length < 2) continue
                const winner = cluster.reduce((best, t) => (!best || t.tier > best.tier) ? t : best, null as Tentative | null)!
                console.log('[strava-match] cluster reconciled', {
                  members: cluster.map(t => t.activity.stravaName),
                  winnerActivity: winner.activity.stravaName,
                  winnerMatch: winner.match.data().workout?.title,
                  winnerTier: winner.tier,
                })
                for (const t of cluster) { t.match = winner.match; t.tier = winner.tier }
              }
            }

            // Phase 3 — write the final decision for each activity.
            for (const { activity, logRef, match, tier } of tentative) {
              const wType = match.data().workout?.type || ''
              const isStrengthW = ['strength', 'cross_training'].includes(wType)
              const plannedDist = match.data().workout?.distance ?? 0
              let shouldComplete = false
              if (isStrengthW || wType === 'swim' || wType === 'bike') {
                shouldComplete = true // discipline already confirmed via candidates filter
              } else {
                // Sum distance across every activity THIS sync matched to
                // the same workout (covers both "several workouts today"
                // and "one workout split into warmup + main" cases).
                const matchedKm = tentative.filter(t => t.match.id === match.id).reduce((s, t) => s + (t.activity.distanceKm || 0), 0)
                shouldComplete = plannedDist === 0 || matchedKm >= plannedDist * 0.7
              }
              // Only the MAIN (longest-distance) fragment of a multi-fragment
              // session gets the workout's comparisonGroup tag — a
              // warmup/cooldown recorded as its own separate Strava activity
              // would otherwise pool into the SAME comparison-group trend
              // (useWorkoutComparisonGroups has no way to tell them apart
              // once tagged) and show its own short, slow pace as if it
              // were another real session of the workout.
              const clusterMates = tentative.filter(t => t.match.id === match.id)
              const isMainFragment = clusterMates.every(t => (t.activity.distanceKm || 0) <= (activity.distanceKm || 0))
              console.log('[strava-match] final', {
                activity: activity.stravaName, matchedTo: match.data().workout?.title, tier, shouldComplete, isMainFragment,
              })
              await updateDoc(logRef, {
                assignedWorkoutId: match.id,
                // Always corrected to the REAL template id, not left as the
                // synthetic `strava_<activityId>` placeholder set at log
                // creation — useWorkoutLactateGroups keys its threshold-
                // folder grouping off this exact field, so without it a
                // genuine threshold session could never be found there no
                // matter how correct its data eventually became.
                workoutId: match.data().workoutId,
                comparisonGroup: isMainFragment ? (match.data().workout?.comparisonGroup || null) : null,
                matchTier: tier,
              })
              if (shouldComplete) {
                await updateDoc(doc(db, 'assignedWorkouts', match.id), { status: 'completed', completedAt: serverTimestamp() })
                onAssignedWorkoutStatusChange?.(match.id, { status: 'completed', completedAt: new Date() })
              }
            }

            // No automatic "rebuild splitLogs into rep-shaped rows" step
            // here anymore — that used to run silently on every sync and,
            // across many rounds of real bugs (missing splits, garbage
            // computed paces, fabricated rest, stale frozen data surviving
            // multiple fix deploys), never gave the athlete/coach a chance
            // to catch a bad match before it was already "final". Per
            // explicit direction: the Strava box always stays raw (above),
            // and workout-log-form.tsx's own rep-entry flow — which already
            // prefills the same best-guess matched splits for review, and
            // only writes thresholdDistance/hasLactate/rep-shaped splitLogs
            // when the athlete/coach actually reviews and saves — is now
            // the ONE place that produces the data the Lab reads. Raw data
            // that's never been reviewed just stays raw and isn't in the
            // Lab yet, which is correct: it hasn't been confirmed.

            // A repaired log's match can move to a DIFFERENT workout than
            // before (e.g. a fragment that was wrongly completing the
            // evening workout now correctly points to morning instead) —
            // if nothing today still points to whatever it used to be
            // linked to, that workout's "completed" status is stale and
            // must be reverted, or it stays wrongly marked done forever.
            const oldIds = new Set(tentative.map(t => t.oldAssignedWorkoutId).filter((id): id is string => !!id))
            const newIds = new Set(tentative.map(t => t.match.id))
            for (const oldId of oldIds) {
              if (newIds.has(oldId)) continue
              const staleDoc = awSnap.docs.find(d => d.id === oldId)
              if (staleDoc && staleDoc.data().status === 'completed') {
                console.log('[strava-match] reverting stale completion', { workoutId: oldId, title: staleDoc.data().workout?.title })
                await updateDoc(doc(db, 'assignedWorkouts', oldId), { status: 'scheduled', completedAt: null })
                onAssignedWorkoutStatusChange?.(oldId, { status: 'scheduled', completedAt: null })
              }
            }
          } catch (e) { console.error('Smart auto-complete failed:', e) }
        }
        toast.success(`${t.syncedFromStrava}: ${saved}`)
        onSynced?.()
      } else {
        // Previously silent on failure — e.g. Strava's own rate limit
        // (100 requests/15min) kicking in after several syncs in a row
        // returns { error: '...Too Many Requests' } here, and nothing was
        // ever shown to the user for it.
        const isRateLimit = String(data.error || '').toLowerCase().includes('too many requests')
        toast.error(isRateLimit ? t.stravaRateLimitError : t.stravaSyncTitle)
      }
    } catch (err) { console.error(err); toast.error(t.stravaSyncTitle) }
    finally { setSyncing(false) }
  }

  return { syncing, sync }
}
