'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { doc, getDoc } from 'firebase/firestore'
import { Eye, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { db } from '@/lib/firebase'
import { cn } from '@/lib/utils'
import { startViewAs } from '@/contexts/view-as-context'

/**
 * Opens the athlete app as this athlete sees it right now (every /athlete
 * screen, their live data) — see contexts/view-as-context.tsx. The coach
 * gets back from the banner at the top of those screens.
 */
export function ViewAsButton({ athleteId, className, label = 'תצוגת ספורטאי: כל העמודים' }: {
  athleteId: string
  className?: string
  label?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)

  const open = async () => {
    setBusy(true)
    try {
      const snap = await getDoc(doc(db, 'users', athleteId))
      const d = snap.data() || {}
      startViewAs({ id: athleteId, name: d.name || d.email || 'ספורטאי', email: d.email || '', photoURL: d.photoURL || undefined })
      router.push('/athlete')
    } catch (err) {
      console.error('Error opening athlete view:', err)
      toast.error('פתיחת תצוגת הספורטאי נכשלה')
      setBusy(false)
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={busy}
      className={cn(
        'inline-flex h-10 items-center justify-center gap-1.5 rounded-md bg-rust px-3 text-sm font-semibold text-stock transition-transform active:scale-[0.98] disabled:opacity-60',
        className,
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
      {label}
    </button>
  )
}
