import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

const CATEGORY_KEYS = ['patrol', 'sentry', 'hunt', 'mountains', 'tunnels', 'cliffs']

function sanitizeCategories(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const keys = value
    .split(',')
    .map((s) => s.trim())
    .filter((s) => CATEGORY_KEYS.includes(s))
  return Array.from(new Set(keys)).join(',')
}

// PATCH /api/activists/[id] — update name / extId / categories
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    const current = await db.activist.findUnique({ where: { id } })
    if (!current) {
      return NextResponse.json({ error: 'Активист не найден' }, { status: 404 })
    }

    const data: { name?: string; extId?: string; categories?: string } = {}

    if (body?.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) return NextResponse.json({ error: 'Имя не может быть пустым' }, { status: 400 })
      data.name = name
    }

    if (body?.extId !== undefined) {
      const extId = typeof body.extId === 'string' ? body.extId.trim() : ''
      if (!/^\d{2,}$/.test(extId)) {
        return NextResponse.json({ error: 'ID должен быть числом (минимум 2 цифры)' }, { status: 400 })
      }
      const duplicate = await db.activist.findUnique({ where: { extId } })
      if (duplicate && duplicate.id !== id) {
        return NextResponse.json(
          { error: `ID ${extId} уже занят: «${duplicate.name}»` },
          { status: 409 }
        )
      }
      data.extId = extId
    }

    if (body?.categories !== undefined) {
      const categories = sanitizeCategories(body.categories)
      if (categories !== undefined) data.categories = categories
    }

    const updated = await db.activist.update({ where: { id }, data })
    return NextResponse.json(updated)
  } catch (error) {
    console.error('PATCH /api/activists/[id] error:', error)
    return NextResponse.json({ error: 'Не удалось обновить активиста' }, { status: 500 })
  }
}

// DELETE /api/activists/[id] — remove an activist
export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const existing = await db.activist.findUnique({ where: { id } })
    if (!existing) {
      return NextResponse.json({ error: 'Активист не найден' }, { status: 404 })
    }
    await db.activist.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('DELETE /api/activists/[id] error:', error)
    return NextResponse.json({ error: 'Не удалось удалить активиста' }, { status: 500 })
  }
}
