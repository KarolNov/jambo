/** How the jam's connection reads in the header, kept apart from the provider so it can be tested. */

/** The connection as the header shows it. */
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'offline'

/** What the socket says it is doing. */
export type SocketStatus = 'connecting' | 'connected' | 'disconnected'

/**
 * The status to show: offline while the browser has no network; otherwise live while connected,
 * and, while not, connecting until the first connection and reconnecting after it (the socket
 * retries on its own, so a drop is not offline).
 */
export function connectionStatus(
  socket: SocketStatus,
  everConnected: boolean,
  online: boolean,
): ConnectionStatus {
  if (!online) return 'offline'
  if (socket === 'connected') return 'connected'
  return everConnected ? 'reconnecting' : 'connecting'
}
