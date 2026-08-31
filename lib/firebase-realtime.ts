import { getDatabase } from 'firebase/database'
import app from '@/lib/firebase'

// Split out of lib/firebase.ts on purpose: that file is imported by
// contexts/auth-context.tsx, which wraps the ENTIRE app in the root
// layout — so anything exported there ships to every single page,
// including ones with no chat feature at all (e.g. /privacy). Only the
// handful of chat components that actually import this file pull in the
// Realtime Database SDK.
export const realtimeDb = getDatabase(app)
