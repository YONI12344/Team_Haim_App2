"use client"

import { useState, useEffect, useRef } from "react"
import { ref, push, onValue, query, orderByChild, limitToLast } from "firebase/database"
import { realtimeDb } from "@/lib/firebase"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Send, ArrowLeft } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { useLanguage } from "@/contexts/language-context"

interface Message {
  id: string
  senderId: string
  senderName: string
  senderAvatar?: string
  content: string
  timestamp: number
}

interface ChatRoomProps {
  chatId: string
  currentUserId: string
  currentUserName: string
  currentUserAvatar?: string
  otherUserName: string
  otherUserAvatar?: string
  backLink: string
}

export function ChatRoom({
  chatId,
  currentUserId,
  currentUserName,
  currentUserAvatar,
  otherUserName,
  otherUserAvatar,
  backLink,
}: ChatRoomProps) {
  const { t } = useLanguage()
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState("")
  const [isLoading, setIsLoading] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const messagesRef = ref(realtimeDb, `conversations/${chatId}/messages`)
    const messagesQuery = query(messagesRef, orderByChild("timestamp"), limitToLast(100))

    const unsubscribe = onValue(messagesQuery, (snapshot) => {
      const data = snapshot.val()
      if (data) {
        const messageList: Message[] = Object.entries(data).map(([id, msg]: [string, any]) => ({
          id,
          ...msg,
        }))
        setMessages(messageList.sort((a, b) => a.timestamp - b.timestamp))
      } else {
        setMessages([])
      }
      setIsLoading(false)
    })

    return () => unsubscribe()
  }, [chatId])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const sendMessage = async () => {
    if (!newMessage.trim()) return

    const messagesRef = ref(realtimeDb, `conversations/${chatId}/messages`)
    await push(messagesRef, {
      senderId: currentUserId,
      senderName: currentUserName,
      senderAvatar: currentUserAvatar || "",
      content: newMessage.trim(),
      timestamp: Date.now(),
    })

    setNewMessage("")
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  }

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp)
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    if (date.toDateString() === today.toDateString()) {
      return t.today
    } else if (date.toDateString() === yesterday.toDateString()) {
      return t.yesterday
    } else {
      return date.toLocaleDateString([], { month: "short", day: "numeric" })
    }
  }

  // Group messages by date
  const groupedMessages: { date: string; messages: Message[] }[] = []
  let currentDate = ""

  messages.forEach((msg) => {
    const msgDate = formatDate(msg.timestamp)
    if (msgDate !== currentDate) {
      currentDate = msgDate
      groupedMessages.push({ date: msgDate, messages: [msg] })
    } else {
      groupedMessages[groupedMessages.length - 1].messages.push(msg)
    }
  })

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <div className="flex items-center gap-4 p-4 border-b border-[#0a1628]/10 bg-white">
        <Link href={backLink}>
          <Button variant="ghost" size="icon" className="text-[#0a1628]/60 hover:text-[#0a1628] hover:bg-[#0a1628]/5 rounded-xl">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <Avatar className="h-10 w-10 ring-2 ring-[#c9a84c]/30">
          <AvatarImage src={otherUserAvatar} />
          <AvatarFallback className="bg-[#0a1628]/10 text-[#0a1628] font-semibold">
            {otherUserName.split(" ").map(n => n[0]).join("")}
          </AvatarFallback>
        </Avatar>
        <div>
          <h2 className="font-semibold text-[#0a1628]">{otherUserName}</h2>
          <p className="text-xs text-gray-400">{t.directMessage}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <div className="animate-pulse text-gray-400">{t.loadingMessages}</div>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className="w-16 h-16 rounded-full bg-[#0a1628]/10 flex items-center justify-center mb-4">
              <Send className="h-8 w-8 text-[#0a1628]" />
            </div>
            <h3 className="font-semibold text-[#0a1628] mb-1">{t.startConversation}</h3>
            <p className="text-sm text-gray-400">
              {t.sendMessageTo} {otherUserName}
            </p>
          </div>
        ) : (
          groupedMessages.map((group, groupIndex) => (
            <div key={groupIndex}>
              <div className="flex items-center justify-center mb-4">
                <span className="px-3 py-1 text-xs font-medium text-gray-400 bg-white border border-gray-100 rounded-full shadow-sm">
                  {group.date}
                </span>
              </div>
              <div className="space-y-3">
                {group.messages.map((message) => {
                  const isOwn = message.senderId === currentUserId
                  return (
                    <div
                      key={message.id}
                      className={cn(
                        "flex items-end gap-2",
                        isOwn ? "justify-end" : "justify-start"
                      )}
                    >
                      {!isOwn && (
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={message.senderAvatar} />
                          <AvatarFallback className="bg-[#c9a84c]/20 text-[#0a1628] text-xs font-semibold">
                            {message.senderName.split(" ").map(n => n[0]).join("")}
                          </AvatarFallback>
                        </Avatar>
                      )}
                      <div
                        className={cn(
                          "max-w-[75%] px-4 py-2.5 rounded-2xl",
                          isOwn
                            ? "bg-[#0a1628] text-white rounded-br-md"
                            : "bg-white border border-gray-100 text-[#0a1628] rounded-bl-md shadow-sm"
                        )}
                      >
                        <p className="text-sm whitespace-pre-wrap break-words">{message.content}</p>
                        <p
                          className={cn(
                            "text-[10px] mt-1",
                            isOwn ? "text-white/60" : "text-gray-400"
                          )}
                        >
                          {formatTime(message.timestamp)}
                        </p>
                      </div>
                      {isOwn && (
                        <Avatar className="h-8 w-8">
                          <AvatarImage src={currentUserAvatar} />
                          <AvatarFallback className="bg-[#0a1628] text-white text-xs">
                            {currentUserName.split(" ").map(n => n[0]).join("")}
                          </AvatarFallback>
                        </Avatar>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-100 bg-white">
        <div className="flex items-center gap-3">
          <Input
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder={t.typeMessage}
            className="flex-1 h-12 bg-gray-50 border-gray-200 rounded-2xl focus:border-[#0a1628]/30 focus:ring-[#0a1628]/10"
          />
          <Button
            onClick={sendMessage}
            disabled={!newMessage.trim()}
            className="h-12 w-12 bg-[#0a1628] hover:bg-[#0a1628]/90 text-white rounded-2xl flex-shrink-0 disabled:opacity-40 p-0"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
