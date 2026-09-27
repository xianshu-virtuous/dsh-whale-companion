/**
 * Peer Memory（多人记忆）存取层。
 *
 * 设计（参考 NeoMoFox booku_memory 的分层 + 按需检索思想，适配 dsh/Node）：
 * - 每个 QQ 用户（peer）独立记忆空间：~/.dsh/plugins/dsh-whale-companion/peers/{peerId}/
 * - profile.md   长周期档案：append-only 段落（每段一个 UUID 锚点），按需检索取回
 * - index.json   轻量倒排索引：关键词 → 段落 ID 列表，实现 O(1) 定位相关记忆
 * - 主人（master）的档案仍走原 master/ 目录，双深深共享；本模块只服务各 peer。
 *
 * token 经济学：
 * - system prompt 只注入"peer 迷你索引"（每 peer 一行主题摘要，数百字符封顶）
 * - 完整段落由 agent 通过 recall_peer_memory 按需取回，不全文塞入
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** 单条记忆最大字符数。 */
export const MAX_MEMORY_CHARS = 4000
/** 迷你索引里每个 peer 摘要最大字符数。 */
export const MAX_PEER_SNIPPET_CHARS = 200
/** 检索默认返回条数。 */
export const DEFAULT_TOP_K = 5
/** 索引停用词（中文常见虚词，不做索引词）。 */
const STOP_WORDS = new Set([
  '的', '了', '和', '是', '在', '有', '我', '你', '他', '她', '它', '们',
  '这', '那', '个', '吗', '呢', '吧', '啊', '哦', '呀', '嘛', '就', '都',
  '也', '很', '把', '被', '让', '给', '对', '从', '到', '说', '做', '看',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'to', 'of', 'in', 'on',
  'at', 'for', 'with', 'and', 'or', 'but', 'i', 'you', 'he', 'she', 'it',
])

/** 记忆条目。 */
export interface PeerMemoryEntry {
  id: string
  text: string
  createdAt: string
  /** 该条目被检索命中的次数（活跃度，供压缩参考）。 */
  hits: number
}

/** 倒排索引：词 → 条目 ID 集合。 */
export type PeerIndex = Record<string, string[]>

/** peer 记忆目录。 */
let peersRootOverride: string | null = null
/** 测试专用：覆盖 peers 根目录（默认走 dshHomePath）。 */
export function setPeersRootForTests(root: string | null): void {
  peersRootOverride = root
}
export function peersRoot(): string {
  return peersRootOverride ?? dshHomePath('plugins', 'dsh-whale-companion', 'peers')
}
export function peerDir(peerId: string): string {
  return join(peersRoot(), safePeerId(peerId))
}
export function peerProfilePath(peerId: string): string {
  return join(peerDir(peerId), 'profile.md')
}
export function peerIndexPath(peerId: string): string {
  return join(peerDir(peerId), 'index.json')
}

/** _active 目录：dsh-qqbot 按 sessionId 写当前会话的 peer 身份（JSON）。 */
export function activePeerDir(): string {
  return join(peersRoot(), '_active')
}

/** 会话级 peer 元数据（dsh-qqbot inbound 补丁写入）。 */
export interface ActivePeerMeta {
  scope: string
  peerId: string
  senderId: string
  isMaster: boolean
  updatedAt?: number
}

/** 按 sessionId 读取会话的 peer 元数据（找不到返回 null）。 */
export function readActivePeerMeta(sessionId: string | undefined): ActivePeerMeta | null {
  if (!sessionId) return null
  const path = join(activePeerDir(), `${sessionId}.json`)
  if (!existsSync(path)) return null
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<ActivePeerMeta>
    if (typeof parsed.peerId !== 'string' || parsed.peerId === '') return null
    return {
      scope: typeof parsed.scope === 'string' ? parsed.scope : 'c2c',
      peerId: parsed.peerId,
      senderId: typeof parsed.senderId === 'string' ? parsed.senderId : parsed.peerId,
      isMaster: parsed.isMaster === true,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : undefined,
    }
  } catch {
    return null
  }
}

/** peerId 落盘安全化：只保留字母数字和常见连接符。 */
export function safePeerId(peerId: string): string {
  const s = String(peerId ?? '').trim()
  if (s === '') return 'anonymous'
  const safe = s.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 64)
  return safe || 'anonymous'
}

/** 从文本提取索引词（中文按字/双字 + 英文按词；去停用词，去重，截断）。 */
export function extractTokens(text: string, limit = 64): string[] {
  const out = new Set<string>()
  const clean = text.toLowerCase()
  // 英文词
  for (const m of clean.match(/[a-z0-9]{2,}/g) ?? []) {
    if (!STOP_WORDS.has(m)) out.add(m)
  }
  // 中文字符 + 双字组合（覆盖人名/地名等实体的一部分）
  const cjk = clean.match(/[\u4e00-\u9fff]/g) ?? []
  for (let i = 0; i < cjk.length; i++) {
    const c = cjk[i]
    if (!STOP_WORDS.has(c)) out.add(c)
    if (i + 1 < cjk.length) {
      const bigram = c + cjk[i + 1]
      if (!STOP_WORDS.has(bigram)) out.add(bigram)
    }
  }
  return [...out].slice(0, limit)
}

/** 读取某 peer 的全部记忆条目（按写入顺序）。 */
export function loadPeerEntries(peerId: string): PeerMemoryEntry[] {
  const path = peerProfilePath(peerId)
  if (!existsSync(path)) return []
  const text = readFileSync(path, 'utf8')
  const entries: PeerMemoryEntry[] = []
  // 段落格式：`<!-- ID:uuid hits:N -->` 开头到下一个标记为止；hits 为可选元数据（缺省 0）
  const re = /<!--\s*ID:([A-Za-z0-9-]+)(?:\s+hits:(\d+))?\s*-->\n?([\s\S]*?)(?=<!--\s*ID:|$)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const hits = m[2] !== undefined ? Number(m[2]) : 0
    entries.push({ id: m[1], text: m[3].trim(), createdAt: '', hits: Number.isFinite(hits) ? hits : 0 })
  }
  return entries
}

/** 读取倒排索引。 */
export function loadIndex(peerId: string): PeerIndex {
  const path = peerIndexPath(peerId)
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PeerIndex
  } catch {
    return {}
  }
}

/** 追加一条记忆并更新索引。 */
export async function appendPeerMemory(peerId: string, text: string): Promise<PeerMemoryEntry> {
  const t = String(text ?? '').trim()
  if (t === '') throw new Error('memory text must not be blank')
  if (t.length > MAX_MEMORY_CHARS) {
    throw new Error(`memory must not exceed ${MAX_MEMORY_CHARS} characters`)
  }
  await mkdir(peerDir(peerId), { recursive: true })
  const entry: PeerMemoryEntry = {
    id: randomUUID(),
    text: t,
    createdAt: new Date().toISOString(),
    hits: 0,
  }
  await appendFile(peerProfilePath(peerId), `<!-- ID:${entry.id} hits:0 -->\n${t}\n\n`, { encoding: 'utf8' })
  // 更新倒排索引
  const index = loadIndex(peerId)
  for (const token of extractTokens(t)) {
    const list = index[token] ?? []
    if (!list.includes(entry.id)) {
      list.push(entry.id)
      index[token] = list
    }
  }
  await writeFile(peerIndexPath(peerId), JSON.stringify(index), { encoding: 'utf8' })
  return entry
}

/** 命中递增：把某条记忆的 hits+1 并写回（闪回/检索命中时调用）。返回新 hits。 */
export async function bumpHit(peerId: string, id: string): Promise<number> {
  const path = peerProfilePath(peerId)
  if (!existsSync(path)) return 0
  const text = readFileSync(path, 'utf8')
  const entries = loadPeerEntries(peerId)
  const target = entries.find(e => e.id === id)
  if (!target) return 0
  const next = target.hits + 1
  const markerRe = /(<!--\s*ID:)([A-Za-z0-9-]+)((?:\s+hits:\d+)?)(\s*-->)/g
  const updated = text.replace(markerRe, (_full, head: string, markerId: string, _oldHit: string, tail: string) => {
    if (markerId !== id) return _full
    return `${head}${markerId} hits:${next}${tail}`
  })
  await writeFile(path, updated, { encoding: 'utf8' })
  return next
}

/** 检索结果去重阈值：两条记忆词集合的 Jaccard 相似度 ≥ 此值视为冗余（去重跳过）。 */
export const DEDUP_SIMILARITY_THRESHOLD = 0.85

/** 两条记忆文本的词集合 Jaccard 相似度（纯文本，不依赖 embedding）。 */
export function textSimilarity(a: string, b: string): number {
  const ta = new Set(extractTokens(a, 128))
  const tb = new Set(extractTokens(b, 128))
  if (ta.size === 0 && tb.size === 0) return 0
  let intersect = 0
  for (const t of ta) if (tb.has(t)) intersect++
  const union = ta.size + tb.size - intersect
  if (union <= 0) return 0
  return intersect / union
}

/** 贪心去重：按 score 从高到低，剔除与已选集合 Jaccard 相似度过高的冗余条目。 */
export function dedupEntries(
  entries: PeerMemoryEntry[],
  threshold = DEDUP_SIMILARITY_THRESHOLD,
  limit = Number.POSITIVE_INFINITY,
): PeerMemoryEntry[] {
  const selected: PeerMemoryEntry[] = []
  for (const entry of entries) {
    if (selected.length >= limit) break
    let redundant = false
    for (const chosen of selected) {
      if (entry.id === chosen.id) { redundant = true; break }
      if (textSimilarity(entry.text, chosen.text) >= threshold) { redundant = true; break }
    }
    if (!redundant) selected.push(entry)
  }
  return selected
}

/** 按激活次数反向加权（低活跃记忆权重更高）从 pool 中抽 1 条的纯函数。
 * exponent 越大越偏向低活跃记忆；传入 rng 以便测试可复现（默认 Math.random）。 */
export function weightedFlashback(
  pool: PeerMemoryEntry[],
  exponent = 1.0,
  rng: () => number = Math.random,
): PeerMemoryEntry | null {
  if (pool.length === 0) return null
  const weights = pool.map(e => 1 / (Math.max(0, e.hits) + 1) ** exponent)
  const total = weights.reduce((s, w) => s + w, 0)
  if (total <= 0) return pool[pool.length - 1]
  let threshold = rng() * total
  for (let i = 0; i < pool.length; i++) {
    threshold -= weights[i]
    if (threshold <= 0) return pool[i]
  }
  return pool[pool.length - 1]
}

/** 闪回召回：混合返回"低活跃旧记忆"与"最近记忆"，对冲只见最近的记忆盲区。
 * 空查询时由 recall_peer_memory 调用；count 为目标条数。
 * - oldShare(0..1)：旧记忆池占总返回的比例（默认 ~1/3），其余由最近记忆补足。 */
export function recallFlashback(
  peerId: string,
  count = DEFAULT_TOP_K,
  oldShare = 0.4,
  rng: () => number = Math.random,
): PeerMemoryEntry[] {
  const all = loadPeerEntries(peerId)
  if (all.length === 0) return []
  const recent = all.slice(-count).reverse()
  // 旧记忆池：去掉最近 count 条（真正"旧"的）
  const oldPool = all.slice(0, Math.max(0, all.length - count))
  const oldCount = Math.max(1, Math.round(count * oldShare))
  const picked: PeerMemoryEntry[] = []
  if (oldPool.length > 0) {
    // 抽到不同旧记忆为止，最多抽 oldCount 次
    const pickedIds = new Set<string>()
    for (let i = 0; i < oldCount && picked.length < oldCount; i++) {
      const cand = weightedFlashback(oldPool, 1.0, rng)
      if (cand && !pickedIds.has(cand.id)) { picked.push(cand); pickedIds.add(cand.id) }
    }
  }
  // 用最近记忆补足到 count
  for (const e of recent) {
    if (picked.length >= count) break
    if (!picked.some(p => p.id === e.id)) picked.push(e)
  }
  return dedupEntries(picked, DEDUP_SIMILARITY_THRESHOLD, count)
}

/** 按查询词检索某 peer 的记忆，返回排序后的条目（按命中词数降序）。 */
export function searchPeerMemory(peerId: string, query: string, topK = DEFAULT_TOP_K): PeerMemoryEntry[] {
  const q = String(query ?? '').trim()
  const tokens = extractTokens(q, 32)
  if (tokens.length === 0) {
    // 无有效查询词：返回最近几条（去重）
    return dedupEntries(loadPeerEntries(peerId).slice(-topK).reverse(), DEDUP_SIMILARITY_THRESHOLD, topK)
  }
  const index = loadIndex(peerId)
  const entriesById = new Map(loadPeerEntries(peerId).map(e => [e.id, e]))
  const score = new Map<string, number>()
  for (const token of tokens) {
    for (const id of index[token] ?? []) {
      score.set(id, (score.get(id) ?? 0) + 1)
    }
  }
  const ranked = [...score.entries()]
    .sort((a, b) => b[1] - a[1])
  const results: PeerMemoryEntry[] = []
  for (const [id] of ranked) {
    const entry = entriesById.get(id)
    if (entry) results.push(entry)
  }
  // 命中数不足时补充最近记忆
  if (results.length < topK) {
    for (const e of loadPeerEntries(peerId).slice(-(topK - results.length)).reverse()) {
      if (!results.some(r => r.id === e.id)) results.push(e)
    }
  }
  // 去重（保留前 topK）
  return dedupEntries(results, DEDUP_SIMILARITY_THRESHOLD, topK)
}

/** 生成某 peer 的迷你索引摘要（system prompt 用，数百字符封顶）。 */
export function peerSnippet(peerId: string): string | null {
  const entries = loadPeerEntries(peerId)
  if (entries.length === 0) return null
  // 取最近 3 条的首句拼摘要
  const recent = entries.slice(-3)
  const parts = recent.map(e => {
    const firstLine = e.text.split('\n')[0] ?? ''
    return firstLine.slice(0, MAX_PEER_SNIPPET_CHARS)
  })
  return parts.join('；')
}

/** 列出所有已知 peer（目录名），用于状态展示。 */
export function listPeers(): string[] {
  if (!existsSync(peersRoot())) return []
  return readdirSync(peersRoot())
    .filter(f => existsSync(join(peersRoot(), f, 'profile.md')))
    .sort()
}
