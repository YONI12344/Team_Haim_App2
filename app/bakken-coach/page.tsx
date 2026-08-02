'use client'

import { useState, useRef, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Loader2, Send } from 'lucide-react'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

const OPENER = 'A new athlete has just connected. Begin the autonomous onboarding protocol.'

// Internal test page only — lets us try the standalone Bakken/Almgren
// Norwegian Method AI coach inside the real app shell before deciding
// whether/how to wire it into any athlete-facing flow.
export default function BakkenCoachTestPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [started, setStarted] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = async (history: ChatMessage[]) => {
    setLoading(true)
    try {
      const res = await fetch('/api/bakken-coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: history }),
      })
      const data = await res.json()
      if (data.error) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${data.error}` }])
      } else {
        setMessages((prev) => [...prev, { role: 'assistant', content: data.reply }])
      }
    } catch (err) {
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${String(err)}` }])
    } finally {
      setLoading(false)
    }
  }

  const begin = () => {
    setStarted(true)
    const history: ChatMessage[] = [{ role: 'user', content: OPENER }]
    setMessages(history)
    send(history)
  }

  const handleSend = () => {
    if (!input.trim() || loading) return
    const next: ChatMessage[] = [...messages, { role: 'user', content: input.trim() }]
    setMessages(next)
    setInput('')
    send(next)
  }

  return (
    <div className="min-h-screen bg-background p-4 md:p-8 flex justify-center">
      <Card className="w-full max-w-2xl flex flex-col h-[85vh]">
        <CardHeader>
          <CardTitle>Bakken AI Coach — Test Build</CardTitle>
          <CardDescription>
            Standalone Norwegian Sub-Threshold Method engine, running inside the Team Haim shell for evaluation only. Not connected to athlete data.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex-1 flex flex-col min-h-0">
          {!started ? (
            <div className="flex-1 flex items-center justify-center">
              <Button onClick={begin} size="lg">
                Start Onboarding
              </Button>
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 pr-4 -mr-4">
                <div className="space-y-4 pb-2">
                  {messages.map((m, i) => (
                    <div
                      key={i}
                      className={`rounded-lg px-4 py-3 text-sm whitespace-pre-wrap ${
                        m.role === 'user'
                          ? 'bg-primary text-primary-foreground ml-auto max-w-[85%]'
                          : 'bg-muted mr-auto max-w-[85%]'
                      }`}
                    >
                      {m.content}
                    </div>
                  ))}
                  {loading && (
                    <div className="flex items-center gap-2 text-muted-foreground text-sm">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Coach is thinking...
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              </ScrollArea>
              <div className="flex gap-2 pt-4 border-t mt-4">
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      handleSend()
                    }
                  }}
                  placeholder="Type your reply..."
                  className="resize-none"
                  rows={2}
                  disabled={loading}
                />
                <Button onClick={handleSend} disabled={loading || !input.trim()} size="icon">
                  <Send className="h-4 w-4" />
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
