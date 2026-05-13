"use client"

import { useState, useEffect } from "react"
import { ref, onValue, query, orderByChild, limitToLast } from "firebase/database"
import { realtimeDb } from "@/lib/firebase"
import { Card } from "@/components/ui/card"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { MessageSquare, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import Link from "next/link"
import { mockAthletes } from "@/lib/mock-data"

interface ChatPreview {
  odatId: string
  odatName: string
  odatAvatar?: string
  lastMessage?: string
  lastMessageTime?: number
  unreadCount: number
}

interface CoachChatHubProps {
  coachId: string
}

export function CoachChatHub({ coachId }: CoachChatHubProps) {
  const [chatPreviews, setChatPreviews] = useState<ChatPreview[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    // Initialize chat previews with all athletes
    const previews: ChatPreview[] = mockAthletes.map((athlete) => ({
      odatId: athlete.id,
      odatName: athlete.name,
      odatAvatar: athlete.avatar,
      unreadCount: 0,
    }))

    // Listen for chat updates for each athlete
    const unsubscribes: (() => void)[] = []

    mockAthletes.forEach((athlete, index) => {
      const chatId = `coach-${coachId}-athlete-${athlete.id}`
      const messagesRef = ref(realtimeDb, `chats/${chatId}/messages`)
      const messagesQuery = query(messagesRef, orderByChild("timestamp"), limitToLast(1))

      const unsubscribe = onValue(messagesQuery, (snapshot) => {
        const data = snapshot.val()
        if (data) {
          const lastMsg = Object.values(data)[0] as any
          setChatPreviews((prev) => {
            const updated = [...prev]
            const idx = updated.findIndex((p) => p.odatId === athlete.id)
            if (idx !== -1) {
              updated[idx] = {
                ...updated[idx],
                lastMessage: lastMsg.content,
                lastMessageTime: lastMsg.timestamp,
              }
            }
            return updated
          })
        }
      })

      unsubscribes.push(unsubscribe)
    })

    setChatPreviews(previews)
    setIsLoading(false)

    return () => {
      unsubscribes.forEach((unsub) => unsub())
    }
  }, [coachId])

  const filteredPreviews = chatPreviews.filter((chat) =>
    chat.odatName.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const sortedPreviews = [...filteredPreviews].sort((a, b) => {
    if (a.lastMessageTime && b.lastMessageTime) {
      return b.lastMessageTime - a.lastMessageTime
    }
    if (a.lastMessageTime) return -1
    if (b.lastMessageTime) return 1
    return a.odatName.localeCompare(b.odatName)
  })

  const formatTime = (timestamp?: number) => {
    if (!timestamp) return ""
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    } else if (days === 1) {
      return "Yesterday"
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: "short" })
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" })
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Messages</h1>
          <p className="text-muted-foreground">Chat with your athletes</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search athletes..."
            className="pl-10 bg-card border-border"
          />
        </div>
      </div>

      {/* Chat List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <div className="animate-pulse text-muted-foreground">Loading conversations...</div>
        </div>
      ) : sortedPreviews.length === 0 ? (
        <Card className="p-12 text-center bg-card border-border">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
            <MessageSquare className="h-8 w-8 text-primary" />
          </div>
          <h3 className="font-semibold text-foreground mb-1">No conversations found</h3>
          <p className="text-sm text-muted-foreground">
            {searchQuery ? "Try a different search term" : "Start chatting with your athletes"}
          </p>
        </Card>
      ) : (
        <div className="space-y-2">
          {sortedPreviews.map((chat) => (
            <Link key={chat.odatId} href={`/coach/chat/${chat.odatId}`}>
              <Card className="p-4 bg-card border-border hover:bg-accent/50 transition-colors cursor-pointer">
                <div className="flex items-center gap-4">
                  <Avatar className="h-12 w-12 ring-2 ring-primary/20">
                    <AvatarImage src={chat.odatAvatar} />
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                      {chat.odatName.split(" ").map(n => n[0]).join("")}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold text-foreground truncate">{chat.odatName}</h3>
                      {chat.lastMessageTime && (
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatTime(chat.lastMessageTime)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-1">
                      <p className="text-sm text-muted-foreground truncate">
                        {chat.lastMessage || "Start a conversation..."}
                      </p>
                      {chat.unreadCount > 0 && (
                        <Badge className="bg-primary text-primary-foreground text-xs">
                          {chat.unreadCount}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
