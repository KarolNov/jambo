/**
 * iOS treats Web Audio as ambient sound by default, so the ring/silent switch mutes it. Asking for
 * the `playback` session makes a jam play like a music app does. Safari 16.4+; elsewhere a no-op.
 * Set it before audio starts.
 */
export function preferPlayback() {
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession
  if (!session) return
  try {
    session.type = 'playback'
  } catch {
    // Not allowed here; audio still works, just not in silent mode.
  }
}

/**
 * Brings the context back after iOS suspends or interrupts it (the tab went to the background, a
 * call came in, the screen locked): when the page is visible again, on the next tap or key, and
 * whenever its state changes. Returns a function that stops watching.
 */
export function keepAwake(ctx: AudioContext): () => void {
  const wake = () => {
    if (ctx.state !== 'running' && ctx.state !== 'closed') ctx.resume().catch(() => {})
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') wake()
  }
  document.addEventListener('visibilitychange', onVisible)
  window.addEventListener('pointerdown', wake, true)
  window.addEventListener('keydown', wake, true)
  ctx.addEventListener('statechange', wake)
  return () => {
    document.removeEventListener('visibilitychange', onVisible)
    window.removeEventListener('pointerdown', wake, true)
    window.removeEventListener('keydown', wake, true)
    ctx.removeEventListener('statechange', wake)
  }
}
