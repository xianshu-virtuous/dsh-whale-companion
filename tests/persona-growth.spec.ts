import { describe, expect, it } from 'vitest'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendGrowth, loadGrowth, MAX_GROWTH_CHARS, MAX_GROWTH_ENTRIES,
} from '../src/persona-growth.ts'

describe('whale maid persona growth', () => {
  it('returns an empty archive before any entries are appended', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-whale-growth-'))
    expect(loadGrowth(join(dir, 'growth.json'))).toEqual([])
  })

  it('appends entries in order and persists them', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-whale-growth-'))
    const path = join(dir, 'growth.json')
    const first = await appendGrowth('第一条：主人怕冷', false, path)
    const second = await appendGrowth('第二条：珍视的夸奖', true, path)
    const entries = loadGrowth(path)
    expect(entries).toHaveLength(2)
    expect(entries[0]).toMatchObject({ id: first.id, text: '第一条：主人怕冷', locked: false })
    expect(entries[1]).toMatchObject({ id: second.id, text: '第二条：珍视的夸奖', locked: true })
    expect(entries[1].createdAt).toBeTruthy()
  })

  it('rejects blank and oversized growth entries', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-whale-growth-'))
    const path = join(dir, 'growth.json')
    await expect(appendGrowth('   ', false, path)).rejects.toThrow(/blank/)
    await expect(appendGrowth('x'.repeat(MAX_GROWTH_CHARS + 1), false, path)).rejects.toThrow(/exceed/)
  })

  it('rejects appends once the archive is full', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-whale-growth-'))
    const path = join(dir, 'growth.json')
    const full = Array.from({ length: MAX_GROWTH_ENTRIES }, (_, i) => ({
      id: `id${i}`, text: `条目 ${i}`, locked: false, createdAt: '2026-01-01T00:00:00Z',
    }))
    await writeFile(path, JSON.stringify({ secrets: full }), 'utf8')
    await expect(appendGrowth('新条目', false, path)).rejects.toThrow(/full/)
  })

  it('reads a bare-array archive (legacy) as well as the secrets wrapper', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'dsh-whale-growth-'))
    const bare = join(dir, 'bare.json')
    const wrapped = join(dir, 'wrapped.json')
    await writeFile(bare, JSON.stringify([{ id: 'a', text: '裸数组条目', locked: false, createdAt: '' }]), 'utf8')
    await writeFile(wrapped, JSON.stringify({ secrets: [{ id: 'b', text: 'secrets 包裹条目', locked: true, createdAt: '' }] }), 'utf8')
    expect(loadGrowth(bare).map(e => e.text)).toEqual(['裸数组条目'])
    expect(loadGrowth(wrapped).map(e => e.text)).toEqual(['secrets 包裹条目'])
  })
})
