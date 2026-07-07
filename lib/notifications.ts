/**
 * SETUP INSTRUCTIONS:
 * 1. Firebase Console → Project Settings → Cloud Messaging
 *    → Generate a Web Push certificate → copy the VAPID key
 *    → Add to Vercel env vars as NEXT_PUBLIC_FIREBASE_VAPID_KEY
 * 2. Firebase Console → Project Settings → Service Accounts
 *    → Generate new private key → download the JSON
 *    → Add values to Vercel env vars:
 *       FIREBASE_ADMIN_PROJECT_ID   (project_id from JSON)
 *       FIREBASE_ADMIN_CLIENT_EMAIL (client_email from JSON)
 *       FIREBASE_ADMIN_PRIVATE_KEY  (private_key from JSON — keep \n as-is)
 */

import { getMessaging, getToken, onMessage } from 'firebase/messaging'
import { doc, setDoc, collection, addDoc, serverTimestamp } from 'firebase/firestore'
// Use the already-initialized app instance directly — calling getApp() via a
// separate import can resolve a second copy of firebase/app under Turbopack,
// which throws "No Firebase App '[DEFAULT]' has been created"
import app, { db } from './firebase'

const VAPID_KEY = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY || ''

export async function requestNotificationPermission(userId: string): Promise<string | null> {
  try {
    if (typeof window === 'undefined') return null
    if (!('Notification' in window)) return null
    if (!('serviceWorker' in navigator)) return null

    const permission = await Notification.requestPermission()
    if (permission !== 'granted') return null

    const registration = await navigator.serviceWorker.register('/firebase-messaging-sw.js')

    const messaging = getMessaging(app)

    const token = await getToken(messaging, {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    })

    if (token) {
      await setDoc(doc(db, 'fcmTokens', userId), {
        token,
        userId,
        updatedAt: serverTimestamp(),
        platform: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ? 'mobile' : 'web',
      })
      return token
    }
    return null
  } catch (error) {
    console.error('Notification permission error:', error)
    return null
  }
}

export function listenForForegroundMessages(onReceive: (payload: any) => void): () => void {
  try {
    const messaging = getMessaging(app)
    return onMessage(messaging, onReceive)
  } catch (error) {
    console.error('Foreground message listener error:', error)
    return () => {}
  }
}

export async function scheduleNotification({
  userId,
  title,
  body,
  scheduledFor,
  type,
  data = {},
}: {
  userId: string
  title: string
  body: string
  scheduledFor: Date
  type: 'morning_workout' | 'evening_reminder' | 'coach_message' | 'workout_complete'
  data?: Record<string, string>
}) {
  await addDoc(collection(db, 'scheduledNotifications'), {
    userId,
    title,
    body,
    scheduledFor,
    type,
    data,
    sent: false,
    createdAt: serverTimestamp(),
  })
}
