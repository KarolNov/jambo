/**
 * Who an agent is in a jam. Its name is a jambo adjective and its kind, like "Groovy Claude", so an
 * AI reads as one by name as well as by its badge. The room seats it by a private key only the
 * agent holds; the board and presence carry only a separate public id.
 */
import { NAME_MAX } from '../names'
import { ADJECTIVES, capitalize } from '../words'

/** Prefix of an agent's public id wherever an author is stored, so the UI can mark its work. */
export const AGENT_AUTHOR_PREFIX = 'agent:'

export const DEFAULT_KIND = 'Agent'

/** Longest a kind may be. */
export const KIND_MAX = 20

/** Whether a stored author is an agent. */
export const isAgentAuthor = (author: string) => author.startsWith(AGENT_AUTHOR_PREFIX)

/** An agent's kind, title-cased ("claude" → "Claude"); undefined unless one word of 1-20 letters or digits. */
export function toKind(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const v = value.trim()
  if (v.length > KIND_MAX || !/^[A-Za-z0-9]+$/.test(v)) return undefined
  return capitalize(v.toLowerCase())
}

const adjectives = new Set<string>(ADJECTIVES)

/**
 * `name` written as `agentName` writes it ("groovy  claude" → "Groovy Claude") when it is a jambo
 * adjective followed by `kind`, case and spacing aside; undefined otherwise.
 */
export function toAgentName(name: string, kind: string): string | undefined {
  const parts = name.trim().split(/\s+/)
  if (
    parts.length !== 2 ||
    !adjectives.has(parts[0]!.toLowerCase()) ||
    parts[1]!.toLowerCase() !== kind.toLowerCase()
  )
    return undefined
  const canonical = agentName(parts[0]!.toLowerCase(), kind)
  return canonical.length <= NAME_MAX ? canonical : undefined
}

/** Whether `name` is a jambo adjective followed by `kind`, case and spacing aside, like "Groovy Claude". */
export const isAgentName = (name: string, kind: string) => toAgentName(name, kind) !== undefined

/** `name` as an agent of `kind` writes it: "Groovy Claude". */
export const agentName = (adjective: string, kind: string) => `${capitalize(adjective)} ${kind}`

/** A random agent name for `kind`, from `random` (a float in [0, 1)). */
export function randomAgentName(kind: string, random: () => number = Math.random): string {
  return agentName(ADJECTIVES[Math.floor(random() * ADJECTIVES.length)]!, kind)
}

/** Every agent name for `kind`, in a fixed order. */
export function* allAgentNames(kind: string): Generator<string> {
  for (const adjective of ADJECTIVES) yield agentName(adjective, kind)
}

/** A new private agent key: 128 random bits, hex. */
export function newAgentKey(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)))
}

/**
 * An agent's public id in jam `jam`: a one-way hash of its key, so the same key always gets the
 * same id there without the room storing one, and the id gives the key away to nobody.
 */
export async function agentIdOf(key: string, jam: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${jam}\n${key}`))
  return hex(new Uint8Array(digest, 0, 8))
}

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')

/** Whether `value` looks like a key `newAgentKey` made. */
export const isAgentKey = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{32}$/.test(value)
