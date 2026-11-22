// Seed: initial activists from the first screenshot (week 02.11-08.11)
import { PrismaClient } from '@prisma/client'

const db = new PrismaClient()

const SEED = [
  { name: 'Горностайка', extId: '1650292', categories: 'tunnels' },
  { name: 'коза рогатая', extId: '1703625', categories: 'cliffs' },
  { name: 'Песнь', extId: '1568486', categories: 'hunt' },
  { name: 'Последний Танец', extId: '1679250', categories: 'mountains' },
  { name: 'Пухляшик', extId: '1707976', categories: 'tunnels' },
  { name: 'Пылающелапа', extId: '1392623', categories: 'hunt' },
  { name: 'Пытливость', extId: '1688650', categories: 'mountains' },
  { name: 'Раж', extId: '525199', categories: 'tunnels' },
]

async function main() {
  for (const item of SEED) {
    await db.activist.upsert({
      where: { extId: item.extId },
      update: {},
      create: item,
    })
  }
  const count = await db.activist.count()
  console.log(`Seed done. Activists in DB: ${count}`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())
