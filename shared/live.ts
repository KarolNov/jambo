/**
 * Live voice, as the Worker and the client share it: the jam's limits, the wire format of one
 * stamped frame of a voice, the messages the fake transport relays through the room, and the live
 * slots the room hands out.
 *
 * A singer stamps every frame with the room time it was sung at (the jam clock, corrected for
 * their round trip); every listener plays it at stamp + one bar at the jam's tempo, so it lands on
 * the same beat of the next bar for everyone.
 */
import { BPM } from './board/schema'
import { audioToRoom, roomToAudio } from './clock'
import { type ColorName, toColorName } from './colors'
import { barMs } from './looper'
import { toName } from './names'

export const LIVE = {
  /** Live voices a jam may have at once. */
  maxVoices: 3,
  /** How long a voice stays live before it stops by itself, in ms. */
  maxMs: 60 * 60 * 1000,
  /** One frame of voice, in ms (an Opus frame). */
  frameMs: 20,
  /** Opus's encoder lookahead (312 samples at 48 kHz): decoded audio lags its input by this, in ms. */
  codecDelayMs: 6.5,
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
 * `{ t: 'live', v, f }`, `v` naming whose voice it is (the voice id the room granted their slot,
 * set by the room, never by the sender).
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

/**
 * Live slots: the room hands out the jam's `LIVE.maxVoices` slots over the board connection. A
 * seated person asks with `request` and gets `grant` (naming the voice id their frames will carry)
 * or `full`; they give it back with `stop`. The room sends `stop` too, saying why, when it ends a
 * slot itself: `asked` (they stopped), `hour` (`LIVE.maxMs` ran out) or `unseated` (they asked
 * before the room seated them).
 */
export type LiveStopReason = 'asked' | 'hour' | 'unseated'
export type SlotMessage =
  | { t: 'slot'; s: 'request' }
  | { t: 'slot'; s: 'grant'; v: string }
  | { t: 'slot'; s: 'full' }
  | { t: 'slot'; s: 'stop'; why?: LiveStopReason }

const STOP_REASONS: readonly LiveStopReason[] = ['asked', 'hour', 'unseated']

export const slotRequest = () => JSON.stringify({ t: 'slot', s: 'request' })
export const slotGrant = (voice: string) => JSON.stringify({ t: 'slot', s: 'grant', v: voice })
export const slotFull = () => JSON.stringify({ t: 'slot', s: 'full' })
export const slotStop = (why?: LiveStopReason) =>
  JSON.stringify(why ? { t: 'slot', s: 'stop', why } : { t: 'slot', s: 'stop' })

/** A slot message, or undefined for anything else. */
export function parseSlotMessage(message: string): SlotMessage | undefined {
  if (!message.startsWith('{"t":"slot"')) return undefined
  try {
    const m = JSON.parse(message) as { s?: unknown; v?: unknown; why?: unknown }
    if (m.s === 'request') return { t: 'slot', s: 'request' }
    if (m.s === 'full') return { t: 'slot', s: 'full' }
    if (m.s === 'grant' && typeof m.v === 'string' && m.v.length > 0 && m.v.length <= 64)
      return { t: 'slot', s: 'grant', v: m.v }
    if (m.s === 'stop') {
      const why = STOP_REASONS.find((r) => r === m.why)
      return why ? { t: 'slot', s: 'stop', why } : { t: 'slot', s: 'stop' }
    }
  } catch {
    // Not JSON: not a slot message.
  }
  return undefined
}

/**
 * Someone live, as the room publishes them in its own state (`live` beside `agents`): the voice id
 * their frames carry, and their name and colour as the room seated them. Names are unique in a jam,
 * so a listener matches a person to their voice by name.
 */
export interface LiveVoice {
  voice: string
  name: string
  color: ColorName
  /**
   * How many times the voice has been published on Realtime, once it has: a listener subscribed to
   * an earlier publish (before the singer reconnected) subscribes again when it goes up.
   */
  rev?: number
}

/** One published live voice, if it reads as one. */
export function toLiveVoice(v: unknown): LiveVoice | undefined {
  const l = v as { voice?: unknown; name?: unknown; color?: unknown; rev?: unknown } | null
  const color = toColorName(l?.color)
  const name = toName(l?.name)
  if (typeof l?.voice !== 'string' || l.voice.length === 0 || !color || !name) return undefined
  const rev = Number.isSafeInteger(l.rev) && (l.rev as number) > 0 ? (l.rev as number) : undefined
  return rev ? { voice: l.voice, name, color, rev } : { voice: l.voice, name, color }
}

/**
 * How live voice travels in this Worker, as `GET /api/live` answers: `realtime` (Cloudflare Realtime
 * DataChannels), `fake` (relayed through the room, local Workers only), or `none` where neither is
 * set up (a deployed Worker without Realtime credentials).
 */
export type LiveTransportKind = 'realtime' | 'fake' | 'none'

export const toTransportKind = (v: unknown): LiveTransportKind =>
  v === 'realtime' || v === 'fake' ? v : 'none'

/** What the mic control says where live voice isn't set up. */
export const LIVE_UNAVAILABLE = "Live voice isn't available here."

/**
 * Every live voice's DataChannel delivery: unordered, never retransmitted. A late frame is useless
 * (the jitter buffer drops it), so nothing waits for one. Both ends and the Realtime API must agree.
 */
export const CHANNEL_POLICY = { ordered: false, maxRetransmits: 0 } as const

/**
 * The session route's calls, under `/api/jams/:slug/live/`. Every call names the caller's private
 * seat key; all but `session` carry the session and the ticket `session` gave for it.
 */
export const LIVE_CALLS = ['session', 'answer', 'publish', 'subscribe', 'close'] as const
export type LiveCall = (typeof LIVE_CALLS)[number]

/** A session description, as WebRTC and the Realtime API pass it. */
export interface Description {
  type: 'offer' | 'answer'
  sdp: string
}
