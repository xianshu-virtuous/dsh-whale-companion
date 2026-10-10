/**
 * 表情包打标签（Tagging）。
 *
 * **主路径走 DSH 路由的多模态模型**——也就是当前配置里支持 image 输入的那个
 * 模型（如 `deepseek-flash`），与对话用的是同一个模型。做法是：
 *   1. 把图片存进 attachment store，拿到 `ImageAttachmentRef`
 *   2. 用一次性请求（`GenerateOptions.system` + 手搓 messages）调用 `ctx.llm.stream()`
 *   3. `BlockAssembler` 把 chunk 流拼回文本，再解析 JSON
 *
 * 这样不占本机显存、且用的是主人已经配好的模型。**兜底**保留本机 Ollama
 * （离线免费），仅在路由调用失败时使用。
 *
 * 标注格式参考 MoFox `emoji_sender`：注入角色人格 + 要求结构化 JSON 输出。
 * @module @dsh-external/dsh-whale-companion/src/stickers/tagging
 */
import { readFileSync } from 'node:fs'
import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type {} from '@deepseek-ai/dsh-llm'
import type { GenerateOptions, RequestMessage } from '@deepseek-ai/dsh-llm'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'

/** 情感标签预设集（对齐 MoFox emoji_sender 的 EMOTION_TAG_PRESET）。 */
export const EMOTION_TAGS = [
  '开心', '难过', '生气', '惊讶', '害羞', '尴尬', '无语', '委屈', '嘲讽',
  '疑惑', '赞同', '否定', '兴奋', '疲惫', '害怕', '厌恶', '紧张', '冷漠',
] as const

export interface StickerTagResult {
  /** 是否值得收藏（低质/冒犯/违规/与人设不符 → false）。 */
  keep: boolean
  description: string
  tags: string[]
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

/** 给模型的标注指令；尽量短，减少格式漂移。 */
export function buildTagPrompt(): string {
  return [
    '你在为一只「鲸鱼娘女仆」角色整理表情包素材库。',
    '你将看到一张图片，请判断它是否适合作为她的表情包，并给出标注。',
    '',
    '只输出一个 JSON 对象，不要任何解释文字：',
    '{"keep": true, "description": "一句话描述画面内容", "emotion_tags": ["标签"]}',
    '',
    '要求：',
    `- emotion_tags：从这些里选 1~3 个 —— ${EMOTION_TAGS.join('、')}`,
    '- description：简短客观；若图中有文字，用「文字：\'…\'」补在描述后面',
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
 * 返回 null 表示本次标注失败（格式不支持、模型不可用、或回复无法解析），
 * 调用方应跳过该图而不是写坏索引。
 */
export async function tagImageViaLlm(
  ctx: Context,
  absPath: string,
  route: TagRoute,
  timeoutMs = 120000,
): Promise<StickerTagResult | null> {
  const mediaType = MIME_BY_EXT[extname(absPath).toLowerCase()]
  if (mediaType === undefined) return null

  let data: Uint8Array
  try {
    data = readFileSync(absPath)
  } catch {
    return null
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
      maxTokens: 400,
      signal: controller.signal,
    } as GenerateOptions

    const assembler = new BlockAssembler()
    for await (const chunk of ctx.llm.stream(options)) assembler.push(chunk)

    const text = assembler.blocks()
      .map(block => (block.type === 'text' ? block.text : ''))
      .join('')
    return parseTagResponse(text)
  } catch {
    return null
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

/** 兜底：用本机 Ollama 的视觉模型打标签。 */
export async function tagImageViaOllama(absPath: string, timeoutMs = 120000): Promise<StickerTagResult | null> {
  const mediaType = MIME_BY_EXT[extname(absPath).toLowerCase()]
  if (mediaType === undefined) return null

  let base64: string
  try {
    base64 = readFileSync(absPath).toString('base64')
  } catch {
    return null
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
        max_tokens: 400,
        stream: false,
      }),
    })
    if (!response.ok) return null
    const payload = await response.json() as { choices?: { message?: { content?: string } }[] }
    const content = payload.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') return null
    return parseTagResponse(content)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
