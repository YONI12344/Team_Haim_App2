import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Splits an exercise's free-text instructions into separate cue lines for
 *  bulleted display, instead of one dense paragraph. Prefers real newlines
 *  (coach entered one cue per line); falls back to splitting on Hebrew/
 *  English sentence-ending periods for older text saved as one paragraph
 *  (e.g. imported cues like "גב ישר. ברך לא נעולה."). */
export function instructionLines(text?: string | null): string[] {
  if (!text) return []
  const byNewline = text.split('\n').map((l) => l.trim()).filter(Boolean)
  if (byNewline.length > 1) return byNewline
  return text
    .split(/(?<=[.!?])\s+/)
    .map((l) => l.trim())
    .filter(Boolean)
}
