import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const dynamic = 'force-dynamic'

// GET /api/activists — list all activists
export async function GET() {
  try {
    const activists = await db.activist.findMany({
      orderBy: [{ name: 'asc' }, { extId: 'asc' }],
    })
    return NextResponse.json(activists)
  } catch (error) {
    console.error('GET /api/activists error:', error)
    return NextResponse.json({ error: 'Не удалось загрузить список' }, { status: 500 })
  }
}

// POST /api/activists — create an activist
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const name = typeof body?.name === 'string' ? body.name.trim() : ''
    const extId = typeof body?.extId === 'string' ? body.extId.trim() : ''
    const categories = typeof body?.categories === 'string' ? body.categories : ''

    if (!name) {
      return NextResponse.json({ error: 'Укажите имя' }, { status: 400 })
    }
    if (!/^\d{2,}$/.test(extId)) {
      return NextResponse.json({ error: 'ID должен быть числом (минимум 2 цифры)' }, { status: 400 })
    }

    const existing = await db.activist.findUnique({ where: { extId } })
    if (existing) {
      return NextResponse.json(
        { error: `Активист с ID ${extId} уже есть: «${existing.name}»` },
        { status: 409 }
      )
    }

    const created = await db.activist.create({ data: { name, extId, categories } })
    return NextResponse.json(created, { status: 201 })
  } catch (error) {
    console.error('POST /api/activists error:', error)
    return NextResponse.json({ error: 'Не удалось добавить активиста' }, { status: 500 })
  }
}

// DELETE /api/activists — clear the whole list (new week)
export async function DELETE() {
  try {
    const { count } = await db.activist.deleteMany({})
    return NextResponse.json({ ok: true, count })
  } catch (error) {
    console.error('DELETE /api/activists error:', error)
    return NextResponse.json({ error: 'Не удалось очистить список' }, { status: 500 })
  }
}
