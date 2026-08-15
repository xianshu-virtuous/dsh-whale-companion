import { describe, expect, it } from 'vitest'
import type { ConversationNode } from '@deepseek-ai/dsh-client-runtime/client'
import {
  buildContinuationPrompt,
  CONTINUATION_FRAMING,
  reachesContinuationThreshold,
} from '../src/client/handoff.ts'

describe('automatic continuation policy', () => {
  it('uses projected pressure and waits for the threshold', () => {
    expect(reachesContinuationThreshold({
      pressureTokens: 90,
      projectedTokens: 87,
      contextWindow: 100,
    })).toBe(false)
    expect(reachesContinuationThreshold({
      pressureTokens: 70,
      projectedTokens: 88,
      contextWindow: 100,
    })).toBe(true)
  })

  it('requires usable pressure and capacity', () => {
    expect(reachesContinuationThreshold(undefined)).toBe(false)
    expect(reachesContinuationThreshold({ pressureTokens: 90 })).toBe(false)
    expect(reachesContinuationThreshold({ pressureTokens: 90, contextWindow: 0 })).toBe(false)
  })

  it('carries only the last completed user and assistant exchange', () => {
    const nodes = [
      user(1, 'old request'),
      assistant(2, 'old answer'),
      user(3, 'latest request'),
      assistant(4, 'latest answer'),
    ]
    const prompt = buildContinuationPrompt({ nodes })
    expect(prompt).toContain('latest request')
    expect(prompt).toContain('latest answer')
    expect(prompt).not.toContain('old request')
    expect(prompt).not.toContain('old answer')
  })

  it('does not continue an incomplete exchange', () => {
    expect(buildContinuationPrompt({ nodes: [user(1, 'waiting')] })).toBeNull()
  })

  it('bounds oversized handoff text', () => {
    const prompt = buildContinuationPrompt({
      nodes: [user(1, 'u'.repeat(5_000)), assistant(2, 'a'.repeat(5_000))],
    }, 2_000)
    expect(prompt).not.toBeNull()
    expect(prompt!.length).toBeLessThanOrEqual(2_100)
    expect(prompt).toContain('middle omitted')
  })

  it('uses one shared framing source for every handoff', () => {
    const prompt = buildContinuationPrompt({ nodes: [user(1, 'request'), assistant(2, 'answer')] })
    expect(prompt).toContain(CONTINUATION_FRAMING)
    expect(prompt!.match(new RegExp(CONTINUATION_FRAMING, 'g'))).toHaveLength(1)
  })
})

function user(seq: number, text: string): ConversationNode {
  return {
    kind: 'user',
    seq,
    time: seq,
    source: { kind: 'user' },
    content: [{ type: 'text', text }],
  }
}

function assistant(seq: number, text: string): ConversationNode {
  return {
    kind: 'assistant',
    seq,
    time: seq,
    turn: seq,
    step: 1,
    blocks: [{ kind: 'text', text }],
  }
}
