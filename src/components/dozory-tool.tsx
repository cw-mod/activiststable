'use client'

import { Fragment, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'
import {
  AlertTriangle,
  ChevronDown,
  ClipboardPaste,
  Coins,
  Copy,
  Eraser,
  ListChecks,
  Sheet,
  Timer,
  UserRound,
} from 'lucide-react'
import { cn } from '@/lib/utils'

const PASSIVE_RATE = 1
const ACTIVE_RATE = 1.5
/** «Активист» в таблице дозоров — от стольки часов суммарно */
const ACTIVIST_MIN_HOURS = 10

type WatchKind = 'passive' | 'active'

type WatchEntry = {
  kind: WatchKind
  date: string
  name: string
  extId: string
  hours: number
  points: number
  sector: string
  /** «Время: ЧЧ:ММ — ЧЧ:ММ» из поста, если было */
  timeLabel: string | null
  /** Текст «Общее время: …» из поста, если был */
  declaredLabel: string | null
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
  // «1 час 30 минут» / «1ч 30 мин» / «3 часа 30 минут»
  // Longer «час…» before bare «ч», иначе «часа» съедается как «ч».
  const compound = t.match(
    /(\d+(?:[.,]\d+)?)\s*(?:часов|часа|час|ч)\s+(\d+(?:[.,]\d+)?)\s*мин\w*/
  )
  if (compound) {
    const h = Number.parseFloat(compound[1].replace(',', '.'))
    const mins = Number.parseFloat(compound[2].replace(',', '.'))
    if (Number.isFinite(h) && Number.isFinite(mins) && h >= 0 && mins >= 0) {
      return round2(h + mins / 60)
    }
  }
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(часов|часа|час|ч|мин\w*)/)
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
    const declaredRaw = declaredM ? cleanText(declaredM[1]) : null
    const declared = declaredRaw ? parseDeclaredDuration(declaredRaw) : null
    const computed = timeM
      ? timeRangeHours(Number(timeM[1]), Number(timeM[2]), Number(timeM[3]), Number(timeM[4]))
      : null
    const timeLabel = timeM
      ? `${timeM[1].padStart(2, '0')}:${timeM[2]} — ${timeM[3].padStart(2, '0')}:${timeM[4]}`
      : null

    let hours: number
    let warning: string | null = null
    if (declared != null) {
      hours = declared
      if (computed != null && Math.abs(declared - computed) > 0.05) {
        const interval = timeLabel ?? '—'
        const declaredShown = declaredRaw ?? `${fmt(declared)} ${hoursWord(declared)}`
        warning = `в отчёте «Общее время: ${declaredShown}» (= ${fmt(declared)} ${hoursWord(declared)}), а интервал «Время: ${interval}» = ${fmt(computed)} ${hoursWord(computed)} — что верно?`
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
      timeLabel,
      declaredLabel: declaredRaw,
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
        byDay: {},
        isActivist: false,
      }
      map.set(e.extId, p)
    }
    if (e.kind === 'passive') p.passiveHours = round2(p.passiveHours + e.hours)
    else p.activeHours = round2(p.activeHours + e.hours)
    p.hours = round2(p.passiveHours + p.activeHours)
    p.points = round2(p.points + e.points)
    p.isActivist = p.hours >= ACTIVIST_MIN_HOURS
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

function dayEntries(p: Person, day: string, kind: WatchKind): WatchEntry[] {
  return p.entries.filter((e) => shortDate(e.date) === day && e.kind === kind)
}

/** Подсказка: часы как в отчёте, без перевода в баллы */
function dayCellTitle(p: Person, day: string, kind: WatchKind): string {
  const kindLabel = kind === 'active' ? 'Актив' : 'Пассив'
  const list = dayEntries(p, day, kind)
  if (list.length === 0) return `${kindLabel}: нет записей`
  const lines = list.map((e) => {
    const parts: string[] = []
    if (e.declaredLabel) parts.push(`Общее время: ${e.declaredLabel}`)
    if (e.timeLabel) parts.push(`Время: ${e.timeLabel}`)
    if (parts.length === 0) parts.push(`${fmt(e.hours)} ${hoursWord(e.hours)}`)
    return parts.join(' · ')
  })
  if (lines.length === 1) return `${kindLabel}: ${lines[0]}`
  return `${kindLabel} (${list.length}):\n${lines.map((l, i) => `${i + 1}) ${l}`).join('\n')}`
}

/** TSV matching the Google Sheets template for paste */
function buildSheetTsv(people: Person[], dates: string[]): string {
  const r1 = ['Имя CatWar', 'ID', 'Общий балл', 'Всего часов', 'Активист']
  for (const d of dates) {
    r1.push(d, '') // date spans active+passive
  }
  const r2 = ['', '', '', '', '']
  for (const _d of dates) {
    r2.push('Активный', 'Пассивный')
  }
  const body = people.map((p) => {
    const row = [
      p.name,
      p.extId,
      fmtSheet(p.points),
      fmtSheet(p.hours),
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

type DozoryMatrixProps = {
  people: Person[]
  dates: string[]
  minTableWidth: number
  onCopyName: (p: Person) => void
  onCopyId: (extId: string) => void
  footer: ReactNode
}

function DozoryMatrix({
  people,
  dates,
  minTableWidth,
  onCopyName,
  onCopyId,
  footer,
}: DozoryMatrixProps) {
  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="overflow-auto max-h-[70vh]">
        <table
          className="caption-bottom text-sm border-separate border-spacing-0"
          style={{ tableLayout: 'fixed', width: minTableWidth, minWidth: minTableWidth }}
        >
          <colgroup>
            <col style={{ width: 144 }} />
            <col style={{ width: 88 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
            <col style={{ width: 80 }} />
            {dates.map((d) => (
              <Fragment key={`col-${d}`}>
                <col style={{ width: 68 }} />
                <col style={{ width: 68 }} />
              </Fragment>
            ))}
          </colgroup>
          <thead>
            <tr className="bg-muted">
              <th className="sticky top-0 left-0 z-40 border-b border-r bg-muted px-2 py-2 text-left align-bottom font-medium">
                Имя CatWar
              </th>
              <th className="sticky top-0 left-[144px] z-40 border-b border-r bg-muted px-2 py-2 text-left align-bottom font-medium shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)]">
                ID
              </th>
              <th
                className="sticky top-0 z-30 border-b border-r bg-amber-100/80 px-2 py-2 text-center align-bottom font-medium leading-tight text-amber-950"
                title="Сумма баллов: пассив ×1 + актив ×1,5"
              >
                Общий
                <br />
                балл
              </th>
              <th
                className="sticky top-0 z-30 border-b border-r bg-sky-100/80 px-2 py-2 text-center align-bottom font-medium leading-tight text-sky-950"
                title="Сумма часов активного и пассивного дозора"
              >
                Всего
                <br />
                часов
              </th>
              <th
                className="sticky top-0 z-30 border-b border-r-2 border-r-foreground/25 bg-muted px-2 py-2 text-center align-bottom font-medium"
                title="1, если суммарно ≥ 10 часов дозоров"
              >
                Активист
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  colSpan={2}
                  className="sticky top-0 z-30 border-b border-r-2 border-r-foreground/20 bg-muted p-0 align-bottom"
                >
                  <div className="border-b border-border/60 px-1 py-1.5 text-center font-mono font-semibold text-sm">
                    {d}
                    <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">
                      часы
                    </span>
                  </div>
                  <div className="grid grid-cols-2">
                    <div className="border-r border-rose-300/80 bg-rose-50/90 px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-rose-800">
                      Актив
                      <span className="block font-normal normal-case tracking-normal text-rose-700/80">
                        ×1,5
                      </span>
                    </div>
                    <div className="bg-sky-50/90 px-1 py-1 text-center text-[10px] font-semibold uppercase tracking-wide text-sky-900">
                      Пассив
                      <span className="block font-normal normal-case tracking-normal text-sky-800/80">
                        ×1
                      </span>
                    </div>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {people.map((p, idx) => {
              const warnEntries = p.entries.filter((e) => e.warning)
              const hasWarn = warnEntries.length > 0
              const warnTitle = warnEntries.map((e) => e.warning).join('\n')
              const stripe = idx % 2 === 1
              const rowBg = hasWarn
                ? 'bg-amber-50/70 dark:bg-amber-950/20'
                : stripe
                  ? 'bg-[#fff5f7]'
                  : 'bg-background'
              const stickyBg = hasWarn
                ? 'bg-amber-50 dark:bg-amber-950'
                : stripe
                  ? 'bg-[#fff5f7] hover:bg-rose-100'
                  : 'bg-background hover:bg-rose-50'
              const cellBase =
                'border-b border-r px-2 py-2 text-center text-sm tabular-nums whitespace-nowrap transition-colors'
              return (
                <tr key={p.extId} className={cn('group border-b', rowBg)}>
                  <td
                    className={cn(
                      'sticky left-0 z-10 border-b border-r px-2 py-2 font-medium transition-colors',
                      stickyBg
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onCopyName(p)}
                      className="group/name inline-flex max-w-full items-center gap-1 rounded text-left font-medium transition-colors hover:text-rose-800 focus-visible:outline-2 focus-visible:outline-rose-500"
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
                    {hasWarn && (
                      <AlertTriangle
                        className="inline h-3 w-3 ml-1 text-amber-600 align-middle"
                        aria-label="Спорное время — перепроверьте пост"
                        title={warnTitle}
                      />
                    )}
                  </td>
                  <td
                    className={cn(
                      'sticky left-[144px] z-10 border-b border-r px-2 py-2 font-mono text-xs text-muted-foreground whitespace-nowrap shadow-[2px_0_4px_-2px_rgba(0,0,0,0.12)] transition-colors',
                      stickyBg
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onCopyId(p.extId)}
                      className="group inline-flex items-center gap-1 rounded font-mono text-xs text-muted-foreground transition-colors hover:text-rose-800 focus-visible:outline-2 focus-visible:outline-rose-500"
                      aria-label={`Скопировать ID ${p.extId}`}
                      title="Клик — скопировать только ID"
                    >
                      {p.extId}
                      <Copy
                        className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70"
                        aria-hidden="true"
                      />
                    </button>
                  </td>
                  <td
                    className={cn(
                      cellBase,
                      'font-semibold tabular-nums text-amber-950',
                      stripe ? 'bg-amber-50/40 hover:bg-amber-100/70' : 'bg-amber-50/25 hover:bg-amber-50'
                    )}
                    title="Баллы"
                  >
                    {fmt(p.points)}
                  </td>
                  <td
                    className={cn(
                      cellBase,
                      'font-semibold tabular-nums text-sky-950',
                      stripe ? 'bg-sky-50/50 hover:bg-sky-100/70' : 'bg-sky-50/30 hover:bg-sky-50'
                    )}
                    title="Часы"
                  >
                    {fmt(p.hours)}
                  </td>
                  <td
                    className={cn(
                      cellBase,
                      'border-r-2 border-r-foreground/25',
                      stripe ? 'hover:bg-rose-100' : 'hover:bg-rose-50'
                    )}
                  >
                    {p.isActivist ? '1' : '0'}
                  </td>
                  {dates.map((d) => {
                    const a = dayCell(p, d, 'active')
                    const s = dayCell(p, d, 'passive')
                    return (
                      <Fragment key={`${p.extId}-${d}`}>
                        <td
                          className={cn(
                            cellBase,
                            a > 0
                              ? 'bg-rose-100/90 font-medium text-rose-950 hover:bg-rose-200'
                              : cn(
                                  'bg-rose-50/30',
                                  stripe ? 'hover:bg-rose-100' : 'hover:bg-rose-50'
                                )
                          )}
                          title={dayCellTitle(p, d, 'active')}
                        >
                          {a > 0 ? fmt(a) : ''}
                        </td>
                        <td
                          className={cn(
                            cellBase,
                            'border-r-2 border-r-foreground/20',
                            s > 0
                              ? 'bg-sky-100/90 font-medium text-sky-950 hover:bg-sky-200'
                              : cn(
                                  'bg-sky-50/30',
                                  stripe ? 'hover:bg-sky-100' : 'hover:bg-sky-50'
                                )
                          )}
                          title={dayCellTitle(p, d, 'passive')}
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
        {footer}
      </div>
    </div>
  )
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
  const [sortMode, setSortMode] = useState<'alpha' | 'points'>('alpha')
  const [hydrated, setHydrated] = useState(false)
  const [inputOpen, setInputOpen] = useState(true)
  const [userToggledInput, setUserToggledInput] = useState(false)

  useEffect(() => {
    const saved = localStorage.getItem('dozoryText')
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration from localStorage
    if (saved) {
      setText(saved)
      if (saved.length >= COLLAPSE_CHARS) setInputOpen(false)
    }
    setHydrated(true)
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
  const dates = useMemo(() => collectDates(parsed.entries), [parsed.entries])
  const people = useMemo(() => aggregate(parsed.entries), [parsed.entries])

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

  async function copyId(extId: string) {
    const ok = await copyText(extId)
    toast(ok ? { title: 'ID скопирован', description: extId } : { title: 'Не удалось скопировать' })
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

  const disputed = useMemo(
    () => parsed.entries.filter((e) => e.warning),
    [parsed.entries]
  )

  const stats = [
    { icon: ListChecks, value: String(parsed.entries.length), label: 'записей', warn: false },
    { icon: UserRound, value: String(people.length), label: 'участников', warn: false },
    { icon: Timer, value: fmt(totals.hours), label: 'часов всего', warn: false },
    { icon: Coins, value: fmt(totals.points), label: 'баллов всего', warn: false },
    {
      icon: AlertTriangle,
      value: String(totals.warnings),
      label: 'спорное время',
      warn: totals.warnings > 0,
      title:
        '«Общее время» в посте не совпадает с длиной интервала «Время: ЧЧ:ММ — ЧЧ:ММ». В расчёт берём «Общее время» — сверьте, какая цифра верная.',
    },
  ]

  // colgroup: 144 + 88 + 80 + 80 + 80 + dates * (68+68)
  const minTableWidth = 472 + dates.length * 136
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
              В ячейках дат — только часы. Баллы считаются отдельно: пассив ×1, актив ×1,5. Большой
              текст сворачивается автоматически — таблица остаётся на виду.
            </p>
          </div>
        ) : (
          <div id="dozory-input-panel" className="px-4 py-2.5 border-t text-xs text-muted-foreground">
            Поле свёрнуто. Вставка из буфера работает и так; чтобы править текст — нажмите «Развернуть».
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border p-4 flex items-center gap-3"
            title={'title' in s ? s.title : undefined}
          >
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

      {disputed.length > 0 && (
        <div className="rounded-lg border border-amber-300/80 bg-amber-50/80 px-4 py-3 space-y-2">
          <p className="text-sm font-medium text-amber-950 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0 text-amber-700" aria-hidden="true" />
            Спорное время — перепроверьте эти посты
          </p>
          <p className="text-xs text-amber-900/90 leading-relaxed">
            В расчёт сейчас идёт строка «Общее время». Если она ошибочна, а верный интервал в
            «Время: ЧЧ:ММ — ЧЧ:ММ» — поправьте «Общее время» в исходном посте (или наоборот).
            Пример: «Общее время: 30 минут», а «Время: 09:03 — 10:03» — это уже 1 час.
          </p>
          <ul className="space-y-2 text-xs text-amber-950">
            {disputed.map((e, i) => (
              <li
                key={`${e.extId}-${e.date}-${e.kind}-${i}`}
                className="rounded-md border border-amber-200/80 bg-background/70 px-3 py-2"
              >
                <div className="font-medium">
                  {e.name} [{e.extId}] · {shortDate(e.date)} ·{' '}
                  {e.kind === 'active' ? 'актив' : 'пассив'}
                </div>
                <div className="mt-0.5 text-amber-900/90">{e.warning}</div>
              </li>
            ))}
          </ul>
        </div>
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

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-amber-200 ring-1 ring-amber-400/60" />
              баллы
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-200 ring-1 ring-sky-400/60" />
              часы
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-200 ring-1 ring-rose-400/60" />
              актив ×{ACTIVE_RATE.toLocaleString('ru-RU')}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-sky-100 ring-1 ring-sky-500/50" />
              пассив ×{PASSIVE_RATE}
            </span>
            <span className="text-muted-foreground/80">
              В колонках дат — часы, не баллы
            </span>
          </div>

          <DozoryMatrix
            people={sortedPeople}
            dates={dates}
            minTableWidth={minTableWidth}
            onCopyName={copyName}
            onCopyId={copyId}
            footer={
              <>
                <span>
                  Итого часов: пассив {fmt(totals.passive)} · актив {fmt(totals.active)} · всего{' '}
                  {fmt(totals.hours)}
                </span>
                <span>Общий балл суммарно: {fmt(totals.points)}</span>
                <span>
                  Активистов (≥ {ACTIVIST_MIN_HOURS} ч):{' '}
                  {sortedPeople.filter((p) => p.isActivist).length}
                </span>
                <span>Дат в шапке: {dates.join(', ')}</span>
              </>
            }
          />
        </>
      )}
    </div>
  )
}
