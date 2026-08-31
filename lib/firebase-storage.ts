import { getStorage } from 'firebase/storage'
import app from '@/lib/firebase'

// Split out of lib/firebase.ts on purpose — see lib/firebase-realtime.ts
// for why. Only the document/photo-upload components that actually
// import this file pull in the Storage SDK.
export const storage = getStorage(app)
