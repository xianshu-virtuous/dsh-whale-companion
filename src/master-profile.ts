/**
 * 主人档案（Master Profile）存取层。
 *
 * 三级结构（省 token 设计）：
 * - core.md     L0 核心卡：≤1500 字符，每次新会话注入 system prompt
 * - summary.md  L1 缩略版：完整版的可读索引与要点，会话中按需读取
 * - full/*.md   L2 完整版：按主题拆分，缩略版不够时按主题查阅
 *
 * 写入只做追加（append-only），压缩（full → summary/core）由 agent 在
 * 对话中执行，避免工具侧消耗 LLM token。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** L0 核心卡最大字符数（超出则不注入，避免浪费 token）。 */
export const MAX_CORE_CHARS = 1500
/** L1 缩略版提醒阈值：超过则建议压缩。 */
export const SUMMARY_COMPACT_THRESHOLD = 6000
/** remember 单条内容上限。 */
export const MAX_FACT_CHARS = 2000
/** 主题名白名单。 */
const TOPIC_PATTERN = /^[a-z0-9][a-z0-9_-]{0,31}$/

export function masterDir(): string {
  return dshHomePath('plugins', 'dsh-whale-companion', 'master')
}
export function corePath(): string {
  return join(masterDir(), 'core.md')
}
export function summaryPath(): string {
  return join(masterDir(), 'summary.md')
}
export function fullDir(): string {
  return join(masterDir(), 'full')
}
export function fullTopicPath(topic: string): string {
  return join(fullDir(), `${topic}.md`)
}

export function assertTopic(topic: string): string {
  const t = topic.trim().toLowerCase()
  if (!TOPIC_PATTERN.test(t)) {
    throw new Error(`topic must match ${TOPIC_PATTERN} (got "${topic}")`)
  }
  return t
}

export function loadCore(): string | null {
  const path = corePath()
  if (!existsSync(path)) return null
  const text = readFileSync(path, 'utf8').trim()
  if (text === '' || text.length > MAX_CORE_CHARS) return null
  return text
}

export function loadSummary(): string | null {
  const path = summaryPath()
  if (!existsSync(path)) return null
  return readFileSync(path, 'utf8').trim() || null
}

export function loadFull(topic: string): { text: string; path: string } | null {
  const t = assertTopic(topic)
  const path = fullTopicPath(t)
  if (!existsSync(path)) return null
  return { text: readFileSync(path, 'utf8').trim(), path }
}

export function listFullTopics(): string[] {
  if (!existsSync(fullDir())) return []
  return readdirSync(fullDir())
    .filter(f => f.endsWith('.md'))
    .map(f => f.slice(0, -3))
    .sort()
}

export interface MasterStatus {
  core: { exists: boolean; chars: number }
  summary: { exists: boolean; chars: number; needsCompact: boolean }
  full: { topic: string; chars: number }[]
  totalFullChars: number
}

export function masterStatus(): MasterStatus {
  const core = corePath()
  const summary = summaryPath()
  const fullTopics = listFullTopics()
  const full = fullTopics.map(topic => {
    const path = fullTopicPath(topic)
    const chars = readFileSync(path, 'utf8').length
    return { topic, chars }
  })
  const coreText = existsSync(core) ? readFileSync(core, 'utf8') : ''
  const summaryText = existsSync(summary) ? readFileSync(summary, 'utf8') : ''
  return {
    core: { exists: existsSync(core), chars: coreText.length },
    summary: {
      exists: existsSync(summary),
      chars: summaryText.length,
      needsCompact: summaryText.length > SUMMARY_COMPACT_THRESHOLD,
    },
    full,
    totalFullChars: full.reduce((acc, f) => acc + f.chars, 0),
  }
}

/** 追加一条事实到完整版对应主题（append-only，省 token）。 */
export async function appendFact(topic: string, content: string): Promise<{ topic: string; file: string; chars: number }> {
  const t = assertTopic(topic)
  const text = content.trim()
  if (text === '') throw new Error('content must not be blank')
  if (text.length > MAX_FACT_CHARS) throw new Error(`content must not exceed ${MAX_FACT_CHARS} characters`)
  await mkdir(fullDir(), { recursive: true })
  const path = fullTopicPath(t)
  if (!existsSync(path)) {
    await writeFile(path, `# ${t}\n\n`, { encoding: 'utf8' })
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  await appendFile(path, `- [${stamp}] ${text}\n`, { encoding: 'utf8' })
  return { topic: t, file: path, chars: readFileSync(path, 'utf8').length }
}

/** 写核心卡（agent 压缩时用）。 */
export async function writeCore(text: string): Promise<void> {
  const t = text.trim()
  if (t === '' || t.length > MAX_CORE_CHARS) {
    throw new Error(`core must be 1..${MAX_CORE_CHARS} characters`)
  }
  await mkdir(masterDir(), { recursive: true })
  await writeFile(corePath(), `${t}\n`, { encoding: 'utf8' })
}

/** 写缩略版（agent 压缩时用）。 */
export async function writeSummary(text: string): Promise<void> {
  const t = text.trim()
  if (t === '') throw new Error('summary must not be blank')
  await mkdir(masterDir(), { recursive: true })
  await writeFile(summaryPath(), `${t}\n`, { encoding: 'utf8' })
}
