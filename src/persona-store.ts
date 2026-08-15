import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

export const MAX_PERSONA_CHARACTERS = 32_768

export interface PersonaDocument {
  persona: string
}

/** Resolve the persistent user-owned persona document. */
export function personaDocumentPath(): string {
  return dshHomePath('plugins', 'dsh-whale-companion', 'persona.json')
}

/** Parse and validate a persisted or HTTP-submitted persona document. */
export function parsePersonaDocument(value: unknown): PersonaDocument {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('persona document must be an object')
  }
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'persona') {
    throw new Error('persona document must contain only the "persona" field')
  }
  const persona = (value as { persona?: unknown }).persona
  if (typeof persona !== 'string') throw new Error('persona must be a string')
  if (persona.trim() === '') throw new Error('persona must not be blank')
  if (persona.length > MAX_PERSONA_CHARACTERS) {
    throw new Error(`persona must not exceed ${MAX_PERSONA_CHARACTERS} characters`)
  }
  return { persona }
}

/** Load the user override when present, otherwise return the configured default. */
export function loadPersona(defaultPersona: string, path = personaDocumentPath()): {
  persona: string
  custom: boolean
} {
  if (!existsSync(path)) return { persona: defaultPersona, custom: false }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'))
    return { ...parsePersonaDocument(parsed), custom: true }
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error)
    console.warn(`whale-companion: ignoring invalid persona file "${path}": ${reason}`)
    return { persona: defaultPersona, custom: false }
  }
}

/** Atomically persist one validated override for the next Harness start. */
export async function savePersona(
  document: PersonaDocument,
  path = personaDocumentPath(),
): Promise<void> {
  const validated = parsePersonaDocument(document)
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`
  await writeFile(temporary, `${JSON.stringify(validated, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
  await rename(temporary, path)
}
