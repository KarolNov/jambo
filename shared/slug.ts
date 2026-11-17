import { ADJECTIVES, NOUNS } from './words'

/** Lowercase Crockford-style base32 without the letters that read like digits (i, l, o, u). */
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz'
const SUFFIX_LENGTH = 4

/** `<adjective>-<noun>-<4 base32 chars>`, e.g. `funky-otter-k7q2`. */
export const SLUG_PATTERN = new RegExp(`^([a-z]+)-([a-z]+)-([${ALPHABET}]{${SUFFIX_LENGTH}})$`)

const adjectives = new Set<string>(ADJECTIVES)
const nouns = new Set<string>(NOUNS)

/** True when `slug` is a jam link slug this app could have generated. */
export function isJamSlug(slug: string): boolean {
  const match = SLUG_PATTERN.exec(slug)
  return !!match && adjectives.has(match[1]!) && nouns.has(match[2]!)
}

/** A new random jam slug, from a cryptographic random source. */
export function newJamSlug(
  random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b),
): string {
  const bytes = random(new Uint8Array(2 + SUFFIX_LENGTH))
  const adjective = ADJECTIVES[bytes[0]! % ADJECTIVES.length]
  const noun = NOUNS[bytes[1]! % NOUNS.length]
  let suffix = ''
  for (let i = 0; i < SUFFIX_LENGTH; i++) suffix += ALPHABET[bytes[2 + i]! % ALPHABET.length]
  return `${adjective}-${noun}-${suffix}`
}
