import type {
  ClientContext,
  ISessions,
  IWorkspaces,
  SessionId,
} from '@deepseek-ai/dsh-client-runtime/client'
import type { ContextPressureProjection } from '@deepseek-ai/dsh-token-meter/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { PersonaSettingsSection } from './PersonaSettingsSection.tsx'
import {
  buildContinuationPrompt,
  reachesContinuationThreshold,
} from './handoff.ts'

export const name = 'dsh-whale-companion-client'
export const inject = ['sessions', 'workspaces', 'slots']

const STORAGE_PREFIX = 'dsh.whale-companion.continued.v1.'

/** Watch the selected Web session and continue a near-limit completed turn in a fresh task. */
export function apply(ctx: ClientContext): void {
  // Host and Web declarations share one build, so pin these merged services to their client contracts.
  const sessions = ctx.sessions as unknown as ISessions
  const workspaces = ctx.workspaces as unknown as IWorkspaces

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'whale-persona',
    order: 30,
    label: '鲸鱼娘人格',
  }, PersonaSettingsSection))

  const completed = new Set<SessionId>()
  let selected: SessionId | undefined
  let disposeSession = (): void => {}
  let disposePressure = (): void => {}
  let evaluating = false
  let queued = false
  let disposed = false

  const schedule = (): void => {
    if (disposed || queued) return
    queued = true
    queueMicrotask(() => {
      queued = false
      void evaluate()
    })
  }

  const bindSelected = (): void => {
    const next = sessions.list.getSnapshot().current
    if (next === selected) {
      schedule()
      return
    }
    disposeSession()
    disposePressure()
    disposeSession = () => {}
    disposePressure = () => {}
    selected = next
    if (next !== undefined) {
      const binding = sessions.binding(next)
      if (binding !== undefined) {
        disposeSession = binding.session.subscribe(schedule)
        disposePressure = binding.session.projections.faceOf('contextPressure').subscribe(schedule)
      }
    }
    schedule()
  }

  const evaluate = async (): Promise<void> => {
    if (disposed || evaluating) return
    const list = sessions.list.getSnapshot()
    const sourceId = list.current
    if (sourceId === undefined || completed.has(sourceId)) return
    const sourceSummary = list.byId[sourceId]
    const binding = sessions.binding(sourceId)
    if (sourceSummary === undefined || sourceSummary.running || sourceSummary.blank || binding === undefined) return
    const snapshot = binding.session.getSnapshot()
    if (snapshot.openState !== 'open' || snapshot.running || snapshot.removed) return
    const pressure = binding.session.projections.faceOf('contextPressure').getSnapshot() as
      | ContextPressureProjection
      | undefined
    if (!reachesContinuationThreshold(pressure) || wasPersisted(sourceId)) {
      if (wasPersisted(sourceId)) completed.add(sourceId)
      return
    }
    const prompt = buildContinuationPrompt(snapshot)
    if (prompt === null) return
    const workspace = workspaces.list.getSnapshot().items
      .find(candidate => candidate.sessionIds.includes(sourceId))
    if (workspace === undefined) {
      ctx.logger.warn(`whale-companion: session "${sourceId}" is not attached to a workspace; automatic continuation skipped`)
      return
    }

    evaluating = true
    try {
      const childId = await workspaces.connectWorkspace(workspace.workspaceId)
      if (disposed) return
      const child = sessions.binding(childId)?.session
      if (child === undefined) throw new Error(`new session "${childId}" is not locally addressable`)
      const accepted = await child.prompt([{ type: 'text', text: prompt }], 'queue')
      if (!accepted.ok) {
        throw new Error(`${accepted.error.code}: ${accepted.error.message}`)
      }
      completed.add(sourceId)
      persistContinuation(sourceId, childId)
      sessions.open(childId)
    } catch (error: unknown) {
      ctx.logger.warn(`whale-companion: automatic continuation failed for session "${sourceId}": ${String(error)}`)
    } finally {
      evaluating = false
    }
  }

  const disposeList = sessions.list.subscribe(bindSelected)
  bindSelected()
  ctx.effect(() => () => {
    disposed = true
    disposeList()
    disposeSession()
    disposePressure()
  }, 'whale-companion: automatic session continuation')
}

function wasPersisted(sourceId: SessionId): boolean {
  if (typeof localStorage === 'undefined') return false
  try {
    return localStorage.getItem(STORAGE_PREFIX + sourceId) !== null
  } catch {
    return false
  }
}

function persistContinuation(sourceId: SessionId, childId: SessionId): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_PREFIX + sourceId, childId)
  } catch {
    // Browser storage is optional; the process-local completed set still prevents duplicates.
  }
}
