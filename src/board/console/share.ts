/** Sharing a jam's link: the system share sheet where there is one, else the clipboard. */

export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed'

export interface ShareDeps {
  /** The system share sheet (navigator.share), where the browser has one. */
  share?: (data: { title: string; url: string }) => Promise<void>
  /** Copies text to the clipboard (navigator.clipboard.writeText). */
  copy?: (text: string) => Promise<void>
}

/** The jam's link as people share it: no query string, no hash. */
export const jamLink = (origin: string, slug: string) => `${origin}/jam/${encodeURIComponent(slug)}`

/**
 * Shares `url`. The share sheet comes first; closing it counts as cancelled, not a failure. If it
 * isn't there or fails, the link is copied instead.
 */
export async function shareLink(url: string, title: string, deps: ShareDeps): Promise<ShareResult> {
  if (deps.share) {
    try {
      await deps.share({ title, url })
      return 'shared'
    } catch (e) {
      if ((e as Error | undefined)?.name === 'AbortError') return 'cancelled'
    }
  }
  if (!deps.copy) return 'failed'
  try {
    await deps.copy(url)
    return 'copied'
  } catch {
    return 'failed'
  }
}
