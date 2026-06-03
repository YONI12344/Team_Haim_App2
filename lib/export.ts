/**
 * lib/export.ts
 *
 * Client-side Excel (.xlsx) export for Team Haim.
 * Uses xlsx-js-style (SheetJS fork with cell styling) to produce a
 * professionally styled workbook:
 *   – Title row  : "TEAM HAIM" in serif, navy, 18pt bold, merged across columns
 *   – Subtitle   : sheet name, 11pt italic muted
 *   – Blank row  : breathing room
 *   – Header row : navy bg, white bold 11pt, gold bottom border
 *   – Data rows  : alternating white / warm-cream, 10pt navy
 *   – Freeze 4 rows; auto-size column widths; tab colors navy/gold/coral
 *
 * All Firestore reads are passed in as pre-loaded data so this module stays
 * free of async side-effects and is fully testable.
 */

// xlsx-js-style re-exports the SheetJS XLSX object with style support baked in.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const XLSX = require('xlsx-js-style')

// ─── Brand tokens ─────────────────────────────────────────────────────────────
const NAVY = '#1A2748'
const WHITE = '#FFFFFF'
const GOLD = '#C9A961'
const CREAM = '#F8F6F0'
const GRAY_MID = '#6B7280'
const CORAL = '#E8826B'

// Tab colors per sheet category
const TAB_NAVY = NAVY
const TAB_GOLD = GOLD
const TAB_CORAL = CORAL

// ─── Type shims ───────────────────────────────────────────────────────────────

export interface ExportAthleteData {
  name: string
  email: string
  dateOfBirth?: string
  gender?: string
  height?: number
  weight?: number
  discipline?: string[]
  events?: string[]
  experienceLevel?: string
  weeklyMileage?: number
  restingHR?: number
  maxHR?: number
  goalRaceEvent?: string
  goalRaceDate?: string
  goalRaceTarget?: string
  personalRecords?: PRRow[]
  seasonBests?: PRRow[]
  trainingPaces?: PaceRow[]
  goals?: GoalRow[]
  workoutLogs?: LogRow[]
  assignedWorkouts?: ScheduleRow[]
  journeyStages?: JourneyRow[]
}

export interface PRRow {
  event: string
  time: string
  date?: string
  location?: string
  competition?: string
}

export interface PaceRow {
  type: string
  pace: string
  description?: string
}

export interface GoalRow {
  title: string
  targetEvent?: string
  targetTime?: string
  targetDate?: string
  status: string
  notes?: string
}

export interface LogRow {
  date: string
  workoutTitle: string
  distance?: number
  pace?: string
  effort?: number
  comment?: string
}

export interface ScheduleRow {
  date: string
  workoutTitle: string
  type?: string
  status: string
  duration?: number
  distance?: number
  coachFeedback?: string
}

export interface JourneyRow {
  stageName: string
  type: string
  startDate: string
  endDate: string
  focus: string
  weeklyVolumeKm?: number
  keyWorkouts?: string
  milestones?: string
}

// ─── Cell helpers ─────────────────────────────────────────────────────────────

type CellStyle = {
  font?: Record<string, unknown>
  fill?: Record<string, unknown>
  alignment?: Record<string, unknown>
  border?: Record<string, unknown>
}

function cell(value: string | number | null | undefined, style: CellStyle = {}) {
  const v = value == null ? '' : value
  return { v, t: typeof v === 'number' ? 'n' : 's', s: style }
}

const titleStyle: CellStyle = {
  font: { name: 'Georgia', sz: 18, bold: true, color: { rgb: NAVY.replace('#', '') } },
  alignment: { horizontal: 'center', vertical: 'center' },
  fill: { fgColor: { rgb: 'FFFFFF' } },
  border: { bottom: { style: 'medium', color: { rgb: GOLD.replace('#', '') } } },
}

const subtitleStyle: CellStyle = {
  font: { name: 'Calibri', sz: 11, italic: true, color: { rgb: GRAY_MID.replace('#', '') } },
  alignment: { horizontal: 'center', vertical: 'center' },
  fill: { fgColor: { rgb: 'FFFFFF' } },
}

const headerStyle: CellStyle = {
  font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
  fill: { fgColor: { rgb: NAVY.replace('#', '') } },
  alignment: { horizontal: 'center', vertical: 'center' },
  border: { bottom: { style: 'thin', color: { rgb: GOLD.replace('#', '') } } },
}

function dataStyle(rowIndex: number): CellStyle {
  const bg = rowIndex % 2 === 0 ? 'FFFFFF' : CREAM.replace('#', '')
  return {
    font: { name: 'Calibri', sz: 10, color: { rgb: NAVY.replace('#', '') } },
    fill: { fgColor: { rgb: bg } },
    alignment: { horizontal: 'left', vertical: 'center', wrapText: false },
  }
}

// ─── Sheet builder ─────────────────────────────────────────────────────────────

/**
 * Build a single styled sheet from a headers array + data rows.
 * The first 4 rows are: title, subtitle, blank, header. Data starts at row 5.
 */
function buildSheet(opts: {
  title: string         // e.g. "TEAM HAIM"
  subtitle: string      // e.g. "Personal Records"
  headers: string[]
  rows: (string | number | null | undefined)[][]
}) {
  const { title, subtitle, headers, rows } = opts
  const ncols = headers.length
  const ws: Record<string, unknown> = {}
  let maxRow = 0

  // Helper to write a cell reference
  const addr = (r: number, c: number) => XLSX.utils.encode_cell({ r, c })

  // Row 0 (1-indexed row 1): title
  ws[addr(0, 0)] = cell(title, titleStyle)
  for (let c = 1; c < ncols; c++) {
    ws[addr(0, c)] = cell('', { ...titleStyle })
  }

  // Row 1: subtitle
  ws[addr(1, 0)] = cell(subtitle, subtitleStyle)
  for (let c = 1; c < ncols; c++) {
    ws[addr(1, c)] = cell('', subtitleStyle)
  }

  // Row 2: blank
  for (let c = 0; c < ncols; c++) {
    ws[addr(2, c)] = cell('', {})
  }

  // Row 3: headers
  headers.forEach((h, c) => {
    ws[addr(3, c)] = cell(h, headerStyle)
  })

  // Rows 4+: data
  rows.forEach((row, ri) => {
    const style = dataStyle(ri)
    headers.forEach((_, c) => {
      const val = row[c] ?? ''
      ws[addr(4 + ri, c)] = cell(val, style)
    })
    maxRow = 4 + ri
  })

  if (rows.length === 0) {
    // write an empty row so the sheet is valid
    headers.forEach((_, c) => {
      ws[addr(4, c)] = cell('', dataStyle(0))
    })
    maxRow = 4
  }

  // !ref
  ws['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: maxRow, c: ncols - 1 } })

  // Merge title + subtitle rows across all columns
  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: ncols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: ncols - 1 } },
    { s: { r: 2, c: 0 }, e: { r: 2, c: ncols - 1 } },
  ]

  // Freeze top 4 rows
  ws['!freeze'] = { xSplit: 0, ySplit: 4 }

  // Column widths: measure longest value, cap at 40
  const colWidths = headers.map((h, c) => {
    let max = h.length
    rows.forEach((row) => {
      const v = String(row[c] ?? '')
      if (v.length > max) max = v.length
    })
    return { wch: Math.min(max + 2, 40) }
  })
  ws['!cols'] = colWidths

  // Row heights: title row taller
  ws['!rows'] = [
    { hpt: 28 },  // row 1 title
    { hpt: 18 },  // row 2 subtitle
    { hpt: 8 },   // row 3 blank
    { hpt: 22 },  // row 4 header
  ]

  return ws
}

// ─── Per-athlete workbook ──────────────────────────────────────────────────────

export function buildAthleteWorkbook(data: ExportAthleteData): unknown {
  const wb = XLSX.utils.book_new()
  const teamTitle = 'TEAM HAIM'

  // Helper to append a sheet
  const addSheet = (name: string, ws: unknown, tabColor: string) => {
    XLSX.utils.book_append_sheet(wb, ws, name)
    // Tab color
    const sheet = wb.Sheets[name] as Record<string, unknown>
    if (sheet) {
      sheet['!tabcolor'] = { rgb: tabColor.replace('#', '') }
    }
  }

  // 1. Profile
  const profileHeaders = [
    'Field', 'Value',
  ]
  const profileRows: (string | number | null | undefined)[][] = [
    ['Name', data.name || ''],
    ['Email', data.email || ''],
    ['Date of Birth', data.dateOfBirth || ''],
    ['Gender', data.gender || ''],
    ['Height (cm)', data.height ?? ''],
    ['Weight (kg)', data.weight ?? ''],
    ['Discipline', (data.discipline || []).join(', ')],
    ['Events', (data.events || []).join(', ')],
    ['Experience Level', data.experienceLevel || ''],
    ['Weekly Mileage (km)', data.weeklyMileage ?? ''],
    ['Resting HR (bpm)', data.restingHR ?? ''],
    ['Max HR (bpm)', data.maxHR ?? ''],
    ['Goal Race Event', data.goalRaceEvent || ''],
    ['Goal Race Date', data.goalRaceDate || ''],
    ['Goal Race Target', data.goalRaceTarget || ''],
  ]
  addSheet('Profile', buildSheet({
    title: teamTitle,
    subtitle: 'Athlete Profile',
    headers: profileHeaders,
    rows: profileRows,
  }), TAB_NAVY)

  // 2. Personal Records
  addSheet('Personal Records', buildSheet({
    title: teamTitle,
    subtitle: 'Personal Records',
    headers: ['Event', 'Time', 'Date', 'Location', 'Competition'],
    rows: (data.personalRecords || []).map((r) => [
      r.event, r.time, r.date || '', r.location || '', r.competition || '',
    ]),
  }), TAB_GOLD)

  // 3. Season Bests
  addSheet('Season Bests', buildSheet({
    title: teamTitle,
    subtitle: 'Season Bests',
    headers: ['Event', 'Time', 'Date', 'Location'],
    rows: (data.seasonBests || []).map((r) => [
      r.event, r.time, r.date || '', r.location || '',
    ]),
  }), TAB_GOLD)

  // 4. Training Paces
  addSheet('Training Paces', buildSheet({
    title: teamTitle,
    subtitle: 'Training Paces',
    headers: ['Type', 'Pace', 'Description'],
    rows: (data.trainingPaces || []).map((r) => [
      r.type, r.pace, r.description || '',
    ]),
  }), TAB_GOLD)

  // 5. Goals
  addSheet('Goals', buildSheet({
    title: teamTitle,
    subtitle: 'Goals',
    headers: ['Title', 'Target Event', 'Target Time', 'Target Date', 'Status', 'Notes'],
    rows: (data.goals || []).map((r) => [
      r.title, r.targetEvent || '', r.targetTime || '',
      r.targetDate || '', r.status, r.notes || '',
    ]),
  }), TAB_GOLD)

  // 6. Workout Logs
  addSheet('Workout Logs', buildSheet({
    title: teamTitle,
    subtitle: 'Workout Logs',
    headers: ['Date', 'Workout', 'Distance (km)', 'Pace', 'Effort (1-10)', 'Comment'],
    rows: (data.workoutLogs || []).map((r) => [
      r.date, r.workoutTitle, r.distance ?? '', r.pace || '',
      r.effort ?? '', r.comment || '',
    ]),
  }), TAB_CORAL)

  // 7. Schedule
  addSheet('Schedule', buildSheet({
    title: teamTitle,
    subtitle: 'Assigned Workout Schedule',
    headers: ['Date', 'Workout', 'Type', 'Status', 'Duration (min)', 'Distance (km)', 'Coach Feedback'],
    rows: (data.assignedWorkouts || []).map((r) => [
      r.date, r.workoutTitle, r.type || '', r.status,
      r.duration ?? '', r.distance ?? '', r.coachFeedback || '',
    ]),
  }), TAB_CORAL)

  // 8. Season Journey
  addSheet('Season Journey', buildSheet({
    title: teamTitle,
    subtitle: 'Season Journey',
    headers: ['Stage', 'Type', 'Start Date', 'End Date', 'Focus', 'Weekly Volume (km)', 'Key Workouts', 'Milestones'],
    rows: (data.journeyStages || []).map((r) => [
      r.stageName, r.type, r.startDate, r.endDate,
      r.focus, r.weeklyVolumeKm ?? '', r.keyWorkouts || '', r.milestones || '',
    ]),
  }), TAB_CORAL)

  return wb
}

// ─── All-athletes workbook ─────────────────────────────────────────────────────

export interface AllAthletesExportData {
  athletes: ExportAthleteData[]
}

export function buildAllAthletesWorkbook(data: AllAthletesExportData): unknown {
  const wb = XLSX.utils.book_new()
  const teamTitle = 'TEAM HAIM'
  const all = data.athletes

  const addSheet = (name: string, ws: unknown, tabColor: string) => {
    XLSX.utils.book_append_sheet(wb, ws, name)
    const sheet = wb.Sheets[name] as Record<string, unknown>
    if (sheet) sheet['!tabcolor'] = { rgb: tabColor.replace('#', '') }
  }

  // 1. Athletes Summary
  addSheet('Athletes Summary', buildSheet({
    title: teamTitle,
    subtitle: 'Athletes Summary',
    headers: ['Name', 'Email', 'Discipline', 'Level', 'Weekly Mileage (km)', '# PRs', '# Goals', 'Goal Race', 'Goal Race Date'],
    rows: all.map((a) => [
      a.name, a.email,
      (a.discipline || []).join(', '),
      a.experienceLevel || '',
      a.weeklyMileage ?? '',
      (a.personalRecords || []).length,
      (a.goals || []).length,
      a.goalRaceEvent || '',
      a.goalRaceDate || '',
    ]),
  }), TAB_NAVY)

  // 2. All PRs
  addSheet('All PRs', buildSheet({
    title: teamTitle,
    subtitle: 'All Personal Records',
    headers: ['Athlete', 'Event', 'Time', 'Date', 'Location'],
    rows: all.flatMap((a) =>
      (a.personalRecords || []).map((r) => [a.name, r.event, r.time, r.date || '', r.location || ''])
    ),
  }), TAB_GOLD)

  // 3. All Season Bests
  addSheet('All Season Bests', buildSheet({
    title: teamTitle,
    subtitle: 'All Season Bests',
    headers: ['Athlete', 'Event', 'Time', 'Date', 'Location'],
    rows: all.flatMap((a) =>
      (a.seasonBests || []).map((r) => [a.name, r.event, r.time, r.date || '', r.location || ''])
    ),
  }), TAB_GOLD)

  // 4. All Workout Logs
  addSheet('All Workout Logs', buildSheet({
    title: teamTitle,
    subtitle: 'All Workout Logs',
    headers: ['Athlete', 'Date', 'Workout', 'Distance (km)', 'Pace', 'Effort', 'Comment'],
    rows: all.flatMap((a) =>
      (a.workoutLogs || []).map((r) => [
        a.name, r.date, r.workoutTitle, r.distance ?? '', r.pace || '', r.effort ?? '', r.comment || '',
      ])
    ),
  }), TAB_CORAL)

  // 5. All Schedules
  addSheet('All Schedules', buildSheet({
    title: teamTitle,
    subtitle: 'All Scheduled Workouts',
    headers: ['Athlete', 'Date', 'Workout', 'Status', 'Duration (min)', 'Distance (km)'],
    rows: all.flatMap((a) =>
      (a.assignedWorkouts || []).map((r) => [
        a.name, r.date, r.workoutTitle, r.status, r.duration ?? '', r.distance ?? '',
      ])
    ),
  }), TAB_CORAL)

  // 6. All Goals
  addSheet('All Goals', buildSheet({
    title: teamTitle,
    subtitle: 'All Goals',
    headers: ['Athlete', 'Title', 'Target Event', 'Target Time', 'Target Date', 'Status'],
    rows: all.flatMap((a) =>
      (a.goals || []).map((r) => [
        a.name, r.title, r.targetEvent || '', r.targetTime || '', r.targetDate || '', r.status,
      ])
    ),
  }), TAB_GOLD)

  // 7. All Journeys
  addSheet('All Journeys', buildSheet({
    title: teamTitle,
    subtitle: 'All Season Journeys',
    headers: ['Athlete', 'Stage', 'Type', 'Start Date', 'End Date', 'Focus'],
    rows: all.flatMap((a) =>
      (a.journeyStages || []).map((r) => [
        a.name, r.stageName, r.type, r.startDate, r.endDate, r.focus,
      ])
    ),
  }), TAB_CORAL)

  return wb
}

// ─── Workbook properties ───────────────────────────────────────────────────────

export function setWorkbookProperties(wb: unknown, athleteName: string) {
  const w = wb as Record<string, unknown>
  w.Props = {
    Title: `Team Haim — ${athleteName}`,
    Author: 'Team Haim App',
    Company: 'Team Haim',
    CreatedDate: new Date(),
  }
}

// ─── Download helper ───────────────────────────────────────────────────────────

export function downloadWorkbook(wb: unknown, filename: string) {
  const safeFilename = filename
    .replace(/\s+/g, '_')
    .replace(/[^a-zA-Z0-9._-]/g, '')

  const wbout: ArrayBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeFilename.endsWith('.xlsx') ? safeFilename : `${safeFilename}.xlsx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// ─── Filename helpers ──────────────────────────────────────────────────────────

export function athleteFilename(athleteName: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const safe = (athleteName || 'athlete').replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, '')
  return `team-haim_${safe}_${date}.xlsx`
}

export function allAthletesFilename(): string {
  const date = new Date().toISOString().slice(0, 10)
  return `team-haim_all-athletes_${date}.xlsx`
}
