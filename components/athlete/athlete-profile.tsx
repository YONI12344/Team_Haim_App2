'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { mockAthleteProfile } from '@/lib/mock-data'
import { format } from 'date-fns'
import { 
  User, 
  Calendar, 
  Ruler, 
  Weight, 
  Trophy, 
  Target,
  Clock,
  MapPin,
  Award
} from 'lucide-react'
import { cn } from '@/lib/utils'

const paceTypeColors: Record<string, string> = {
  easy: 'bg-emerald-100 text-emerald-700',
  tempo: 'bg-amber-100 text-amber-700',
  threshold: 'bg-orange-100 text-orange-700',
  interval: 'bg-red-100 text-red-700',
  repetition: 'bg-purple-100 text-purple-700',
  race: 'bg-gold/20 text-gold',
}

export function AthleteProfile() {
  const profile = mockAthleteProfile

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
      <div>
        <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">
          My Profile
        </h1>
        <p className="text-muted-foreground">
          Your athletic profile and training information
        </p>
      </div>

      {/* Profile Card */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col md:flex-row items-start gap-6">
            <Avatar className="w-24 h-24 border-4 border-gold/20">
              <AvatarImage src={profile.photoURL} alt={profile.name} />
              <AvatarFallback className="bg-gold/10 text-gold text-2xl font-serif">
                {getInitials(profile.name)}
              </AvatarFallback>
            </Avatar>

            <div className="flex-1 space-y-4">
              <div>
                <h2 className="text-2xl font-serif font-bold text-navy">
                  {profile.name}
                </h2>
                <p className="text-muted-foreground">{profile.email}</p>
              </div>

              <div className="flex flex-wrap gap-2">
                {profile.events.map((event) => (
                  <Badge key={event} variant="secondary" className="bg-navy/10 text-navy">
                    {event}
                  </Badge>
                ))}
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
                {profile.dateOfBirth && (
                  <div className="flex items-center gap-2 text-sm">
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">
                      {format(new Date(profile.dateOfBirth), 'MMM d, yyyy')}
                    </span>
                  </div>
                )}
                {profile.gender && (
                  <div className="flex items-center gap-2 text-sm">
                    <User className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground capitalize">
                      {profile.gender}
                    </span>
                  </div>
                )}
                {profile.height && (
                  <div className="flex items-center gap-2 text-sm">
                    <Ruler className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{profile.height} cm</span>
                  </div>
                )}
                {profile.weight && (
                  <div className="flex items-center gap-2 text-sm">
                    <Weight className="h-4 w-4 text-muted-foreground" />
                    <span className="text-muted-foreground">{profile.weight} kg</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabs */}
      <Tabs defaultValue="prs" className="space-y-6">
        <TabsList className="grid w-full grid-cols-4 lg:w-auto lg:inline-grid">
          <TabsTrigger value="prs">PRs</TabsTrigger>
          <TabsTrigger value="season">Season Best</TabsTrigger>
          <TabsTrigger value="paces">Paces</TabsTrigger>
          <TabsTrigger value="goals">Goals</TabsTrigger>
        </TabsList>

        {/* Personal Records */}
        <TabsContent value="prs" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Trophy className="h-5 w-5 text-gold" />
                Personal Records
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-2">
                {profile.personalRecords.map((pr) => (
                  <div
                    key={pr.id}
                    className="p-4 rounded-lg border border-border bg-gradient-to-br from-gold/5 to-transparent"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <Badge className="bg-gold/20 text-gold border-gold/30">
                        {pr.event}
                      </Badge>
                      <Award className="h-5 w-5 text-gold" />
                    </div>
                    <p className="text-3xl font-bold text-navy font-mono">
                      {pr.time}
                    </p>
                    <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Calendar className="h-3.5 w-3.5" />
                        {format(new Date(pr.date), 'MMM d, yyyy')}
                      </div>
                      {pr.location && (
                        <div className="flex items-center gap-2">
                          <MapPin className="h-3.5 w-3.5" />
                          {pr.location}
                        </div>
                      )}
                      {pr.competition && (
                        <p className="text-xs mt-1">{pr.competition}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Season Bests */}
        <TabsContent value="season" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-gold" />
                {new Date().getFullYear()} Season Bests
              </CardTitle>
            </CardHeader>
            <CardContent>
              {profile.seasonBests.length > 0 ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {profile.seasonBests.map((sb) => (
                    <div
                      key={sb.id}
                      className="p-4 rounded-lg border border-border"
                    >
                      <div className="flex items-start justify-between mb-2">
                        <Badge variant="outline">{sb.event}</Badge>
                      </div>
                      <p className="text-2xl font-bold text-navy font-mono">
                        {sb.time}
                      </p>
                      <div className="mt-2 text-sm text-muted-foreground">
                        <div className="flex items-center gap-2">
                          <Calendar className="h-3.5 w-3.5" />
                          {format(new Date(sb.date), 'MMM d, yyyy')}
                        </div>
                        {sb.location && (
                          <div className="flex items-center gap-2 mt-1">
                            <MapPin className="h-3.5 w-3.5" />
                            {sb.location}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground text-center py-8">
                  No season bests recorded yet
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Training Paces */}
        <TabsContent value="paces" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-gold" />
                Training Paces
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {profile.trainingPaces.map((pace) => (
                  <div
                    key={pace.id}
                    className="flex items-center justify-between p-4 rounded-lg border border-border"
                  >
                    <div className="flex items-center gap-4">
                      <Badge 
                        className={cn(
                          'capitalize font-medium',
                          paceTypeColors[pace.type] || 'bg-muted'
                        )}
                      >
                        {pace.type}
                      </Badge>
                      <div>
                        <p className="font-mono font-semibold text-navy">
                          {pace.pace}
                        </p>
                        {pace.description && (
                          <p className="text-sm text-muted-foreground">
                            {pace.description}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Goals */}
        <TabsContent value="goals" id="goals" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Target className="h-5 w-5 text-gold" />
                Goals
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {profile.goals.map((goal) => (
                  <div
                    key={goal.id}
                    className={cn(
                      'p-4 rounded-lg border',
                      goal.status === 'active' 
                        ? 'border-gold/30 bg-gold/5' 
                        : goal.status === 'achieved'
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-border bg-muted/30'
                    )}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <h4 className="font-semibold text-navy">
                            {goal.title}
                          </h4>
                          <Badge
                            variant="outline"
                            className={cn(
                              goal.status === 'active' && 'bg-gold/10 text-gold border-gold/30',
                              goal.status === 'achieved' && 'bg-emerald-100 text-emerald-700 border-emerald-200',
                              goal.status === 'archived' && 'bg-muted text-muted-foreground'
                            )}
                          >
                            {goal.status}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
                          {goal.targetEvent && (
                            <span>Event: {goal.targetEvent}</span>
                          )}
                          {goal.targetTime && (
                            <span className="font-mono">Target: {goal.targetTime}</span>
                          )}
                          {goal.targetDate && (
                            <span>By: {format(new Date(goal.targetDate), 'MMM d, yyyy')}</span>
                          )}
                        </div>
                        {goal.notes && (
                          <p className="text-sm text-muted-foreground mt-2">
                            {goal.notes}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
