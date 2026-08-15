import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DEFAULT_PERSONA } from '../shared/persona.ts'
import css from './PersonaSettingsSection.module.css'

const ENDPOINT = '/api/dsh-whale-companion/persona'
const MAX_PERSONA_CHARACTERS = 32_768

type PersonaSectionProps = PropsRuntime<'settings.section'>

interface PersonaResponse {
  persona?: unknown
  custom?: unknown
  error?: unknown
}

/** Settings page for editing the next-start additive persona. */
export function PersonaSettingsSection(_props: PersonaSectionProps): ReactNode {
  const [persona, setPersona] = useState(DEFAULT_PERSONA)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [custom, setCustom] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [restartPrompt, setRestartPrompt] = useState<'saved' | 'endpoint' | null>(null)

  useEffect(() => {
    let active = true
    void requestPersona().then(
      (value) => {
        if (!active) return
        setPersona(value.persona)
        setCustom(value.custom)
        setLoading(false)
      },
      (reason: unknown) => {
        if (!active) return
        setPersona(DEFAULT_PERSONA)
        setError(reason instanceof Error ? reason.message : String(reason))
        if (reason instanceof PersonaEndpointUnavailableError) setRestartPrompt('endpoint')
        setLoading(false)
      },
    )
    return () => { active = false }
  }, [])

  const save = async (): Promise<void> => {
    setSaving(true)
    setError(null)
    try {
      const response = await fetch(ENDPOINT, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          'x-dsh-whale-companion': '1',
        },
        body: JSON.stringify({ persona }),
      })
      const body = await responseBody(response)
      if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
      setCustom(true)
      setRestartPrompt('saved')
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : String(reason))
      if (reason instanceof PersonaEndpointUnavailableError) setRestartPrompt('endpoint')
    } finally {
      setSaving(false)
    }
  }

  const blank = persona.trim() === ''
  return (
    <div className={css.section} data-whale-persona-settings>
      <div className={css.heading}>
        <span className={css.crest} aria-hidden="true" />
        <div>
          <h2>鲸鱼娘人格</h2>
          <p>{custom ? '当前使用自定义人格文本' : '当前使用插件默认人格文本'}</p>
        </div>
      </div>
      <label className={css.field}>
        <span>人格提示词</span>
        <small>直接输入正文即可，无需添加三引号；保存后插件会自动添加人格边界。</small>
        <textarea
          value={persona}
          disabled={loading || saving}
          maxLength={MAX_PERSONA_CHARACTERS}
          spellCheck={false}
          onChange={(event) => { setPersona(event.target.value) }}
        />
      </label>
      <div className={css.meta}>
        <span>{persona.length.toLocaleString()} / {MAX_PERSONA_CHARACTERS.toLocaleString()}</span>
        {error === null ? null : <span className={css.error} role="alert">{error}</span>}
      </div>
      <div className={css.actions}>
        <Button disabled={loading || saving || blank} onClick={() => { void save() }}>
          {saving ? '正在保存…' : '覆写人格'}
        </Button>
      </div>
      <Modal
        open={restartPrompt !== null}
        onClose={() => { setRestartPrompt(null) }}
        title={restartPrompt === 'saved' ? '人格已覆写' : '需要重启 Harness'}
        closeLabel="关闭"
        description={restartPrompt === 'saved'
          ? '新的人格提示词将在重启 DeepSeek Harness 后生效。当前会话不会被中断。'
          : '当前 Harness 进程尚未加载人格配置接口。请重启一次后再保存。'}
        className={css.dialog as string}
        footer={<Button autoFocus onClick={() => { setRestartPrompt(null) }}>知道了</Button>}
      >
        <p className={css.restartText}>请在方便时关闭并重新启动 Harness。插件不会代替你执行重启，也不会终止当前任务。</p>
      </Modal>
    </div>
  )
}

async function requestPersona(): Promise<{ persona: string; custom: boolean }> {
  const response = await fetch(ENDPOINT, { cache: 'no-store' })
  const body = await responseBody(response)
  if (!response.ok) throw new Error(typeof body.error === 'string' ? body.error : `HTTP ${response.status}`)
  if (typeof body.persona !== 'string') throw new Error('人格配置响应缺少文本')
  return { persona: body.persona, custom: body.custom === true }
}

class PersonaEndpointUnavailableError extends Error {}

async function responseBody(response: Response): Promise<PersonaResponse> {
  const text = await response.text()
  if (response.status === 404) {
    throw new PersonaEndpointUnavailableError('人格配置接口尚未加载，请重启 DeepSeek Harness 后再试。')
  }
  try {
    return JSON.parse(text) as PersonaResponse
  } catch {
    throw new Error(`人格配置接口返回了无效响应（HTTP ${response.status}）。`)
  }
}
