import { describe, expect, it } from 'vitest'
import { EMOTION_TAGS, buildTagPrompt, parseTagResponse } from '../src/stickers/tagging.ts'
import { filterCandidates, PAGE_SIZE } from '../src/stickers/index.ts'
import { SHORT_ID_LENGTH, findSticker, shortId, type StickerIndex } from '../src/stickers/store.ts'

function entry(id: string, description: string, tags: string[]) {
  return { id, file: `${id}0000.png`, description, tags, addedAt: '2026-10-11T00:00:00.000Z' }
}

function indexOf(entries: ReturnType<typeof entry>[]): StickerIndex {
  return { version: 1, entries }
}

describe('whale companion stickers · tagging', () => {
  it('parses a clean JSON reply', () => {
    const result = parseTagResponse('{"keep": true, "description": "生气地翻白眼", "emotion_tags": ["生气", "无语"]}')
    expect(result).toEqual({ keep: true, description: '生气地翻白眼', tags: ['生气', '无语'] })
  })

  it('tolerates prose around the JSON object', () => {
    const result = parseTagResponse('好的，这是标注：\n{"keep": true, "description": "比了个大拇指", "emotion_tags": ["赞同"]}\n希望有帮助')
    expect(result?.description).toBe('比了个大拇指')
    expect(result?.tags).toEqual(['赞同'])
  })

  it('drops tags outside the preset and caps at three', () => {
    const result = parseTagResponse('{"keep": true, "description": "x", "emotion_tags": ["开心","不存在的标签","难过","生气","惊讶"]}')
    expect(result?.tags).toEqual(['开心', '难过', '生气'])
  })

  it('treats keep:false as a drop decision but keeps the annotation', () => {
    const result = parseTagResponse('{"keep": false, "description": "模糊的低质图", "emotion_tags": []}')
    expect(result).toEqual({ keep: false, description: '模糊的低质图', tags: [] })
  })

  it('rejects replies without a usable description or JSON', () => {
    expect(parseTagResponse('这里没有 JSON')).toBeNull()
    expect(parseTagResponse('{"keep": true, "description": "   ", "emotion_tags": []}')).toBeNull()
    expect(parseTagResponse('{ 坏掉的 json }')).toBeNull()
  })

  it('builds a prompt that offers every preset tag', () => {
    const prompt = buildTagPrompt()
    for (const tag of EMOTION_TAGS) expect(prompt).toContain(tag)
    expect(prompt).toContain('JSON')
  })
})

describe('whale companion stickers · 检索', () => {
  const index = indexOf([
    entry('aaaa111122223333', '生气地翻白眼', ['生气', '无语']),
    entry('bbbb111122223333', '开心地转圈', ['开心']),
    entry('cccc111122223333', '无奈摊手', ['无语']),
  ])

  it('filters by emotion tags', () => {
    const hit = filterCandidates(index, ['开心'], '')
    expect(hit.map(e => e.id)).toEqual(['bbbb111122223333'])
  })

  it('accepts multiple tags as a union', () => {
    const hit = filterCandidates(index, ['开心', '生气'], '')
    expect(hit).toHaveLength(2)
  })

  it('narrows by free-text description when there are many candidates', () => {
    const many = indexOf(Array.from({ length: PAGE_SIZE + 2 }, (_, i) =>
      entry(`${String(i).padStart(16, '0')}`, `第 ${i} 张 摊手`, ['无语'])))
    const hit = filterCandidates(many, ['无语'], '摊手')
    expect(hit.length).toBeGreaterThan(0)
    expect(hit.every(e => e.description.includes('摊手'))).toBe(true)
  })

  it('returns empty when nothing matches, so the caller can fall back', () => {
    expect(filterCandidates(index, ['害怕'], '')).toHaveLength(0)
  })
})

describe('whale companion stickers · 索引', () => {
  it('shortens the content hash into a stable id', () => {
    const hash = 'a'.repeat(64)
    expect(shortId(hash)).toHaveLength(SHORT_ID_LENGTH)
    expect(shortId(hash)).toBe('a'.repeat(SHORT_ID_LENGTH))
  })

  it('finds entries by full id, id prefix, or file name', () => {
    const index = indexOf([entry('abcd1234abcd1234', '示意', ['开心'])])
    expect(findSticker(index, 'abcd1234abcd1234')?.description).toBe('示意')
    expect(findSticker(index, 'abcd1234')?.description).toBe('示意')
    expect(findSticker(index, 'abcd1234abcd12340000.png')?.description).toBe('示意')
    expect(findSticker(index, 'zzzz')).toBeUndefined()
    expect(findSticker(index, '   ')).toBeUndefined()
  })
})
