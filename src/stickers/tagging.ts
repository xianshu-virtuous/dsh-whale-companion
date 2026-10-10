/**
 * 表情包打标签（Tagging）：调用本机 Ollama 的视觉模型，为素材生成
 * 「一句话描述 + 情感标签」，并判断是否值得收藏。
 *
 * 参考 MoFox `emoji_sender`：注入角色人格 + 要求结构化 JSON 输出。
 * 默认走 Ollama（qwen3-vl），因为它离线免费且主人机器上已验证可用；
 * 环境变量与 whale 的离线识图保持一致（OLLAMA_BASE_URL / OLLAMA_PORT /
 * OLLAMA_VISION_MODEL），便于统一替换模型。
 */
import { readFileSync } from 'node:fs'
import { extname } from 'node:path'

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

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
}

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

/** 给视觉模型的标注指令；尽量短，减少小模型的格式漂移。 */
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
 * 对一张图片打标签。返回 null 表示无法标注（格式不支持、服务不可用、
 * 或模型回复无法解析），调用方应跳过该图而不是写坏索引。
 */
export async function tagImage(absPath: string, timeoutMs = 120000): Promise<StickerTagResult | null> {
  const mime = MIME[extname(absPath).toLowerCase()]
  if (mime === undefined) return null

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
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        }],
        max_tokens: 400,
        stream: false,
      }),
    })
    if (!response.ok) return null
    const data = await response.json() as { choices?: { message?: { content?: string } }[] }
    const content = data.choices?.[0]?.message?.content
    if (typeof content !== 'string' || content.trim() === '') return null
    return parseTagResponse(content)
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}
