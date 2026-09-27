import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendPeerMemory, searchPeerMemory, peerSnippet, loadPeerEntries, extractTokens,
  setPeersRootForTests, textSimilarity, dedupEntries, recallFlashback, weightedFlashback, bumpHit,
} from '../src/peer-memory.ts'

let tempHome: string

describe('peer-memory', () => {
  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), 'whale-peer-test-'))
    setPeersRootForTests(tempHome)
  })

  afterEach(() => {
    rmSync(tempHome, { recursive: true, force: true })
    setPeersRootForTests(null)
  })

  it('extractTokens 提取中英文词', () => {
    const tokens = extractTokens('主人喜欢 DeepSeek 和鲸鱼娘', 64)
    expect(tokens).toContain('deepseek')
    expect(tokens).toContain('主人')
    expect(tokens).toContain('鲸鱼')
    // 停用词被过滤
    expect(tokens).not.toContain('的')
  })

  it('appendPeerMemory 追加并建索引', async () => {
    await appendPeerMemory('peerA', '小号飞行雪萤喜欢玩 Minecraft')
    const entries = loadPeerEntries('peerA')
    expect(entries).toHaveLength(1)
    expect(entries[0].text).toContain('Minecraft')
    // 索引文件存在
    const indexPath = join(tempHome, 'peerA', 'index.json')
    expect(existsSync(indexPath)).toBe(true)
    const index = JSON.parse(readFileSync(indexPath, 'utf8'))
    expect(index['minecraft']).toContain(entries[0].id)
  })

  it('searchPeerMemory 按关键词检索', async () => {
    await appendPeerMemory('peerB', '主人主号叫飞行雪绒，QQ 981575562')
    await appendPeerMemory('peerB', '主人喜欢喝咖啡')
    await appendPeerMemory('peerB', '最近在折腾 QQ 机器人接入')
    const hits = searchPeerMemory('peerB', '咖啡', 5)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].text).toContain('咖啡')
    // 不相关的记忆不应排在最前
    const unrelated = searchPeerMemory('peerB', '机器人', 5)
    expect(unrelated[0].text).toContain('机器人')
  })

  it('searchPeerMemory 空查询返回最近记忆', async () => {
    await appendPeerMemory('peerC', '第一条记忆')
    await appendPeerMemory('peerC', '第二条记忆')
    const recent = searchPeerMemory('peerC', '', 5)
    expect(recent.length).toBe(2)
    expect(recent[0].text).toBe('第二条记忆')
  })

  it('peerSnippet 生成迷你摘要（最近 3 条首句）', async () => {
    await appendPeerMemory('peerD', '喜欢蓝色\n详细内容一')
    await appendPeerMemory('peerD', '讨厌辣椒')
    const snippet = peerSnippet('peerD')
    expect(snippet).toContain('喜欢蓝色')
    expect(snippet).toContain('讨厌辣椒')
  })

  it('peer 间记忆完全隔离', async () => {
    await appendPeerMemory('peerX', 'X 的秘密数据')
    await appendPeerMemory('peerY', 'Y 的私有数据')
    // X 检索"私有数据"不应出现 Y 的内容（无命中时补充的是 X 自己的记忆）
    const xHits = searchPeerMemory('peerX', '私有数据', 5)
    expect(xHits.every(e => !e.text.includes('Y 的私有数据'))).toBe(true)
    expect(xHits.every(e => e.text.includes('X'))).toBe(true)
    // Y 检索自己内容能命中
    const yHits = searchPeerMemory('peerY', '私有数据', 5)
    expect(yHits.some(e => e.text.includes('Y 的私有数据'))).toBe(true)
  })

  it('textSimilarity 高相似文本得分高、无关文本得分低', () => {
    const same = textSimilarity('主人喜欢喝咖啡和茶', '主人喜欢喝咖啡但不爱茶')
    const low = textSimilarity('主人喜欢喝咖啡和茶', '小号下周要去北京出差')
    expect(same).toBeGreaterThan(0.5)
    expect(low).toBeLessThan(0.5)
  })

  it('dedupEntries 剔除高度雷同的重复条目并保 diversity', async () => {
    // 第二句几乎只多了一个"醒脑"，逐词雷同，应被去重
    await appendPeerMemory('peerD1', '主人喜欢喝美式咖啡，每天早上一杯提神')
    await appendPeerMemory('peerD1', '主人喜欢喝美式咖啡，每天早上一杯提神醒脑')
    await appendPeerMemory('peerD1', '主人最近在折腾 QQ 机器人接入')
    const all = loadPeerEntries('peerD1')
    expect(all).toHaveLength(3)
    const deduped = dedupEntries(all, 0.85, 10)
    // 两条雷同的美式咖啡记忆只保留一条
    const coffee = deduped.filter(e => e.text.includes('美式咖啡'))
    expect(coffee.length).toBeLessThanOrEqual(1)
    // 不同的机器人记忆被保留
    expect(deduped.some(e => e.text.includes('QQ 机器人'))).toBe(true)
  })

  it('searchPeerMemory 去重后不重复返回雷同记忆', async () => {
    // 逐词几乎一致的两条雪绒记忆，应只返回一条
    await appendPeerMemory('peerD2', '主人主号叫飞行雪绒，QQ 号码 981575562')
    await appendPeerMemory('peerD2', '主人主号叫飞行雪绒，QQ 号码 981575562')
    await appendPeerMemory('peerD2', '主人喜欢喝美式咖啡')
    const hits = searchPeerMemory('peerD2', '雪绒', 5)
    // 查到内容但雷同的两条不重复返回
    const snow = hits.filter(e => e.text.includes('雪绒'))
    expect(hits.length).toBeGreaterThan(0)
    expect(snow.length).toBeLessThanOrEqual(1)
  })

  it('weightedFlashback 低活跃记忆权重更高', () => {
    const low = { id: 'low', text: '旧记忆', createdAt: '', hits: 0 }
    const hot = { id: 'hot', text: '热门记忆', createdAt: '', hits: 50 }
    // rng 返回 0 -> 命中第一项（低活跃权重大，理论上最先被抽到）
    const picked = weightedFlashback([low, hot], 1.0, () => 0)
    expect(picked?.id).toBe('low')
  })

  it('recallFlashback 混合旧记忆与最近记忆', async () => {
    // 8 条内容各异的旧记忆（像真实记忆），最后一条是最近的
    const texts = [
      '主人喜欢蓝色鲸鱼和深海主题',
      '主人主号叫飞行雪绒，QQ 981575562',
      '主人最近在折腾 QQ 机器人接入',
      '主人喜欢喝美式咖啡，每天清早一杯',
      '主人偏好简短直接的口语化表达',
      '主人讨厌被叫笨蛋和胖',
      '主人习惯深夜 1 到 4 点干活',
      '主人用 GHelper 管理笔记本散热',
    ]
    for (const t of texts) await appendPeerMemory('peerF', t)
    const all = loadPeerEntries('peerF')
    expect(all).toHaveLength(8)
    const rec = recallFlashback('peerF', 5, 0.4, () => 0)
    expect(rec.length).toBe(5)
    // 混合返回既包含早期记忆又包含最近记忆
    const content = rec.map(e => e.text).join(' | ')
    expect(content).toContain('蓝色鲸鱼')
    expect(rec.some(e => e.text.includes('GHelper'))).toBe(true)
  })

  it('bumpHit 递增并持久化', async () => {
    await appendPeerMemory('peerH', '主人喜欢蓝色鲸鱼')
    const [entry] = loadPeerEntries('peerH')
    expect(entry.hits).toBe(0)
    const next = await bumpHit('peerH', entry.id)
    expect(next).toBe(1)
    const [after] = loadPeerEntries('peerH')
    expect(after.hits).toBe(1)
    // 再次递增
    const next2 = await bumpHit('peerH', entry.id)
    expect(next2).toBe(2)
    const [after2] = loadPeerEntries('peerH')
    expect(after2.hits).toBe(2)
  })
})
