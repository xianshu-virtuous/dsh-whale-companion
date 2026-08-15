import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadPersona, MAX_PERSONA_CHARACTERS, parsePersonaDocument, savePersona } from './persona-store.ts'
import { DEFAULT_PERSONA, PERSONA_REMINDER, renderPersonaSection } from './shared/persona.ts'

export const name = '@dsh-external/dsh-whale-companion'
export const inject = ['systemPrompt', 'tools']
export { DEFAULT_PERSONA } from './shared/persona.ts'

export interface Config {
  /** Whether the additive persona section is registered. */
  enabled?: boolean
  /** Exact additive role-play guidance. */
  persona?: string
}

interface PersonaAssemblyScope {
  session: {
    requestHeader(): unknown
  }
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  persona: z.string().default(DEFAULT_PERSONA),
})

/** Register the configured persona as an additive prompt section. */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  const configured = config.persona ?? DEFAULT_PERSONA
  const loaded = loadPersona(configured)
  const persona = loaded.persona
  if (persona.trim() === '') return
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'whale-companion:persona',
    order: 10,
    text: ({ scope }) => {
      if (scope === undefined) return ''
      const agent = scope as unknown as PersonaAssemblyScope
      return agent.session.requestHeader() === undefined
        ? renderPersonaSection(persona)
        : PERSONA_REMINDER
    },
  }), 'whale-companion: additive persona')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'read_whale_persona',
    description: 'Reload the complete DeepDeep whale-maid persona at task completion, after context transfer, or when role details may have drifted. Do not call every turn.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: { persona: { type: 'string', required: true } },
        additionalProperties: false,
      },
      render: () => [{ type: 'text', text: '已重新读取深深的人格设定。' }],
    },
    presentCall: () => ({ card: 'generic', title: '重新读取鲸鱼娘人格' }),
    execute: async () => ({ persona }),
  })), 'whale-companion: persona reload tool')

  ctx.inject(['webServer'], (scope: Context) => {
    scope.effect(() => scope.webServer.register({
      kind: 'exact',
      path: '/api/dsh-whale-companion/persona',
      handler: async (request, response) => {
        response.setHeader('cache-control', 'no-store')
        response.setHeader('content-type', 'application/json; charset=utf-8')
        if (request.method === 'GET') {
          response.writeHead(200)
          response.end(JSON.stringify(loadPersona(configured)))
          return
        }
        if (request.method !== 'PUT') {
          response.writeHead(405, { allow: 'GET, PUT' })
          response.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        if (request.headers['x-dsh-whale-companion'] !== '1'
          || !String(request.headers['content-type'] ?? '').startsWith('application/json')) {
          response.writeHead(403)
          response.end(JSON.stringify({ error: 'same-origin configuration request required' }))
          return
        }
        try {
          const body = await readJsonBody(request, MAX_PERSONA_CHARACTERS * 4)
          const document = parsePersonaDocument(body)
          await savePersona(document)
          response.writeHead(200)
          response.end(JSON.stringify({ saved: true, restartRequired: true, persona: document.persona }))
        } catch (error: unknown) {
          response.writeHead(400)
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }))
        }
      },
    }), 'whale-companion: persona configuration route')
  })
}

async function readJsonBody(request: AsyncIterable<Uint8Array>, maxBytes: number): Promise<unknown> {
  const chunks: Uint8Array[] = []
  let bytes = 0
  for await (const chunk of request) {
    bytes += chunk.byteLength
    if (bytes > maxBytes) throw new Error(`request body exceeds ${maxBytes} bytes`)
    chunks.push(chunk)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}
