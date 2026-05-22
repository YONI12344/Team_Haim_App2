'use client'

import { useAuth } from '@/contexts/auth-context'
import { AthletePlannerView } from '@/components/athlete/athlete-planner-view'
import { Loader2 } from 'lucide-react'

export default function SchedulePage() {
  const { firebaseUser, loading } = useAuth()
  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <Loader2 className="h-8 w-8 animate-spin text-gold" />
    </div>
  )
  if (!firebaseUser) return null
  return <AthletePlannerView athleteId={firebaseUser.uid} />
}
