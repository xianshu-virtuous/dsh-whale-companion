/**
 * 表情包素材库（Stickers Store）存取层。
 *
 * 素材由**用户自己**放入 `$DSH_HOME/plugins/dsh-whale-companion/stickers/`，
 * 插件本身不含任何图片（素材权利归用户所有）。文件名 = 内容 sha256，
 * 天然去重且 id 稳定；元数据（描述 + 情感标签）由视觉模型异步标注，
 * 存在同目录的 `index.json`。
 *
 * 设计参考 MoFox 的 `emoji_sender`，但去掉了向量层——检索交给 LLM 自己挑。
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { extname, join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** 允许入库的图片后缀。 */
export const STICKER_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.webp'] as const
/** 短 id 长度：sha256 十六进制的前 N 位，够用且便于 LLM 引用。 */
export const SHORT_ID_LENGTH = 16
/** 素材数量上限；达到后不再入库（对齐 MoFox 的 max_memes 默认值）。 */
export const MAX_STICKERS = 200

/** 一条已入库的表情包。 */
export interface StickerEntry {
  /** 短 id（sha256 前缀），模型用它调用 send_sticker。 */
  id: string
  /** 文件名（完整 sha256 + 原后缀）。 */
  file: string
  /** 视觉模型给出的一句话描述。 */
  description: string
  /** 情感标签（限定在内置预设集内）。 */
  tags: string[]
  /** 入库时间（ISO 字符串）。 */
  addedAt: string
}

export interface StickerIndex {
  version: 1
  entries: StickerEntry[]
}

export function stickersDir(): string {
  return dshHomePath('plugins', 'dsh-whale-companion', 'stickers')
}

export function indexPath(): string {
  return join(stickersDir(), 'index.json')
}

export function stickerPath(file: string): string {
  return join(stickersDir(), file)
}

/** 读取索引；缺失或损坏时返回空索引（绝不让 Harness 启动失败）。 */
export function loadIndex(): StickerIndex {
  const path = indexPath()
  if (!existsSync(path)) return { version: 1, entries: [] }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    const entries = (parsed as { entries?: unknown } | null)?.entries
    if (!Array.isArray(entries)) return { version: 1, entries: [] }
    return { version: 1, entries: entries.flatMap(normalizeEntry) }
  } catch {
    return { version: 1, entries: [] }
  }
}

function normalizeEntry(value: unknown): StickerEntry[] {
  if (typeof value !== 'object' || value === null) return []
  const e = value as Record<string, unknown>
  if (typeof e.id !== 'string' || typeof e.file !== 'string') return []
  const tags = Array.isArray(e.tags) ? e.tags.filter((t): t is string => typeof t === 'string') : []
  return [{
    id: e.id,
    file: e.file,
    description: typeof e.description === 'string' ? e.description : '',
    tags,
    addedAt: typeof e.addedAt === 'string' ? e.addedAt : '',
  }]
}

/** 原子写索引（临时文件 + rename），避免半截写入。 */
export async function saveIndex(index: StickerIndex): Promise<void> {
  await mkdir(stickersDir(), { recursive: true })
  const path = indexPath()
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(index, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, path)
}

/** 目录里所有受支持的图片文件名（按名称排序，保证稳定）。 */
export function listImageFiles(): string[] {
  const dir = stickersDir()
  if (!existsSync(dir)) return []
  const allowed = new Set<string>(STICKER_EXTENSIONS)
  return readdirSync(dir)
    .filter(name => allowed.has(extname(name).toLowerCase()))
    .sort()
}

/** 内容 sha256（十六进制）。 */
export function hashFile(absPath: string): string {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex')
}

export function shortId(sha256: string): string {
  return sha256.slice(0, SHORT_ID_LENGTH)
}

/** 按短 id 或文件名（可只给前缀）查找。 */
export function findSticker(index: StickerIndex, idOrFile: string): StickerEntry | undefined {
  const key = idOrFile.trim().toLowerCase()
  if (key === '') return undefined
  return index.entries.find(entry =>
    entry.id === key
    || entry.id.startsWith(key)
    || entry.file.toLowerCase() === key
    || entry.file.toLowerCase().startsWith(key))
}

/**
 * 对齐目录与索引，返回两项：
 * - `index`：剔除「文件已被用户删掉」的条目后，仍有效的索引
 * - `pending`：目录里存在、但索引里还没有的图片（待打标签入库）
 *
 * 用户删除图片 → 下次 reconcile 自动清理对应条目（与 MoFox 行为一致）。
 */
export function reconcile(): { index: StickerIndex; pending: { file: string; hash: string }[] } {
  const index = loadIndex()
  const files = listImageFiles()
  const presentFiles = new Set(files)

  const entries = index.entries.filter(entry => presentFiles.has(entry.file))
  const knownFiles = new Set(entries.map(entry => entry.file))

  const pending: { file: string; hash: string }[] = []
  for (const file of files) {
    if (knownFiles.has(file)) continue
    if (entries.length + pending.length >= MAX_STICKERS) break
    try {
      pending.push({ file, hash: hashFile(stickerPath(file)) })
    } catch {
      // 读取失败（占用/损坏）时跳过，下一轮再试
    }
  }

  return { index: { version: 1, entries }, pending }
}
