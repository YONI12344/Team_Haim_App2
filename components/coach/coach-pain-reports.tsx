'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { HeartPulse, ChevronLeft } from 'lucide-react'
import { areaLabel, listRehabReports } from '@/lib/rehab'
import type { AthleteProfile, RehabReport } from '@/lib/types'
import { PainChip } from '@/components/rehab/pain-scale'

const SIDES: Record<string, string> = { right: 'ימין', left: 'שמאל', both: 'שני הצדדים' }

/** New pain reports from any athlete, each opening that athlete's rehab desk. Renders nothing when there are none. */
export function CoachPainReports({ athletes }: { athletes: Pick<AthleteProfile, 'id' | 'name'>[] }) {
  const [reports, setReports] = useState<RehabReport[]>([])

  useEffect(() => {
    listRehabReports()
      .then(setReports)
      .catch((err) => console.error('Error loading pain reports:', err))
  }, [])

  if (reports.length === 0) return null
  const nameOf = (id: string) => athletes.find((a) => a.id === id)?.name || 'ספורטאי'

  return (
    <section className="overflow-hidden rounded-2xl border-2 border-rust">
      <div className="flex items-center gap-2 bg-rust px-4 py-2.5 text-white">
        <HeartPulse className="h-4 w-4" />
        <p className="text-sm font-bold">דיווחי כאב חדשים ({reports.length})</p>
      </div>
      <ul className="divide-y divide-border bg-card">
        {reports.map((r) => (
          <li key={r.id}>
            <Link href={`/coach/athletes/${r.athleteId}/rehab`} className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40">
              <PainChip value={r.pain} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-navy">{nameOf(r.athleteId)}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {areaLabel(r.areaKey, 'he')}{r.side ? `, ${SIDES[r.side]}` : ''} · {format(r.createdAt, 'd/M HH:mm')}
                </span>
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
