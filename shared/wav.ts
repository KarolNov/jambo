import { UPLOADS } from './sounds'

/** What an upload's WAV header says. */
export interface WavInfo {
  sampleRate: number
  channels: number
  bitsPerSample: number
  frames: number
  durationMs: number
}

const HEADER_BYTES = 44

/** Encodes mono samples in [-1, 1] as a 16-bit PCM WAV file with the canonical 44-byte header. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(HEADER_BYTES + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i)
  }
  ascii(0, 'RIFF')
  view.setUint32(4, bytes.length - 8, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byte rate
  view.setUint16(32, 2, true) // block align
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!))
    view.setInt16(HEADER_BYTES + i * 2, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true)
  }
  return bytes
}

/**
 * Reads the header of a WAV file and checks it is what the room stores: 16-bit PCM, mono, at the
 * upload sample rate, no longer than the upload limit, with exactly the data it declares.
 * Returns the header's details, or why the file is refused.
 */
export function parseUploadWav(bytes: Uint8Array): WavInfo | { error: string } {
  if (bytes.length > UPLOADS.maxBytes) return { error: 'The file is too big' }
  if (bytes.length < HEADER_BYTES) return { error: 'Not a WAV file' }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4))
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') return { error: 'Not a WAV file' }
  if (tag(12) !== 'fmt ' || view.getUint32(16, true) !== 16 || tag(36) !== 'data')
    return { error: 'Unexpected WAV layout' }
  const format = view.getUint16(20, true)
  const channels = view.getUint16(22, true)
  const sampleRate = view.getUint32(24, true)
  const bitsPerSample = view.getUint16(34, true)
  if (format !== 1 || bitsPerSample !== 16) return { error: 'Only 16-bit PCM is accepted' }
  if (channels !== 1) return { error: 'Only mono is accepted' }
  if (sampleRate !== UPLOADS.sampleRate)
    return { error: `Only ${UPLOADS.sampleRate} Hz is accepted` }
  const dataBytes = view.getUint32(40, true)
  if (dataBytes !== bytes.length - HEADER_BYTES || view.getUint32(4, true) !== bytes.length - 8)
    return { error: 'The file is truncated or has extra data' }
  const frames = dataBytes / 2
  if (frames < 1 || !Number.isInteger(frames)) return { error: 'The file has no audio' }
  const durationMs = Math.ceil((frames * 1000) / sampleRate)
  if (durationMs > UPLOADS.maxSeconds * 1000)
    return { error: `Samples must be ${UPLOADS.maxSeconds} seconds or less` }
  return { sampleRate, channels, bitsPerSample, frames, durationMs }
}

/** Silence is anything more than 60 dB below the sample's own peak. */
export const SILENCE = 10 ** (-60 / 20)
/** How much is kept before the first sound, so attacks aren't clipped. */
export const LEAD_SECONDS = 0.005
/** Peaks are levelled to −1 dBFS. */
export const PEAK = 10 ** (-1 / 20)

/** Mixes channels down to one by averaging them. */
export function mixDown(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!.slice()
  const out = new Float32Array(channels[0]?.length ?? 0)
  for (const ch of channels)
    for (let i = 0; i < out.length; i++) out[i]! += ch[i]! / channels.length
  return out
}

/**
 * Trims silence from both ends, keeping a few ms before the first sound. Silence is measured
 * against the sample's peak, so the cut doesn't depend on how loud it was recorded. Returns an
 * empty array when everything is zero.
 */
export function trimSilence(samples: Float32Array, sampleRate: number): Float32Array {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  if (peak === 0) return new Float32Array(0)
  const floor = peak * SILENCE
  let first = 0
  while (first < samples.length && Math.abs(samples[first]!) < floor) first++
  let last = samples.length - 1
  while (last > first && Math.abs(samples[last]!) < floor) last--
  const start = Math.max(0, first - Math.round(LEAD_SECONDS * sampleRate))
  return samples.slice(start, last + 1)
}

/** Scales the samples so the loudest peak sits at −1 dBFS. */
export function normalise(samples: Float32Array): Float32Array {
  let peak = 0
  for (const s of samples) peak = Math.max(peak, Math.abs(s))
  if (peak === 0) return samples.slice()
  const gain = PEAK / peak
  return samples.map((s) => s * gain)
}
