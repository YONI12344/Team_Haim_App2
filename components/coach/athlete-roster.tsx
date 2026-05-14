'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Search,
  ChevronRight,
  Trophy,
  Calendar,
  Activity,
  Loader2,
  Pencil,
  Trash2,
} from 'lucide-react'
import Link from 'next/link'
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { db } from '@/lib/firebase'
import type { AthleteProfile } from '@/lib/types'
import { useAuth } from '@/contexts/auth-context'
import { isCoachEmail } from '@/lib/constants'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { toast } from 'sonner'

export function AthleteRoster() {
  const { user } = useAuth()
  const isCoach = isCoachEmail(user?.email)

  const [searchQuery, setSearchQuery] = useState('')
  const [athletes, setAthletes] = useState<AthleteProfile[]>([])
  const [loading, setLoading] = useState(true)

  const [editing, setEditing] = useState<AthleteProfile | null>(null)
  const [editName, setEditName] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [saving, setSaving] = useState(false)

  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    const load = async () => {
      setLoading(true)
      try {
        const snap = await getDocs(
          query(collection(db, 'users'), where('role', '==', 'athlete')),
        )
        setAthletes(
          snap.docs.map((d) => {
            const data = d.data()
            return {
              id: d.id,
              userId: data.userId || d.id,
              name: data.name || data.email || 'Athlete',
              email: data.email || '',
              photoURL: data.photoURL,
              dateOfBirth: data.dateOfBirth,
              gender: data.gender,
              height: data.height,
              weight: data.weight,
              events: Array.isArray(data.events) ? data.events : [],
              personalRecords: Array.isArray(data.personalRecords) ? data.personalRecords : [],
              seasonBests: Array.isArray(data.seasonBests) ? data.seasonBests : [],
              trainingPaces: Array.isArray(data.trainingPaces) ? data.trainingPaces : [],
              goals: Array.isArray(data.goals) ? data.goals : [],
              coachId: data.coachId,
              createdAt: data.createdAt?.toDate?.() || new Date(),
              updatedAt: data.updatedAt?.toDate?.() || new Date(),
            }
          }),
        )
      } catch (err) {
        console.error('Error loading athletes:', err)
        setAthletes([])
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const filteredAthletes = athletes.filter(
    (athlete) =>
      athlete.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      athlete.events.some((e) => e.toLowerCase().includes(searchQuery.toLowerCase())),
  )

  const getInitials = (name: string) =>
    name
      .split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || '?'

  const openEdit = (athlete: AthleteProfile) => {
    setEditing(athlete)
    setEditName(athlete.name)
    setEditEmail(athlete.email)
  }

  const handleSave = async () => {
    if (!editing) return
    setSaving(true)
    try {
      await updateDoc(doc(db, 'users', editing.id), {
        name: editName.trim() || editing.name,
        email: editEmail.trim() || editing.email,
        updatedAt: serverTimestamp(),
      })
      setAthletes((prev) =>
        prev.map((a) =>
          a.id === editing.id
            ? { ...a, name: editName.trim() || a.name, email: editEmail.trim() || a.email }
            : a,
        ),
      )
      toast.success('Athlete updated')
      setEditing(null)
    } catch (err) {
      console.error('Error updating athlete:', err)
      toast.error('Failed to update athlete')
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteId) return
    setDeleting(true)
    try {
      await deleteDoc(doc(db, 'users', deleteId))
      setAthletes((prev) => prev.filter((a) => a.id !== deleteId))
      toast.success('Athlete removed from team')
    } catch (err) {
      console.error('Error deleting athlete:', err)
      toast.error('Failed to remove athlete')
    } finally {
      setDeleting(false)
      setDeleteId(null)
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl md:text-3xl font-serif font-bold text-navy">Athletes</h1>
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

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-gold" />
        </div>
      ) : (
        <>
          {/* Athletes Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredAthletes.map((athlete) => (
              <Card key={athlete.id} className="hover:shadow-md transition-luxury h-full">
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
                    {athlete.email && (
                      <p className="text-xs text-muted-foreground">{athlete.email}</p>
                    )}
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
                        {athlete.goals.filter((g) => g.status === 'active').length}
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

                  <Link href={`/coach/athletes/${athlete.id}`} className="block">
                    <Button variant="ghost" className="w-full mt-4 text-gold hover:text-gold/80">
                      View Profile
                      <ChevronRight className="h-4 w-4 ml-1" />
                    </Button>
                  </Link>

                  {isCoach && (
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => openEdit(athlete)}
                      >
                        <Pencil className="h-3.5 w-3.5 mr-1" />
                        Edit
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeleteId(athlete.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" />
                        Remove
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredAthletes.length === 0 && (
            <Card>
              <CardContent className="py-12 text-center">
                <p className="text-muted-foreground">
                  {athletes.length === 0
                    ? 'No athletes have signed up yet.'
                    : 'No athletes found matching your search.'}
                </p>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit athlete</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">Name</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">Email</Label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving}
              className="bg-gold hover:bg-gold/90 text-navy"
            >
              {saving ? 'Saving…' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog
        open={!!deleteId}
        onOpenChange={(open) => !open && setDeleteId(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this athlete?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently deletes the athlete from the team in Firestore.
              Their profile and goals will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Removing…' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
