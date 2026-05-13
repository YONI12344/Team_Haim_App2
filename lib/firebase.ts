import { initializeApp, getApps } from 'firebase/app'
import { getAuth, GoogleAuthProvider } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getDatabase } from 'firebase/database'

const firebaseConfig = {
  apiKey: "AIzaSyDLbpHzJ2i1Bl5pkI14yjCkah7GK4QVYKs",
  authDomain: "team-haim.firebaseapp.com",
  projectId: "team-haim",
  storageBucket: "team-haim.firebasestorage.app",
  messagingSenderId: "57632152447",
  appId: "1:57632152447:web:b2109f9fb26f50cc5a584a",
  databaseURL: "https://team-haim-default-rtdb.firebaseio.com",
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

export default app
