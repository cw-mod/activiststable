/** Helpers for matching dozory results onto the Google Sheets «ДОЗОРЫ» roster. */

export type RosterPerson = { name: string; extId: string }

export type SheetRoster = {
  dates: string[]
  roster: RosterPerson[]
  source?: string
}

const ROSTER_KEY = 'dozoryRoster:v1'

/** Layout of «КОНТРОЛЬ ГРОЗА» / [ ДОЗОРЫ ] (0-based CSV columns). */
export const SHEET_COLS = {
  name: 2,
  id: 12,
  score: 15,
  activist: 16,
  firstDate: 17,
  /** columns per day: Active + 3 empty + Passive + 3 empty */
  daySpan: 8,
  activeOffset: 0,
  passiveOffset: 4,
} as const

export function shortDate(date: string): string {
  const m = date.trim().match(/^(\d{1,2})\.(\d{1,2})/)
  if (!m) return date.trim()
  return `${Number(m[1])}.${Number(m[2])}`
}

function isId(s: string): boolean {
  return /^\d{3,}$/.test(s.trim())
}

function looksLikeName(s: string): boolean {
  const t = s.trim()
  if (!t) return false
  if (isId(t)) return false
  if (/^[01]$/.test(t)) return false
  if (/^\d+([.,]\d+)?$/.test(t)) return false
  if (/^(имя|id|общий|балл|активист|активный|пассивный)$/i.test(t)) return false
  return true
}

/** Parse roster from a pasted Google Sheets CSV/TSV export. */
export function parseSheetRoster(text: string): SheetRoster | null {
  const raw = text.replace(/^\uFEFF/, '').trim()
  if (!raw) return null

  const lines = raw.split(/\r?\n/).filter((l) => l.length > 0)
  if (lines.length < 2) return null

  const delim = raw.includes('\t') ? '\t' : ','
  const rows = lines.map((line) => {
    if (delim === '\t') return line.split('\t').map((c) => c.trim())
    // naive CSV split (sheet exports rarely quote names with commas)
    return line.split(',').map((c) => c.replace(/^"|"$/g, '').trim())
  })

  // Dates from header rows (e.g. 16.11)
  const dateRe = /^\d{1,2}\.\d{1,2}$/
  const dates: string[] = []
  const seenDates = new Set<string>()
  for (const row of rows.slice(0, 6)) {
    for (const c of row) {
      const s = shortDate(c)
      if (dateRe.test(s) && !seenDates.has(s)) {
        seenDates.add(s)
        dates.push(s)
      }
    }
  }

  const roster: RosterPerson[] = []
  const seenIds = new Set<string>()

  for (const row of rows) {
    // Prefer fixed column indices when the paste looks like the full sheet
    let name = ''
    let extId = ''
    if (row.length > SHEET_COLS.id) {
      const n = row[SHEET_COLS.name] ?? ''
      const id = row[SHEET_COLS.id] ?? ''
      if (looksLikeName(n) && isId(id)) {
        name = n.trim()
        extId = id.trim()
      }
    }
    if (!extId) {
      // Compact paste: Name \t ID  or  Name [ID]
      for (const c of row) {
        const m = c.match(/^(.+?)\s*\[(\d{3,})\]\s*$/)
        if (m) {
          name = m[1].trim()
          extId = m[2]
          break
        }
      }
    }
    if (!extId) {
      const ids = row.filter(isId)
      const names = row.filter(looksLikeName)
      if (ids.length >= 1 && names.length >= 1) {
        name = names[0]
        extId = ids[0].trim()
      }
    }
    if (!extId || !name || seenIds.has(extId)) continue
    // skip header-ish
    if (/^(имя|id)$/i.test(name)) continue
    seenIds.add(extId)
    roster.push({ name, extId })
  }

  if (roster.length === 0) return null
  return { dates, roster }
}

export function loadRoster(): SheetRoster | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(ROSTER_KEY)
    if (!raw) return null
    const data = JSON.parse(raw) as SheetRoster
    if (!data || !Array.isArray(data.roster) || data.roster.length === 0) return null
    return {
      dates: Array.isArray(data.dates) ? data.dates.map(shortDate) : [],
      roster: data.roster
        .filter((p) => p && typeof p.name === 'string' && typeof p.extId === 'string')
        .map((p) => ({ name: p.name, extId: String(p.extId) })),
      source: data.source,
    }
  } catch {
    return null
  }
}

export function saveRoster(roster: SheetRoster): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(ROSTER_KEY, JSON.stringify(roster))
  } catch {
    /* ignore */
  }
}

export function clearRoster(): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(ROSTER_KEY)
  } catch {
    /* ignore */
  }
}

export type DayHours = Record<string, { active: number; passive: number }>

export type ScorePerson = {
  name: string
  extId: string
  points: number
  byDay: DayHours
  isActivist: boolean
  /** true when this row came from dozory posts but is not on the sheet roster */
  extra?: boolean
  /** true when on roster but no dozory entries matched */
  empty?: boolean
}

/** Merge roster order with dozory scores: same ID → fill date columns. */
export function mergeRosterWithScores(
  roster: RosterPerson[],
  scored: ScorePerson[],
  weekDates: string[]
): { rows: ScorePerson[]; matched: number; unmatchedScores: number; extras: number } {
  const byId = new Map(scored.map((p) => [p.extId, p]))
  const used = new Set<string>()
  const rows: ScorePerson[] = []
  let matched = 0

  for (const r of roster) {
    const hit = byId.get(r.extId)
    if (hit) {
      used.add(r.extId)
      matched++
      rows.push({
        ...hit,
        name: r.name || hit.name,
        extra: false,
        empty: false,
      })
    } else {
      const byDay: DayHours = {}
      for (const d of weekDates) byDay[d] = { active: 0, passive: 0 }
      rows.push({
        name: r.name,
        extId: r.extId,
        points: 0,
        byDay,
        isActivist: false,
        empty: true,
      })
    }
  }

  const extrasList = scored.filter((p) => !used.has(p.extId))
  for (const p of extrasList) {
    rows.push({ ...p, extra: true, empty: false })
  }

  return {
    rows,
    matched,
    unmatchedScores: extrasList.length,
    extras: extrasList.length,
  }
}

function fmtSheet(n: number): string {
  if (n === 0) return ''
  return String(Math.round(n * 100) / 100).replace('.', ',')
}

function dayVal(p: ScorePerson, day: string, kind: 'active' | 'passive'): number {
  const d = p.byDay[day]
  if (!d) return 0
  return kind === 'active' ? d.active : d.passive
}

/** Compact TSV: Name, ID, Score, Activist, then Active/Passive per date. */
export function buildCompactTsv(people: ScorePerson[], dates: string[]): string {
  const r1 = ['Имя CatWar', 'ID', 'Общий балл', 'Активист']
  for (const d of dates) r1.push(d, '')
  const r2 = ['', '', '', '']
  for (const _ of dates) r2.push('Активный', 'Пассивный')
  const body = people.map((p) => {
    const row = [
      p.name,
      p.extId,
      p.points > 0 ? String(Math.round(p.points * 100) / 100).replace('.', ',') : '0',
      p.isActivist ? '1' : '0',
    ]
    for (const d of dates) {
      const a = dayVal(p, d, 'active')
      const s = dayVal(p, d, 'passive')
      row.push(a > 0 ? fmtSheet(a) : '', s > 0 ? fmtSheet(s) : '')
    }
    return row.join('\t')
  })
  return [r1.join('\t'), r2.join('\t'), ...body].join('\n')
}

/**
 * TSV aligned to the real Google Sheets merged layout (paste at A1 or row 5 from col A).
 * Empty cells keep Name → ID → score → activist → date Active/Passive in the right columns.
 */
export function buildAlignedSheetTsv(
  people: ScorePerson[],
  dates: string[],
  opts?: { includeHeader?: boolean; dataOnly?: boolean }
): string {
  const includeHeader = opts?.includeHeader !== false && !opts?.dataOnly
  const lines: string[] = []

  const width =
    SHEET_COLS.firstDate + Math.max(dates.length, 1) * SHEET_COLS.daySpan

  function emptyRow(): string[] {
    return Array.from({ length: width }, () => '')
  }

  if (includeHeader) {
    const h1 = emptyRow()
    h1[SHEET_COLS.name] = 'Имя CatWar'
    h1[SHEET_COLS.id] = 'ID'
    dates.forEach((d, i) => {
      h1[SHEET_COLS.firstDate + i * SHEET_COLS.daySpan] = d
    })
    const h2 = emptyRow()
    dates.forEach((_, i) => {
      const base = SHEET_COLS.firstDate + i * SHEET_COLS.daySpan
      h2[base + SHEET_COLS.activeOffset] = 'Активный'
      h2[base + SHEET_COLS.passiveOffset] = 'Пассивный'
    })
    const h3 = emptyRow()
    h3[SHEET_COLS.score] = 'Общий балл'
    h3[SHEET_COLS.activist] = 'Активист'
    lines.push(h1.join('\t'), h2.join('\t'), h3.join('\t'))
  }

  for (const p of people) {
    if (p.extra) continue // extras don't belong on the fixed roster paste
    const row = emptyRow()
    row[SHEET_COLS.name] = p.name
    row[SHEET_COLS.id] = p.extId
    row[SHEET_COLS.score] =
      p.points > 0 ? String(Math.round(p.points * 100) / 100).replace('.', ',') : '0'
    row[SHEET_COLS.activist] = p.isActivist ? '1' : '0'
    dates.forEach((d, i) => {
      const base = SHEET_COLS.firstDate + i * SHEET_COLS.daySpan
      const a = dayVal(p, d, 'active')
      const s = dayVal(p, d, 'passive')
      row[base + SHEET_COLS.activeOffset] = a > 0 ? fmtSheet(a) : ''
      row[base + SHEET_COLS.passiveOffset] = s > 0 ? fmtSheet(s) : ''
    })
    lines.push(row.join('\t'))
  }

  return lines.join('\n')
}

/**
 * Only date-column values (no Name / ID / score / activist).
 * - compact: Active\tPassive per date (as in the app table)
 * - aligned: same layout as Google Sheets day blocks (Active + 3 empty + Passive + 3 empty)
 *   Paste starting at the first «Активный» cell of the first date (first data row).
 */
export function buildDateColumnsTsv(
  people: ScorePerson[],
  dates: string[],
  mode: 'compact' | 'aligned' = 'compact'
): string {
  return people
    .filter((p) => !p.extra)
    .map((p) => {
      const cells: string[] = []
      for (const d of dates) {
        const a = dayVal(p, d, 'active')
        const s = dayVal(p, d, 'passive')
        if (mode === 'aligned') {
          const block = Array.from({ length: SHEET_COLS.daySpan }, () => '')
          block[SHEET_COLS.activeOffset] = a > 0 ? fmtSheet(a) : ''
          block[SHEET_COLS.passiveOffset] = s > 0 ? fmtSheet(s) : ''
          cells.push(...block)
        } else {
          cells.push(a > 0 ? fmtSheet(a) : '', s > 0 ? fmtSheet(s) : '')
        }
      }
      return cells.join('\t')
    })
    .join('\n')
}
