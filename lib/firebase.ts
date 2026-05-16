import { initializeApp, getApps } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getDatabase } from 'firebase/database'
import { getStorage } from 'firebase/storage'

// Read configuration from NEXT_PUBLIC_* env vars when available, falling back
// to the team-haim project values so local development works out of the box.
const firebaseConfig = {
  apiKey:
    process.env.NEXT_PUBLIC_FIREBASE_API_KEY ||
    'AIzaSyDLbpHzJ2i1Bl5pkI14yjCkah7GK4QVYKs',
  authDomain:
    process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ||
    'team-haim.firebaseapp.com',
  projectId:
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'team-haim',
  storageBucket:
    process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET ||
    'team-haim.firebasestorage.app',
  messagingSenderId:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || '57632152447',
  appId:
    process.env.NEXT_PUBLIC_FIREBASE_APP_ID ||
    '1:57632152447:web:b2109f9fb26f50cc5a584a',
  databaseURL:
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
    'https://team-haim-default-rtdb.firebaseio.com',
}

// Initialize Firebase only once
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

// Auth
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

// Firestore (main database)
export const db = getFirestore(app)

// Realtime Database (for chat)
export const realtimeDb = getDatabase(app)

// Storage (for profile photos & uploaded media)
export const storage = getStorage(app)

export default app
