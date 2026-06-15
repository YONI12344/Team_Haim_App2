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
    }

    const unsubscribe = listenForForegroundMessages((payload) => {
      const body = payload.notification?.body || ''
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
