'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { 
  onAuthStateChanged, 
  signInWithPopup, 
  signOut as firebaseSignOut,
  type User as FirebaseUser 
} from 'firebase/auth'
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, googleProvider, db } from '@/lib/firebase'
import type { User, UserRole } from '@/lib/types'

interface AuthContextType {
  user: User | null
  firebaseUser: FirebaseUser | null
  loading: boolean
  signInWithGoogle: () => Promise<void>
  signOut: () => Promise<void>
  updateUserRole: (role: UserRole) => Promise<void>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (fbUser) => {
      setFirebaseUser(fbUser)
      
      if (fbUser) {
        // Fetch or create user profile from Firestore
        const userRef = doc(db, 'users', fbUser.uid)
        const userSnap = await getDoc(userRef)
        
        if (userSnap.exists()) {
          const userData = userSnap.data()
          setUser({
            id: fbUser.uid,
            email: fbUser.email || '',
            name: userData.name || fbUser.displayName || '',
            role: userData.role || 'athlete',
            photoURL: userData.photoURL || fbUser.photoURL || undefined,
            createdAt: userData.createdAt?.toDate() || new Date(),
            updatedAt: userData.updatedAt?.toDate() || new Date(),
          })
        } else {
          // Create new user profile
          const newUser: Omit<User, 'id' | 'createdAt' | 'updatedAt'> & { createdAt: ReturnType<typeof serverTimestamp>, updatedAt: ReturnType<typeof serverTimestamp> } = {
            email: fbUser.email || '',
            name: fbUser.displayName || '',
            role: 'athlete', // Default role
            photoURL: fbUser.photoURL || undefined,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }
          await setDoc(userRef, newUser)
          setUser({
            id: fbUser.uid,
            email: fbUser.email || '',
            name: fbUser.displayName || '',
            role: 'athlete',
            photoURL: fbUser.photoURL || undefined,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
        }
      } else {
        setUser(null)
      }
      
      setLoading(false)
    })

    return () => unsubscribe()
  }, [])

  const signInWithGoogle = async () => {
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (error) {
      console.error('Error signing in with Google:', error)
      throw error
    }
  }

  const signOut = async () => {
    try {
      await firebaseSignOut(auth)
      setUser(null)
    } catch (error) {
      console.error('Error signing out:', error)
      throw error
    }
  }

  const updateUserRole = async (role: UserRole) => {
    if (!firebaseUser) return
    
    const userRef = doc(db, 'users', firebaseUser.uid)
    await setDoc(userRef, { role, updatedAt: serverTimestamp() }, { merge: true })
    
    if (user) {
      setUser({ ...user, role, updatedAt: new Date() })
    }
  }

  return (
    <AuthContext.Provider value={{ user, firebaseUser, loading, signInWithGoogle, signOut, updateUserRole }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
