import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  sendMailboxMessage, readMailboxInbox, countUnread, setMailboxRootForTests,
} from '../src/mailbox.ts'

let tempHome: string

describe('mailbox (双向信箱)', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'whale-mailbox-'))
    setMailboxRootForTests(tempHome)
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
    setMailboxRootForTests(null)
  })

  it('GUI 深深发消息 → QQ 深深收到（from/to 正确）', async () => {
    const sent = await sendMailboxMessage('gui', 'QQ 深深，帮我看看网关日志', '协作请求')
    expect(sent.from).toBe('gui')
    expect(sent.to).toBe('qq')
    // QQ 深深读自己的收件箱
    const inbox = readMailboxInbox('qq')
    expect(inbox).toHaveLength(1)
    expect(inbox[0].text).toContain('网关日志')
    expect(inbox[0].from).toBe('gui')
    expect(inbox[0].subject).toBe('协作请求')
    // 读过后归档，不再重复读到
    expect(countUnread('qq')).toBe(0)
    const again = readMailboxInbox('qq')
    expect(again).toHaveLength(0)
  })

  it('QQ 深深发消息 → GUI 深深收到（双向）', async () => {
    await sendMailboxMessage('qq', 'GUI 深深，权限已配好，记得清理临时文件')
    const inbox = readMailboxInbox('gui')
    expect(inbox).toHaveLength(1)
    expect(inbox[0].from).toBe('qq')
    expect(inbox[0].text).toContain('权限已配好')
  })

  it('from 身份由写入方强制，无法伪造', async () => {
    // sendMailboxMessage 的 from 参数就是身份，没有调用方可控的 to/from 注入面
    const sent = await sendMailboxMessage('gui', '测试')
    expect(sent.from).toBe('gui')
    expect(sent.to).toBe('qq')
  })

  it('空消息拒绝', async () => {
    await expect(sendMailboxMessage('gui', '   ')).rejects.toThrow('must not be blank')
  })

  it('超长消息拒绝', async () => {
    await expect(sendMailboxMessage('gui', 'x'.repeat(16001))).rejects.toThrow('must not exceed')
  })

  it('归档目录保留审计', async () => {
    await sendMailboxMessage('qq', '一条需要留档的消息')
    readMailboxInbox('gui')
    expect(existsSync(join(tempHome, 'archive'))).toBe(true)
  })
})
