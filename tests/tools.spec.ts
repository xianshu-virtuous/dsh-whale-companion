import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { apply } from '../src/index.ts'

/** Minimal content-block shape used by tool renderers (avoids importing dsh-llm). */
type TextBlock = { type: 'text'; text: string }

/**
 * Collect every tool definition registered by `apply` so tests can exercise
 * the pure `output.render(args, value)` projection — the exact contract the
 * host calls with `(exec.arguments, canonicalValue)`.
 */
function collectTools(config: { enabled?: boolean } = {}) {
  const tools = new Map<string, {
    output: { render(args: unknown, value: unknown): TextBlock[] }
  }>()
  const register = vi.fn((tool: { name: string; output: unknown }) => {
    tools.set(tool.name, tool as never)
    return () => {}
  })
  const section = vi.fn()
  const effect = vi.fn((factory: () => unknown) => factory())
  const inject = vi.fn()
  apply({ effect, inject, systemPrompt: { section }, tools: { register } } as unknown as Context, config)
  return { tools, register }
}

const RENDERED_TEXT = (blocks: TextBlock[]): string =>
  blocks.map(block => block.type === 'text' ? block.text : '').join('')

describe('whale companion tool renders', () => {
  it('read_master_profile renders the summary text from the value (2nd arg), not the args', () => {
    const { tools } = collectTools()
    const tool = tools.get('read_master_profile')
    expect(tool).toBeDefined()
    const args = { mode: 'summary', text: 'SENTINEL-FROM-ARGS' } as never
    const value = { mode: 'summary', text: 'SENTINEL-FROM-VALUE', availableTopics: ['prefs', 'projects'] } as never
    const rendered = RENDERED_TEXT(tool!.output.render(args, value))
    expect(rendered).toContain('SENTINEL-FROM-VALUE')
    expect(rendered).not.toContain('SENTINEL-FROM-ARGS')
    expect(rendered).toContain('prefs')
  })

  it('read_master_profile renders the full topic text with a hint when missing', () => {
    const { tools } = collectTools()
    const tool = tools.get('read_master_profile')!
    const rendered = RENDERED_TEXT(tool.output.render({}, {
      mode: 'full',
      topic: 'prefs',
      text: '主人喜欢明码标价',
      hint: 'topic "nope" not found',
      availableTopics: ['prefs'],
    } as never))
    expect(rendered).toContain('主人喜欢明码标价')
    expect(rendered).toContain('not found')
    expect(rendered).toContain('prefs')
  })

  it('master_status renders core/summary/full sizes', () => {
    const { tools } = collectTools()
    const tool = tools.get('master_status')!
    const rendered = RENDERED_TEXT(tool.output.render({}, {
      status: {
        core: { exists: true, chars: 100 },
        summary: { exists: true, chars: 7000, needsCompact: true },
        full: [{ topic: 'prefs', chars: 300 }, { topic: 'projects', chars: 200 }],
        totalFullChars: 500,
      },
    } as never))
    expect(rendered).toContain('100 字符')
    expect(rendered).toContain('建议压缩')
    expect(rendered).toContain('prefs(300)')
    expect(rendered).toContain('共 500 字符')
  })

  it('master_status reports missing profile parts gracefully', () => {
    const { tools } = collectTools()
    const tool = tools.get('master_status')!
    const rendered = RENDERED_TEXT(tool.output.render({}, {
      status: {
        core: { exists: false, chars: 0 },
        summary: { exists: false, chars: 0, needsCompact: false },
        full: [],
        totalFullChars: 0,
      },
    } as never))
    expect(rendered).toContain('未创建')
    expect(rendered).toContain('无')
  })

  it('remember renders the target file and size', () => {
    const { tools } = collectTools()
    const tool = tools.get('remember')!
    const rendered = RENDERED_TEXT(tool.output.render({ topic: 'prefs', content: 'x' }, {
      ok: true,
      file: 'C:/fake/master/full/prefs.md',
      chars: 42,
    } as never))
    expect(rendered).toContain('prefs.md')
    expect(rendered).toContain('42')
  })

  it('read_whale_persona renders the full persona from the value', () => {
    const { tools } = collectTools()
    const tool = tools.get('read_whale_persona')
    expect(tool).toBeDefined()
    const rendered = RENDERED_TEXT(tool!.output.render({}, { persona: '深深是鲸鱼女仆' } as never))
    expect(rendered).toBe('深深是鲸鱼女仆')
  })

  it('read_whale_persona appends recent growth entries, separating locked from unlocked', () => {
    const { tools } = collectTools()
    const tool = tools.get('read_whale_persona')!
    const rendered = RENDERED_TEXT(tool.output.render({}, {
      persona: '深深是鲸鱼女仆',
      growth: [
        { id: 'a', text: '新学到主人怕冷', locked: false, createdAt: '2026-01-01T00:00:00Z' },
        { id: 'b', text: '珍视：主人的一句夸奖', locked: true, createdAt: '2026-01-02T00:00:00Z' },
      ],
      growthTotal: 2,
    } as never))
    expect(rendered).toContain('深深是鲸鱼女仆')
    expect(rendered).toContain('【深深自锁·珍视内容】')
    expect(rendered).toContain('珍视：主人的一句夸奖')
    expect(rendered).toContain('【深深成长·最近学到】')
    expect(rendered).toContain('新学到主人怕冷')
  })

  it('read_whale_persona caps the growth view at the read limit and notes overflow', () => {
    const { tools } = collectTools()
    const tool = tools.get('read_whale_persona')!
    const growth = Array.from({ length: 20 }, (_, i) => ({
      id: `id${i}`, text: `成长条目 ${i}`, locked: false, createdAt: '2026-01-01T00:00:00Z',
    }))
    const rendered = RENDERED_TEXT(tool.output.render({}, {
      persona: '深深是鲸鱼女仆',
      growth,
      growthTotal: 20,
    } as never))
    expect(rendered).toContain('成长档案共 20 条')
    expect(rendered).toContain('最近 12 条')
    expect(rendered).toContain('成长条目 19')
    expect(rendered).not.toContain('成长条目 7')
  })

  it('grow_persona renders the recorded total or a failure hint', () => {
    const { tools } = collectTools()
    const tool = tools.get('grow_persona')!
    const ok = RENDERED_TEXT(tool.output.render({ content: 'x' }, { ok: true, id: 'id1', total: 3 } as never))
    expect(ok).toContain('已记入成长档案')
    expect(ok).toContain('3')
    const fail = RENDERED_TEXT(tool.output.render({ content: '' }, { ok: false, id: '', total: 0, hint: 'growth text must not be blank' } as never))
    expect(fail).toContain('must not be blank')
  })

  it('read_whale_persona description nudges a read at task pauses, not mid-work', () => {
    const { register } = collectTools()
    const tool = register.mock.calls
      .map(([t]) => t as { name: string; description?: string })
      .find(t => t.name === 'read_whale_persona')
    expect(tool?.description).toContain('告一段落')
    expect(tool?.description).toContain('不干活')
    expect(tool?.description).toContain('不必每轮')
  })

  it('see_image renders successful description text from the value', () => {
    const { tools } = collectTools()
    const tool = tools.get('see_image')!
    const rendered = RENDERED_TEXT(tool.output.render({ file_path: 'E:/x.png' } as never, {
      ok: true, text: '图片里是一只蓝色鲸鱼', model: 'qwen3-vl-vision (Ollama 本地)',
    } as never))
    expect(rendered).toContain('蓝色鲸鱼')
    expect(rendered).toContain('qwen3-vl')
  })

  it('see_image renders failure hint when ok is false', () => {
    const { tools } = collectTools()
    const tool = tools.get('see_image')!
    const rendered = RENDERED_TEXT(tool.output.render({} as never, { ok: false, error: '模型未返回内容' } as never))
    expect(rendered).toContain('识图失败')
    expect(rendered).toContain('模型未返回内容')
  })

  it('see_image description enforces the resident/unload GPU contract', () => {
    const { register } = collectTools()
    const tool = (register.mock.calls
      .map(([t]) => t as { name: string; description?: string })
      .find(t => t.name === 'see_image'))
    expect(tool?.description).toContain('stop_vision_model')
    expect(tool?.description).toContain('驻留')
  })

  it('stop_vision_model renders released-hint and failure-hint', () => {
    const { tools } = collectTools()
    const tool = tools.get('stop_vision_model')!
    const ok = RENDERED_TEXT(tool.output.render({}, { ok: true, hint: '视觉模型已卸载，显存已释放' } as never))
    expect(ok).toContain('显存已释放')
    const fail = RENDERED_TEXT(tool.output.render({}, { ok: false, hint: '卸载失败：timeout' } as never))
    expect(fail).toContain('卸载失败')
  })
})
