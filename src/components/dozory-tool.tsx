'use client'

import { Fragment, useEffect, useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useToast } from '@/hooks/use-toast'
import { loadActivists } from '@/lib/store'
import {
  AlertTriangle,
  ClipboardPaste,
  Coins,
  Copy,
  Eraser,
  ListChecks,
  ScrollText,
  Sheet,
  Timer,
  UserRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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

/** Plain number for spreadsheet paste (comma decimal) */
function fmtSheet(n: number): string {
  if (n === 0) return '0'
  return String(round2(n)).replace('.', ',')
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

/** TSV matching the Google Sheets template for paste */
function buildSheetTsv(people: Person[], dates: string[]): string {
  const r1 = ['Имя CatWar', 'ID', 'Общий балл', 'Активист']
  for (const d of dates) {
    r1.push(d, '') // date spans active+passive
  }
  const r2 = ['', '', '', '']
  for (const _d of dates) {
    r2.push('Активный', 'Пассивный')
  }
  const body = people.map((p) => {
    const row = [
      p.name,
      p.extId,
      fmtSheet(p.points),
      p.isActivist ? '1' : '0',
    ]
    for (const d of dates) {
      const a = dayCell(p, d, 'active')
      const s = dayCell(p, d, 'passive')
      row.push(a > 0 ? fmtSheet(a) : '', s > 0 ? fmtSheet(s) : '')
    }
    return row.join('\t')
  })
  return [r1.join('\t'), r2.join('\t'), ...body].join('\n')
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

export default function DozoryTool() {
  const { toast } = useToast()
  const [text, setText] = useState('')
  const [sortMode, setSortMode] = useState<'alpha' | 'points'>('alpha')
  const [hydrated, setHydrated] = useState(false)
  const [activistIds, setActivistIds] = useState<Set<string>>(() => new Set())

  useEffect(() => {
    const saved = localStorage.getItem('dozoryText')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
    if (saved) setText(saved)
    try {
      setActivistIds(new Set(loadActivists().map((a) => a.extId)))
    } catch {
      /* ignore */
    }
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const t = setTimeout(() => localStorage.setItem('dozoryText', text), 300)
    return () => clearTimeout(t)
  }, [text, hydrated])

  const parsed = useMemo(() => parseDozory(text), [text])
  const dates = useMemo(() => collectDates(parsed.entries), [parsed.entries])
  const people = useMemo(
    () => aggregate(parsed.entries, activistIds),
    [parsed.entries, activistIds]
  )

  const sortedPeople = useMemo(() => {
    const arr = [...people]
    if (sortMode === 'alpha') {
      arr.sort(
        (a, b) =>
          a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }) ||
          a.extId.localeCompare(b.extId)
      )
    } else {
      arr.sort(
        (a, b) =>
          b.points - a.points ||
          b.hours - a.hours ||
          a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' })
      )
    }
    return arr
  }, [people, sortMode])

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
    const ok = await copyText(buildSheetTsv(sortedPeople, dates))
    toast(
      ok
        ? {
            title: 'Скопировано для таблицы',
            description: 'Вставьте в Google Sheets (Ctrl+V) — колонки как в шаблоне',
          }
        : { title: 'Не удалось скопировать' }
    )
  }

  async function pasteFromBuffer() {
    try {
      const t = await navigator.clipboard.readText()
      if (t.trim()) {
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
    { icon: Timer, value: fmt(totals.hours), label: 'часов всего', warn: false },
    { icon: Coins, value: fmt(totals.points), label: 'баллов всего', warn: false },
    { icon: AlertTriangle, value: String(totals.warnings), label: 'с сомнениями', warn: totals.warnings > 0 },
  ]

  const minTableWidth = 360 + dates.length * 140

  return (
    <div className="space-y-4">
      <div className="rounded-lg border p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="dozory-input" className="text-sm font-medium">
            Список постов с дозорами
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={pasteFromBuffer}>
              <ClipboardPaste className="h-4 w-4 mr-1" aria-hidden="true" />
              Вставить из буфера
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setText('')}
              disabled={!text}
            >
              <Eraser className="h-4 w-4 mr-1" aria-hidden="true" />
              Очистить
            </Button>
          </div>
        </div>
        <Textarea
          id="dozory-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={
            'Пассивный дозор [09.11.26]\nСектор: Березовая роща\nДозорный: Ревнивенькая [1712482]\nВремя: 01:22 — 02:22\nОбщее время: 1 час'
          }
          className="min-h-44 font-mono text-xs"
          aria-label="Список постов с дозорами"
        />
        <p className="text-xs text-muted-foreground">
          Ставки: пассивный дозор — 1 балл за час (30 мин = 0,5) · активный — 1,5 балла за час (30 мин =
          0,75). Таблица как в шаблоне: даты сверху, под каждой — Активный / Пассивный (часы).
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
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

      {people.length === 0 ? (
        <div className="rounded-lg border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {hydrated && text.trim()
              ? 'Не нашлось ни одного дозора. Проверьте, что в постах есть строки «Дозорный: Имя [ID]», «Время: ЧЧ:ММ — ЧЧ:ММ» или «Общее время:».'
              : 'Вставьте список постов сверху — таблица соберётся сама по шаблону недели.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-2">
              <Button onClick={copySheet}>
                <Sheet className="h-4 w-4 mr-1" aria-hidden="true" />
                Скопировать для таблицы
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

          {/* Sheet-like matrix: Name | ID | Общий балл | Активист | date→Active/Passive */}
          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
              <Table style={{ minWidth: minTableWidth }}>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead
                      rowSpan={2}
                      className="align-bottom border-r min-w-[8rem] sticky left-0 bg-muted/50 z-20"
                    >
                      Имя CatWar
                    </TableHead>
                    <TableHead rowSpan={2} className="align-bottom border-r min-w-[5rem]">
                      ID
                    </TableHead>
                    <TableHead rowSpan={2} className="align-bottom text-center border-r min-w-[4.5rem]">
                      Общий балл
                    </TableHead>
                    <TableHead rowSpan={2} className="align-bottom text-center border-r min-w-[4.5rem]">
                      Активист
                    </TableHead>
                    {dates.map((d) => (
                      <TableHead
                        key={d}
                        colSpan={2}
                        className="text-center border-r font-mono font-semibold"
                      >
                        {d}
                      </TableHead>
                    ))}
                  </TableRow>
                  <TableRow className="bg-muted/40 hover:bg-muted/40">
                    {dates.map((d) => (
                      <Fragment key={d}>
                        <TableHead className="text-center text-[11px] font-medium text-emerald-800 border-r-0 min-w-[4.5rem]">
                          Активный
                        </TableHead>
                        <TableHead className="text-center text-[11px] font-medium text-muted-foreground border-r min-w-[4.5rem]">
                          Пассивный
                        </TableHead>
                      </Fragment>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPeople.map((p) => {
                    const hasWarn = p.entries.some((e) => e.warning)
                    return (
                      <TableRow
                        key={p.extId}
                        className={cn(hasWarn && 'bg-amber-50/60 dark:bg-amber-950/20')}
                      >
                        <TableCell className="font-medium border-r sticky left-0 bg-background z-10">
                          <button
                            type="button"
                            onClick={() => copyName(p)}
                            className="group inline-flex max-w-full items-center gap-1 rounded text-left font-medium transition-colors hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-600"
                            aria-label={`Скопировать ${p.name} [${p.extId}]`}
                            title="Клик — скопировать «Имя [ID]»"
                          >
                            <span className="truncate" title={p.name}>
                              {p.name}
                            </span>
                            <Copy
                              className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70"
                              aria-hidden="true"
                            />
                          </button>
                          {hasWarn && (
                            <AlertTriangle
                              className="inline h-3 w-3 ml-1 text-amber-600"
                              aria-label="Есть расхождения во времени"
                            />
                          )}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground border-r">
                          {p.extId}
                        </TableCell>
                        <TableCell className="text-center font-semibold border-r">
                          {fmt(p.points)}
                        </TableCell>
                        <TableCell className="text-center text-sm border-r">
                          {p.isActivist ? '1' : '0'}
                        </TableCell>
                        {dates.map((d) => {
                          const a = dayCell(p, d, 'active')
                          const s = dayCell(p, d, 'passive')
                          return (
                            <Fragment key={d}>
                              <TableCell
                                className={cn(
                                  'text-center text-sm tabular-nums',
                                  a > 0 && 'bg-emerald-50/80 font-medium text-emerald-900'
                                )}
                              >
                                {a > 0 ? fmt(a) : ''}
                              </TableCell>
                              <TableCell
                                className={cn(
                                  'text-center text-sm tabular-nums border-r',
                                  s > 0 && 'bg-muted/50 font-medium'
                                )}
                              >
                                {s > 0 ? fmt(s) : ''}
                              </TableCell>
                            </Fragment>
                          )
                        })}
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="border-t bg-muted/30 px-4 py-2 text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1">
              <span>
                Итого часов: пассив {fmt(totals.passive)} · актив {fmt(totals.active)} · всего{' '}
                {fmt(totals.hours)}
              </span>
              <span>Общий балл суммарно: {fmt(totals.points)}</span>
              <span>Дат в шапке: {dates.map((d) => d).join(', ')}</span>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
