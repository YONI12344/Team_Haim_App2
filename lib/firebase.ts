import { initializeApp, getApps } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import {
  initializeFirestore,
  getFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'
// Realtime Database and Storage are intentionally NOT imported here —
// see lib/firebase-realtime.ts / lib/firebase-storage.ts. This file is
// imported by contexts/auth-context.tsx, which wraps the entire app in
// the root layout, so anything pulled in here ships to every page,
// including ones with no chat or upload feature at all.

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
  // The NEXT_PUBLIC_FIREBASE_DATABASE_URL env var is set in Vercel but
  // empty, so this fallback is what's actually in effect everywhere,
  // including production. The Realtime Database instance itself lives in
  // europe-west1 (matching Cloud Functions — see firebase.json), so it
  // MUST use the region-qualified *.firebasedatabase.app host: the plain
  // *.firebaseio.com host silently redirects every single connection
  // through us-central1 first, adding a network hop to every chat
  // read/write and unread-count listener in the app.
  databaseURL:
    process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL ||
    'https://team-haim-default-rtdb.europe-west1.firebasedatabase.app',
}

// Initialize Firebase only once
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

// Auth
export const auth = getAuth(app)
export const googleProvider = new GoogleAuthProvider()

// Firestore (main database) — persistent IndexedDB cache means repeat reads
// (revisiting a page, reloading, switching tabs across the app) are served
// instantly from disk and only the delta syncs over the network, instead of
// every navigation re-fetching everything from Firestore's servers.
// Falls back to the plain (memory-only) client if persistence can't init —
// e.g. private/incognito browsing, or a browser without IndexedDB support.
let firestoreDb
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
} catch (err) {
  console.error('Firestore persistent cache unavailable, falling back to memory cache:', err)
  firestoreDb = getFirestore(app)
}
export const db = firestoreDb

export default app
