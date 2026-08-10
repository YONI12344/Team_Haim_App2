'use client'

import { useEffect, useState } from 'react'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/lib/firebase'
import Link from 'next/link'
import { Loader2, MessageCircle, ChevronRight, AlertTriangle, Video, Dumbbell } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLanguage } from '@/contexts/language-context'
import { useAuth } from '@/contexts/auth-context'
import { BODY_ZONES, ZONE_IDS } from '@/lib/injury-data'
import { listExercises } from '@/lib/exercise-library'
import type { AthleteInjury, ExerciseLibraryItem } from '@/lib/types'

export function AthleteInjuryView() {
  const { language, isRTL } = useLanguage()
  const { user } = useAuth()
  const he = language === 'he'
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [exercises, setExercises] = useState<ExerciseLibraryItem[]>([])
  const [injuries, setInjuries] = useState<AthleteInjury[]>([])

  useEffect(() => {
    if (!user?.id) return
    const load = async () => {
      try {
        const [exList, injSnap] = await Promise.all([
          listExercises(),
          getDocs(query(
            collection(db, 'injuries'),
            where('athleteId', '==', user.id),
            where('visibleToAthlete', '==', true),
          )),
        ])
        setExercises(exList)
        setInjuries(injSnap.docs.map((d) => {
          const data = d.data()
          return {
            id: d.id,
            athleteId: data.athleteId,
            zoneId: data.zoneId,
            title: data.title || '',
            description: data.description,
            status: data.status || 'active',
            visibleToAthlete: true,
            rehabWorkoutId: data.rehabWorkoutId,
            createdBy: data.createdBy || '',
            createdAt: data.createdAt?.toDate?.() || new Date(),
            updatedAt: data.updatedAt?.toDate?.() || new Date(),
          } as AthleteInjury
        }))
      } catch (err) {
        console.error('Error loading injury view data:', err)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [user?.id])

  const zone = selected ? BODY_ZONES[selected] : null
  const zoneExercises = selected ? exercises.filter((ex) => ex.injuryZones?.includes(selected)) : []
  const zoneInjury = selected ? injuries.find((inj) => inj.zoneId === selected && inj.status === 'active') : undefined

  return (
    <div className="space-y-5 pb-24 md:pb-8" dir={isRTL ? 'rtl' : 'ltr'}>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-[#0a1628]">
          {he ? 'מרכז פציעות ומניעה' : 'Injury & Prevention Center'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {he
            ? 'בחרו אזור בגוף כדי לראות פציעות נפוצות ותרגילי מניעה'
            : 'Select a body area to see common injuries and prevention exercises'}
        </p>
      </div>

      {/* Zone chips */}
      <div className="flex flex-wrap gap-2">
        {ZONE_IDS.map((id) => (
          <button
            key={id}
            onClick={() => setSelected(id === selected ? null : id)}
            className={cn(
              'px-3.5 py-2 rounded-full text-xs font-semibold border transition-colors',
              selected === id
                ? 'bg-[#0a1628] text-[#e4c878] border-[#0a1628]'
                : 'bg-white text-gray-600 border-gray-200 active:bg-gray-50'
            )}
          >
            {he ? BODY_ZONES[id].he : BODY_ZONES[id].en}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-[#c9a84c]" />
        </div>
      ) : zone ? (
        <div className="space-y-4">

          {/* Personalized rehab plan, if the coach set one for this zone */}
          {zoneInjury && (
            <div className="bg-[#0a1628] rounded-3xl p-5 space-y-3">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wide text-[#e4c878]">
                  {he ? 'התוכנית שלך מהמאמן' : "Your coach's plan"}
                </p>
                <p className="font-bold text-white text-base mt-1">{zoneInjury.title}</p>
                {zoneInjury.description && (
                  <p className="text-sm text-white/60 mt-1">{zoneInjury.description}</p>
                )}
              </div>
              {zoneInjury.rehabWorkoutId && (
                <Link href={`/athlete/lift/${zoneInjury.rehabWorkoutId}`} className="block">
                  <div className="bg-white/10 rounded-2xl p-3.5 flex items-center justify-between active:scale-[0.98] transition-transform">
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-[#e4c878] flex items-center justify-center flex-shrink-0">
                        <Dumbbell className="h-4.5 w-4.5 text-[#0a1628]" />
                      </div>
                      <p className="font-semibold text-white text-sm">
                        {he ? 'התחל אימון שיקום' : 'Start rehab session'}
                      </p>
                    </div>
                    <ChevronRight className={cn('h-5 w-5 text-white/40 flex-shrink-0', isRTL && 'rotate-180')} />
                  </div>
                </Link>
              )}
            </div>
          )}

          {/* Common injuries */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <h2 className="font-bold text-[#0a1628] text-lg">
              {he ? zone.he : zone.en}
            </h2>
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#c9a84c] mt-3 mb-2">
              {he ? 'פציעות נפוצות אצל רצים' : 'Common running injuries'}
            </p>
            <ul className="space-y-1.5">
              {(he ? zone.commonInjuriesHe : zone.commonInjuriesEn).map((inj) => (
                <li key={inj} className="text-sm text-gray-600 flex items-start gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-[#c9a84c] mt-1.5 flex-shrink-0" />
                  {inj}
                </li>
              ))}
            </ul>
          </div>

          {/* Real exercises from the coach's library, tagged for this zone */}
          <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-5">
            <p className="text-[11px] font-bold uppercase tracking-wide text-[#c9a84c] mb-3">
              {he ? 'תרגילי מניעה וחיזוק' : 'Prevention & strengthening exercises'}
            </p>
            {zoneExercises.length === 0 ? (
              <p className="text-sm text-gray-400">
                {he ? 'המאמן עוד לא שייך תרגילים לאזור הזה' : "Your coach hasn't tagged exercises for this area yet"}
              </p>
            ) : (
              <div className="space-y-3">
                {zoneExercises.map((ex) => (
                  <details key={ex.id} className="rounded-2xl border border-gray-100 overflow-hidden group">
                    <summary className="flex items-center gap-4 p-3.5 cursor-pointer list-none">
                      <div className="w-11 h-11 rounded-xl bg-[#0a1628] flex items-center justify-center flex-shrink-0">
                        <Video className="h-5 w-5 text-[#e4c878]" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm text-[#0a1628] leading-tight">{ex.name}</p>
                        {(ex.defaultSets || ex.defaultReps) && (
                          <p className="text-xs text-gray-400 mt-0.5">
                            {ex.defaultSets ? `${ex.defaultSets} ${he ? 'סטים' : 'sets'}` : ''}{ex.defaultSets && ex.defaultReps ? ' · ' : ''}{ex.defaultReps || ''}
                          </p>
                        )}
                      </div>
                    </summary>
                    {ex.videoUrl && (
                      <video src={ex.videoUrl} className="w-full aspect-video bg-black" controls playsInline preload="metadata" />
                    )}
                    {ex.instructions && <p className="text-xs text-gray-500 p-3.5 pt-2">{ex.instructions}</p>}
                  </details>
                ))}
              </div>
            )}
          </div>

          {/* Talk to coach CTA */}
          <Link href="/athlete/chat" className="block">
            <div className="bg-[#0a1628] rounded-3xl p-5 flex items-center justify-between active:scale-[0.98] transition-transform">
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 rounded-2xl bg-white/10 flex items-center justify-center flex-shrink-0">
                  <MessageCircle className="h-5 w-5 text-[#e4c878]" />
                </div>
                <div>
                  <p className="font-bold text-white text-sm leading-tight">
                    {he ? 'ספר למאמן על הפציעה' : 'Tell your coach about this injury'}
                  </p>
                  <p className="text-xs text-white/50 mt-0.5">
                    {he ? 'נתאים את תוכנית האימונים שלך' : "We'll adapt your training plan"}
                  </p>
                </div>
              </div>
              <ChevronRight className={cn('h-5 w-5 text-white/40 flex-shrink-0', isRTL && 'rotate-180')} />
            </div>
          </Link>

          {/* Disclaimer */}
          <p className="text-[11px] text-gray-400 leading-relaxed flex items-start gap-2 px-1">
            <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
            {he
              ? 'המידע כאן אינו מחליף אבחון רפואי. אם הכאב חד, מחמיר, או נמשך מעבר לשבועיים — פנה לרופא או פיזיותרפיסט.'
              : 'This information does not replace a medical diagnosis. If the pain is sharp, getting worse, or lasts more than two weeks — see a doctor or physiotherapist.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-3xl shadow-sm border border-dashed border-gray-200 p-8 text-center">
          <p className="text-sm text-gray-400">
            {he
              ? 'בחר אזור בגוף כדי לראות פציעות נפוצות ותרגילי מניעה'
              : 'Select a body area to see common injuries and prevention exercises'}
          </p>
        </div>
      )}
    </div>
  )
}
