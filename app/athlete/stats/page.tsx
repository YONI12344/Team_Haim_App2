'use client'

import { useState } from 'react'
import { AthleteLayout } from '@/components/athlete/athlete-layout'
import { AthleteStats } from '@/components/athlete/athlete-stats'
import { AthleteJourneyView } from '@/components/athlete/athlete-journey'
import { useLanguage } from '@/contexts/language-context'
import { cn } from '@/lib/utils'

function StatsPageContent() {
  const [activeTab, setActiveTab] = useState<'stats' | 'journey'>('stats')
  const { isRTL } = useLanguage()

  return (
    <div>
      <div className="flex gap-1 p-1 bg-gray-100/80 rounded-2xl mb-4">
        <button
          onClick={() => setActiveTab('stats')}
          className={cn(
            'flex-1 h-10 rounded-xl text-sm font-bold transition-all duration-200',
            activeTab === 'stats'
              ? 'bg-[#0a1628] text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          {isRTL ? 'סטטיסטיקות' : 'Statistics'}
        </button>
        <button
          onClick={() => setActiveTab('journey')}
          className={cn(
            'flex-1 h-10 rounded-xl text-sm font-bold transition-all duration-200',
            activeTab === 'journey'
              ? 'bg-[#0a1628] text-white shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          )}
        >
          {isRTL ? 'מסע' : 'Journey'}
        </button>
      </div>

      {activeTab === 'stats' ? <AthleteStats /> : <AthleteJourneyView />}
    </div>
  )
}

export default function StatsPage() {
  return (
    <AthleteLayout>
      <StatsPageContent />
    </AthleteLayout>
  )
}
