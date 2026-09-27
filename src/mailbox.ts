/**
 * 深深双向信箱（cross-channel mailbox）。
 *
 * GUI 深深与 QQ 深深跑在不同 dsh profile（不同进程），本模块提供它们之间
 * 的可靠消息通道：共享 mailbox 目录，消息以 JSON 落盘，带身份/来源/时间戳。
 *
 * 目录结构（都在 whale-companion home 下，两个 profile 都能读写）：
 *   mailbox/to-gui/  QQ 深深 → GUI 深深
 *   mailbox/to-qq/   GUI 深深 → QQ 深深
 *   mailbox/archive/ 已读消息（保留审计，避免误删）
 *
 * 消息格式：{ id, from: 'gui'|'qq', to: 'gui'|'qq', text, ts }
 * - from 始终由写入方硬编码（不允许调用方伪造），保证身份可信
 * - UTF-8 JSON，跨平台无乱码
 */
import { existsSync, readFileSync, readdirSync, writeFileSync, renameSync, mkdirSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** 消息来源方。 */
export type MailboxFrom = 'gui' | 'qq'

/** 信箱消息。 */
export interface MailboxMessage {
  id: string
  /** 发送方（写入时强制，不可伪造）。 */
  from: MailboxFrom
  /** 接收方。 */
  to: MailboxFrom
  text: string
  ts: string
  /** 可选主题/标题。 */
  subject?: string
}

let mailboxRootOverride: string | null = null
/** 测试专用：覆盖 mailbox 根目录。 */
export function setMailboxRootForTests(root: string | null): void {
  mailboxRootOverride = root
}

export function mailboxRoot(): string {
  return mailboxRootOverride ?? dshHomePath('plugins', 'dsh-whale-companion', 'mailbox')
}
function inboxDir(from: MailboxFrom): string {
  return join(mailboxRoot(), from === 'gui' ? 'to-qq' : 'to-gui')
}
function archiveDir(): string {
  return join(mailboxRoot(), 'archive')
}

function parseMessage(fileName: string, dir: string): MailboxMessage | null {
  const path = join(dir, fileName)
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as Partial<MailboxMessage>
    if (typeof parsed.id !== 'string' || parsed.id === '') return null
    if (parsed.from !== 'gui' && parsed.from !== 'qq') return null
    if (parsed.to !== 'gui' && parsed.to !== 'qq') return null
    if (typeof parsed.text !== 'string' || parsed.text === '') return null
    return {
      id: parsed.id,
      from: parsed.from,
      to: parsed.to,
      text: parsed.text,
      ts: typeof parsed.ts === 'string' ? parsed.ts : '',
      subject: typeof parsed.subject === 'string' ? parsed.subject : undefined,
    }
  } catch {
    return null
  }
}

/** 发送一条消息到对方信箱（from 强制为调用方身份）。 */
export async function sendMailboxMessage(from: MailboxFrom, text: string, subject?: string): Promise<MailboxMessage> {
  const t = String(text ?? '').trim()
  if (t === '') throw new Error('message text must not be blank')
  if (t.length > 16000) throw new Error('message must not exceed 16000 characters')
  const to: MailboxFrom = from === 'gui' ? 'qq' : 'gui'
  const message: MailboxMessage = {
    id: randomUUID(),
    from,
    to,
    text: t,
    ts: new Date().toISOString(),
    ...(subject !== undefined && String(subject).trim() !== '' ? { subject: String(subject).trim() } : {}),
  }
  const dir = inboxDir(from)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${message.id}.json`), `${JSON.stringify(message, null, 2)}\n`, { encoding: 'utf8' })
  return message
}

/** 读取我的收件箱（来自对方的未读消息），可选移入 archive。 */
export function readMailboxInbox(me: MailboxFrom, { archive = true }: { archive?: boolean } = {}): MailboxMessage[] {
  const dir = inboxDir(me === 'gui' ? 'qq' : 'gui')
  if (!existsSync(dir)) return []
  const messages: MailboxMessage[] = []
  for (const fileName of readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
    const msg = parseMessage(fileName, dir)
    if (msg !== null && msg.to === me) {
      messages.push(msg)
      if (archive) {
        mkdirSync(archiveDir(), { recursive: true })
        try {
          renameSync(join(dir, fileName), join(archiveDir(), `${msg.ts.replace(/[:.]/g, '-')}__${fileName}`))
        } catch {
          // 并发竞争可忽略（另一进程已归档）
        }
      }
    }
  }
  return messages
}

/** 待读消息数（轻量探测，供 system prompt 提示）。 */
export function countUnread(me: MailboxFrom): number {
  const dir = inboxDir(me === 'gui' ? 'qq' : 'gui')
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter(f => f.endsWith('.json')).length
}
