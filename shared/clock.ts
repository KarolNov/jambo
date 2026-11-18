/**
 * The jam clock's pure math: estimating this client's offset from the room's clock, and mapping
 * room time onto the AudioContext's timeline. Room ("server") times are Unix milliseconds on the
 * Board Durable Object's clock; client times are `performance.timeOrigin + performance.now()`.
 */

/** How many recent samples the estimate picks from. */
export const SAMPLE_WINDOW = 8

/** Offset changes smaller than this are noise, and ignored. */
export const OFFSET_THRESHOLD_MS = 5

/** Audio↔room mapping changes smaller than this are jitter, and ignored. */
export const SHIFT_THRESHOLD_MS = 2

/** One ping/pong round trip: room time minus client time, and how long the trip took. */
export interface ClockSample {
  offset: number
  rtt: number
}

/** The sample from a pong: sent at `sentAt`, received at `receivedAt` (client), `serverTime` (room). */
export function sampleFrom(sentAt: number, serverTime: number, receivedAt: number): ClockSample {
  const rtt = receivedAt - sentAt
  return { offset: serverTime - (sentAt + rtt / 2), rtt }
}

/** The best of the last `SAMPLE_WINDOW` samples: the one with the lowest round-trip time. */
export function bestSample(samples: readonly ClockSample[]): ClockSample | undefined {
  let best: ClockSample | undefined
  for (const s of samples.slice(-SAMPLE_WINDOW)) if (!best || s.rtt < best.rtt) best = s
  return best
}

/** The offset to use next: the candidate, unless it is within `OFFSET_THRESHOLD_MS` of the current one. */
export function nextOffset(current: number | undefined, candidate: number): number {
  if (current === undefined) return candidate
  return Math.abs(candidate - current) < OFFSET_THRESHOLD_MS ? current : candidate
}

/**
 * The shift from room seconds to audio seconds: `audio = room / 1000 + shift`.
 *
 * `heard` pairs an audio time with the client time (`performance.now()`, ms) at which that
 * sample leaves the speakers, so a sound scheduled at `audio` is heard at room time `room`.
 */
export function audioShift(
  heard: { contextTime: number; performanceTime: number },
  offsetMs: number,
  timeOrigin: number,
): number {
  return heard.contextTime - (heard.performanceTime + timeOrigin + offsetMs) / 1000
}

/** Room ms → audio seconds, and back, for a given shift. */
export const roomToAudio = (roomMs: number, shift: number) => roomMs / 1000 + shift
export const audioToRoom = (audio: number, shift: number) => (audio - shift) * 1000

/** Clock messages over the board connection: a client's ping, and the room's pong. */
export type ClockMessage = { t: 'ping'; c: number } | { t: 'pong'; c: number; s: number }

export const ping = (clientTime: number) => JSON.stringify({ t: 'ping', c: clientTime })
export const pong = (clientTime: number, roomTime: number) =>
  JSON.stringify({ t: 'pong', c: clientTime, s: roomTime })

/** A clock message, or undefined for anything else. */
export function parseClockMessage(message: string): ClockMessage | undefined {
  try {
    const m = JSON.parse(message) as { t?: unknown; c?: unknown; s?: unknown }
    const c = m.c
    const s = m.s
    if (typeof c !== 'number' || !Number.isFinite(c)) return undefined
    if (m.t === 'ping') return { t: 'ping', c }
    if (m.t === 'pong' && typeof s === 'number' && Number.isFinite(s)) return { t: 'pong', c, s }
  } catch {
    // Not a clock message.
  }
  return undefined
}
