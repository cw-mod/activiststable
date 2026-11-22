'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import { loadActivists, updateActivist } from '@/lib/store'
import { DEFAULT_DOZORY_ROSTER } from '@/lib/dozory-roster.default'
import {
  buildAlignedSheetTsv,
  buildCompactTsv,
  clearRoster,
  loadRoster,
  mergeRosterWithScores,
  parseSheetRoster,
  saveRoster,
  shortDate as sheetShortDate,
  type ScorePerson,
  type SheetRoster,
} from '@/lib/dozory-sheet'
import {
  AlertTriangle,
  ChevronDown,
  ClipboardPaste,
  Coins,
  Copy,
  Eraser,
  Link2,
  ListChecks,
  ScrollText,
  Sheet,
  Timer,
  UserCheck,
  UserRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const ACTIVISTS_CHANGED = 'activists:changed'

const PASSIVE_RATE = 1
const ACTIVE_RATE = 1.5

type WatchKind = 'passive' | 'active'

type WatchEntry = {
  kind: WatchKind
  date: string
  name: string
  extId: string
  hours: number
  points: number
  sector: string
  warning: string | null
}

/** hours by shortDate → kind */
type DayHours = Record<string, { active: number; passive: number }>

type Person = {
  name: string
  extId: string
  passiveHours: number
  activeHours: number
  hours: number
  points: number
  entries: WatchEntry[]
  byDay: DayHours
  isActivist: boolean
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function fmt(n: number): string {
  return round2(n).toLocaleString('ru-RU', { maximumFractionDigits: 2 })
}

function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n)
  if (!Number.isInteger(abs)) return few
  const i = abs % 100
  const j = abs % 10
  if (i > 10 && i < 20) return many
  if (j === 1) return one
  if (j >= 2 && j <= 4) return few
  return many
}

function hoursWord(n: number): string {
  return plural(n, 'час', 'часа', 'часов')
}

function pointsWord(n: number): string {
  return plural(n, 'балл', 'балла', 'баллов')
}

/** "16.11.26" / "16.11.2026" → "16.11" */
function shortDate(date: string): string {
  const m = date.trim().match(/^(\d{1,2})\.(\d{1,2})/)
  if (!m) return date
  return `${Number(m[1])}.${Number(m[2])}`
}

function dateSortKey(date: string): number {
  const m = date.trim().match(/^(\d{1,2})\.(\d{1,2})(?:\.(\d{2,4}))?/)
  if (!m) return 0
  const d = Number(m[1])
  const mo = Number(m[2])
  let y = m[3] ? Number(m[3]) : 0
  if (y > 0 && y < 100) y += 2000
  return y * 10000 + mo * 100 + d
}

function cleanText(s: string): string {
  return s
    .replace(/[\u3164\u200b\u00a0\u200e\u200f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseDeclaredDuration(s: string): number | null {
  const t = cleanText(s).toLowerCase()
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(ч|час\w*|мин\w*)/)
  if (!m) return null
  const n = Number.parseFloat(m[1].replace(',', '.'))
  if (!Number.isFinite(n) || n < 0) return null
  if (m[2].startsWith('мин')) return round2(n / 60)
  return n
}

function timeRangeHours(sh: number, sm: number, eh: number, em: number): number {
  let minutes = eh * 60 + em - (sh * 60 + sm)
  if (minutes < 0) minutes += 24 * 60
  return round2(minutes / 60)
}

function parseDozory(text: string): { entries: WatchEntry[]; skipped: number } {
  const entries: WatchEntry[] = []
  let skipped = 0
  if (!text.trim()) return { entries, skipped }

  const chunks = text.split(/(?=(?:пассивный|активный)\s*дозор)/i)
  for (const chunk of chunks) {
    const titleM = chunk.match(
      /(пассивный|активный)\s*дозор\s*\[\s*(\d{1,2}\.\d{1,2}\.\d{2,4})\s*\]/i
    )
    if (!titleM) continue
    const kind: WatchKind = titleM[1].toLowerCase().startsWith('пасс') ? 'passive' : 'active'
    const date = titleM[2]

    const dosM = chunk.match(/Дозорный:\s*([^\n]+)/i)
    if (!dosM) {
      skipped++
      continue
    }
    const dosLine = cleanText(dosM[1])
    const idMatches = Array.from(dosLine.matchAll(/\d{2,}/g))
    if (idMatches.length === 0) {
      skipped++
      continue
    }
    const last = idMatches[idMatches.length - 1]
    const extId = last[0]
    const name = dosLine
      .slice(0, last.index ?? 0)
      .replace(/[[\]()]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!name) {
      skipped++
      continue
    }

    const sectorM = chunk.match(/Сектор:\s*([^\n]+)/i)
    const sector = sectorM ? cleanText(sectorM[1]) : ''

    const timeM = chunk.match(/Время:\s*(\d{1,2}):(\d{2})\s*[—–-]\s*(\d{1,2}):(\d{2})/i)
    const declaredM = chunk.match(/Общее время:\s*([^\n]+)/i)
    const declared = declaredM ? parseDeclaredDuration(declaredM[1]) : null
    const computed = timeM
      ? timeRangeHours(Number(timeM[1]), Number(timeM[2]), Number(timeM[3]), Number(timeM[4]))
      : null

    let hours: number
    let warning: string | null = null
    if (declared != null) {
      hours = declared
      if (computed != null && Math.abs(declared - computed) > 0.05) {
        warning = `заявлено ${fmt(declared)} ${hoursWord(declared)}, а по «Время» выходит ${fmt(computed)} ${hoursWord(computed)}`
      }
    } else if (computed != null) {
      hours = computed
    } else {
      skipped++
      continue
    }

    entries.push({
      kind,
      date,
      name,
      extId,
      hours,
      points: round2(hours * (kind === 'passive' ? PASSIVE_RATE : ACTIVE_RATE)),
      sector,
      warning,
    })
  }
  return { entries, skipped }
}

function collectDates(entries: WatchEntry[]): string[] {
  const set = new Map<string, string>() // short → first raw
  for (const e of entries) {
    const s = shortDate(e.date)
    if (!set.has(s)) set.set(s, e.date)
  }
  return Array.from(set.entries())
    .sort((a, b) => dateSortKey(a[1]) - dateSortKey(b[1]))
    .map(([short]) => short)
}

function aggregate(entries: WatchEntry[], activistIds: Set<string>): Person[] {
  const map = new Map<string, Person>()
  for (const e of entries) {
    let p = map.get(e.extId)
    if (!p) {
      p = {
        name: e.name,
        extId: e.extId,
        passiveHours: 0,
        activeHours: 0,
        hours: 0,
        points: 0,
        entries: [],
        byDay: {},
        isActivist: activistIds.has(e.extId),
      }
      map.set(e.extId, p)
    }
    if (e.kind === 'passive') p.passiveHours = round2(p.passiveHours + e.hours)
    else p.activeHours = round2(p.activeHours + e.hours)
    p.hours = round2(p.passiveHours + p.activeHours)
    p.points = round2(p.points + e.points)
    p.entries.push(e)

    const day = shortDate(e.date)
    if (!p.byDay[day]) p.byDay[day] = { active: 0, passive: 0 }
    if (e.kind === 'active') p.byDay[day].active = round2(p.byDay[day].active + e.hours)
    else p.byDay[day].passive = round2(p.byDay[day].passive + e.hours)
  }
  return Array.from(map.values())
}

function dayCell(p: Person, day: string, kind: WatchKind): number {
  const d = p.byDay[day]
  if (!d) return 0
  return kind === 'active' ? d.active : d.passive
}

function toScorePerson(p: Person): ScorePerson {
  return {
    name: p.name,
    extId: p.extId,
    points: p.points,
    byDay: p.byDay,
    isActivist: p.isActivist,
  }
}

function buildReport(people: Person[], dates: string[]): string {
  const lines = people.map((p) => {
    const parts: string[] = []
    if (p.passiveHours > 0) parts.push(`пассив ${fmt(p.passiveHours)}`)
    if (p.activeHours > 0) parts.push(`актив ${fmt(p.activeHours)}`)
    const detail = parts.length > 0 ? ` (${parts.join(', ')})` : ''
    const dayBits = dates
      .map((d) => {
        const a = dayCell(p, d, 'active')
        const s = dayCell(p, d, 'passive')
        if (a <= 0 && s <= 0) return null
        const bits: string[] = []
        if (a > 0) bits.push(`акт ${fmt(a)}`)
        if (s > 0) bits.push(`пасс ${fmt(s)}`)
        return `${d}: ${bits.join(', ')}`
      })
      .filter(Boolean)
    const datesPart = dayBits.length > 0 ? ` · ${dayBits.join('; ')}` : ''
    return `${p.name} [${p.extId}] — ${fmt(p.points)} ${pointsWord(p.points)}${detail}${datesPart}`
  })
  const totP = round2(people.reduce((s, p) => s + p.points, 0))
  const totH = round2(people.reduce((s, p) => s + p.hours, 0))
  lines.push(`Итого: ${fmt(totH)} ${hoursWord(totH)} — ${fmt(totP)} ${pointsWord(totP)}`)
  return lines.join('\n')
}

async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = t
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

const COLLAPSE_CHARS = 600

export default function DozoryTool() {
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [sortMode, setSortMode] = useState<'alpha' | 'points' | 'roster'>('roster')
  const [hydrated, setHydrated] = useState(false)
  const [activistIds, setActivistIds] = useState<Set<string>>(() => new Set())
  const [inputOpen, setInputOpen] = useState(true)
  const [userToggledInput, setUserToggledInput] = useState(false)
  const [roster, setRoster] = useState<SheetRoster | null>(null)
  const [rosterPasteOpen, setRosterPasteOpen] = useState(false)
  const [rosterPaste, setRosterPaste] = useState('')

  function refreshActivistIds() {
    try {
      setActivistIds(new Set(loadActivists().map((a) => a.extId)))
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    const saved = localStorage.getItem('dozoryText')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
    if (saved) {
      setText(saved)
      if (saved.length >= COLLAPSE_CHARS) setInputOpen(false)
    }
    refreshActivistIds()
    const savedRoster = loadRoster()
    setRoster(savedRoster ?? DEFAULT_DOZORY_ROSTER)
    setHydrated(true)

    const onChange = () => refreshActivistIds()
    window.addEventListener(ACTIVISTS_CHANGED, onChange)
    return () => window.removeEventListener(ACTIVISTS_CHANGED, onChange)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const t = setTimeout(() => localStorage.setItem('dozoryText', text), 300)
    return () => clearTimeout(t)
  }, [text, hydrated])

  // Auto-collapse when the paste grows large (unless user pinned it open/closed)
  useEffect(() => {
    if (!hydrated || userToggledInput) return
    if (text.length >= COLLAPSE_CHARS) setInputOpen(false)
    else setInputOpen(true)
  }, [text.length, hydrated, userToggledInput])

  const parsed = useMemo(() => parseDozory(text), [text])
  const postDates = useMemo(() => collectDates(parsed.entries), [parsed.entries])
  const people = useMemo(
    () => aggregate(parsed.entries, activistIds),
    [parsed.entries, activistIds]
  )

  /** Week dates: roster header first, then any extra dates from posts */
  const dates = useMemo(() => {
    const fromRoster = (roster?.dates ?? []).map(sheetShortDate).filter(Boolean)
    const set = new Set(fromRoster)
    const extra = postDates.filter((d) => !set.has(d))
    const merged = [...fromRoster, ...extra]
    if (merged.length > 0) return merged
    return postDates
  }, [roster, postDates])

  const merged = useMemo(() => {
    const scored = people.map(toScorePerson).map((p) => ({
      ...p,
      isActivist: activistIds.has(p.extId),
    }))
    if (!roster || roster.roster.length === 0) {
      return {
        rows: scored,
        matched: scored.length,
        unmatchedScores: 0,
        extras: 0,
      }
    }
    const result = mergeRosterWithScores(roster.roster, scored, dates)
    // refresh activist flag for empty roster rows
    return {
      ...result,
      rows: result.rows.map((r) => ({
        ...r,
        isActivist: activistIds.has(r.extId),
      })),
    }
  }, [people, roster, dates, activistIds])

  const displayRows = useMemo(() => {
    if (sortMode === 'roster' && roster && roster.roster.length > 0) {
      return merged.rows
    }
    const arr = merged.rows.filter((r) => !r.empty)
    if (sortMode === 'alpha') {
      arr.sort(
        (a, b) =>
          a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }) ||
          a.extId.localeCompare(b.extId)
      )
    } else {
      arr.sort(
        (a, b) =>
          b.points - a.points || a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' })
      )
    }
    return arr
  }, [merged.rows, sortMode, roster])

  const sortedPeople = useMemo(() => {
    // keep Person[] for report that needs hours — rebuild from people map
    const byId = new Map(people.map((p) => [p.extId, p]))
    return displayRows
      .map((r) => byId.get(r.extId))
      .filter((p): p is Person => !!p)
  }, [displayRows, people])

  const totals = useMemo(() => {
    let h = 0
    let pts = 0
    let passive = 0
    let active = 0
    let warnings = 0
    for (const e of parsed.entries) {
      h += e.hours
      pts += e.points
      if (e.kind === 'passive') passive += e.hours
      else active += e.hours
      if (e.warning) warnings++
    }
    return {
      hours: round2(h),
      points: round2(pts),
      passive: round2(passive),
      active: round2(active),
      warnings,
    }
  }, [parsed.entries])

  async function copyName(p: Person) {
    const ok = await copyText(`${p.name} [${p.extId}]`)
    toast(
      ok
        ? { title: 'Скопировано', description: `${p.name} [${p.extId}]` }
        : { title: 'Не удалось скопировать' }
    )
  }

  async function copyReport() {
    const ok = await copyText(buildReport(sortedPeople, dates))
    toast(
      ok
        ? { title: 'Разбалловка скопирована', description: `Участников: ${sortedPeople.length}` }
        : { title: 'Не удалось скопировать' }
    )
  }

  async function copySheet() {
    const rows = displayRows.filter((r) => !r.extra)
    const useAligned = !!(roster && roster.roster.length > 0)
    const tsv = useAligned
      ? buildAlignedSheetTsv(rows, dates, { dataOnly: true })
      : buildCompactTsv(rows, dates)
    const ok = await copyText(tsv)
    toast(
      ok
        ? {
            title: 'Скопировано для Google Sheets',
            description: useAligned
              ? `Вставьте в A5 листа «ДОЗОРЫ»: ${merged.matched} совпадений по ID → часы в колонках дат`
              : 'Вставьте в таблицу (Ctrl+V) — колонки как в шаблоне',
          }
        : { title: 'Не удалось скопировать' }
    )
  }

  async function copyCompactSheet() {
    const ok = await copyText(buildCompactTsv(displayRows, dates))
    toast(
      ok
        ? {
            title: 'Компактная таблица скопирована',
            description: 'Имя · ID · балл · активист · даты (Актив/Пассив)',
          }
        : { title: 'Не удалось скопировать' }
    )
  }

  function applyRosterPaste(raw: string) {
    const parsedRoster = parseSheetRoster(raw)
    if (!parsedRoster) {
      toast({
        title: 'Не разобрать список',
        description: 'Вставьте строки из листа «ДОЗОРЫ» (Имя + ID) или CSV/TSV экспорта.',
        variant: 'destructive',
      })
      return
    }
    const next: SheetRoster = {
      ...parsedRoster,
      dates: parsedRoster.dates.length > 0 ? parsedRoster.dates : roster?.dates ?? [],
      source: 'вставка из Google Sheets',
    }
    saveRoster(next)
    setRoster(next)
    setSortMode('roster')
    setRosterPasteOpen(false)
    setRosterPaste('')
    toast({
      title: 'Состав листа загружен',
      description: `${next.roster.length} человек` + (next.dates.length ? ` · даты ${next.dates.join(', ')}` : ''),
    })
  }

  function useDefaultRoster() {
    saveRoster(DEFAULT_DOZORY_ROSTER)
    setRoster(DEFAULT_DOZORY_ROSTER)
    setSortMode('roster')
    toast({
      title: 'Шаблон КОНТРОЛЬ ГРОЗА',
      description: `${DEFAULT_DOZORY_ROSTER.roster.length} человек в составе`,
    })
  }

  function resetRoster() {
    clearRoster()
    setRoster(DEFAULT_DOZORY_ROSTER)
    toast({ title: 'Состав сброшен к шаблону' })
  }

  function applyToSentryColumn() {
    const ids = new Set(
      people.filter((p) => p.points > 0 || p.hours > 0).map((p) => p.extId)
    )
    if (ids.size === 0) {
      toast({ title: 'Нет участников дозоров', description: 'Сначала вставьте посты.' })
      return
    }
    const list = loadActivists()
    let updated = 0
    let skipped = 0
    let missing = 0
    for (const id of ids) {
      const a = list.find((x) => x.extId === id)
      if (!a) {
        missing++
        continue
      }
      const cats = a.categories.split(',').map((c) => c.trim()).filter(Boolean)
      if (cats.includes('sentry')) {
        skipped++
        continue
      }
      cats.push('sentry')
      const res = updateActivist(a.id, { categories: cats.join(',') })
      if (res.ok) updated++
    }
    refreshActivistIds()
    window.dispatchEvent(new Event(ACTIVISTS_CHANGED))
    toast({
      title: 'Колонка «Дозоры»',
      description: `Проставлено: ${updated} · уже было: ${skipped} · нет в активистах: ${missing}`,
    })
  }

  async function pasteFromBuffer() {
    try {
      const t = await navigator.clipboard.readText()
      if (t.trim()) {
        setUserToggledInput(false) // allow auto-collapse for large pastes
        setText(t)
        toast({ title: 'Вставлено из буфера' })
      } else {
        toast({ title: 'Буфер обмена пуст' })
      }
    } catch {
      toast({ title: 'Нет доступа к буферу', description: 'Вставьте список вручную: Ctrl+V' })
    }
  }

  const stats = [
    { icon: ListChecks, value: String(parsed.entries.length), label: 'записей', warn: false },
    { icon: UserRound, value: String(people.length), label: 'участников', warn: false },
    {
      icon: Link2,
      value: String(merged.matched),
      label: 'совпало с листом',
      warn: false,
    },
    { icon: Timer, value: fmt(totals.hours), label: 'часов всего', warn: false },
    { icon: Coins, value: fmt(totals.points), label: 'баллов всего', warn: false },
    { icon: AlertTriangle, value: String(totals.warnings), label: 'с сомнениями', warn: totals.warnings > 0 },
  ]

  const minTableWidth = 420 + dates.length * 128
  const textChars = text.length
  const textLines = text ? text.split('\n').length : 0

  function toggleInput(open: boolean) {
    setUserToggledInput(true)
    setInputOpen(open)
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/30">
          <button
            type="button"
            className="inline-flex items-center gap-2 text-sm font-medium text-left hover:text-foreground"
            onClick={() => toggleInput(!inputOpen)}
            aria-expanded={inputOpen}
            aria-controls="dozory-input-panel"
          >
            <ChevronDown
              className={cn('h-4 w-4 shrink-0 transition-transform', !inputOpen && '-rotate-90')}
              aria-hidden="true"
            />
            <span>Список постов с дозорами</span>
            {textChars > 0 && (
              <span className="text-xs font-normal text-muted-foreground">
                {textLines.toLocaleString('ru-RU')} стр. · {textChars.toLocaleString('ru-RU')} симв.
                {parsed.entries.length > 0 ? ` · ${parsed.entries.length} записей` : ''}
              </span>
            )}
          </button>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={pasteFromBuffer}>
              <ClipboardPaste className="h-4 w-4 mr-1" aria-hidden="true" />
              Вставить из буфера
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => {
                setText('')
                setUserToggledInput(false)
                setInputOpen(true)
              }}
              disabled={!text}
            >
              <Eraser className="h-4 w-4 mr-1" aria-hidden="true" />
              Очистить
            </Button>
            {!inputOpen && textChars > 0 && (
              <Button variant="secondary" size="sm" onClick={() => toggleInput(true)}>
                Развернуть
              </Button>
            )}
          </div>
        </div>

        {inputOpen ? (
          <div id="dozory-input-panel" className="p-4 pt-3 space-y-3 border-t">
            <Textarea
              id="dozory-input"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                'Пассивный дозор [09.11.26]\nСектор: Березовая роща\nДозорный: Ревнивенькая [1712482]\nВремя: 01:22 — 02:22\nОбщее время: 1 час'
              }
              className="min-h-28 max-h-48 overflow-y-auto font-mono text-xs resize-y"
              aria-label="Список постов с дозорами"
            />
            <p className="text-xs text-muted-foreground">
              Ставки: пассивный — 1 балл/час · активный — 1,5 балла/час. Большой текст сворачивается
              автоматически — таблица остаётся на виду.
            </p>
          </div>
        ) : (
          <div id="dozory-input-panel" className="px-4 py-2.5 border-t text-xs text-muted-foreground">
            Поле свёрнуто. Вставка из буфера работает и так; чтобы править текст — нажмите «Развернуть».
          </div>
        )}
      </div>

      <div className="rounded-lg border overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 bg-muted/30">
          <div className="text-sm">
            <span className="font-medium">Лист «ДОЗОРЫ»</span>
            <span className="text-muted-foreground">
              {' '}
              · состав {roster?.roster.length ?? 0}
              {roster?.dates?.length ? ` · ${roster.dates.join(', ')}` : ''}
              {people.length > 0 ? ` · совпало ID ${merged.matched}` : ''}
              {merged.extras > 0 ? ` · вне списка ${merged.extras}` : ''}
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setRosterPasteOpen((v) => !v)}>
              <ClipboardPaste className="h-4 w-4 mr-1" aria-hidden="true" />
              Загрузить состав
            </Button>
            <Button variant="outline" size="sm" onClick={useDefaultRoster}>
              Шаблон Грозы
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={applyToSentryColumn}
              disabled={people.length === 0}
            >
              <UserCheck className="h-4 w-4 mr-1" aria-hidden="true" />
              В колонку «Дозоры»
            </Button>
          </div>
        </div>
        {rosterPasteOpen && (
          <div className="border-t p-4 space-y-3">
            <p className="text-xs text-muted-foreground">
              Скопируйте строки из Google Sheets (вкладка ДОЗОРЫ: имена и ID) или весь лист через
              Файл → Скачать → CSV и вставьте сюда. По совпадению ID часы уйдут в колонки Активный /
              Пассивный нужной даты.
            </p>
            <Textarea
              value={rosterPaste}
              onChange={(e) => setRosterPaste(e.target.value)}
              placeholder={'Воркотунья\t358173\nГрыжа\t1676369'}
              className="min-h-24 font-mono text-xs"
              aria-label="Состав листа ДОЗОРЫ"
            />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => applyRosterPaste(rosterPaste)}>
                Применить состав
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const t = await navigator.clipboard.readText()
                    if (t.trim()) applyRosterPaste(t)
                    else toast({ title: 'Буфер пуст' })
                  } catch {
                    toast({ title: 'Вставьте состав вручную' })
                  }
                }}
              >
                Из буфера
              </Button>
              <Button size="sm" variant="ghost" onClick={resetRoster}>
                Сбросить
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border p-4 flex items-center gap-3">
            <s.icon
              className={cn('h-5 w-5 shrink-0', s.warn ? 'text-amber-600' : 'text-muted-foreground')}
              aria-hidden="true"
            />
            <div>
              <div className={cn('text-2xl font-semibold leading-none', s.warn && 'text-amber-700')}>
                {s.value}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      {parsed.skipped > 0 && (
        <p className="text-xs text-amber-700 flex items-center gap-1">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Постов с заголовком дозора, но без «Дозорный» или времени: {parsed.skipped} — они не попали
          в расчёт.
        </p>
      )}

      {people.length === 0 && !(roster && roster.roster.length > 0 && text.trim()) ? (
        <div className="rounded-lg border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {hydrated && text.trim()
              ? 'Не нашлось ни одного дозора. Проверьте, что в постах есть строки «Дозорный: Имя [ID]», «Время: ЧЧ:ММ — ЧЧ:ММ» или «Общее время:».'
              : 'Вставьте посты с дозорами — по совпадению ID часы встанут в колонки дат состава листа «ДОЗОРЫ».'}
          </p>
        </div>
      ) : people.length === 0 ? (
        <div className="rounded-lg border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Состав листа загружен ({roster?.roster.length ?? 0}), но постов с дозорами ещё нет —
            вставьте их сверху.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button onClick={copySheet}>
                <Sheet className="h-4 w-4 mr-1" aria-hidden="true" />
                В Google Sheets
              </Button>
              <Button variant="outline" onClick={copyCompactSheet}>
                Компактно
              </Button>
              <Button variant="outline" onClick={copyReport}>
                <ScrollText className="h-4 w-4 mr-1" aria-hidden="true" />
                Разбалловка текстом
              </Button>
            </div>
            <div
              className="inline-flex rounded-lg border bg-muted/40 p-1 gap-1"
              role="group"
              aria-label="Сортировка"
            >
              <button
                type="button"
                aria-pressed={sortMode === 'roster'}
                onClick={() => setSortMode('roster')}
                className={cn(
                  'inline-flex items-center rounded-md px-3 h-8 text-sm font-medium transition-colors',
                  sortMode === 'roster'
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                Как в листе
              </button>
              <button
                type="button"
                aria-pressed={sortMode === 'alpha'}
                onClick={() => setSortMode('alpha')}
                className={cn(
                  'inline-flex items-center rounded-md px-3 h-8 text-sm font-medium transition-colors',
                  sortMode === 'alpha'
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                По алфавиту
              </button>
              <button
                type="button"
                aria-pressed={sortMode === 'points'}
                onClick={() => setSortMode('points')}
                className={cn(
                  'inline-flex items-center rounded-md px-3 h-8 text-sm font-medium transition-colors',
                  sortMode === 'points'
                    ? 'bg-background shadow-sm text-foreground'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                По баллам
              </button>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-auto max-h-[70vh]">
              <table
                className="w-full caption-bottom text-sm border-separate border-spacing-0"
                style={{ minWidth: minTableWidth }}
              >
                <thead>
                  <tr className="bg-muted">
                    <th className="sticky top-0 left-0 z-40 border-b border-r bg-muted px-2 py-2 text-left align-bottom font-medium min-w-[9rem] max-w-[11rem] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]">
                      Имя CatWar
                    </th>
                    <th className="sticky top-0 z-30 border-b border-r bg-muted px-2 py-2 text-left align-bottom font-medium min-w-[5.5rem]">
                      ID
                    </th>
                    <th className="sticky top-0 z-30 border-b border-r bg-muted px-2 py-2 text-center align-bottom font-medium min-w-[5rem] leading-tight">
                      Общий
                      <br />
                      балл
                    </th>
                    <th className="sticky top-0 z-30 border-b border-r bg-muted px-2 py-2 text-center align-bottom font-medium min-w-[5rem]">
                      Активист
                    </th>
                    {dates.map((d) => (
                      <Fragment key={d}>
                        <th className="sticky top-0 z-30 border-b border-r bg-muted px-1.5 py-2 text-center align-bottom min-w-[4.25rem]">
                          <div className="font-mono font-semibold text-sm leading-none">{d}</div>
                          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-emerald-800">
                            Актив
                          </div>
                        </th>
                        <th className="sticky top-0 z-30 border-b border-r bg-muted px-1.5 py-2 text-center align-bottom min-w-[4.25rem]">
                          <div className="font-mono font-semibold text-sm leading-none">{d}</div>
                          <div className="mt-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                            Пассив
                          </div>
                        </th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((p) => {
                    const full = people.find((x) => x.extId === p.extId)
                    const hasWarn = full?.entries.some((e) => e.warning) ?? false
                    return (
                      <tr
                        key={p.extId}
                        className={cn(
                          'group border-b hover:bg-muted/40',
                          hasWarn && 'bg-amber-50/70 dark:bg-amber-950/20',
                          p.empty && 'opacity-50',
                          p.extra && 'bg-sky-50/50'
                        )}
                      >
                        <td
                          className={cn(
                            'sticky left-0 z-10 border-b border-r px-2 py-2 font-medium max-w-[11rem] shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]',
                            hasWarn
                              ? 'bg-amber-50 dark:bg-amber-950'
                              : p.extra
                                ? 'bg-sky-50 group-hover:bg-sky-100'
                                : 'bg-background group-hover:bg-muted'
                          )}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              copyName({
                                name: p.name,
                                extId: p.extId,
                                passiveHours: 0,
                                activeHours: 0,
                                hours: 0,
                                points: p.points,
                                entries: [],
                                byDay: p.byDay,
                                isActivist: p.isActivist,
                              })
                            }
                            className="group/name inline-flex max-w-full items-center gap-1 rounded text-left font-medium transition-colors hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-600"
                            aria-label={`Скопировать ${p.name} [${p.extId}]`}
                            title="Клик — скопировать «Имя [ID]»"
                          >
                            <span className="truncate" title={p.name}>
                              {p.name}
                            </span>
                            <Copy
                              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/name:opacity-70"
                              aria-hidden="true"
                            />
                          </button>
                          {p.extra && (
                            <span className="ml-1 text-[10px] font-normal text-sky-700">вне листа</span>
                          )}
                          {hasWarn && (
                            <AlertTriangle
                              className="inline h-3 w-3 ml-1 text-amber-600 align-middle"
                              aria-label="Есть расхождения во времени"
                            />
                          )}
                        </td>
                        <td className="border-b border-r px-2 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {p.extId}
                        </td>
                        <td className="border-b border-r px-2 py-2 text-center font-semibold tabular-nums whitespace-nowrap">
                          {p.points > 0 ? fmt(p.points) : p.empty ? '' : '0'}
                        </td>
                        <td className="border-b border-r px-2 py-2 text-center text-sm whitespace-nowrap">
                          {p.isActivist ? '1' : '0'}
                        </td>
                        {dates.map((d) => {
                          const day = p.byDay[d]
                          const a = day?.active ?? 0
                          const s = day?.passive ?? 0
                          return (
                            <Fragment key={d}>
                              <td
                                className={cn(
                                  'border-b border-r px-2 py-2 text-center text-sm tabular-nums whitespace-nowrap',
                                  a > 0 && 'bg-emerald-50 font-medium text-emerald-900'
                                )}
                              >
                                {a > 0 ? fmt(a) : ''}
                              </td>
                              <td
                                className={cn(
                                  'border-b border-r px-2 py-2 text-center text-sm tabular-nums whitespace-nowrap',
                                  s > 0 && 'bg-stone-100 font-medium'
                                )}
                              >
                                {s > 0 ? fmt(s) : ''}
                              </td>
                            </Fragment>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Итого часов: пассив {fmt(totals.passive)} · актив {fmt(totals.active)} · всего{' '}
                {fmt(totals.hours)}
              </span>
              <span>Общий балл суммарно: {fmt(totals.points)}</span>
              <span>
                ID→колонки: {merged.matched} совпало
                {merged.extras > 0 ? `, ${merged.extras} вне состава` : ''}
              </span>
              <span>Дат в шапке: {dates.join(', ') || '—'}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
