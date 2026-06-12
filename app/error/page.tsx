'use client'

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { useRouter } from 'next/navigation'

function ErrorContent() {
  const searchParams = useSearchParams()
  const message = searchParams.get('message') || 'Something went wrong'
  const router = useRouter()

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-4">
      <div className="text-center max-w-md">
        <h1 className="text-2xl font-bold text-red-600 mb-4">❌ Error</h1>
        <p className="text-muted-foreground mb-8">{message}</p>
        <Button onClick={() => router.push('/')}>
          Go Back to Login
        </Button>
      </div>
    </div>
  )
}

export default function ErrorPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Loading...</div>}>
      <ErrorContent />
    </Suspense>
  )
}
