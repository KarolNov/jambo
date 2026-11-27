/**
 * Live voice, as the Worker and the client share it: the jam's limits, the wire format of one
 * stamped frame of a voice, and the messages the fake transport relays through the room.
 *
 * A singer stamps every frame with the room time it was sung at (the jam clock, corrected for
 * their round trip); every listener plays it at stamp + one bar at the jam's tempo, so it lands on
 * the same beat of the next bar for everyone.
 */
import { BPM } from './board/schema'
import { audioToRoom, roomToAudio } from './clock'
import { barMs } from './looper'

export const LIVE = {
  /** Live voices a jam may have at once. */
  maxVoices: 3,
  /** How long a voice stays live before it stops by itself, in ms. */
  maxMs: 60 * 60 * 1000,
  /** One frame of voice, in ms (an Opus frame). */
  frameMs: 20,
  /** The encoder's target bitrate, in bits a second. */
  bitrate: 32_000,
  /** The largest encoded payload a frame may carry, in bytes: far above Opus at 32 kbps. */
  maxPayload: 1_000,
} as const

/** How far behind the singer every listener plays a voice, in room ms: one bar at `bpm`. */
export const liveDelayMs = (bpm: number) => barMs(bpm)

/**
 * The room time a voice was sung at, from the context time `capturedAt` its sample reached the
 * live encoder: the singer sang to what they heard, `delay` seconds earlier (their round trip, plus
 * the preset's own delay), and `shift` maps their context's time onto the room's.
 */
export const liveStamp = (capturedAt: number, delay: number, shift: number) =>
  audioToRoom(capturedAt - delay, shift)

/** When a listener plays a frame stamped `stamp`: one bar later, in their context's seconds. */
export const livePlayAt = (stamp: number, bpm: number, shift: number) =>
  roomToAudio(stamp + liveDelayMs(bpm), shift)

/** The frame format's version, its first byte. */
const VERSION = 1
/** version u8, bpm u16, seq u32, stamp f64. */
const HEADER = 1 + 2 + 4 + 8

/** One frame of a live voice: its encoded audio and when it was sung. */
export interface LiveFrame {
  /** Counts the singer's frames from 0, for spotting gaps. */
  seq: number
  /** The room time its first sample was sung at, in ms. */
  stamp: number
  /** The tempo it was sung at: a listener on another tempo drops it. */
  bpm: number
  /** The encoded audio (Opus). */
  payload: Uint8Array
}

/** A frame as bytes: header, then payload. */
export function encodeFrame(frame: LiveFrame): Uint8Array {
  const out = new Uint8Array(HEADER + frame.payload.length)
  const view = new DataView(out.buffer)
  view.setUint8(0, VERSION)
  view.setUint16(1, frame.bpm)
  view.setUint32(3, frame.seq >>> 0)
  view.setFloat64(7, frame.stamp)
  out.set(frame.payload, HEADER)
  return out
}

/** A frame from bytes, or undefined when they aren't one this version reads. */
export function parseFrame(bytes: Uint8Array): LiveFrame | undefined {
  if (bytes.length <= HEADER || bytes.length > HEADER + LIVE.maxPayload) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (view.getUint8(0) !== VERSION) return undefined
  const bpm = view.getUint16(1)
  const seq = view.getUint32(3)
  const stamp = view.getFloat64(7)
  if (bpm < BPM.min || bpm > BPM.max || !Number.isFinite(stamp) || stamp <= 0) return undefined
  return { seq, stamp, bpm, payload: bytes.slice(HEADER) }
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Standard base64, padded. */
export function toBase64(bytes: Uint8Array): string {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!
    const b = bytes[i + 1]
    const c = bytes[i + 2]
    out += B64[a >> 2]
    out += B64[((a & 3) << 4) | ((b ?? 0) >> 4)]
    out += b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]
    out += c === undefined ? '=' : B64[c & 63]
  }
  return out
}

/** Bytes from standard base64, or undefined when it isn't. */
export function fromBase64(text: string): Uint8Array | undefined {
  if (text.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(text)) return undefined
  const pad = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0
  const out = new Uint8Array((text.length / 4) * 3 - pad)
  let o = 0
  for (let i = 0; i < text.length; i += 4) {
    const n =
      (B64.indexOf(text[i]!) << 18) |
      (B64.indexOf(text[i + 1]!) << 12) |
      ((B64.indexOf(text[i + 2]!) & 63) << 6) |
      (B64.indexOf(text[i + 3]!) & 63)
    if (o < out.length) out[o++] = n >> 16
    if (o < out.length) out[o++] = (n >> 8) & 255
    if (o < out.length) out[o++] = n & 255
  }
  return out
}

/** The longest frame the fake relay carries, as base64. */
const MAX_RELAYED = Math.ceil((HEADER + LIVE.maxPayload) / 3) * 4

/**
 * The fake transport's messages over the board connection (local dev and e2e only): a singer
 * sends `{ t: 'live', f }` with a frame as base64, and the room relays it to everyone else as
 * `{ t: 'live', v, f }`, `v` naming whose voice it is (their seat's id, set by the room, never
 * by the sender).
 */
export type LiveRelayMessage = { t: 'live'; f: string; v?: string }

export const relayOut = (frame: Uint8Array) => JSON.stringify({ t: 'live', f: toBase64(frame) })

export const relayIn = (voice: string, f: string) => JSON.stringify({ t: 'live', v: voice, f })

/** A relay message, or undefined for anything else (or a frame too big to be one). */
export function parseRelayMessage(message: string): LiveRelayMessage | undefined {
  // Cheap check first: the board connection carries clock pings many times a second.
  if (!message.startsWith('{"t":"live"')) return undefined
  try {
    const m = JSON.parse(message) as { t?: unknown; f?: unknown; v?: unknown }
    if (m.t !== 'live' || typeof m.f !== 'string' || m.f.length > MAX_RELAYED) return undefined
    if (m.v !== undefined && typeof m.v !== 'string') return undefined
    return m.v === undefined ? { t: 'live', f: m.f } : { t: 'live', f: m.f, v: m.v }
  } catch {
    return undefined
  }
}
