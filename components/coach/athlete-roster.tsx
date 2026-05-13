'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { mockAthletes } from '@/lib/mock-data'
import { 
  Search, 
  ChevronRight, 
  Trophy,
  Calendar,
  Activity,
} from 'lucide-react'
import Link from 'next/link'

export function AthleteRoster() {
  const [searchQuery, setSearchQuery] = useState('')
  const athletes = mockAthletes

  const filteredAthletes = athletes.filter(athlete =>
    athlete.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    athlete.events.some(e => e.toLowerCase().includes(searchQuery.toLowerCase()))
  )

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
            Athletes
          </h1>
          <p className="text-muted-foreground">
            Manage your roster and view athlete profiles
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search athletes or events..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Athletes Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredAthletes.map((athlete) => (
          <Link key={athlete.id} href={`/coach/athletes/${athlete.id}`}>
            <Card className="hover:shadow-md transition-luxury cursor-pointer h-full">
              <CardContent className="pt-6">
                <div className="flex flex-col items-center text-center mb-4">
                  <Avatar className="h-16 w-16 mb-3 border-2 border-gold/20">
                    <AvatarImage src={athlete.photoURL} alt={athlete.name} />
                    <AvatarFallback className="bg-gold/10 text-gold text-xl font-serif">
                      {getInitials(athlete.name)}
                    </AvatarFallback>
                  </Avatar>
                  <h3 className="font-serif font-semibold text-navy text-lg">
                    {athlete.name}
                  </h3>
                  <div className="flex flex-wrap justify-center gap-1 mt-2">
                    {athlete.events.map((event) => (
                      <Badge key={event} variant="secondary" className="text-xs">
                        {event}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2 pt-4 border-t border-border">
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                      <Trophy className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-lg font-bold text-navy">
                      {athlete.personalRecords.length}
                    </p>
                    <p className="text-xs text-muted-foreground">PRs</p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                      <Activity className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-lg font-bold text-navy">
                      {athlete.goals.filter(g => g.status === 'active').length}
                    </p>
                    <p className="text-xs text-muted-foreground">Goals</p>
                  </div>
                  <div className="text-center">
                    <div className="flex items-center justify-center gap-1 text-muted-foreground mb-1">
                      <Calendar className="h-3.5 w-3.5" />
                    </div>
                    <p className="text-lg font-bold text-navy">
                      {athlete.trainingPaces.length}
                    </p>
                    <p className="text-xs text-muted-foreground">Paces</p>
                  </div>
                </div>

                <Button variant="ghost" className="w-full mt-4 text-gold hover:text-gold/80">
                  View Profile
                  <ChevronRight className="h-4 w-4 ml-1" />
                </Button>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {filteredAthletes.length === 0 && (
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground">No athletes found matching your search.</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
