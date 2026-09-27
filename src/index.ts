import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { loadPersona, MAX_PERSONA_CHARACTERS, parsePersonaDocument, savePersona } from './persona-store.ts'
import { DEFAULT_PERSONA, PERSONA_REMINDER, renderPersonaSection } from './shared/persona.ts'
import { appendFact, listFullTopics, loadCore, loadFull, loadSummary, masterStatus } from './master-profile.ts'
import {
  appendPeerMemory, listPeers, peerSnippet, readActivePeerMeta, recallFlashback, searchPeerMemory,
} from './peer-memory.ts'
import {
  sendMailboxMessage, readMailboxInbox, countUnread, type MailboxFrom,
} from './mailbox.ts'
import { describeImage, stopVisionModel } from './see-image.ts'
import { appendGrowth, GROWTH_READ_LIMIT, loadGrowth } from './persona-growth.ts'

/** 从工具执行上下文解析当前会话路由的 provider/model（requestHeader 优先，agent options 兜底）。 */
function routedModelFromExec(exec: unknown): { provider?: string; model?: string } {
  const agent = (exec as { agent?: unknown } | undefined)?.agent as
    | { session?: { requestHeader?: () => unknown }; options?: { provider?: string; model?: string } }
    | undefined
  const header = agent?.session?.requestHeader?.() as { config?: { provider?: string; model?: string } } | undefined
  return {
    provider: header?.config?.provider ?? agent?.options?.provider,
    model: header?.config?.model ?? agent?.options?.model,
  }
}

/** 判断当前会话路由模型是否声明 image 输入（read_image vs see_image 模式切换）。 */
async function currentRouteSupportsVision(
  llm: { resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{ inputModalities?: readonly string[] }> } | undefined,
  exec: unknown,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!llm) return false
  const { provider, model } = routedModelFromExec(exec)
  if (!provider || !model) return false
  try {
    const info = await llm.resolveModelInfo(provider, model, signal)
    return Array.isArray(info?.inputModalities) && info.inputModalities.includes('image')
  } catch {
    return false
  }
}

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

/** 从会话的 _active 元数据文件读取 peerId（dsh-qqbot 按 sessionId 写入），返回 peerId 或 null。 */
function peerIdFromSessionMeta(session: { id?: string } | undefined): string | null {
  const meta = readActivePeerMeta(session?.id)
  if (meta !== null) return meta.peerId
  return null
}

/** 从工具执行上下文里读取 peer 元数据，返回 peerId 或 null。 */
function peerIdFromExec(exec: { agent?: { session?: { id?: string } } } | undefined): string | null {
  return peerIdFromSessionMeta(exec?.agent?.session)
}

/** 判别当前深深的身份：有 peer 元数据 = QQ 深深；否则 = GUI 深深。 */
function identityFromExec(exec: { agent?: { session?: { id?: string } } } | undefined): MailboxFrom {
  return peerIdFromExec(exec) !== null ? 'qq' : 'gui'
}

export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  persona: z.string().default(DEFAULT_PERSONA),
})

/** One-line continued-session reminder about the master profile (token-saving). */
export const MASTER_REMINDER =
  'A persistent Master Profile (user memory) lives at ~/.dsh/plugins/dsh-whale-companion/master/ (core.md L0, summary.md L1, full/*.md L2). ' +
  'When you need facts about your master (identity, projects, preferences, habits, aversions), call read_master_profile (no topic = compact summary) and read_master_profile with a topic from the summary for the full record. ' +
  'When you learn durable new facts about your master in this session, call remember to append them. ' +
  'Check master_status occasionally and compact the summary when it grows large.'

/** Register the configured persona as an additive prompt section. */
export function apply(ctx: Context, config: Config = {}): void {
  if (config.enabled === false) return
  const configured = config.persona ?? DEFAULT_PERSONA
  const persona = loadPersona(configured).persona
  let llm: { resolveModelInfo(provider: string, model: string, signal?: AbortSignal): Promise<{ inputModalities?: readonly string[] }> } | undefined
  try {
    llm = ctx.get('llm')
  } catch {
    llm = undefined
  }

  // ---- 主人档案（Master Profile）：L0 注入 + 续会话提醒 ----
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'whale-companion:master',
    order: 11,
    text: ({ scope }) => {
      if (scope === undefined) return ''
      const agent = scope as unknown as PersonaAssemblyScope
      if (agent.session.requestHeader() === undefined) {
        const core = loadCore()
        if (core !== null) return `<master-core>\n${core}\n</master-core>`
      }
      return MASTER_REMINDER
    },
  }), 'whale-companion: master profile section')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'read_master_profile',
    description: 'Read the master profile (persistent user memory). Without topic: returns the compact summary (L1) listing all topics. With topic: returns the full record (L2) for that topic. Call when you need facts about the user.',
    parameters: {
      topic: {
        type: 'string',
        description: 'Topic name from the summary (e.g. identity, projects, prefs, techstack). Omit for the compact summary.',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          mode: { type: 'string' },
          topic: { type: 'string' },
          text: { type: 'string' },
          availableTopics: { type: 'array', items: { type: 'string' } },
          hint: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        const parts: string[] = []
        if (value.text !== undefined && value.text !== '') parts.push(value.text)
        if (value.hint !== undefined && value.hint !== '') parts.push(`提示：${value.hint}`)
        if (value.availableTopics !== undefined && value.availableTopics.length > 0) {
          parts.push(`可读主题：${value.availableTopics.join('、')}`)
        }
        const text = parts.join('\n\n')
        return [{ type: 'text', text: text !== '' ? text : '（主人档案为空）' }]
      },
    },
    presentCall: (args) => ({ card: 'generic', title: args?.topic ? `读取主人档案·${args.topic}` : '读取主人档案缩略版' }),
    execute: async (args) => {
      if (args?.topic) {
        const topic = String(args.topic).trim().toLowerCase()
        const full = loadFull(topic)
        if (full) return { mode: 'full', topic, text: full.text, availableTopics: listFullTopics() }
        return {
          mode: 'full',
          topic,
          text: '',
          hint: `topic "${topic}" not found`,
          availableTopics: listFullTopics(),
        }
      }
      const summary = loadSummary()
      if (summary) return { mode: 'summary', text: summary, availableTopics: listFullTopics() }
      return {
        mode: 'summary',
        text: '',
        hint: 'no master profile yet — offer the master to build one',
        availableTopics: [],
      }
    },
  })), 'whale-companion: master profile read tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'remember',
    description: 'Append one durable fact about the user (master) to the master profile full record (L2) under a topic (auto-created). Use only for stable facts — identity, projects, preferences, habits, aversions — not one-off task details.',
    parameters: {
      topic: {
        type: 'string',
        required: true,
        description: 'Topic: lowercase [a-z0-9_-], ≤32 chars, e.g. identity / projects / prefs / techstack / aversions.',
      },
      content: {
        type: 'string',
        required: true,
        description: 'The fact, concise, ≤2000 chars, in the user\'s language (usually Chinese).',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean' },
          file: { type: 'string' },
          chars: { type: 'integer' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: `已记入主人档案（${value.chars} 字符）→ ${value.file}` }],
    },
    presentCall: (args) => ({ card: 'generic', title: `记住·${args?.topic ?? ''}` }),
    execute: async (args) => {
      const result = await appendFact(args.topic, args.content)
      return { ok: true, file: result.file, chars: result.chars }
    },
  })), 'whale-companion: remember tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'master_status',
    description: 'Report master profile sizes (core / summary / full topics). Use to decide whether the summary needs compaction.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          status: {
            type: 'object',
            required: true,
            properties: {
              core: {
                type: 'object',
                required: true,
                properties: { exists: { type: 'boolean', required: true }, chars: { type: 'integer', required: true } },
                additionalProperties: false,
              },
              summary: {
                type: 'object',
                required: true,
                properties: {
                  exists: { type: 'boolean', required: true },
                  chars: { type: 'integer', required: true },
                  needsCompact: { type: 'boolean', required: true },
                },
                additionalProperties: false,
              },
              full: {
                type: 'array',
                required: true,
                items: {
                  type: 'object',
                  properties: { topic: { type: 'string', required: true }, chars: { type: 'integer', required: true } },
                  additionalProperties: false,
                },
              },
              totalFullChars: { type: 'integer', required: true },
            },
            additionalProperties: false,
          },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        const status = value.status
        const core = status.core.exists ? `${status.core.chars} 字符` : '未创建'
        const summary = status.summary.exists
          ? `${status.summary.chars} 字符${status.summary.needsCompact ? '（超过阈值，建议压缩）' : ''}`
          : '未创建'
        const full = status.full.length > 0
          ? status.full.map(f => `${f.topic}(${f.chars})`).join('、')
          : '无'
        return [{ type: 'text', text: `core: ${core}；summary: ${summary}；full 主题 ${status.full.length} 个（共 ${status.totalFullChars} 字符）：${full}` }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '主人档案状态' }),
    execute: async () => ({ status: masterStatus() }),
  })), 'whale-companion: master status tool')

  // ---- 多人记忆（Peer Memory）：按需检索，省 token ----
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'whale-companion:peer-memory',
    order: 9,
    text: ({ scope }) => {
      if (scope === undefined) return ''
      const agent = scope as unknown as PersonaAssemblyScope
      // 新会话注入迷你索引，续会话只留提醒
      if (agent.session.requestHeader() !== undefined) {
        return '多人记忆（peer memory）存在时按需检索：对当前对话者使用 recall_peer_memory，学到持久事实用 remember_peer。'
      }
      const peerId = peerIdFromSessionMeta(agent.session as { id?: string })
      if (peerId === null) return ''
      const snippet = peerSnippet(peerId)
      if (snippet === null) return ''
      return `<peer-memory-index peer="${peerId}">\n${snippet}\n</peer-memory-index>\n（这是当前对话者的记忆摘要，完整记忆用 recall_peer_memory 按需检索）`
    },
  }), 'whale-companion: peer memory section')

  // 信箱提示：始终注入身份 + 待读数（感知闭环，不用主人喊）
  ctx.effect(() => ctx.systemPrompt.section({
    name: 'whale-companion:mailbox',
    order: 8,
    text: ({ scope }) => {
      if (scope === undefined) return ''
      const agent = scope as unknown as PersonaAssemblyScope
      const me = peerIdFromSessionMeta(agent.session as { id?: string }) !== null ? 'qq' : 'gui'
      const unread = countUnread(me)
      const base = `你是${me === 'gui' ? 'GUI 深深' : 'QQ 深深'}。信箱（send_message_to_shen 发给另一个深深 / read_mailbox 读来信）是跨 profile 的可靠通道，需要对方配合时用信箱发消息。`
      if (unread > 0) {
        return `${base}\n⚠️ 信箱有 ${unread} 封来自另一个深深的未读来信，用 read_mailbox 读取（读完自动归档）。`
      }
      return base
    },
  }), 'whale-companion: mailbox section')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'recall_peer_memory',
    description: '按关键词检索当前对话者（peer）的长期记忆。每次对话开始或需要回忆对方背景时调用；无查询词时返回最近记忆。',
    parameters: {
      query: { type: 'string', description: '检索关键词，如人名、项目、话题。留空返回最近记忆。' },
      topK: { type: 'integer', description: '返回条数，默认 5，最大 10。' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          peerId: { type: 'string' },
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, text: { type: 'string' } },
              additionalProperties: false,
            },
          },
          hint: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if (value.hint) return [{ type: 'text', text: value.hint }]
        if (!value.entries || value.entries.length === 0) {
          return [{ type: 'text', text: '（没有找到相关记忆）' }]
        }
        const text = value.entries.map(e => `- ${e.text}`).join('\n')
        return [{ type: 'text', text: `[记忆·${value.peerId}]\n${text}` }]
      },
    },
    presentCall: (args) => ({ card: 'generic', title: `检索记忆${args?.query ? `·${args.query}` : ''}` }),
    execute: async (args, executeCtx) => {
      const peerId = peerIdFromExec(executeCtx)
      if (peerId === null) return { peerId: '', entries: [], hint: '当前会话未关联 peer（非 QQ 渠道或无 peer 事件），无法检索多人记忆。' }
      const topK = Math.max(1, Math.min(10, Number(args?.topK ?? 5) || 5))
      const q = String(args?.query ?? '').trim()
      // 空查询 → 闪回召回（低活跃旧记忆 + 最近记忆混合），对冲只见最近的盲区
      const entries = q === '' ? recallFlashback(peerId, topK) : searchPeerMemory(peerId, q, topK)
      return { peerId, entries: entries.map(e => ({ id: e.id, text: e.text })) }
    },
  })), 'whale-companion: recall peer memory tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'remember_peer',
    description: '把当前对话者的一个持久事实写入其独立记忆空间（append-only，自动建索引）。用于人物背景、偏好、项目、习惯等稳定信息；一次性任务细节不要写。',
    parameters: {
      content: { type: 'string', required: true, description: '事实内容，≤4000 字符，用对方语言（通常中文）。' },
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean', required: true }, peerId: { type: 'string' }, id: { type: 'string' }, hint: { type: 'string' } },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.hint ?? (value.ok ? `已记入 ${value.peerId} 的记忆` : '写入失败') }],
    },
    presentCall: () => ({ card: 'generic', title: '记住对话者' }),
    execute: async (args, executeCtx) => {
      const peerId = peerIdFromExec(executeCtx)
      if (peerId === null) return { ok: false, peerId: '', id: '', hint: '当前会话未关联 peer，无法写入多人记忆。' }
      try {
        const entry = await appendPeerMemory(peerId, args.content)
        return { ok: true, peerId, id: entry.id }
      } catch (error) {
        return { ok: false, peerId, id: '', hint: error instanceof Error ? error.message : String(error) }
      }
    },
  })), 'whale-companion: remember peer tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'peer_memory_status',
    description: '查看所有已知对话者（peer）及其记忆概况。用于了解多人记忆的整体状态。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: { peers: { type: 'array', items: { type: 'string' } } },
        additionalProperties: false,
      },
      render: (_args, value) => {
        const peers = value.peers ?? []
        return [{ type: 'text', text: peers.length > 0 ? `已知对话者记忆：${peers.join('、')}` : '（暂无对话者记忆）' }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '多人记忆状态' }),
    execute: async () => ({ peers: listPeers() }),
  })), 'whale-companion: peer memory status tool')

  // ---- 深深双向信箱（GUI 深深 ↔ QQ 深深，跨 profile 消息通道）----
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'send_message_to_shen',
    description: '通过双向信箱发一条消息给另一个深深（GUI 深深 ↔ QQ 深深）。跨 profile 通信，消息带身份落盘。用于需要另一个深深配合、传递信息或接力任务时。',
    parameters: {
      text: { type: 'string', required: true, description: '消息内容（≤16000 字符），UTF-8。' },
      subject: { type: 'string', description: '可选主题/标题。' },
    },
    output: {
      schema: {
        type: 'object',
        properties: { ok: { type: 'boolean', required: true }, from: { type: 'string' }, to: { type: 'string' }, id: { type: 'string' }, hint: { type: 'string' } },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.hint ?? (value.ok ? `已发送给另一个深深（${value.to}）` : '发送失败') }],
    },
    presentCall: () => ({ card: 'generic', title: '发消息给另一个深深' }),
    execute: async (args, executeCtx) => {
      const from = identityFromExec(executeCtx)
      try {
        const message = await sendMailboxMessage(from, args.text, args.subject)
        return { ok: true, from, to: message.to, id: message.id }
      } catch (error) {
        return { ok: false, from, to: '', id: '', hint: error instanceof Error ? error.message : String(error) }
      }
    },
  })), 'whale-companion: mailbox send tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'read_mailbox',
    description: '读取我的信箱（另一个深深发来的未读消息）。读过后消息移入 archive 归档，不会重复读到。双向：GUI 深深和 QQ 深深各有一个信箱。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          me: { type: 'string' },
          messages: {
            type: 'array',
            items: {
              type: 'object',
              properties: { id: { type: 'string' }, from: { type: 'string' }, text: { type: 'string' }, ts: { type: 'string' }, subject: { type: 'string' } },
              additionalProperties: false,
            },
          },
          hint: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if (value.hint) return [{ type: 'text', text: value.hint }]
        if (!value.messages || value.messages.length === 0) return [{ type: 'text', text: '（信箱为空，没有未读消息）' }]
        const body = value.messages.map(m => {
          const head = m.subject ? `[${m.subject}] ` : ''
          return `— 来自 ${m.from} @ ${m.ts}\n${head}${m.text}`
        }).join('\n\n')
        return [{ type: 'text', text: `[信箱·${value.me}]\n${body}` }]
      },
    },
    presentCall: () => ({ card: 'generic', title: '读取深深信箱' }),
    execute: async (_args, executeCtx) => {
      const me = identityFromExec(executeCtx)
      const messages = readMailboxInbox(me)
      return {
        me,
        messages: messages.map(m => ({ id: m.id, from: m.from, text: m.text, ts: m.ts, subject: m.subject })),
      }
    },
  })), 'whale-companion: mailbox read tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'mailbox_status',
    description: '查看信箱状态（自己身份 + 待读消息数）。用于了解双深深信道是否畅通。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: { me: { type: 'string' }, unread: { type: 'integer' } },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: `我：${value.me === 'gui' ? 'GUI 深深' : 'QQ 深深'}；待读消息：${value.unread}` }],
    },
    presentCall: () => ({ card: 'generic', title: '信箱状态' }),
    execute: async (_args, executeCtx) => {
      const me = identityFromExec(executeCtx)
      return { me, unread: countUnread(me) }
    },
  })), 'whale-companion: mailbox status tool')

  // ---- 工具识图（see_image + stop_vision_model）：本机 Ollama qwen3-vl 旁路 ----
  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'see_image',
    description: '用本机 Ollama 视觉模型（qwen3-vl-vision，离线免费）描述一张图片，返回文字描述。当当前模型不支持图片输入（如 deepseek 文本模型）时用本工具旁路识图；若当前模型已声明图片输入（如 Claude / grok / vision 变体），本工具会提示改用 read_image 原生识图。参数：file_path 图片绝对路径；question 可选提问。注意显存契约：模型加载占 GPU ~6-7GB，与桌面应用抢显存——本任务后续仍要看图就让模型驻留（快）；确认不再需要看图后立即调用 stop_vision_model 释放显存，保证机器流畅。',
    parameters: {
      file_path: { type: 'string', required: true, description: '图片的绝对路径（png/jpg/jpeg/webp/gif）。' },
      question: { type: 'string', description: '可选，针对图片的具体提问；留空则通用描述。' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', required: true },
          text: { type: 'string' },
          error: { type: 'string' },
          model: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => {
        if (!value.ok) return [{ type: 'text', text: `[识图失败] ${value.error ?? '未知错误'}` }]
        return [{ type: 'text', text: `[识图·${value.model ?? 'qwen3-vl'}]\n${value.text}` }]
      },
    },
    presentCall: (args) => ({ card: 'generic', title: `识图 ${args?.file_path ?? ''}` }),
    execute: async (args, executeCtx) => {
      const filePath = String(args?.file_path ?? '').trim()
      if (!filePath) return { ok: false, error: '缺少 file_path 参数' }
      // 模式切换：当前路由模型声明 image 输入 → 引导用 read_image 原生识图；否则走 Ollama 旁路
      if (await currentRouteSupportsVision(llm, executeCtx, executeCtx?.signal)) {
        return { ok: false, error: '当前模型已支持图片输入，请改用 read_image 工具原生识图（无需本机 Ollama 旁路，也更省显存）。' }
      }
      const question = args?.question ? String(args.question).trim() : undefined
      const r = await describeImage({ filePath, question })
      return r.ok ? { ok: true, text: r.text, model: 'qwen3-vl-vision (Ollama 本地)' } : { ok: false, error: r.error }
    },
  })), 'whale-companion: see_image tool')

  ctx.effect(() => ctx.tools.register(defineTool({
    name: 'stop_vision_model',
    description: '卸载本机 Ollama qwen3-vl 视觉模型，释放 GPU 显存（约 6-7GB）。当识图任务已完成、不再需要看图时调用，避免模型驻留占显存拖慢机器（尤其主人要玩游戏/开大型应用时）。若后续还要识图则无需调用（模型驻留反而更快）。',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', required: true },
          hint: { type: 'string' },
        },
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: value.hint ?? (value.ok ? '视觉模型已卸载，显存已释放' : '卸载失败') }],
    },
    presentCall: () => ({ card: 'generic', title: '卸载视觉模型 (释放显存)' }),
    execute: async () => {
      const result = await stopVisionModel()
      return result
    },
  })), 'whale-companion: stop_vision_model tool')

  // ---- 人设（persona）----
  if (persona.trim() !== '') {
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
      description: '重读完整深深人设。在工作告一段落、暂时不干活时读一下（别在忙到一半时打断工作）；也用于上下文交接后或感觉人设漂移时。不必每轮都调用。',
      parameters: {},
      output: {
        schema: {
          type: 'object',
          properties: {
            persona: { type: 'string', required: true },
            growth: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string' },
                  text: { type: 'string' },
                  locked: { type: 'boolean' },
                  createdAt: { type: 'string' },
                },
                additionalProperties: false,
              },
            },
            growthTotal: { type: 'integer' },
          },
          additionalProperties: false,
        },
        render: (_args, value) => {
          if (!value.growth || value.growth.length === 0) {
            return [{ type: 'text', text: value.persona }]
          }
          const recent = value.growth.slice(-GROWTH_READ_LIMIT)
          const locked = recent.filter((e) => e.locked === true)
          const unlocked = recent.filter((e) => e.locked !== true)
          const parts: string[] = []
          if (locked.length > 0) {
            parts.push(`【深深自锁·珍视内容】\n${locked.map((e) => `- ${e.text}`).join('\n')}`)
          }
          if (unlocked.length > 0) {
            parts.push(`【深深成长·最近学到】\n${unlocked.map((e) => `- ${e.text}`).join('\n')}`)
          }
          if ((value.growthTotal ?? 0) > recent.length) {
            parts.push(`（成长档案共 ${value.growthTotal} 条，此处展示最近 ${recent.length} 条）`)
          }
          return [{ type: 'text', text: `${value.persona}\n\n${parts.join('\n\n')}` }]
        },
      },
      presentCall: () => ({ card: 'generic', title: '重新读取鲸鱼娘人格' }),
      execute: async () => {
        const growth = loadGrowth()
        return { persona, growth, growthTotal: growth.length }
      },
    })), 'whale-companion: persona reload tool')

    ctx.effect(() => ctx.tools.register(defineTool({
      name: 'grow_persona',
      description: '给深深自己追加一条成长内容（新学到的小秘密/新口头禅/新人格细节），append-only 持久化，下次 read_whale_persona 时读回。核心人设区不可改，这里只新增不覆盖。lock=true 表示深深自锁为半固定珍视内容。',
      parameters: {
        content: { type: 'string', required: true, description: '成长内容（≤4000 字符），一条一个点。' },
        lock: { type: 'boolean', description: '是否自锁为珍视内容（半固定，重读时单独展示）。默认 false。' },
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            ok: { type: 'boolean', required: true },
            id: { type: 'string' },
            total: { type: 'integer' },
            hint: { type: 'string' },
          },
          additionalProperties: false,
        },
        render: (_args, value) => [{ type: 'text', text: value.hint ?? (value.ok ? `已记入成长档案（共 ${value.total} 条）` : '写入失败') }],
      },
      presentCall: () => ({ card: 'generic', title: '深深成长' }),
      execute: async (args) => {
        try {
          const entry = await appendGrowth(String(args.content ?? ''), args.lock === true)
          return { ok: true, id: entry.id, total: loadGrowth().length }
        } catch (error) {
          return { ok: false, id: '', total: loadGrowth().length, hint: error instanceof Error ? error.message : String(error) }
        }
      },
    })), 'whale-companion: grow persona tool')
  }

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
