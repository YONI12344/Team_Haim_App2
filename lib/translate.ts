import { doc, setDoc } from 'firebase/firestore'
import { db } from '@/lib/firebase'

// AI-translates a batch of Hebrew coach-authored text fields to English via
// /api/translate, for caching onto the *En fields on Workout/ExerciseLibraryItem/
// StrengthBlockExercise (see lib/types.ts). Best-effort: never throws — a
// translation failure should never block a Hebrew save, it just means the
// English cache stays stale/empty until the next successful save, and
// display code falls back to the Hebrew field either way.
export async function translateTexts(items: { id: string; text: string }[]): Promise<Record<string, string>> {
  const nonEmpty = items.filter((it) => it.text?.trim())
  if (nonEmpty.length === 0) return {}

  try {
    const res = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: nonEmpty }),
    })
    if (!res.ok) return {}
    const data = await res.json()
    const translations: { id: string; text: string }[] = data.translations ?? []
    return Object.fromEntries(translations.map((t) => [t.id, t.text]))
  } catch (err) {
    console.error('translateTexts failed:', err)
    return {}
  }
}

/** Fire-and-forget: translates each `fields` entry (key -> Hebrew text) and
 *  merges the results back onto {collectionName}/{docId} as `${key}En`.
 *  Call this right after a successful save, don't await it in the save
 *  flow — a slow/failed translation should never delay or break the save
 *  itself. Skips keys whose text is empty. */
export async function translateAndCacheFields(
  collectionName: string,
  docId: string,
  fields: Record<string, string | undefined | null>,
): Promise<void> {
  try {
    const items = Object.entries(fields)
      .filter((entry): entry is [string, string] => !!entry[1]?.trim())
      .map(([key, text]) => ({ id: key, text }))
    if (items.length === 0) return

    const translated = await translateTexts(items)
    const update: Record<string, string> = {}
    for (const [key, text] of Object.entries(translated)) {
      if (text) update[`${key}En`] = text
    }
    if (Object.keys(update).length === 0) return

    await setDoc(doc(db, collectionName, docId), update, { merge: true })
  } catch (err) {
    console.error(`translateAndCacheFields failed for ${collectionName}/${docId}:`, err)
  }
}
