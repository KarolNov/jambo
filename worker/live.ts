/**
 * Live voice in the Worker. For now only the fake transport's relay: the room passes one person's
 * stamped frames to everyone else over the board connection, so local dev and the e2e tests can
 * sing live with no Realtime app. It relays only for connections made to a local Worker, so a
 * deployed room never carries audio.
 */

/** The hosts a local Worker answers on. */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/** Whether the room relays fake live frames for a connection opened to `url`. */
export function relaysFake(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname)
  } catch {
    return false
  }
}
