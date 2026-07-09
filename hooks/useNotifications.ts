'use client'
import { useEffect, useState } from 'react'
import { requestNotificationPermission, listenForForegroundMessages } from '@/lib/notifications'
import { useAuth } from '@/contexts/auth-context'
import { toast } from 'sonner'

export function useNotifications() {
  const { user } = useAuth()
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [token, setToken] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.id) return
    if (typeof window === 'undefined') return

    if ('Notification' in window) {
      setPermission(Notification.permission)

      // Self-heal: if the browser permission was already granted in the
      // past (the common case — most people already said yes once), the
      // "enable notifications" banner never shows again since it's gated
      // on permission === 'default'. That left no way to recover from the
      // Firestore token write silently failing (e.g. the fcmTokens rules
      // gap). Re-registering here is a safe no-op from the user's POV —
      // Notification.requestPermission() resolves immediately with
      // 'granted' and shows no prompt — but it re-fetches the FCM token
      // and re-writes it to Firestore, quietly fixing a missing/stale
      // token without requiring the user to do anything.
      if (Notification.permission === 'granted') {
        requestNotificationPermission(user.id).catch(() => {})
      }
    }

    const unsubscribe = listenForForegroundMessages((payload) => {
      const body = payload.data?.body || ''
      toast(body, {
        duration: 5000,
        position: 'top-right',
        style: { direction: 'rtl', fontFamily: 'inherit' },
      })
    })

    return unsubscribe
  }, [user?.id])

  const enableNotifications = async () => {
    if (!user?.id) return
    const fcmToken = await requestNotificationPermission(user.id)
    if (fcmToken) {
      setToken(fcmToken)
      setPermission('granted')
    }
  }

  return { permission, token, enableNotifications }
}
