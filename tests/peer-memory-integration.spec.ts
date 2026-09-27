import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  setPeersRootForTests, appendPeerMemory, searchPeerMemory, readActivePeerMeta,
} from '../src/peer-memory.ts'

// 模拟 dsh-qqbot 补丁：按 sessionId 写 _active 元数据文件（与 inbound.js 补丁一致）
function writeActiveMeta(sessionId: string, peerId: string, senderId: string, isMaster: boolean) {
  const dir = join(tempHome, '_active')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${sessionId}.json`), JSON.stringify({
    scope: 'c2c', peerId, senderId, isMaster, updatedAt: Date.now(),
  }), 'utf8')
}

function makeExec(sessionId: string) {
  return { agent: { session: { id: sessionId } } }
}

// 从 exec 提取 peerId（与 index.ts 的 peerIdFromExec 逻辑一致）
function peerIdFromExecLike(exec: any): string | null {
  const meta = readActivePeerMeta(exec?.agent?.session?.id)
  return meta !== null ? meta.peerId : null
}

let tempHome: string

describe('peer memory integration (tool exec context)', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'whale-peer-int-'))
    setPeersRootForTests(tempHome)
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
    setPeersRootForTests(null)
  })

  it('peerIdFromExec 从 peer 元数据提取 peerId（主号）', () => {
    writeActiveMeta('sess-master-id', '520F46B036F1D76820067E3CCE63F8DC', '520F46B036F1D76820067E3CCE63F8DC', true)
    const exec = makeExec('sess-master-id')
    expect(peerIdFromExecLike(exec)).toBe('520F46B036F1D76820067E3CCE63F8DC')
  })

  it('peerIdFromExec 提取小号 peerId', () => {
    writeActiveMeta('sess-guest', 'GUEST_OPENID_ABC', 'GUEST_OPENID_ABC', false)
    const exec = makeExec('sess-guest')
    expect(peerIdFromExecLike(exec)).toBe('GUEST_OPENID_ABC')
  })

  it('无 peer 元数据返回 null（GUI 会话或旧会话）', () => {
    const exec = { agent: { session: { id: 'sess-no-meta' } } }
    expect(peerIdFromExecLike(exec)).toBeNull()
  })

  it('完整链路：主人记一条 → 检索命中；小号独立空间不可见', async () => {
    writeActiveMeta('sess-master', 'MASTER_ID', 'MASTER_ID', true)
    writeActiveMeta('sess-guest2', 'GUEST_ID', 'GUEST_ID', false)
    const master = makeExec('sess-master')
    const guest = makeExec('sess-guest2')
    const masterPeer = peerIdFromExecLike(master)!
    const guestPeer = peerIdFromExecLike(guest)!
    expect(masterPeer).toBe('MASTER_ID')
    expect(guestPeer).toBe('GUEST_ID')
    // 主人写入记忆
    await appendPeerMemory(masterPeer, '主人喜欢深夜写代码')
    // 主人检索命中
    const masterHits = searchPeerMemory(masterPeer, '深夜', 5)
    expect(masterHits.some(e => e.text.includes('深夜写代码'))).toBe(true)
    // 小号空间检索不到主人记忆
    const guestHits = searchPeerMemory(guestPeer, '深夜', 5)
    expect(guestHits.some(e => e.text.includes('主人喜欢'))).toBe(false)
  })

  it('多 peer 各自独立累积', async () => {
    await appendPeerMemory('A', 'A 的往事一')
    await appendPeerMemory('B', 'B 的往事一')
    await appendPeerMemory('A', 'A 的往事二')
    const aEntries = searchPeerMemory('A', '', 10)
    const bEntries = searchPeerMemory('B', '', 10)
    expect(aEntries).toHaveLength(2)
    expect(bEntries).toHaveLength(1)
    expect(aEntries.every(e => e.text.startsWith('A 的'))).toBe(true)
    expect(bEntries.every(e => e.text.startsWith('B 的'))).toBe(true)
  })
})
