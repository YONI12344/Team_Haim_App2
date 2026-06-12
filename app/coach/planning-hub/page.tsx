'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function PlanningHubRedirect() {
  const router = useRouter()
  useEffect(() => { router.replace('/coach/workouts?tab=planning') }, [router])
  return null
}
