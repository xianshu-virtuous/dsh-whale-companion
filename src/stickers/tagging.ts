/**
 * 表情包打标签（Tagging）。
 *
 * **主路径走 DSH 路由的多模态模型**——也就是当前配置里支持 image 输入的那个
 * 模型（如 `deepseek-flash`），与对话用的是同一个模型。做法是：
 *   1. 把图片存进 attachment store，拿到 `ImageAttachmentRef`
 *   2. 用一次性请求（手搓 messages）调用 `ctx.llm.stream()`
 *   3. `BlockAssembler` 把 chunk 流拼回文本，再解析 JSON
 *
 * 这样不占本机显存、且用的是主人已经配好的模型。**兜底**保留本机 Ollama
 * （离线免费），仅在路由调用失败时使用。
 *
 * 三个踩过的坑（2026-10-11 实测）：
 *  - 本机 qwen3-vl 会先在 `reasoning` 里长篇思考再给 `content`；`max_tokens`
 *    给少了推理会把额度吃光，`content` 只剩空串 → 解析必然失败。所以要给足。
 *  - 模型容易给「内容标签」（可爱/女仆/互动）而不是「情绪标签」，会被白名单
 *    全部滤掉。prompt 必须点明这是情绪标签并给示例。
 *  - 服务取用：本仓库既有代码走的是 `ctx.get('llm')`，直接读 `ctx.llm` 在
 *    某些加载时序下拿不到实例。这里两条路都试，并把失败原因带出来。
 *
 * 标注格式参考 MoFox `emoji_sender`：注入角色人格 + 要求结构化 JSON 输出。
 * @module @dsh-external/dsh-whale-companion/src/stickers/tagging
 */
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage, StreamChunk } from '@deepseek-ai/dsh-llm'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'

/** 情感标签预设集（对齐 MoFox emoji_sender 的 EMOTION_TAG_PRESET）。 */
export const EMOTION_TAGS = [
  '开心', '难过', '生气', '惊讶', '害羞', '尴尬', '无语', '委屈', '嘲讽',
  '疑惑', '赞同', '否定', '兴奋', '疲惫', '害怕', '厌恶', '紧张', '冷漠',
] as const

/** 标注失败的原因，供调用方记录（而不是静默跳过）。 */
export type TagFailure =
  | 'unsupported-format'
  | 'read-failed'
  | 'llm-unreachable'
  | 'llm-failed'
  | 'empty-reply'
  | 'unparsable-reply'

export interface StickerTagResult {
  /** 是否值得收藏（低质/冒犯/违规/与人设不符 → false）。 */
  keep: boolean
  description: string
  tags: string[]
}

export interface StickerTagOutcome {
  result: StickerTagResult | null
  failure?: TagFailure
  /** 失败细节（异常消息等），用于排查——2026-10-11 的静默失败吃过亏。 */
  detail?: string
}

/** 打标签用的模型路由。 */
export interface TagRoute {
  provider: string
  model: string
}

const MIME_BY_EXT: Record<string, ImageMediaType> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

/**
 * 输出额度。本机 qwen3-vl 会先输出一大段 `reasoning` 再给 `content`：
 * 实测 400 token 会被推理吃光导致 `content` 为空，1200 才有稳定余量。
 */
const MAX_OUTPUT_TOKENS = 1200

/** 只依赖流式调用的最小 llm 服务形状。 */
interface LlmLike {
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>
}

/**
 * 取 llm 服务。优先直接读 `ctx.llm`，拿不到再退回 `ctx.get('llm')`
 * （本仓库既有代码用的就是后者，说明两种时序都可能出现）。
 */
export function resolveLlm(ctx: Context): { llm?: LlmLike; via?: string; error?: string } {
  const direct = (ctx as unknown as { llm?: LlmLike }).llm
  if (direct !== undefined && direct !== null && typeof direct.stream === 'function') {
    return { llm: direct, via: 'ctx.llm' }
  }
  try {
    const getter = (ctx as unknown as { get?: (name: string) => unknown }).get
    const viaGet = typeof getter === 'function' ? getter.call(ctx, 'llm') : undefined
    if (viaGet !== undefined && viaGet !== null && typeof (viaGet as LlmLike).stream === 'function') {
      return { llm: viaGet as LlmLike, via: "ctx.get('llm')" }
    }
  } catch (error: unknown) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
  return {}
}

/** 给模型的标注指令；明确「情绪标签」并给示例，减少内容标签与格式漂移。 */
export function buildTagPrompt(): string {
  return [
    '你在为「鲸鱼娘女仆」角色整理表情包素材。看这张图，判断它是否适合收藏，并给出标注。',
    '',
    '只输出一个 JSON 对象，不要任何解释文字：',
    '{"keep": true, "description": "一句话描述画面", "emotion_tags": ["开心"]}',
    '',
    '要求：',
    '- emotion_tags 是**情绪**标签（不是画面内容标签），必须从这个列表里选 1~3 个：',
    `  ${EMOTION_TAGS.join('、')}`,
    '- description：简短客观地描述画面；若图中有文字，用「文字：\'…\'」补在后面',
    '- keep：画面低质、冒犯、违规，或与角色气质不符时判 false',
  ].join('\n')
}

/** 从模型回复里截取第一个 JSON 对象（容忍前后夹带说明文字）。 */
export function parseTagResponse(text: string): StickerTagResult | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const raw = parsed as Record<string, unknown>

  const description = typeof raw.description === 'string' ? raw.description.trim() : ''
  const allowed = new Set<string>(EMOTION_TAGS)
  const tags = (Array.isArray(raw.emotion_tags) ? raw.emotion_tags : [])
    .filter((t): t is string => typeof t === 'string')
    .map(t => t.trim())
    .filter(t => allowed.has(t))
    .slice(0, 3)

  // 没有可用描述时视为标注失败，避免把空条目写进索引
  if (description === '') return null

  return { keep: raw.keep !== false, description, tags }
}

/**
 * 主路径：走 DSH 路由的多模态模型打标签。
 * 失败时带 `failure` 与 `detail` 返回，调用方据此决定是否退到兜底并记录日志。
 */
export async function tagImageViaLlm(
  ctx: Context,
  absPath: string,
  route: TagRoute,
  timeoutMs = 120000,
): Promise<StickerTagOutcome> {
  const mediaType = MIME_BY_EXT[extname(absPath).toLowerCase()]
  if (mediaType === undefined) return { result: null, failure: 'unsupported-format' }

  let data: Uint8Array
  try {
    data = readFileSync(absPath)
  } catch (error: unknown) {
    return { result: null, failure: 'read-failed', detail: error instanceof Error ? error.message : String(error) }
  }

  const { llm, via, error: probeError } = resolveLlm(ctx)
  if (llm === undefined) {
    return { result: null, failure: 'llm-unreachable', detail: probeError ?? 'ctx.llm 与 ctx.get("llm") 都拿不到流式服务' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    // 图片必须先落进 attachment store，消息里引用的是它的 ref 而不是裸字节。
    // 用单数 `saveImage`：它在 0.1.0-rc.6 与 0.2.0-rc.2 两代 AttachmentStore 上都存在，
    // 而复数 `saveImages` 只在 0.2 起才有（0.1.x 的旧实例被 dsh-client-runtime 拖在树里）。
    const ref = await ctx.attachments.saveImage({ data, mediaType, name: basename(absPath) })

    const messages = [{
      role: 'user',
      content: [
        { type: 'text', text: buildTagPrompt() },
        { type: 'image', attachment: ref },
      ],
    }] as unknown as RequestMessage[]

    const options = {
      provider: route.provider,
      model: route.model,
      messages,
      maxTokens: MAX_OUTPUT_TOKENS,
      signal: controller.signal,
    } as GenerateOptions

    const assembler = new BlockAssembler()
    for await (const chunk of llm.stream(options)) assembler.push(chunk)

    const text = assembler.blocks()
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
    if (text.trim() === '') {
      return { result: null, failure: 'empty-reply', detail: `via ${via ?? '?'}：模型返回空文本` }
    }

    const parsed = parseTagResponse(text)
    if (parsed === null) {
      return { result: null, failure: 'unparsable-reply', detail: text.slice(0, 200) }
    }
    return { result: parsed }
  } catch (error: unknown) {
    return {
      result: null,
      failure: 'llm-failed',
      detail: `${via ?? '?'}：${error instanceof Error ? error.message : String(error)}`,
    }
  } finally {
    clearTimeout(timer)
  }
}

/* ------------------------------------------------------------------ *
 * 兜底路径：本机 Ollama（离线免费，不需要 API key，但会占 6-7GB 显存）
 * ------------------------------------------------------------------ */

function ollamaBase(): string {
  const explicit = process.env.OLLAMA_BASE_URL?.trim()
  if (explicit !== undefined && explicit !== '') return explicit.replace(/\/+$/, '')
  const port = process.env.OLLAMA_PORT?.trim() || '11434'
  return `http://127.0.0.1:${port}`
}

function visionModel(): string {
  const model = process.env.OLLAMA_VISION_MODEL?.trim()
  return model !== undefined && model !== '' ? model : 'qwen3-vl-vision:latest'
}

/** 兜底：用本机 Ollama 的视觉模型打标签（单张实测 12~70 秒）。 */
export async function tagImageViaOllama(absPath: string, timeoutMs = 180000): Promise<StickerTagOutcome> {
  const mediaType = MIME_BY_EXT[extname(absPath).toLowerCase()]
  if (mediaType === undefined) return { result: null, failure: 'unsupported-format' }

  let base64: string
  try {
    base64 = readFileSync(absPath).toString('base64')
  } catch (error: unknown) {
    return { result: null, failure: 'read-failed', detail: error instanceof Error ? error.message : String(error) }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(`${ollamaBase()}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model: visionModel(),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: buildTagPrompt() },
            { type: 'image_url', image_url: { url: `data:${mediaType};base64,${base64}` } },
          ],
        }],
        max_tokens: MAX_OUTPUT_TOKENS,
        stream: false,
      }),
    })
    if (!response.ok) {
      return { result: null, failure: 'llm-failed', detail: `Ollama HTTP ${response.status}` }
    }

    const payload = await response.json() as { choices?: { message?: { content?: string } }[] }
    const content = payload.choices?.[0]?.message?.content
    // 注意：qwen3-vl 先输出 reasoning 再给 content；额度不足时 content 是空串
    if (typeof content !== 'string' || content.trim() === '') {
      return { result: null, failure: 'empty-reply', detail: 'Ollama 返回空 content（多半是 reasoning 吃光了额度）' }
    }

    const parsed = parseTagResponse(content)
    return parsed === null
      ? { result: null, failure: 'unparsable-reply', detail: content.slice(0, 200) }
      : { result: parsed }
  } catch (error: unknown) {
    return { result: null, failure: 'llm-failed', detail: error instanceof Error ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}
