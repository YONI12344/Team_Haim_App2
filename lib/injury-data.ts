// Injury Center data: body zones mapped to common running injuries.
// Rehab exercises for each zone come live from the coach's real Exercise
// Library (lib/exercise-library.ts, tagged via ExerciseLibraryItem.injuryZones)
// instead of being hardcoded here — see components/athlete/athlete-injury-view.tsx.

export interface BodyZone {
  id: string
  en: string
  he: string
  /** whether this zone is on the back of the body — kept for a possible
   *  future front/back toggle in the zone picker */
  back?: boolean
  commonInjuriesEn: string[]
  commonInjuriesHe: string[]
}

export const BODY_ZONES: Record<string, BodyZone> = {
  neck: {
    id: 'neck',
    en: 'Neck & Upper Back',
    he: 'צוואר וגב עליון',
    commonInjuriesEn: ['Tension from posture', 'Stiffness after long runs'],
    commonInjuriesHe: ['מתח מיציבה', 'נוקשות אחרי ריצות ארוכות'],
  },
  shoulder: {
    id: 'shoulder',
    en: 'Shoulder',
    he: 'כתף',
    commonInjuriesEn: ['Tightness affecting arm swing'],
    commonInjuriesHe: ['נוקשות שמשפיעה על תנועת הידיים'],
  },
  lowerBack: {
    id: 'lowerBack',
    en: 'Lower Back',
    he: 'גב תחתון',
    back: true,
    commonInjuriesEn: ['Muscle strain', 'Stiffness from weak core'],
    commonInjuriesHe: ['מתיחת שריר', 'נוקשות מליבה חלשה'],
  },
  core: {
    id: 'core',
    en: 'Core & Abdomen',
    he: 'ליבה ובטן',
    commonInjuriesEn: ['Weak core causing form breakdown', 'Side stitch'],
    commonInjuriesHe: ['ליבה חלשה שפוגעת בטכניקה', 'דקירה בצד'],
  },
  hip: {
    id: 'hip',
    en: 'Hip & Hip Flexor',
    he: 'ירך ומכופף הירך',
    commonInjuriesEn: ['Hip flexor strain', 'Hip impingement', 'Tightness from speed work'],
    commonInjuriesHe: ['מתיחת מכופף הירך', 'צביטה בירך', 'נוקשות מאימוני מהירות'],
  },
  glutes: {
    id: 'glutes',
    en: 'Glutes',
    he: 'ישבן',
    back: true,
    commonInjuriesEn: ['Glute weakness', 'Deep gluteal pain (piriformis)'],
    commonInjuriesHe: ['חולשת ישבן', 'כאב עמוק בישבן (פיריפורמיס)'],
  },
  quads: {
    id: 'quads',
    en: 'Quadriceps',
    he: 'ארבע ראשי',
    commonInjuriesEn: ['Quad strain', 'Soreness from downhill running'],
    commonInjuriesHe: ['מתיחה בארבע ראשי', 'כאבים מריצות ירידה'],
  },
  hamstring: {
    id: 'hamstring',
    en: 'Hamstring',
    he: 'המסטרינג',
    back: true,
    commonInjuriesEn: ['Hamstring strain', 'High hamstring tendinopathy'],
    commonInjuriesHe: ['מתיחת המסטרינג', 'דלקת גיד המסטרינג העליון'],
  },
  itband: {
    id: 'itband',
    en: 'IT Band (Outer Thigh)',
    he: 'רצועת ה-IT (ירך חיצונית)',
    commonInjuriesEn: ['IT band syndrome', 'Outer knee pain when running'],
    commonInjuriesHe: ['תסמונת רצועת ה-IT', 'כאב בצד החיצוני של הברך בריצה'],
  },
  knee: {
    id: 'knee',
    en: 'Knee',
    he: 'ברך',
    commonInjuriesEn: ["Runner's knee (patellofemoral pain)", 'Patellar tendinopathy', 'Meniscus irritation'],
    commonInjuriesHe: ['ברך של רצים (כאב פטלופמורלי)', 'דלקת גיד הפיקה', 'גירוי במיניסקוס'],
  },
  shin: {
    id: 'shin',
    en: 'Shin',
    he: 'שוק קדמית',
    commonInjuriesEn: ['Shin splints', 'Stress reaction (see a doctor if sharp pain)'],
    commonInjuriesHe: ['שין ספלינטס', 'תגובת מאמץ (פנה לרופא אם הכאב חד)'],
  },
  calf: {
    id: 'calf',
    en: 'Calf',
    he: 'תאומים',
    back: true,
    commonInjuriesEn: ['Calf strain', 'Cramping late in races', 'Soleus overload'],
    commonInjuriesHe: ['מתיחת תאומים', 'התכווצויות בסוף מרוצים', 'עומס יתר על הסולאוס'],
  },
  achilles: {
    id: 'achilles',
    en: 'Achilles Tendon',
    he: 'גיד אכילס',
    back: true,
    commonInjuriesEn: ['Achilles tendinopathy', 'Morning stiffness in the tendon'],
    commonInjuriesHe: ['דלקת גיד אכילס', 'נוקשות בוקר בגיד'],
  },
  foot: {
    id: 'foot',
    en: 'Foot & Ankle',
    he: 'כף רגל וקרסול',
    commonInjuriesEn: ['Plantar fasciitis', 'Ankle sprain', 'Metatarsal stress (see a doctor if sharp pain)'],
    commonInjuriesHe: ['דורבן / פלנטר פאשיטיס', 'נקע בקרסול', 'עומס במסרקים (פנה לרופא אם הכאב חד)'],
  },
}

export const ZONE_IDS = Object.keys(BODY_ZONES)
