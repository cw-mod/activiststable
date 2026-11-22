// Client-side storage for activists — replaces the old Prisma/SQLite API.
// GitHub Pages serves static files only, so all data lives in the browser
// (localStorage) with JSON backup/restore for moving between devices.

export type Activist = {
  id: string
  name: string
  extId: string
  categories: string
  createdAt: string
  updatedAt: string
}

const KEY = 'activists:v1'

export type AddResult = { ok: true; activist: Activist } | { ok: false; error: string }

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`
}

function isActivist(x: unknown): x is Activist {
  if (typeof x !== 'object' || x === null) return false
  const a = x as Record<string, unknown>
  return typeof a.id === 'string' && typeof a.name === 'string' && typeof a.extId === 'string' && typeof a.categories === 'string'
}

export function loadActivists(): Activist[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const data: unknown = JSON.parse(raw)
    if (!Array.isArray(data)) return []
    return data.filter(isActivist)
  } catch {
    return []
  }
}

export function saveActivists(list: Activist[]): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list))
  } catch {
    // storage full or blocked — nothing we can do here; UI state stays in memory
  }
}

export function addActivist(name: string, extId: string, categories: string): AddResult {
  const list = loadActivists()
  if (list.some((a) => a.extId === extId)) {
    return { ok: false, error: 'Активист с таким ID уже есть в списке' }
  }
  const now = new Date().toISOString()
  const activist: Activist = { id: newId(), name, extId, categories, createdAt: now, updatedAt: now }
  saveActivists([...list, activist])
  return { ok: true, activist }
}

export type UpdateResult = { ok: boolean; error?: string }

export function updateActivist(
  id: string,
  patch: Partial<Pick<Activist, 'name' | 'extId' | 'categories'>>
): UpdateResult {
  const list = loadActivists()
  const idx = list.findIndex((a) => a.id === id)
  if (idx === -1) return { ok: false, error: 'Активист не найден' }
  const dup = patch.extId ? list.some((a) => a.extId === patch.extId && a.id !== id) : false
  if (dup) return { ok: false, error: 'Активист с таким ID уже есть в списке' }
  list[idx] = { ...list[idx], ...patch, updatedAt: new Date().toISOString() }
  saveActivists(list)
  return { ok: true }
}

export function deleteActivist(id: string): void {
  saveActivists(loadActivists().filter((a) => a.id !== id))
}

export function clearActivists(): void {
  saveActivists([])
}

// --- JSON backup / restore ---

export type BackupFile = { version: number; exportedAt: string; activists: Activist[] }

export function buildBackup(list: Activist[]): BackupFile {
  return { version: 1, exportedAt: new Date().toISOString(), activists: list }
}

export type RestoreResult = { ok: true; restored: number } | { ok: false; error: string }

export function restoreBackup(text: string, mode: 'replace' | 'merge'): RestoreResult {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    return { ok: false, error: 'Файл не читается: это не JSON' }
  }
  const arr =
    Array.isArray(data)
      ? data
      : typeof data === 'object' && data !== null && Array.isArray((data as BackupFile).activists)
        ? (data as BackupFile).activists
        : null
  if (!arr) return { ok: false, error: 'В файле нет массива активистов' }
  const valid = arr.filter(isActivist).map((a) => ({
    ...a,
    id: typeof a.id === 'string' && a.id ? a.id : newId(),
    createdAt: typeof a.createdAt === 'string' ? a.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }))
  if (valid.length === 0) return { ok: false, error: 'В файле нет ни одной корректной записи' }

  if (mode === 'replace') {
    saveActivists(valid)
    return { ok: true, restored: valid.length }
  }
  // merge: skip entries whose extId already exists
  const existing = new Set(loadActivists().map((a) => a.extId))
  const fresh = valid.filter((a) => !existing.has(a.extId))
  saveActivists([...loadActivists(), ...fresh])
  return { ok: true, restored: fresh.length }
}
