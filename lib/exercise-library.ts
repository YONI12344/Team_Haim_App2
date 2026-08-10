/**
 * lib/exercise-library.ts
 *
 * Firestore CRUD + Storage upload for the coach-managed exercise library
 * (top-level collection: exerciseLibrary/{id}). Videos live in Firebase
 * Storage under exerciseVideos/{exerciseId}/{fileName} — see storage.rules.
 */

import {
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  deleteDoc,
} from 'firebase/firestore'
import { ref, uploadBytesResumable, getDownloadURL, deleteObject } from 'firebase/storage'
import { db, storage } from '@/lib/firebase'
import type { ExerciseLibraryItem } from '@/lib/types'

function genId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

interface RawExerciseDoc {
  name?: string
  videoUrl?: string
  videoPath?: string
  instructions?: string
  defaultSets?: number
  defaultReps?: string
  injuryZones?: string[]
  createdBy?: string
  createdAt?: { toDate?: () => Date }
  updatedAt?: { toDate?: () => Date }
}

function mapExercise(id: string, data: RawExerciseDoc): ExerciseLibraryItem {
  return {
    id,
    name: data.name || 'Exercise',
    videoUrl: data.videoUrl,
    videoPath: data.videoPath,
    instructions: data.instructions,
    defaultSets: data.defaultSets,
    defaultReps: data.defaultReps,
    injuryZones: data.injuryZones,
    createdBy: data.createdBy || '',
    createdAt: data.createdAt?.toDate?.() || new Date(),
    updatedAt: data.updatedAt?.toDate?.() || new Date(),
  }
}

export async function listExercises(): Promise<ExerciseLibraryItem[]> {
  const col = collection(db, 'exerciseLibrary')
  const snap = await getDocs(query(col, orderBy('name', 'asc')))
  return snap.docs.map((d) => mapExercise(d.id, d.data() as RawExerciseDoc))
}

export async function getExercise(id: string): Promise<ExerciseLibraryItem | null> {
  const snap = await getDoc(doc(db, 'exerciseLibrary', id))
  if (!snap.exists()) return null
  return mapExercise(snap.id, snap.data() as RawExerciseDoc)
}

export async function saveExercise(
  exercise: Omit<ExerciseLibraryItem, 'id' | 'createdAt' | 'updatedAt'> & { id?: string },
): Promise<string> {
  const id = exercise.id || genId('exercise')
  const ref = doc(db, 'exerciseLibrary', id)
  const existing = await getDoc(ref)
  await setDoc(
    ref,
    {
      name: exercise.name,
      videoUrl: exercise.videoUrl ?? null,
      videoPath: exercise.videoPath ?? null,
      instructions: exercise.instructions ?? null,
      defaultSets: exercise.defaultSets ?? null,
      defaultReps: exercise.defaultReps ?? null,
      injuryZones: exercise.injuryZones ?? [],
      createdBy: exercise.createdBy,
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  return id
}

export async function deleteExercise(exercise: ExerciseLibraryItem): Promise<void> {
  if (exercise.videoPath) {
    try {
      await deleteObject(ref(storage, exercise.videoPath))
    } catch {
      // Video may already be gone (e.g. re-uploaded under a new path) —
      // don't block deleting the library entry over a missing file.
    }
  }
  await deleteDoc(doc(db, 'exerciseLibrary', exercise.id))
}

/** Uploads a video for the given exercise id, returns its download URL +
 *  storage path. Call saveExercise afterward with these two fields. */
export async function uploadExerciseVideo(
  exerciseId: string,
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ videoUrl: string; videoPath: string }> {
  const videoPath = `exerciseVideos/${exerciseId}/${Date.now()}_${file.name}`
  const storageRef = ref(storage, videoPath)
  const task = uploadBytesResumable(storageRef, file)
  await new Promise<void>((resolve, reject) => {
    task.on(
      'state_changed',
      (snap) => onProgress?.(Math.round((snap.bytesTransferred / snap.totalBytes) * 100)),
      reject,
      () => resolve(),
    )
  })
  const videoUrl = await getDownloadURL(storageRef)
  return { videoUrl, videoPath }
}
