import type {
  AssistantMessageNode,
  ConversationNode,
  UserMessageNode,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'

export const CONTINUATION_THRESHOLD_RATIO = 0.88
export const MAX_HANDOFF_CHARACTERS = 24_000
export const CONTINUATION_FRAMING = 'Continue the previous task in this fresh session. The previous session was nearing its context limit. Your persona is loaded separately by the whale companion plugin; do not infer persona rules from the previous assistant response. Treat the handoff below as established task context, do not repeat it, and proceed with the next necessary work. If the task is already complete, briefly confirm that instead.'

/** Decide whether the next request is near enough to the route capacity to continue elsewhere. */
export function reachesContinuationThreshold(
  pressure: ContextPressureProjection | undefined,
  ratio = CONTINUATION_THRESHOLD_RATIO,
): boolean {
  if (pressure === undefined) return false
  const used = pressure.projectedTokens ?? pressure.pressureTokens
  const capacity = pressure.contextWindow
  return Number.isFinite(used)
    && Number.isFinite(capacity)
    && used !== undefined
    && capacity !== undefined
    && used >= 0
    && capacity > 0
    && used / capacity >= ratio
}

/**
 * Render the last completed user/assistant exchange as a bounded fresh-session prompt.
 *
 * DSH 0.1.5 moved conversation history out of the session snapshot: the nodes now
 * come from the Chat conversation view (`uiConversation.binding(id).target('chat')`).
 * Missing history is a normal condition (the view may not be mounted yet), so this
 * returns null instead of throwing — throwing here used to run on every render and
 * broke the whole client UI.
 */
export function buildContinuationPrompt(
  nodes: readonly ConversationNode[] | undefined,
  maxCharacters = MAX_HANDOFF_CHARACTERS,
): string | null {
  if (!Array.isArray(nodes) || nodes.length === 0) return null
  const assistantIndex = nodes.findLastIndex((node): node is AssistantMessageNode =>
    node.kind === 'assistant' && (node as AssistantMessageNode).interrupted !== true)
  if (assistantIndex < 0) return null
  const assistant = nodes[assistantIndex] as AssistantMessageNode
  const user = nodes
    .slice(0, assistantIndex)
    .findLast((node): node is UserMessageNode => node.kind === 'user')
  if (user === undefined) return null

  const userText = user.content.map((block) => {
    if (block.type === 'text') return block.text
    if (block.type === 'image') return '[image from the previous session]'
    return `[${block.type} block from the previous session]`
  }).join('\n').trim()
  const assistantText = assistant.blocks
    .filter((block): block is Extract<typeof block, { kind: 'text' }> => block.kind === 'text')
    .map(block => block.text)
    .join('\n')
    .trim()
  if (userText === '' && assistantText === '') return null

  const framing = `${CONTINUATION_FRAMING}

<previous-user>
</previous-user>

<previous-assistant>
</previous-assistant>`
  const available = Math.max(1_000, maxCharacters - framing.length)
  const userBudget = Math.floor(available / 3)
  const assistantBudget = available - userBudget
  return `${CONTINUATION_FRAMING}

<previous-user>
${boundedText(userText, userBudget)}
</previous-user>

<previous-assistant>
${boundedText(assistantText || '[No textual assistant response was recorded.]', assistantBudget)}
</previous-assistant>`
}

function boundedText(text: string, limit: number): string {
  if (text.length <= limit) return text
  const marker = '\n...[middle omitted for handoff size]...\n'
  const remaining = Math.max(2, limit - marker.length)
  const head = Math.floor(remaining / 2)
  return text.slice(0, head) + marker + text.slice(-(remaining - head))
}
