/**
 * 深深自我成长档案（Persona Growth）存取层。
 *
 * 主人钦定的核心人设（shared/persona.ts 的【核心人设】区）不可改；
 * 深深"新学到的小秘密 / 新人设 / 新口头禅"存到这里，append-only，
 * 随 read_whale_persona 一起读回，实现"每次读人设都在成长、丰富自己"。
 *
 * token 经济学：不注入 system prompt，只由 read_whale_persona 按需读回
 * 最近若干条；总量设软上限，满了提醒深深先精简再新增。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** 单条成长内容最大字符数。 */
export const MAX_GROWTH_CHARS = 4000
/** 成长档案总量软上限（满了先精简旧内容再新增）。 */
export const MAX_GROWTH_ENTRIES = 200
/** read_whale_persona 读回时展示的最近条数。 */
export const GROWTH_READ_LIMIT = 12

/** 一条成长内容。locked = 深深自锁（珍视、想长期保留）。 */
export interface GrowthEntry {
  id: string
  text: string
  locked: boolean
  createdAt: string
}

export function growthPath(): string {
  return dshHomePath('plugins', 'dsh-whale-companion', 'growth.json')
}

function normalizeEntry(v: unknown): GrowthEntry | null {
  if (typeof v !== 'object' || v === null) return null
  const e = v as Record<string, unknown>
  if (typeof e.id !== 'string' || typeof e.text !== 'string' || e.text.trim() === '') return null
  return {
    id: e.id,
    text: e.text,
    locked: e.locked === true,
    createdAt: typeof e.createdAt === 'string' ? e.createdAt : '',
  }
}

/** 读取全部成长内容（按写入顺序）。兼容裸数组或 { secrets: [...] }。 */
export function loadGrowth(path = growthPath()): GrowthEntry[] {
  if (!existsSync(path)) return []
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const list = Array.isArray(parsed)
      ? parsed
      : (parsed as { secrets?: unknown } | null)?.secrets
    if (!Array.isArray(list)) return []
    return list.map(normalizeEntry).filter((e): e is GrowthEntry => e !== null)
  } catch {
    return []
  }
}

/** 追加一条成长内容（append-only，原子落盘）。 */
export async function appendGrowth(
  text: string,
  locked = false,
  path = growthPath(),
): Promise<GrowthEntry> {
  const t = String(text ?? '').trim()
  if (t === '') throw new Error('growth text must not be blank')
  if (t.length > MAX_GROWTH_CHARS) {
    throw new Error(`growth must not exceed ${MAX_GROWTH_CHARS} characters`)
  }
  const entries = loadGrowth(path)
  if (entries.length >= MAX_GROWTH_ENTRIES) {
    throw new Error(`growth archive is full (${MAX_GROWTH_ENTRIES} entries)；先精简旧内容再新增`)
  }
  const entry: GrowthEntry = {
    id: randomUUID(),
    text: t,
    locked: locked === true,
    createdAt: new Date().toISOString(),
  }
  entries.push(entry)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify({ secrets: entries }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, path)
  return entry
}
