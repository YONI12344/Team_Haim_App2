// Application-wide constants

// The single coach account email. Only this account is allowed to create,
// edit and delete workouts, and to manage athletes (matches firestore.rules).
export const COACH_EMAIL = 'info.teamhaim@gmail.com'

export function isCoachEmail(email?: string | null): boolean {
  return !!email && email.toLowerCase() === COACH_EMAIL
}
