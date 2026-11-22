'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  Braces,
  Check,
  ClipboardPaste,
  Copy,
  Download,
  Eraser,
  FileDown,
  FileUp,
  ListChecks,
  Pencil,
  Plus,
  Repeat,
  Search,
  ShieldCheck,
  Trash2,
  Users,
} from 'lucide-react'
import DozoryTool from '@/components/dozory-tool'
import { cn } from '@/lib/utils'
import {
  addActivist,
  buildBackup,
  clearActivists,
  deleteActivist,
  loadActivists,
  restoreBackup,
  saveActivists,
  updateActivist,
} from '@/lib/store'
import type { Activist } from '@/lib/store'

const CATEGORIES: { key: string; label: string; hint: string }[] = [
  { key: 'patrol', label: 'Патрули', hint: 'пограничные патрули' },
  { key: 'sentry', label: 'Дозоры', hint: 'дозоры' },
  { key: 'hunt', label: 'Охота', hint: 'охотничьи патрули' },
  { key: 'mountains', label: 'Горы', hint: 'горные мховники' },
  { key: 'tunnels', label: 'Туннели', hint: 'туннели' },
  { key: 'cliffs', label: 'Скалы', hint: 'активист недели' },
]

const CAT_KEYS = CATEGORIES.map((c) => c.key)

function parseCats(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => CAT_KEYS.includes(s))
}

function catsOf(raw: string): Set<string> {
  return new Set(parseCats(raw))
}

function ruCompare(a: Activist, b: Activist): number {
  return a.name.localeCompare(b.name, 'ru', { sensitivity: 'base' }) || a.extId.localeCompare(b.extId)
}

function parseLine(line: string): { name: string; extId: string } | null {
  const matches = Array.from(line.matchAll(/\d{3,}/g))
  if (matches.length === 0) return null
  const last = matches[matches.length - 1]
  const extId = last[0]
  const rest = line.slice(0, last.index ?? 0) + line.slice((last.index ?? 0) + extId.length)
  const name = rest
    .replace(/[[\](){}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[—–\-,:;]+$/g, '')
    .trim()
  if (!name) return null
  return { name, extId }
}

// Default reporting week: the most recent completed Sun–Sat week, format DD.MM
function defaultWeek(): { from: string; to: string } {
  const now = new Date()
  const sunday = new Date(now)
  sunday.setDate(now.getDate() - now.getDay())
  const start = new Date(sunday)
  start.setDate(sunday.getDate() - 7)
  const end = new Date(sunday)
  end.setDate(sunday.getDate() - 1)
  const fmt = (d: Date) =>
    `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`
  return { from: fmt(start), to: fmt(end) }
}

// BB template for the forum post — exactly the user's layout,
// with placeholders for week dates and per-category name lists.
const BB_TEMPLATE = `[bgrf=#D2BA9E][color=#161417][divr=https://github.com/brightestsunset/groza_files/blob/main/NPKq.png?raw=true][center][size=15][hr][bgrf=#d2ba9e90] [header=акт][font=impact]АКТИВИСТЫ 「 __DATE__ 」[/font][/header] [/bgrf][/size][/center][hr][/divr][block=акт]
[font=palatino linotype][center][pad=5 5 0 5][table=0][tr][td][bgrf=#C6AB91][pad=2][bgrf=#E3D1BC][table=0]
[tr][td][b][center][pad=1 0 0 1][bgrf=#C6AB9170][pad=10 20]Сфера[/pad][/bgrf][/pad][/center][/b][/td][td][bgrf=#C6AB9170][pad=0 1 0 0][size=5][color=transparent].
.[/color][/size][/pad][/bgrf][/td][td][b][center][pad=1 0 0 0][bgrf=#C6AB9170][pad=10]Активисты[/pad][/bgrf][/pad][/center][/b][/td][/tr]
[tr][td=c3][bgrf=#C6AB9170][pad=1 0][/pad][/bgrf][/td][/tr]
[tr][td][pad=5]Патрули[/pad][/td][td][bgrf=#C6AB9170][pad=0 1 0 0][size=5][color=transparent].

.[/color][/size][/pad][/bgrf][/td]
[td][pad=5]__LIST_PATROL__[size=10][color=#36201950] [/color][/size][/pad][/td]
[/tr]
[tr][td=c5][bgrf=#C6AB9170][pad=1 0][/pad][/bgrf][/td][/tr]
[tr][td][pad=5]Дозоры[/pad][/td]
[td][bgrf=#C6AB9170][pad=0 1 0 0][size=5][color=transparent].

.[/color][/size][/pad][/bgrf][/td]
[td][pad=5]__LIST_SENTRY__[/pad][/td]
[/tr]
[tr][td=c5][bgrf=#C6AB9170][pad=1 0][/pad][/bgrf][/td][/tr]
[tr][td][pad=5]Охота[/pad][/td]
[td][bgrf=#C6AB9170][pad=0 1 0 0][size=5][color=transparent].

.[/color][/size][/pad][/bgrf][/td]
[td][pad=5]__LIST_HUNT__[/pad][/td]
[/tr]
[tr][td=c5][bgrf=#C6AB9170][pad=1 0][/pad][/bgrf][/td][/tr]
[tr][td][pad=5]Туннели[/pad][/td]
[td][bgrf=#C6AB9170][pad=0 1 0 0][size=5][color=transparent].

.[/color][/size][/pad][/bgrf][/td]
[td][pad=5]__LIST_TUNNELS__[/pad][/td]
[/tr]
[tr][td=c5][bgrf=#C6AB9170][pad=1 0][/pad][/bgrf][/td][/tr]
[tr][td][pad=5]Горы[/pad][/td]
[td][bgrf=#C6AB9170][pad=0 1 0 0][size=5][color=transparent].

.[/color][/size][/pad][/bgrf][/td]
[td][pad=5]__LIST_MOUNTAINS__[/pad][/td]
[/tr]
[tr][td=c5][bgrf=#C6AB9170][pad=1 0][/pad][/bgrf][/td][/tr]
[tr][td][pad=5]Cкалы[/pad][/td]
[td][bgrf=#C6AB9170][pad=0 1 0 0][size=5][color=transparent].

.[/color][/size][/pad][/bgrf][/td]
[td][pad=5]__LIST_CLIFFS__[/pad][/td]
[/tr][/table][/bgrf][/pad][/bgrf][/td][/tr][/table][/pad][/center][/font]

[/block][/color][/bgrf]`

// Build the BB post: names inside each category are alphabetical, empty ones get "-"
function buildBb(from: string, to: string, list: Activist[]): string {
  const mkList = (key: string) => {
    const members = list
      .filter((a) => catsOf(a.categories).has(key))
      .sort(ruCompare)
      .map((a) => `${a.name} [${a.extId}]`)
    return members.length > 0 ? members.join(', ') : '-'
  }
  return BB_TEMPLATE.replace('__DATE__', () => `${from} – ${to}`)
    .replace('__LIST_PATROL__', () => mkList('patrol'))
    .replace('__LIST_SENTRY__', () => mkList('sentry'))
    .replace('__LIST_HUNT__', () => mkList('hunt'))
    .replace('__LIST_TUNNELS__', () => mkList('tunnels'))
    .replace('__LIST_MOUNTAINS__', () => mkList('mountains'))
    .replace('__LIST_CLIFFS__', () => mkList('cliffs'))
}

export default function Page() {
  const { toast } = useToast()
  const [activists, setActivists] = useState<Activist[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'activists' | 'dozory'>('activists')

  // dialog state
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<Activist | null>(null)
  const [formName, setFormName] = useState('')
  const [formExtId, setFormExtId] = useState('')
  const [formCats, setFormCats] = useState<Set<string>>(new Set())
  const [saving, setSaving] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<Activist | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importText, setImportText] = useState('')
  const [importCats, setImportCats] = useState<Set<string>>(new Set())
  const [importing, setImporting] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const [bbOpen, setBbOpen] = useState(false)
  const [bbText, setBbText] = useState('')
  const [bbFrom, setBbFrom] = useState('')
  const [bbTo, setBbTo] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const snapshotRef = useRef<Activist[] | null>(null)

  // data lives in localStorage (GitHub Pages has no server) — load is instant
  const load = useCallback(() => {
    try {
      setActivists([...loadActivists()].sort(ruCompare))
      setLoadError(null)
    } catch {
      setLoadError('Не удалось загрузить данные из браузера')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const def = defaultWeek()
    setBbFrom(localStorage.getItem('bbDateFrom') ?? def.from)
    setBbTo(localStorage.getItem('bbDateTo') ?? def.to)
  }, [])

  const sorted = useMemo(() => [...activists].sort(ruCompare), [activists])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return sorted
    return sorted.filter(
      (a) => a.name.toLowerCase().includes(q) || a.extId.includes(q.replace(/\D/g, '') || '\u0000') || a.extId.includes(q)
    )
  }, [sorted, query])

  const totalMarks = useMemo(
    () => activists.reduce((acc, a) => acc + parseCats(a.categories).length, 0),
    [activists]
  )
  const multiCat = useMemo(
    () => activists.filter((a) => parseCats(a.categories).length >= 2).length,
    [activists]
  )

  const catTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const c of CATEGORIES) {
      map.set(
        c.key,
        activists.filter((a) => catsOf(a.categories).has(c.key)).length
      )
    }
    return map
  }, [activists])

  const withSnapshot = (current: Activist[]) => {
    snapshotRef.current = current
  }

  const revertSnapshot = () => {
    if (snapshotRef.current) setActivists(snapshotRef.current)
    snapshotRef.current = null
  }

  const copyText = async (text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        return true
      } catch {
        return false
      }
    }
  }

  const copyRow = async (a: Activist) => {
    const text = `${a.name} [${a.extId}]`
    if (await copyText(text)) {
      toast({ title: 'Скопировано', description: text })
    } else {
      toast({
        title: 'Не удалось скопировать',
        description: text,
        variant: 'destructive',
      })
    }
  }

  const copyId = async (extId: string) => {
    if (await copyText(extId)) {
      toast({ title: 'ID скопирован', description: extId })
    } else {
      toast({ title: 'Не удалось скопировать', description: extId, variant: 'destructive' })
    }
  }

  const copyBb = async () => {
    if (await copyText(bbText)) {
      toast({ title: 'BB-код скопирован', description: 'Вставь его в тему на форуме' })
    } else {
      toast({
        title: 'Не удалось скопировать',
        description: 'Выдели текст в поле и скопируй вручную',
        variant: 'destructive',
      })
    }
  }

  const openBb = () => {
    setBbText(buildBb(bbFrom, bbTo, activists))
    setBbOpen(true)
  }

  const changeBbDate = (which: 'from' | 'to', value: string) => {
    if (which === 'from') {
      setBbFrom(value)
      localStorage.setItem('bbDateFrom', value)
    } else {
      setBbTo(value)
      localStorage.setItem('bbDateTo', value)
    }
  }

  const toggleCategory = async (a: Activist, key: string) => {
    const has = catsOf(a.categories).has(key)
    const nextKeys = has
      ? parseCats(a.categories).filter((k) => k !== key)
      : [...parseCats(a.categories), key]
    withSnapshot(activists)
    const nextCats = nextKeys.join(',')
    const next = activists.map((x) => (x.id === a.id ? { ...x, categories: nextCats } : x))
    setActivists(next)
    try {
      const res = updateActivist(a.id, { categories: nextCats })
      if (!res.ok) throw new Error(res.error)
      snapshotRef.current = null
    } catch {
      revertSnapshot()
      toast({
        title: 'Ошибка сохранения',
        description: 'Не удалось изменить отметку. Попробуйте ещё раз.',
        variant: 'destructive',
      })
    }
  }

  const openAdd = () => {
    setEditing(null)
    setFormName('')
    setFormExtId('')
    setFormCats(new Set())
    setDialogOpen(true)
  }

  const openEdit = (a: Activist) => {
    setEditing(a)
    setFormName(a.name)
    setFormExtId(a.extId)
    setFormCats(catsOf(a.categories))
    setDialogOpen(true)
  }

  const duplicateId = useMemo(() => {
    const id = formExtId.trim()
    if (!id) return null
    const found = activists.find((x) => x.extId === id)
    if (!found) return null
    if (editing && found.id === editing.id) return null
    return found
  }, [formExtId, activists, editing])

  const submitDialog = async () => {
    const name = formName.trim()
    const extId = formExtId.trim()
    if (!name || !extId || duplicateId) return
    setSaving(true)
    const categories = Array.from(formCats).join(',')
    try {
      const result = editing
        ? updateActivist(editing.id, { name, extId, categories })
        : addActivist(name, extId, categories)
      if (!result.ok) {
        toast({
          title: editing ? 'Не удалось сохранить' : 'Не удалось добавить',
          description: result.error || 'Попробуйте ещё раз',
          variant: 'destructive',
        })
        return
      }
      setDialogOpen(false)
      load()
      toast({
        title: editing ? 'Сохранено' : 'Добавлено',
        description: `${name} (ID: ${extId})`,
      })
    } catch {
      toast({
        title: 'Ошибка',
        description: 'Попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setSaving(false)
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleteTarget(null)
    withSnapshot(activists)
    setActivists((prev) => prev.filter((x) => x.id !== target.id))
    try {
      deleteActivist(target.id)
      snapshotRef.current = null
      toast({ title: 'Удалено', description: `${target.name} (ID: ${target.extId})` })
    } catch {
      revertSnapshot()
      toast({
        title: 'Ошибка',
        description: 'Не удалось удалить активиста',
        variant: 'destructive',
      })
    }
  }

  const confirmClearAll = async () => {
    setClearOpen(false)
    withSnapshot(activists)
    setActivists([])
    setQuery('')
    try {
      clearActivists()
      snapshotRef.current = null
      toast({
        title: 'Список очищен',
        description: 'Можно импортировать активистов новой недели',
      })
    } catch {
      revertSnapshot()
      toast({
        title: 'Ошибка',
        description: 'Не удалось очистить список',
        variant: 'destructive',
      })
    }
  }

  const runImport = async () => {
    const lines = importText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
    const parsed = lines.map(parseLine)
    const valid = parsed.filter((p): p is { name: string; extId: string } => p !== null)
    const invalid = lines.length - valid.length

    if (valid.length === 0) {
      toast({
        title: 'Нечего импортировать',
        description: 'В каждой строке должно быть имя и числовой ID, например: Песнь [1568486]',
        variant: 'destructive',
      })
      return
    }

    setImporting(true)
    let added = 0
    let skipped = 0
    const catsStr = Array.from(importCats).join(',')
    try {
      for (const p of valid) {
        const result = addActivist(p.name, p.extId, catsStr)
        if (result.ok) added++
        else skipped++
      }
      setImportOpen(false)
      setImportText('')
      load()
      const parts = [`Добавлено: ${added}`]
      if (skipped) parts.push(`Пропущено (повтор ID): ${skipped}`)
      if (invalid) parts.push(`Строк без ID: ${invalid}`)
      toast({
        title: 'Импорт завершён',
        description: parts.join(' · '),
        variant: skipped > 0 ? 'default' : 'default',
      })
    } catch {
      toast({
        title: 'Ошибка',
        description: 'Импорт прерван, попробуйте ещё раз',
        variant: 'destructive',
      })
    } finally {
      setImporting(false)
    }
  }

  const exportCsv = () => {
    const header = ['Имя', 'ID', ...CATEGORIES.map((c) => c.label), 'Итого']
    const rows = sorted.map((a) => {
      const cats = catsOf(a.categories)
      return [
        a.name,
        a.extId,
        ...CATEGORIES.map((c) => (cats.has(c.key) ? '+' : '')),
        String(cats.size),
      ]
    })
    const csv =
      '\uFEFF' +
      [header, ...rows]
        .map((r) => r.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(';'))
        .join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'aktivisty.csv'
    link.click()
    URL.revokeObjectURL(url)
    toast({ title: 'Экспорт готов', description: `Файл aktivisty.csv, активистов: ${sorted.length}` })
  }

  const downloadBackup = () => {
    const json = JSON.stringify(buildBackup(activists), null, 2)
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `aktivisty-backup-${new Date().toISOString().slice(0, 10)}.json`
    link.click()
    URL.revokeObjectURL(url)
    toast({ title: 'Резервная копия скачана', description: `Активистов: ${activists.length}` })
  }

  const onBackupFile = async (file: File | undefined) => {
    if (!file) return
    let text = ''
    try {
      text = await file.text()
    } catch {
      toast({ title: 'Не удалось прочитать файл', variant: 'destructive' })
      return
    }
    const mode = activists.length > 0 ? 'merge' : 'replace'
    const result = restoreBackup(text, mode)
    if (result.ok) {
      load()
      toast({
        title: 'Восстановлено',
        description:
          mode === 'replace'
            ? `Загружено активистов: ${result.restored}`
            : `Добавлено новых: ${result.restored} (повторы ID пропущены)`,
      })
    } else {
      toast({ title: 'Ошибка восстановления', description: result.error, variant: 'destructive' })
    }
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="border-b">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5">
          <div className="flex flex-col gap-1">
            {view === 'activists' ? (
              <>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Активисты — учёт по категориям</h1>
                <p className="text-sm text-muted-foreground">
                  Список отсортирован по алфавиту. Клик по клетке ставит или снимает отметку, клик по имени копирует «Имя [ID]», счётчик повторов считается сам.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-xl sm:text-2xl font-semibold tracking-tight">Дозоры — разбалловка</h1>
                <p className="text-sm text-muted-foreground">
                  Вставьте посты с дозорами: имя и ID берутся из строки «Дозорный», часы — из «Общее время», баллы считаются сами: пассив — 1 балл/час, актив — 1,5 балла/час.
                </p>
              </>
            )}
          </div>
          <div
            className="mt-4 inline-flex w-full sm:w-auto rounded-lg border bg-muted/40 p-1 gap-1"
            role="tablist"
            aria-label="Разделы"
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === 'activists'}
              onClick={() => setView('activists')}
              className={cn(
                'inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-md px-4 h-9 text-sm font-medium transition-colors',
                view === 'activists' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <Users className="h-4 w-4" aria-hidden="true" />
              Активисты
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === 'dozory'}
              onClick={() => setView('dozory')}
              className={cn(
                'inline-flex flex-1 sm:flex-none items-center justify-center gap-2 rounded-md px-4 h-9 text-sm font-medium transition-colors',
                view === 'dozory' ? 'bg-background shadow-sm text-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
              Дозоры
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-4">
          {view === 'activists' ? (
          <>
          {/* stats */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border p-4 flex items-center gap-3">
              <Users className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
              <div>
                <div className="text-2xl font-semibold leading-none">{activists.length}</div>
                <div className="text-xs text-muted-foreground mt-1">активистов</div>
              </div>
            </div>
            <div className="rounded-lg border p-4 flex items-center gap-3">
              <ListChecks className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden="true" />
              <div>
                <div className="text-2xl font-semibold leading-none">{totalMarks}</div>
                <div className="text-xs text-muted-foreground mt-1">отметок всего</div>
              </div>
            </div>
            <div className="rounded-lg border p-4 flex items-center gap-3">
              <Repeat className={cn('h-5 w-5 shrink-0', multiCat > 0 ? 'text-amber-600' : 'text-muted-foreground')} aria-hidden="true" />
              <div>
                <div className={cn('text-2xl font-semibold leading-none', multiCat > 0 && 'text-amber-700')}>{multiCat}</div>
                <div className="text-xs text-muted-foreground mt-1">в 2+ категориях</div>
              </div>
            </div>
          </div>

          {/* toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-52">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Поиск по имени или ID"
                className="pl-8"
                aria-label="Поиск по имени или ID"
              />
            </div>
            <Button onClick={openAdd}>
              <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
              Добавить
            </Button>
            <Button variant="outline" onClick={() => setImportOpen(true)}>
              <ClipboardPaste className="h-4 w-4 mr-1" aria-hidden="true" />
              Импорт
            </Button>
            <Button variant="outline" onClick={exportCsv} disabled={activists.length === 0}>
              <Download className="h-4 w-4 mr-1" aria-hidden="true" />
              Экспорт CSV
            </Button>
            <Button variant="outline" onClick={downloadBackup} disabled={activists.length === 0}>
              <FileDown className="h-4 w-4 mr-1" aria-hidden="true" />
              Резерв
            </Button>
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              aria-label="Восстановить из резервной копии"
            >
              <FileUp className="h-4 w-4 mr-1" aria-hidden="true" />
              Восстановить
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => onBackupFile(e.target.files?.[0])}
              aria-hidden="true"
              tabIndex={-1}
            />
            <Button variant="outline" onClick={openBb} disabled={activists.length === 0}>
              <Braces className="h-4 w-4 mr-1" aria-hidden="true" />
              BB-код
            </Button>
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              onClick={() => setClearOpen(true)}
              disabled={activists.length === 0}
            >
              <Eraser className="h-4 w-4 mr-1" aria-hidden="true" />
              Очистить всё
            </Button>
          </div>

          {/* table */}
          {loading ? (
            <div className="rounded-lg border p-10 text-center text-sm text-muted-foreground">Загрузка…</div>
          ) : loadError ? (
            <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 text-center space-y-3">
              <p className="text-sm text-destructive">{loadError}</p>
              <Button variant="outline" onClick={() => { setLoading(true); load() }}>
                Попробовать снова
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border overflow-hidden">
              <div className="max-h-[60vh] overflow-y-auto">
                <Table className="min-w-[760px]">
                  <TableHeader className="sticky top-0 bg-background z-10">
                    <TableRow className="bg-muted/50 hover:bg-muted/50">
                      <TableHead className="w-10 text-center">#</TableHead>
                      <TableHead>Имя</TableHead>
                      <TableHead>ID</TableHead>
                      {CATEGORIES.map((c) => (
                        <TableHead key={c.key} className="text-center px-1">
                          <span title={c.hint}>{c.label}</span>
                        </TableHead>
                      ))}
                      <TableHead className="text-center">Итого</TableHead>
                      <TableHead className="w-20 text-center">
                        <span className="sr-only">Действия</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={10} className="h-40 text-center">
                          {activists.length === 0 ? (
                            <div className="space-y-2">
                              <p className="text-sm text-muted-foreground">Пока никого нет.</p>
                              <Button variant="outline" onClick={openAdd}>
                                <Plus className="h-4 w-4 mr-1" aria-hidden="true" />
                                Добавить первого активиста
                              </Button>
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">Ничего не найдено по запросу «{query}»</p>
                          )}
                        </TableCell>
                      </TableRow>
                    ) : (
                      filtered.map((a, idx) => {
                        const cats = catsOf(a.categories)
                        const count = cats.size
                        return (
                          <TableRow
                            key={a.id}
                            className={cn(count >= 2 && 'bg-amber-50/60 dark:bg-amber-950/20')}
                          >
                            <TableCell className="text-center text-muted-foreground text-xs">{idx + 1}</TableCell>
                            <TableCell className="font-medium max-w-48">
                              <button
                                type="button"
                                onClick={() => copyRow(a)}
                                className="group inline-flex max-w-full items-center gap-1 rounded text-left font-medium transition-colors hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-600"
                                aria-label={`Скопировать ${a.name} [${a.extId}]`}
                                title="Клик — скопировать «Имя [ID]»"
                              >
                                <span className="truncate" title={a.name}>
                                  {a.name}
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
                                onClick={() => copyId(a.extId)}
                                className="group inline-flex items-center gap-1 rounded font-mono text-xs text-muted-foreground transition-colors hover:text-emerald-700 focus-visible:outline-2 focus-visible:outline-emerald-600"
                                aria-label={`Скопировать ID ${a.extId}`}
                                title="Клик — скопировать только ID"
                              >
                                {a.extId}
                                <Copy
                                  className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70"
                                  aria-hidden="true"
                                />
                              </button>
                            </TableCell>
                            {CATEGORIES.map((c) => {
                              const active = cats.has(c.key)
                              return (
                                <TableCell key={c.key} className="text-center p-0">
                                  <button
                                    type="button"
                                    onClick={() => toggleCategory(a, c.key)}
                                    aria-pressed={active}
                                    aria-label={`${a.name}: ${active ? 'убрать из' : 'добавить в'} ${c.label}`}
                                    className={cn(
                                      'h-11 w-full min-w-11 inline-flex items-center justify-center transition-colors',
                                      'hover:bg-muted/70 focus-visible:outline-2 focus-visible:outline-emerald-600'
                                    )}
                                  >
                                    {active ? (
                                      <span className="h-6 w-6 rounded-full bg-emerald-100 text-emerald-700 inline-flex items-center justify-center">
                                        <Check className="h-4 w-4" aria-hidden="true" />
                                      </span>
                                    ) : (
                                      <span className="h-2 w-2 rounded-full bg-border" aria-hidden="true" />
                                    )}
                                  </button>
                                </TableCell>
                              )
                            })}
                            <TableCell className="text-center">
                              {count >= 2 ? (
                                <Badge className="bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-100">
                                  ×{count}
                                </Badge>
                              ) : count === 1 ? (
                                <span className="text-sm text-muted-foreground">1</span>
                              ) : (
                                <span className="text-sm text-muted-foreground">0</span>
                              )}
                            </TableCell>
                            <TableCell className="text-center">
                              <div className="inline-flex items-center gap-1">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8"
                                  onClick={() => openEdit(a)}
                                  aria-label={`Редактировать ${a.name}`}
                                >
                                  <Pencil className="h-4 w-4" aria-hidden="true" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  onClick={() => setDeleteTarget(a)}
                                  aria-label={`Удалить ${a.name}`}
                                >
                                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                        )
                      })
                    )}
                  </TableBody>
                </Table>
              </div>
              {activists.length > 0 && (
                <div className="border-t bg-muted/30">
                  <Table className="min-w-[760px]">
                    <TableBody>
                      <TableRow className="hover:bg-transparent">
                        <TableCell className="text-xs text-muted-foreground font-medium" colSpan={3}>
                          Итого по категориям
                        </TableCell>
                        {CATEGORIES.map((c) => (
                          <TableCell key={c.key} className="text-center text-sm font-semibold">
                            {catTotals.get(c.key) ?? 0}
                          </TableCell>
                        ))}
                        <TableCell className="text-center text-sm font-semibold" colSpan={2}>
                          {totalMarks}
                        </TableCell>
                      </TableRow>
                    </TableBody>
                  </Table>
                </div>
              )}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Категории: Патрули — пограничные патрули · Дозоры · Охота — охотничьи патрули · Горы — горные мховники · Туннели · Скалы — активист недели.
          </p>
          </>
          ) : (
            <DozoryTool />
          )}
        </div>
      </main>

      <footer className="mt-auto border-t">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 text-center text-xs text-muted-foreground">
          Данные сохраняются автоматически · экспорт CSV открывается в Excel
        </div>
      </footer>

      {/* add / edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? 'Редактировать активиста' : 'Новый активист'}</DialogTitle>
            <DialogDescription>
              {editing
                ? 'Измените имя, ID или отметки категорий.'
                : 'Заполните имя и ID. Категории можно проставить сразу или позже в таблице.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="f-name">Имя (ник)</Label>
              <Input
                id="f-name"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Например: Горностайка"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="f-id">ID</Label>
              <Input
                id="f-id"
                value={formExtId}
                onChange={(e) => setFormExtId(e.target.value.replace(/\D/g, ''))}
                placeholder="Например: 1650292"
                inputMode="numeric"
              />
              {duplicateId && (
                <p className="text-xs text-amber-700">
                  Такой ID уже есть: «{duplicateId.name}». Повторные ID не добавляются.
                </p>
              )}
            </div>
            <div className="space-y-2">
              <Label>Категории</Label>
              <div className="grid grid-cols-2 gap-2">
                {CATEGORIES.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 rounded-md border px-3 h-10 cursor-pointer text-sm hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={formCats.has(c.key)}
                      onCheckedChange={(v) => {
                        setFormCats((prev) => {
                          const next = new Set(prev)
                          if (v) next.add(c.key)
                          else next.delete(c.key)
                          return next
                        })
                      }}
                      aria-label={c.label}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={submitDialog}
              disabled={saving || !formName.trim() || !formExtId.trim() || !!duplicateId}
            >
              {saving ? 'Сохранение…' : editing ? 'Сохранить' : 'Добавить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Импорт списком</DialogTitle>
            <DialogDescription>
              По строке на человека: имя и ID (в скобках или без). Выбранные категории проставятся всем импортированным.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              rows={8}
              placeholder={'Песнь [1568486]\nПылающелапа [1392623]\nГорностайка 1650292'}
              aria-label="Список для импорта"
            />
            <div className="space-y-2">
              <Label>Поставить категории всем из списка</Label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORIES.map((c) => (
                  <label
                    key={c.key}
                    className="flex items-center gap-2 rounded-md border px-3 h-10 cursor-pointer text-sm hover:bg-muted/60"
                  >
                    <Checkbox
                      checked={importCats.has(c.key)}
                      onCheckedChange={(v) => {
                        setImportCats((prev) => {
                          const next = new Set(prev)
                          if (v) next.add(c.key)
                          else next.delete(c.key)
                          return next
                        })
                      }}
                      aria-label={c.label}
                    />
                    {c.label}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              Отмена
            </Button>
            <Button onClick={runImport} disabled={importing || !importText.trim()}>
              {importing ? 'Импорт…' : 'Импортировать'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(v) => !v && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить активиста?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget && (
                <>
                  «{deleteTarget.name}» (ID: {deleteTarget.extId}) будет удалён из всех категорий. Действие нельзя отменить.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmDelete}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* clear all confirm */}
      <AlertDialog open={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Очистить весь список?</AlertDialogTitle>
            <AlertDialogDescription>
              Будут удалены все активисты ({activists.length} чел.) со всеми отметками — таблица станет пустой для новой недели.
              Если старые данные ещё нужны, сначала нажмите «Отмена» и сделайте «Экспорт CSV».
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={confirmClearAll}
            >
              Очистить всё
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* bb-code dialog */}
      <Dialog open={bbOpen} onOpenChange={setBbOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>BB-код для форума</DialogTitle>
            <DialogDescription>
              Активисты из таблицы подставлены в шаблон по сферам (по алфавиту), пустые сферы — «-». Проверь даты и скопируй код в тему.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-wrap items-end gap-3">
              <div className="space-y-2">
                <Label htmlFor="bb-from">Неделя с</Label>
                <Input
                  id="bb-from"
                  value={bbFrom}
                  onChange={(e) => changeBbDate('from', e.target.value)}
                  placeholder="13.07"
                  className="w-24"
                  inputMode="numeric"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bb-to">по</Label>
                <Input
                  id="bb-to"
                  value={bbTo}
                  onChange={(e) => changeBbDate('to', e.target.value)}
                  placeholder="19.07"
                  className="w-24"
                  inputMode="numeric"
                />
              </div>
              <p className="text-xs text-muted-foreground pb-2.5">формат ДД.ММ</p>
            </div>
            <Textarea
              value={bbText}
              onChange={(e) => setBbText(e.target.value)}
              rows={14}
              className="font-mono text-xs max-h-[55vh] overflow-y-auto"
              aria-label="BB-код"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBbText(buildBb(bbFrom, bbTo, activists))}>
              Собрать заново
            </Button>
            <Button onClick={copyBb}>
              <Copy className="h-4 w-4 mr-1" aria-hidden="true" />
              Скопировать код
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
