'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { ChevronRight, ChevronLeft } from 'lucide-react'
import { useLanguage } from '@/contexts/language-context'
import { WarmupViewer } from '@/components/athlete/warmup-viewer'

/**
 * Full-page view for a linked routine (warm-up/cooldown/activation) —
 * replaces the old Dialog popup (components/athlete/athlete-planner-view.tsx
 * used to open WarmupViewer inside a <Dialog>). A dialog is too cramped for
 * a video + a scrolling list of exercises; a real page gives it the whole
 * screen instead of fighting a fixed-size box.
 */
export function RoutinePage({ workoutId }: { workoutId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { language } = useLanguage()
  const label = searchParams.get('label')
  const BackIcon = language === 'en' ? ChevronLeft : ChevronRight

  return (
    <div dir={language === 'en' ? 'ltr' : 'rtl'} className="max-w-lg mx-auto px-4 py-4 space-y-3 pb-24">
      <Button variant="ghost" size="sm" onClick={() => router.back()}>
        <BackIcon className="h-4 w-4 mr-1" />{language === 'en' ? 'Back' : 'חזרה'}
      </Button>
      {label && <h1 className="text-lg font-semibold">{label}</h1>}
      <WarmupViewer workoutId={workoutId} />
    </div>
  )
}
