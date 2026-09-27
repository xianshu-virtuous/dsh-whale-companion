import { describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { apply, DEFAULT_PERSONA } from '../src/index.ts'
import { loadPersona, parsePersonaDocument, savePersona } from '../src/persona-store.ts'
import { PERSONA_REMINDER, renderPersonaSection } from '../src/shared/persona.ts'

describe('whale maid persona', () => {
  it('registers an additive ordered prompt section', () => {
    const section = vi.fn((_contribution: {
      name: string
      order: number
      text: (input: { scope: unknown }) => string
    }) => () => {})
    const register = vi.fn((tool: { name: string }) => () => {})
    const effect = vi.fn((factory: () => unknown) => factory())
    const inject = vi.fn()
    apply({ effect, inject, systemPrompt: { section }, tools: { register } } as unknown as Context, {})
    const effectivePersona = loadPersona(DEFAULT_PERSONA).persona
    const contribution = section.mock.calls
      .map(([c]) => c as { name: string; order: number; text: (input: { scope: unknown }) => string })
      .find(c => c.name === 'whale-companion:persona')!
    expect(contribution.name).toBe('whale-companion:persona')
    expect(contribution.order).toBe(10)
    const firstScope = { session: { requestHeader: () => undefined } }
    const laterScope = { session: { requestHeader: () => ({}) } }
    expect(contribution.text({ scope: firstScope })).toBe(renderPersonaSection(effectivePersona))
    expect(contribution.text({ scope: laterScope })).toBe(PERSONA_REMINDER)
    // 续会话提醒必须是中文简略提示词：锚定身份 + 关键设定 + 表情经济学
    expect(PERSONA_REMINDER).toContain('深深')
    expect(PERSONA_REMINDER).toContain('B87')
    expect(PERSONA_REMINDER).toContain('变黑')
    expect(PERSONA_REMINDER).toContain('表情包')
    expect(PERSONA_REMINDER).not.toContain('Maintain the DeepDeep')
    const registeredNames = register.mock.calls.map(([tool]) => (tool as { name: string }).name)
    expect(registeredNames).toEqual([
      'read_master_profile',
      'remember',
      'master_status',
      'recall_peer_memory',
      'remember_peer',
      'peer_memory_status',
      'send_message_to_shen',
      'read_mailbox',
      'mailbox_status',
      'see_image',
      'stop_vision_model',
      'read_whale_persona',
      'grow_persona',
    ])
    expect(inject).toHaveBeenCalledWith(['webServer'], expect.any(Function))
  })

  it('can be disabled without touching the prompt registry', () => {
    const section = vi.fn()
    const register = vi.fn()
    const effect = vi.fn()
    apply({ effect, systemPrompt: { section }, tools: { register } } as unknown as Context, { enabled: false })
    expect(effect).not.toHaveBeenCalled()
    expect(section).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
  })

  it('loads a valid persisted override', () => {
    expect(parsePersonaDocument({ persona: 'custom role' })).toEqual({ persona: 'custom role' })
    expect(() => parsePersonaDocument({ persona: '   ' })).toThrow(/blank/)
    expect(loadPersona('fallback', 'F:/definitely-not-present/persona.json')).toEqual({
      persona: 'fallback',
      custom: false,
    })
  })

  it('replaces an existing persona document on repeated saves', async () => {
    const path = join(tmpdir(), `dsh-whale-persona-${randomUUID()}`, 'persona.json')
    await savePersona({ persona: 'first role' }, path)
    await savePersona({ persona: 'second role' }, path)
    expect(loadPersona('fallback', path)).toEqual({ persona: 'second role', custom: true })
  })

  it('falls back safely when a hand-edited persona file is invalid', async () => {
    const path = join(tmpdir(), `dsh-whale-persona-${randomUUID()}.json`)
    await writeFile(path, '{ not valid json', 'utf8')
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(loadPersona('fallback', path)).toEqual({ persona: 'fallback', custom: false })
    expect(warning).toHaveBeenCalledOnce()
    warning.mockRestore()
  })
})
