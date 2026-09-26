// The TeamHaim brain's knowledge: 18 chapters of The Norwegian Method (facts credited to Marius
// Bakken under source_science; Yoni Haim's own coaching voice under yoni_haim_coaching_philosophy)
// plus the four protocols. Server-only: imported by the coach brain API route, never by the page.

import index from './data/index.json'
import adaptive from './data/protocols/adaptive_progression_protocol.json'
import c1 from './data/chapters/chapter_1.json'
import c2 from './data/chapters/chapter_2.json'
import c3 from './data/chapters/chapter_3.json'
import c4 from './data/chapters/chapter_4.json'
import c5 from './data/chapters/chapter_5.json'
import c6 from './data/chapters/chapter_6.json'
import c7 from './data/chapters/chapter_7.json'
import c8 from './data/chapters/chapter_8.json'
import c9 from './data/chapters/chapter_9.json'
import c10 from './data/chapters/chapter_10.json'
import c11 from './data/chapters/chapter_11.json'
import c12 from './data/chapters/chapter_12.json'
import c13 from './data/chapters/chapter_13.json'
import c14 from './data/chapters/chapter_14.json'
import c15 from './data/chapters/chapter_15.json'
import c16 from './data/chapters/chapter_16.json'
import c17 from './data/chapters/chapter_17.json'
import cFinal from './data/chapters/chapter_final.json'

const CHAPTERS: Record<string, any> = {
  '1': c1, '2': c2, '3': c3, '4': c4, '5': c5, '6': c6, '7': c7, '8': c8, '9': c9, '10': c10,
  '11': c11, '12': c12, '13': c13, '14': c14, '15': c15, '16': c16, '17': c17, final: cFinal,
}

export const ADAPTIVE_PROTOCOL = adaptive

export function chapterIndexText(): string {
  return ((index as any).chapter_index || []).map((r: any) => `${r.chapter}: ${r.short_description}`).join('\n')
}

function findLists(node: unknown, keyPart: string): string[] {
  const found: string[] = []
  if (Array.isArray(node)) node.forEach((x) => found.push(...findLists(x, keyPart)))
  else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k.includes(keyPart) && Array.isArray(v) && v.every((x) => typeof x === 'string')) found.push(...(v as string[]))
      else found.push(...findLists(v, keyPart))
    }
  }
  return found
}

/** Key points only (~500-800 tokens a chapter) -- for questions. */
export function compactChapter(id: string): string {
  const ch = CHAPTERS[id]
  if (!ch) return ''
  const points = findLists(ch.source_science, 'summary_points').slice(0, 10)
  const takeaways = findLists(ch.yoni_haim_coaching_philosophy, 'takeaways').slice(0, 6)
  let out = `\n\n=== Chapter ${id} (key points, credited to Bakken) ===\n` + points.map((p) => `- ${p}`).join('\n')
  if (takeaways.length) out += "\nCoach's takeaways:\n" + takeaways.map((t) => `- ${t}`).join('\n')
  return out
}

/** The full source science of a chapter -- for building plans. */
export function chapterScience(ids: string[]): string {
  return ids.map((id) => CHAPTERS[id]?.source_science
    ? `\n\n=== Chapter ${id} (source science) ===\n${JSON.stringify(CHAPTERS[id].source_science)}` : '').join('')
}

/** Only the chapters this athlete's plan draws on (Chapter 2 is left out: paces are resolved in code). */
export function seasonChapters(planRequest: Record<string, any>, age: number | null): string[] {
  const cat = String(planRequest.category || '')
  const ids = cat.includes('Recreational') || cat.includes('Beginner') ? ['3', '5'] : ['3', '6']
  if (planRequest.double_threshold?.applies) ids.push('7')
  if (cat.includes('Elite')) ids.push('13')
  if (age && age >= 45) ids.push('9')
  return ids
}

/** Cheap keyword routing for questions (no extra model call). */
export function routeChapters(text: string): string[] {
  const t = text.toLowerCase()
  const rules: [RegExp, string][] = [
    [/threshold|golden|lactate|talk test|vdot|pace|heart rate|\bhr\b/, '2'],
    [/easy|week|structure|load|muscle tone|recover/, '3'],
    [/double|two sessions|am\/pm|same day/, '7'],
    [/45\/15|30\/30|short interval/, '8'],
    [/hill|x-session|speed/, '6'],
    [/beginner|recreational|4-6 hours|base/, '5'],
    [/age|older|masters|longevity/, '9'],
    [/strength|gym|injur|achilles|stress fracture/, '10'],
    [/return|comeback|break|layoff|sick|ill/, '11'],
    [/lactate meter|mmol|step test/, '13'],
  ]
  const ids: string[] = []
  for (const [re, id] of rules) if (re.test(t) && !ids.includes(id)) ids.push(id)
  return ids.slice(0, 3)
}
