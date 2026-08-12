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
import { translateTexts } from '@/lib/translate'

function genId(prefix = 'id'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

interface RawExerciseDoc {
  name?: string
  nameEn?: string
  instructionsEn?: string
  videoUrl?: string
  videoPath?: string
  videoMuted?: boolean
  instructions?: string
  defaultSets?: number
  defaultReps?: string
  category?: 'strength' | 'stretch' | 'warmup'
  isTimed?: boolean
  defaultDurationSec?: number
  injuryZones?: string[]
  createdBy?: string
  createdAt?: { toDate?: () => Date }
  updatedAt?: { toDate?: () => Date }
}

function mapExercise(id: string, data: RawExerciseDoc): ExerciseLibraryItem {
  return {
    id,
    name: data.name || 'Exercise',
    nameEn: data.nameEn,
    instructionsEn: data.instructionsEn,
    videoUrl: data.videoUrl,
    videoPath: data.videoPath,
    videoMuted: data.videoMuted,
    instructions: data.instructions,
    defaultSets: data.defaultSets,
    defaultReps: data.defaultReps,
    category: data.category,
    isTimed: data.isTimed,
    defaultDurationSec: data.defaultDurationSec,
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
  options?: { skipAutoTranslate?: boolean },
): Promise<string> {
  const id = exercise.id || genId('exercise')
  const ref = doc(db, 'exerciseLibrary', id)
  const existing = await getDoc(ref)
  await setDoc(
    ref,
    {
      name: exercise.name,
      nameEn: exercise.nameEn ?? existing.data()?.nameEn ?? null,
      instructionsEn: exercise.instructionsEn ?? existing.data()?.instructionsEn ?? null,
      videoUrl: exercise.videoUrl ?? null,
      videoPath: exercise.videoPath ?? null,
      videoMuted: exercise.videoMuted ?? false,
      instructions: exercise.instructions ?? null,
      defaultSets: exercise.defaultSets ?? null,
      defaultReps: exercise.defaultReps ?? null,
      category: exercise.category ?? 'strength',
      isTimed: exercise.isTimed ?? false,
      defaultDurationSec: exercise.defaultDurationSec ?? null,
      injuryZones: exercise.injuryZones ?? [],
      createdBy: exercise.createdBy,
      createdAt: existing.exists() ? existing.data().createdAt : serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )

  // Auto-translate name/instructions to English in the background — never
  // blocks the save, never fails it. Skipped when the caller just hand-
  // edited the En text itself (the review UI), so this doesn't immediately
  // clobber that edit with a fresh AI pass.
  if (!options?.skipAutoTranslate) {
    void translateAndCacheExerciseText(id, exercise.name, exercise.instructions)
  }

  return id
}

async function translateAndCacheExerciseText(id: string, name: string, instructions?: string): Promise<void> {
  try {
    const items = [{ id: 'name', text: name }]
    if (instructions?.trim()) items.push({ id: 'instructions', text: instructions })
    const translated = await translateTexts(items)
    if (!translated.name && !translated.instructions) return
    await setDoc(
      doc(db, 'exerciseLibrary', id),
      {
        ...(translated.name ? { nameEn: translated.name } : {}),
        ...(translated.instructions ? { instructionsEn: translated.instructions } : {}),
      },
      { merge: true },
    )
  } catch (err) {
    console.error('Exercise translation failed:', err)
  }
}

/** Deletes a single video file from Storage — used both when removing an
 *  exercise's video (keeping the exercise) and when replacing it with a
 *  new upload (cleans up the old file instead of leaking it in Storage). */
export async function deleteExerciseVideoFile(videoPath: string): Promise<void> {
  try {
    await deleteObject(ref(storage, videoPath))
  } catch {
    // Already gone (e.g. re-uploaded under a new path before) — don't
    // block the caller over a missing file.
  }
}

export async function deleteExercise(exercise: ExerciseLibraryItem): Promise<void> {
  if (exercise.videoPath) {
    await deleteExerciseVideoFile(exercise.videoPath)
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
