/**
 * send_sticker 的工具卡片：把工具参数里的 id 渲染成素材图片。
 *
 * 图片由插件自己的 `/api/dsh-whale-companion/stickers/<id>` 路由提供；
 * 文件名即内容 sha256，所以可以放心长缓存。
 */
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import css from './StickerCard.module.css'

/** 与 src/stickers/index.ts 的 STICKER_ROUTE_PREFIX 保持一致。 */
const ROUTE_PREFIX = '/api/dsh-whale-companion/stickers'

interface ParsedArgs { id: string }

function parseArgs(raw: string | null | undefined): ParsedArgs {
  if (raw === null || raw === undefined || raw.trim() === '') return { id: '' }
  try {
    const parsed = JSON.parse(raw) as { id?: unknown }
    return { id: String(parsed.id ?? '').trim() }
  } catch {
    // 参数可能尚未成形（流式中途），退化成整串当 id 用
    return { id: raw.trim() }
  }
}

/**
 * 工具调用三态（DSH 0.2.0）：判别属性在外层 `phase`，且只有 `start`
 * （StartedToolCall）与 `result`（ToolResultNode）才带已派发的调用材料；
 * `preparing` 阶段参数还没到，直接不渲染。
 */
export function StickerToolCard(props: ToolCallViewProps) {
  const raw = props.phase === 'result'
    ? props.block.call?.argsRaw
    : props.phase === 'start'
      ? props.block.argsRaw
      : undefined

  const { id } = parseArgs(raw)
  if (id === '') return null

  return (
    <figure className={css.card}>
      <img
        className={css.image}
        src={`${ROUTE_PREFIX}/${encodeURIComponent(id)}`}
        alt={`表情包 ${id}`}
      />
    </figure>
  )
}
