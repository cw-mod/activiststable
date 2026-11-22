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
import {
  AlertTriangle,
  ChevronDown,
  ClipboardPaste,
  Coins,
  Copy,
  Eraser,
  ListChecks,
  ScrollText,
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

type Person = {
  name: string
  extId: string
  passiveHours: number
  activeHours: number
  hours: number
  points: number
  entries: WatchEntry[]
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

/** Sort key for DD.MM[.YY] dates within a season/year-agnostic week list */
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

type DayBucket = {
  date: string
  short: string
  active: { name: string; extId: string }[]
  passive: { name: string; extId: string }[]
}

function byDate(entries: WatchEntry[]): DayBucket[] {
  const map = new Map<string, DayBucket>()
  for (const e of entries) {
    const key = shortDate(e.date)
    let b = map.get(key)
    if (!b) {
      b = { date: e.date, short: key, active: [], passive: [] }
      map.set(key, b)
    }
    const who = { name: e.name, extId: e.extId }
    const list = e.kind === 'active' ? b.active : b.passive
    if (!list.some((x) => x.extId === e.extId)) list.push(who)
  }
  for (const b of map.values()) {
    const cmp = (a: { name: string }, c: { name: string }) =>
      a.name.localeCompare(c.name, 'ru', { sensitivity: 'base' })
    b.active.sort(cmp)
    b.passive.sort(cmp)
  }
  return Array.from(map.values()).sort((a, b) => dateSortKey(a.date) - dateSortKey(b.date))
}

/** Unique date+kind chips for a person, chronological */
function personDateChips(entries: WatchEntry[]): { short: string; kind: WatchKind }[] {
  const seen = new Set<string>()
  const chips: { short: string; kind: WatchKind; key: number }[] = []
  for (const e of entries) {
    const short = shortDate(e.date)
    const id = `${short}|${e.kind}`
    if (seen.has(id)) continue
    seen.add(id)
    chips.push({ short, kind: e.kind, key: dateSortKey(e.date) })
  }
  chips.sort((a, b) => a.key - b.key || (a.kind === 'passive' ? -1 : 1))
  return chips.map(({ short, kind }) => ({ short, kind }))
}

// "1 час", "30 минут", "1.5 часов", "2,5 часа" -> hours
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

  // Split at every watch-post title; everything before the first title is ignored
  const chunks = text.split(/(?=(?:пассивный|активный)\s*дозор)/i)
  for (const chunk of chunks) {
    const titleM = chunk.match(
      /(пассивный|активный)\s*дозор\s*\[\s*(\d{1,2}\.\d{1,2}\.\d{2,4})\s*\]/i
    )
    if (!titleM) continue // rules header or unrelated text
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

function aggregate(entries: WatchEntry[]): Person[] {
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
      }
      map.set(e.extId, p)
    }
    if (e.kind === 'passive') p.passiveHours = round2(p.passiveHours + e.hours)
    else p.activeHours = round2(p.activeHours + e.hours)
    p.hours = round2(p.passiveHours + p.activeHours)
    p.points = round2(p.points + e.points)
    p.entries.push(e)
  }
  return Array.from(map.values())
}

function buildReport(people: Person[], days: DayBucket[]): string {
  const lines = people.map((p) => {
    const parts: string[] = []
    if (p.passiveHours > 0) parts.push(`пассив ${fmt(p.passiveHours)}`)
    if (p.activeHours > 0) parts.push(`актив ${fmt(p.activeHours)}`)
    const detail = parts.length > 0 ? ` (${parts.join(', ')})` : ''
    const dates = personDateChips(p.entries)
      .map((c) => `${c.short} ${c.kind === 'passive' ? 'пасс' : 'акт'}`)
      .join(', ')
    const datesPart = dates ? ` · ${dates}` : ''
    return `${p.name} [${p.extId}] — ${fmt(p.hours)} ${hoursWord(p.hours)}${detail} — ${fmt(p.points)} ${pointsWord(p.points)}${datesPart}`
  })
  const totH = round2(people.reduce((s, p) => s + p.hours, 0))
  const totP = round2(people.reduce((s, p) => s + p.points, 0))
  lines.push(`Итого: ${fmt(totH)} ${hoursWord(totH)} — ${fmt(totP)} ${pointsWord(totP)}`)
  if (days.length > 0) {
    lines.push('')
    lines.push('По датам:')
    for (const d of days) {
      const act =
        d.active.length > 0
          ? `актив: ${d.active.map((x) => `${x.name} [${x.extId}]`).join(', ')}`
          : 'актив: –'
      const pass =
        d.passive.length > 0
          ? `пассив: ${d.passive.map((x) => `${x.name} [${x.extId}]`).join(', ')}`
          : 'пассив: –'
      lines.push(`${d.short} — ${act}; ${pass}`)
    }
  }
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
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('dozoryText')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
    if (saved) setText(saved)
    setHydrated(true)
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const t = setTimeout(() => localStorage.setItem('dozoryText', text), 300)
    return () => clearTimeout(t)
  }, [text, hydrated])

  const parsed = useMemo(() => parseDozory(text), [text])
  const people = useMemo(() => aggregate(parsed.entries), [parsed.entries])
  const days = useMemo(() => byDate(parsed.entries), [parsed.entries])

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
    return { hours: round2(h), points: round2(pts), passive: round2(passive), active: round2(active), warnings }
  }, [parsed.entries])

  async function copyName(p: Person) {
    const ok = await copyText(`${p.name} [${p.extId}]`)
    toast(
      ok
        ? { title: 'Скопировано', description: `${p.name} [${p.extId}]` }
        : { title: 'Не удалось скопировать' }
    )
  }

  async function copyId(extId: string) {
    const ok = await copyText(extId)
    toast(ok ? { title: 'ID скопирован', description: extId } : { title: 'Не удалось скопировать' })
  }

  async function copyReport() {
    const report = buildReport(sortedPeople, days)
    const ok = await copyText(report)
    toast(
      ok
        ? {
            title: 'Разбалловка скопирована',
            description: `Участников: ${sortedPeople.length}, дат: ${days.length}`,
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

  function toggleExpanded(extId: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(extId)) next.delete(extId)
      else next.add(extId)
      return next
    })
  }

  const stats = [
    { icon: ListChecks, value: String(parsed.entries.length), label: 'записей', warn: false },
    { icon: UserRound, value: String(people.length), label: 'участников', warn: false },
    { icon: Timer, value: fmt(totals.hours), label: 'часов всего', warn: false },
    { icon: Coins, value: fmt(totals.points), label: 'баллов всего', warn: false },
    { icon: AlertTriangle, value: String(totals.warnings), label: 'с сомнениями', warn: totals.warnings > 0 },
  ]

  return (
    <div className="space-y-4">
      {/* input */}
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
          Ставки: пассивный дозор — 1 балл за час (30 мин = 0,5) · активный — 1,5 балла за час (30 мин = 0,75). Часы берутся из «Общее время», а если его нет — считаются по «Время».
        </p>
      </div>

      {/* stats */}
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
          Постов с заголовком дозора, но без «Дозорный» или времени: {parsed.skipped} — они не попали в расчёт.
        </p>
      )}

      {/* results */}
      {people.length === 0 ? (
        <div className="rounded-lg border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {hydrated && text.trim()
              ? 'Не нашлось ни одного дозора. Проверьте, что в постах есть строки «Дозорный: Имя [ID]», «Время: ЧЧ:ММ — ЧЧ:ММ» или «Общее время:».'
              : 'Вставьте список постов сверху — таблица соберётся сама.'}
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button onClick={copyReport}>
              <ScrollText className="h-4 w-4 mr-1" aria-hidden="true" />
              Скопировать разбалловку
            </Button>
            <div className="inline-flex rounded-lg border bg-muted/40 p-1 gap-1" role="group" aria-label="Сортировка">
              <button
                type="button"
                aria-pressed={sortMode === 'alpha'}
                onClick={() => setSortMode('alpha')}
                className={cn(
                  'inline-flex items-center rounded-md px-3 h-8 text-sm font-medium transition-colors',
                  sortMode === 'alpha' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
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
                  sortMode === 'points' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
                )}
              >
                По баллам
              </button>
            </div>
          </div>

          <div className="rounded-lg border overflow-hidden">
            <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
              <Table className="min-w-[860px]">
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableHead className="w-10 text-center">#</TableHead>
                    <TableHead>Дозорный</TableHead>
                    <TableHead>ID</TableHead>
                    <TableHead className="min-w-[9rem]">Даты</TableHead>
                    <TableHead className="text-center">Пассив, ч</TableHead>
                    <TableHead className="text-center">Актив, ч</TableHead>
                    <TableHead className="text-center">Всего, ч</TableHead>
                    <TableHead className="text-center">Баллы</TableHead>
                    <TableHead className="w-12 text-center">
                      <span className="sr-only">Детали</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedPeople.map((p, idx) => {
                    const isOpen = expanded.has(p.extId)
                    const hasWarn = p.entries.some((e) => e.warning)
                    const chips = personDateChips(p.entries)
                    return (
                      <Fragment key={p.extId}>
                        <TableRow
                          className={cn(hasWarn && 'bg-amber-50/60 dark:bg-amber-950/20')}
                        >
                          <TableCell className="text-center text-muted-foreground text-xs">{idx + 1}</TableCell>
                          <TableCell className="font-medium max-w-52">
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
                          </TableCell>
                          <TableCell className="font-mono text-xs text-muted-foreground">
                            <button
                              type="button"
                              onClick={() => copyId(p.extId)}
                              className="group inline-flex items-center gap-1 rounded font-mono text-xs text-muted-foreground transition-colors hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-600"
                              aria-label={`Скопировать ID ${p.extId}`}
                              title="Клик — скопировать только ID"
                            >
                              {p.extId}
                              <Copy
                                className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70"
                                aria-hidden="true"
                              />
                            </button>
                          </TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-1">
                              {chips.map((c) => (
                                <span
                                  key={`${c.short}-${c.kind}`}
                                  className={cn(
                                    'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
                                    c.kind === 'passive'
                                      ? 'bg-muted text-muted-foreground'
                                      : 'bg-emerald-100 text-emerald-700'
                                  )}
                                  title={`${c.short}: ${c.kind === 'passive' ? 'пассивный' : 'активный'} дозор`}
                                >
                                  <span className="font-mono">{c.short}</span>
                                  <span>{c.kind === 'passive' ? 'пасс' : 'акт'}</span>
                                </span>
                              ))}
                            </div>
                          </TableCell>
                          <TableCell className="text-center text-sm">{p.passiveHours > 0 ? fmt(p.passiveHours) : '–'}</TableCell>
                          <TableCell className="text-center text-sm">{p.activeHours > 0 ? fmt(p.activeHours) : '–'}</TableCell>
                          <TableCell className="text-center text-sm font-medium">{fmt(p.hours)}</TableCell>
                          <TableCell className="text-center">
                            <span className="font-semibold">{fmt(p.points)}</span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => toggleExpanded(p.extId)}
                              aria-expanded={isOpen}
                              aria-label={`Детали дозоров ${p.name}`}
                            >
                              <ChevronDown
                                className={cn('h-4 w-4 transition-transform', isOpen && 'rotate-180')}
                                aria-hidden="true"
                              />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell colSpan={9} className="bg-muted/20">
                              <div className="space-y-1.5 py-1">
                                {p.entries.map((e, i) => (
                                  <div key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                                    <span className="font-mono text-muted-foreground">[{e.date}]</span>
                                    <span
                                      className={cn(
                                        'rounded px-1.5 py-0.5 font-medium',
                                        e.kind === 'passive'
                                          ? 'bg-muted text-muted-foreground'
                                          : 'bg-emerald-100 text-emerald-700'
                                      )}
                                    >
                                      {e.kind === 'passive' ? 'пассив' : 'актив'}
                                    </span>
                                    <span>
                                      {fmt(e.hours)} {hoursWord(e.hours)} · {fmt(e.points)} {pointsWord(e.points)}
                                    </span>
                                    {e.sector && <span className="text-muted-foreground">· {e.sector}</span>}
                                    {e.warning && (
                                      <span className="text-amber-700 inline-flex items-center gap-1">
                                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                                        {e.warning}
                                      </span>
                                    )}
                                  </div>
                                ))}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            <div className="border-t bg-muted/30">
              <Table className="min-w-[860px]">
                <TableBody>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="text-xs text-muted-foreground font-medium" colSpan={4}>
                      Итого
                    </TableCell>
                    <TableCell className="text-center text-sm font-semibold">{fmt(totals.passive)}</TableCell>
                    <TableCell className="text-center text-sm font-semibold">{fmt(totals.active)}</TableCell>
                    <TableCell className="text-center text-sm font-semibold">{fmt(totals.hours)}</TableCell>
                    <TableCell className="text-center text-sm font-semibold">{fmt(totals.points)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </div>

          {/* who dozored on which date */}
          <div className="rounded-lg border overflow-hidden">
            <div className="border-b bg-muted/40 px-4 py-2.5">
              <h3 className="text-sm font-medium">По датам — кто дозорил</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                На каждую дату: активный и пассивный состав
              </p>
            </div>
            <div className="overflow-x-auto">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow className="bg-muted/30 hover:bg-muted/30">
                    <TableHead className="w-24">Дата</TableHead>
                    <TableHead>Активный</TableHead>
                    <TableHead>Пассивный</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {days.map((d) => (
                    <TableRow key={d.short}>
                      <TableCell className="font-mono font-medium whitespace-nowrap">{d.short}</TableCell>
                      <TableCell className="text-sm">
                        {d.active.length === 0 ? (
                          <span className="text-muted-foreground">–</span>
                        ) : (
                          <div className="flex flex-wrap gap-x-2 gap-y-1">
                            {d.active.map((x) => (
                              <button
                                key={`a-${d.short}-${x.extId}`}
                                type="button"
                                className="rounded bg-emerald-100 px-1.5 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-200"
                                title={`Скопировать ${x.name} [${x.extId}]`}
                                onClick={async () => {
                                  const ok = await copyText(`${x.name} [${x.extId}]`)
                                  toast(
                                    ok
                                      ? { title: 'Скопировано', description: `${x.name} [${x.extId}]` }
                                      : { title: 'Не удалось скопировать' }
                                  )
                                }}
                              >
                                {x.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-sm">
                        {d.passive.length === 0 ? (
                          <span className="text-muted-foreground">–</span>
                        ) : (
                          <div className="flex flex-wrap gap-x-2 gap-y-1">
                            {d.passive.map((x) => (
                              <button
                                key={`p-${d.short}-${x.extId}`}
                                type="button"
                                className="rounded bg-muted px-1.5 py-0.5 text-xs font-medium text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                                title={`Скопировать ${x.name} [${x.extId}]`}
                                onClick={async () => {
                                  const ok = await copyText(`${x.name} [${x.extId}]`)
                                  toast(
                                    ok
                                      ? { title: 'Скопировано', description: `${x.name} [${x.extId}]` }
                                      : { title: 'Не удалось скопировать' }
                                  )
                                }}
                              >
                                {x.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
