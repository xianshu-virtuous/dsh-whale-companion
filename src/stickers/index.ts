/**
 * 表情包模块（Stickers）——把「用户自备的表情包目录」变成 LLM 可用的资源。
 *
 * 与旧的独立 stickers 插件的根本区别：
 *  - **不含任何图片素材**：素材由用户放进 `stickers/` 目录，素材权利归用户；
 *  - **不打包硬编码 catalog**：文件名 = 内容 sha256，元数据由视觉模型异步标注；
 *  - **不引入向量库**：检索靠「情感标签过滤 + 把候选交给 LLM 自己挑」。
 *
 * 对外提供：
 *  - 工具 `search_stickers`：按标签/描述检索候选列表
 *  - 工具 `send_sticker`：发送指定 id 的表情包（人设依赖这个用法）
 *  - 工具 `sync_stickers`：手动触发一次扫描 + 打标签
 *  - 路由 `GET /api/dsh-whale-companion/stickers/<id>`：提供图片二进制
 *
 * @module @dsh-external/dsh-whale-companion/src/stickers
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { existsSync, readFileSync } from 'node:fs'
import { extname } from 'node:path'
import { EMOTION_TAGS, tagImage } from './tagging.ts'
import {
  findSticker, loadIndex, reconcile, saveIndex, shortId, stickerPath,
  type StickerEntry, type StickerIndex,
} from './store.ts'

/** 图片与检索接口的路由前缀。 */
export const STICKER_ROUTE_PREFIX = '/api/dsh-whale-companion/stickers'
/** 每页候选数量（对齐 MoFox picker 的默认值）。 */
export const PAGE_SIZE = 6
/** 进程内记住的最近发送 id 数，用于避免短时间内重复发同一张。 */
export const RECENT_LIMIT = 6
/** 启动后延迟多久开始后台打标签（等 Harness 与 Ollama 就绪，不阻塞加载）。 */
export const STARTUP_SYNC_DELAY_MS = 8000

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/** 最近发送过的 id（进程内，重启清空）。 */
const recentlySent: string[] = []

function rememberSent(id: string): void {
  recentlySent.push(id)
  while (recentlySent.length > RECENT_LIMIT) recentlySent.shift()
}

export interface StickerSyncResult {
  /** 索引里的条目总数。 */
  indexed: number
  /** 本次新入库数量。 */
  added: number
  /** 本次跳过（不值得收藏 / 标注失败）数量。 */
  skipped: number
  /** 扫描到的待处理图片数。 */
  scanned: number
}

/**
 * 扫描素材目录：剔除已被用户删除的条目，为新增图片打标签入库。
 * 逐条落盘，中途失败也不会写坏索引。
 */
export async function syncStickers(log?: (message: string) => void): Promise<StickerSyncResult> {
  const { index, pending } = reconcile()
  await saveIndex(index)

  let added = 0
  let skipped = 0
  for (const item of pending) {
    const result = await tagImage(stickerPath(item.file))
    if (result === null || !result.keep) {
      skipped += 1
      continue
    }
    index.entries.push({
      id: shortId(item.hash),
      file: item.file,
      description: result.description,
      tags: result.tags,
      addedAt: new Date().toISOString(),
    })
    await saveIndex(index)
    added += 1
    log?.(`表情包入库：${item.file} → ${result.description}`)
  }

  return { indexed: index.entries.length, added, skipped, scanned: pending.length }
}

/** 把工具参数里的标签收敛成有效值（大小写/空白容错）。 */
function normalizeTags(input: unknown): string[] {
  const allowed = new Set<string>(EMOTION_TAGS)
  return (Array.isArray(input) ? input : [])
    .filter((t): t is string => typeof t === 'string')
    .map(t => t.trim())
    .filter(t => allowed.has(t))
}

/** 候选排序：先按「最近没发过的」优先，保持其余原顺序。 */
function rankCandidates(entries: StickerEntry[]): StickerEntry[] {
  const recent = new Set(recentlySent)
  const fresh = entries.filter(e => !recent.has(e.id))
  const used = entries.filter(e => recent.has(e.id))
  return [...fresh, ...used]
}

/** 按标签 + 描述做粗筛；两处都没命中时返回空（调用方可放宽条件重试）。 */
export function filterCandidates(index: StickerIndex, tags: string[], description: string): StickerEntry[] {
  let candidates = index.entries
  if (tags.length > 0) {
    const wanted = new Set(tags)
    candidates = candidates.filter(entry => entry.tags.some(tag => wanted.has(tag)))
  }
  const keyword = description.trim().toLowerCase()
  if (keyword !== '' && candidates.length > PAGE_SIZE) {
    const hit = candidates.filter(entry =>
      entry.description.toLowerCase().includes(keyword)
      || entry.tags.some(tag => tag.toLowerCase().includes(keyword)))
    if (hit.length > 0) candidates = hit
  }
  return candidates
}

/** 注册表情包模块的全部对外能力。 */
export function registerStickers(
  ctx: Context,
  options: { log?: (message: string) => void } = {},
): void {
  const log = options.log

  // ---- 工具：检索候选 ----
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'search_stickers',
    description:
      '按情感标签与自由描述检索表情包库，返回候选列表（每项含 id、标签、描述）。'
      + '想发表情时先用它看看有哪些候选，挑最契合当前语境的一张，再用 send_sticker 发送。'
      + '候选都不合适时可换描述重查，或换更大页码翻页。',
    parameters: {
      tags: {
        type: 'array',
        items: { type: 'string' },
        description: `情感标签过滤（可选，可多选）。可选值：${EMOTION_TAGS.join('、')}。留空则不按标签过滤。`,
      },
      description: {
        type: 'string',
        description: '你想要的画面/情绪描述（可选），用于在候选里进一步筛选。',
      },
      page: {
        type: 'number',
        description: `页码，从 1 开始（默认 1，每页 ${PAGE_SIZE} 张）。`,
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          total: { type: 'integer', required: true },
          page: { type: 'integer', required: true },
          text: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    presentCall: () => ({ card: 'generic', title: '检索表情包' }),
    execute: async (args) => {
      const index = loadIndex()
      const tags = normalizeTags(args?.tags)
      const description = typeof args?.description === 'string' ? args.description : ''
      const page = Math.max(1, Math.floor(Number(args?.page ?? 1)) || 1)

      if (index.entries.length === 0) {
        return {
          total: 0,
          page: 1,
          text: '表情包库还是空的。把图片放进素材目录后调用 sync_stickers 打标签入库，再回来检索。',
        }
      }

      const filtered = rankCandidates(filterCandidates(index, tags, description))
      const usable = filtered.length > 0 ? filtered : rankCandidates(index.entries)
      const start = (page - 1) * PAGE_SIZE
      const slice = usable.slice(start, start + PAGE_SIZE)

      if (slice.length === 0) {
        return {
          total: usable.length,
          page,
          text: `没有更多候选了（共 ${usable.length} 张，第 ${page} 页为空）。可换更宽的标签或回到第 1 页。`,
        }
      }

      const lines = [`候选表情包（第 ${page} 页，共 ${usable.length} 张匹配）：`]
      for (const entry of slice) {
        const tagsText = entry.tags.length > 0 ? entry.tags.join('/') : '无标签'
        lines.push(`- id=${entry.id} | 标签: ${tagsText} | 描述: ${entry.description}`)
      }
      lines.push('用 send_sticker(id) 发送选中的那张；都不合适时换描述重查或传更大 page 翻页。')
      return { total: usable.length, page, text: lines.join('\n') }
    },
  })), 'whale-companion: search stickers tool')

  // ---- 工具：发送 ----
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'send_sticker',
    description:
      '发送一张已入库的表情包来表达情绪，代替文字 emoji。每轮对话至多用一个，只在自然时机发。'
      + 'id 来自 search_stickers 的候选列表。',
    parameters: {
      id: { type: 'string', required: true, description: '表情包 id（如 a1b2c3d4e5f6a7b8）。' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', required: true },
          id: { type: 'string' },
          description: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          error: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{
        type: 'text',
        text: value.ok
          ? `🐋 已发送表情包 ${value.id ?? ''}`
          : `[发送表情失败] ${value.error ?? '未知错误'}`,
      }],
    },
    presentCall: (args) => ({ card: 'generic', title: `表情包 ${args?.id ?? ''}` }),
    execute: async (args) => {
      const id = String(args?.id ?? '').trim()
      if (id === '') return { ok: false, error: '缺少 id 参数' }
      const index = loadIndex()
      const entry = findSticker(index, id)
      if (entry === undefined) {
        return { ok: false, error: `库里没有 id=${id} 的表情包；先用 search_stickers 查候选。` }
      }
      rememberSent(entry.id)
      return { ok: true, id: entry.id, description: entry.description, tags: entry.tags }
    },
  })), 'whale-companion: send sticker tool')

  // ---- 工具：手动同步 ----
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'sync_stickers',
    description:
      '扫描表情包素材目录：剔除已删除的、为新增图片异步打标签入库。'
      + '用户刚往素材目录放了新图时调用它。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          indexed: { type: 'integer', required: true },
          added: { type: 'integer', required: true },
          skipped: { type: 'integer', required: true },
          scanned: { type: 'integer', required: true },
          text: { type: 'string', required: true },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.text }],
    },
    presentCall: () => ({ card: 'generic', title: '同步表情包' }),
    execute: async () => {
      const result = await syncStickers(log)
      const text = result.scanned === 0
        ? `没有发现新图片；库里现有 ${result.indexed} 张。`
        : `扫描 ${result.scanned} 张：新增 ${result.added} 张，跳过 ${result.skipped} 张；库里现有 ${result.indexed} 张。`
      return { ...result, text }
    },
  })), 'whale-companion: sync stickers tool')

  // ---- 路由：提供图片二进制 ----
  ctx.inject(['webServer'], (scope: Context) => {
    scope.effect(() => scope.webServer.register({
      kind: 'prefix',
      path: STICKER_ROUTE_PREFIX,
      handler: (request, response) => {
        const rawId = decodeURIComponent(String(request.url ?? '').slice(STICKER_ROUTE_PREFIX.length))
        const id = rawId.replace(/^\/+/, '').split('?')[0] ?? ''
        const entry = findSticker(loadIndex(), id)
        if (entry === undefined) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('sticker not found')
          return
        }
        const abs = stickerPath(entry.file)
        if (!existsSync(abs)) {
          response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('sticker file missing')
          return
        }
        const mime = MIME_BY_EXT[extname(entry.file).toLowerCase()] ?? 'application/octet-stream'
        const body = readFileSync(abs)
        response.writeHead(200, {
          'content-type': mime,
          'content-length': String(body.byteLength),
          // 文件名即内容哈希，可以放心长缓存
          'cache-control': 'public, max-age=31536000, immutable',
        })
        response.end(body)
      },
    }), 'whale-companion: sticker asset route')
  })

  // ---- 启动后异步打标签（不阻塞插件加载）----
  ctx.effect(() => {
    const timer = setTimeout(() => {
      void syncStickers(log).catch((error: unknown) => {
        log?.(`表情包同步失败：${error instanceof Error ? error.message : String(error)}`)
      })
    }, STARTUP_SYNC_DELAY_MS)
    return () => clearTimeout(timer)
  }, 'whale-companion: sticker startup sync')
}
