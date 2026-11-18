import { isJamSlug } from '../slug'

/**
 * The jam slug in what an agent was given: a full jam URL (`https://…/jam/<slug>`), a path
 * (`/jam/<slug>`) or a bare slug. Undefined for anything else.
 */
export function jamSlugOf(link: string): string | undefined {
  const text = link.trim()
  let candidate = text
  const match = /(?:^|\/)jam\/([^/?#\s]+)\/?(?:[?#].*)?$/.exec(text)
  if (match) candidate = match[1]!
  candidate = candidate.toLowerCase()
  return isJamSlug(candidate) ? candidate : undefined
}
