import { describe, expect, it } from 'vitest'
import { UPLOADS } from '../shared/sounds'
import {
  encodeWav,
  LEAD_SECONDS,
  mixDown,
  normalise,
  parseUploadWav,
  PEAK,
  soundBounds,
  trimSilence,
} from '../shared/wav'

const RATE = UPLOADS.sampleRate

const tone = (seconds: number, amp = 0.5) =>
  Float32Array.from(
    { length: Math.round(seconds * RATE) },
    (_, i) => Math.sin((2 * Math.PI * 440 * i) / RATE) * amp,
  )

describe('encodeWav and parseUploadWav', () => {
  it('round-trips a mono sample', () => {
    const wav = encodeWav(tone(1.5), RATE)
    expect(wav.length).toBe(44 + 1.5 * RATE * 2)
    expect(parseUploadWav(wav)).toEqual({
      sampleRate: RATE,
      channels: 1,
      bitsPerSample: 16,
      frames: 1.5 * RATE,
      durationMs: 1500,
    })
  })

  it(`accepts exactly ${UPLOADS.maxSeconds} s, within the byte cap`, () => {
    const wav = encodeWav(new Float32Array(UPLOADS.maxSeconds * RATE), RATE)
    expect(wav.length).toBeLessThanOrEqual(UPLOADS.maxBytes)
    expect(parseUploadWav(wav)).toMatchObject({ durationMs: UPLOADS.maxSeconds * 1000 })
  })

  // @scenario audio/sounds: Too long
  it('refuses anything longer', () => {
    const wav = encodeWav(new Float32Array(UPLOADS.maxSeconds * RATE + 1), RATE)
    expect(parseUploadWav(wav)).toEqual({ error: 'Samples must be 10 seconds or less' })
  })

  it('refuses a different sample rate', () => {
    expect(parseUploadWav(encodeWav(tone(0.1), 48_000))).toEqual({
      error: 'Only 44100 Hz is accepted',
    })
  })

  it('refuses stereo and 24-bit', () => {
    const stereo = encodeWav(tone(0.1), RATE)
    new DataView(stereo.buffer).setUint16(22, 2, true)
    expect(parseUploadWav(stereo)).toEqual({ error: 'Only mono is accepted' })
    const deep = encodeWav(tone(0.1), RATE)
    new DataView(deep.buffer).setUint16(34, 24, true)
    expect(parseUploadWav(deep)).toEqual({ error: 'Only 16-bit PCM is accepted' })
  })

  it('refuses truncated files, padded files and other formats', () => {
    const wav = encodeWav(tone(0.1), RATE)
    expect(parseUploadWav(wav.subarray(0, 30))).toEqual({ error: 'Not a WAV file' })
    expect(parseUploadWav(wav.subarray(0, wav.length - 2))).toMatchObject({ error: /truncated/ })
    const padded = new Uint8Array(wav.length + 4)
    padded.set(wav)
    expect(parseUploadWav(padded)).toMatchObject({ error: /truncated/ })
    expect(parseUploadWav(new TextEncoder().encode('ID3'.padEnd(100, 'x')))).toEqual({
      error: 'Not a WAV file',
    })
  })

  it('refuses an empty sample', () => {
    expect(parseUploadWav(encodeWav(new Float32Array(0), RATE))).toEqual({
      error: 'The file has no audio',
    })
  })
})

describe('sample preparation', () => {
  it('mixes channels down by averaging', () => {
    expect([...mixDown([Float32Array.of(1, 0), Float32Array.of(0, 0.5)])]).toEqual([0.5, 0.25])
  })

  it('trims silence at both ends, keeping a moment before the first sound', () => {
    const silence = new Float32Array(RATE)
    const sound = tone(0.5)
    const padded = new Float32Array(silence.length * 2 + sound.length)
    padded.set(sound, silence.length)
    const trimmed = trimSilence(padded, RATE)
    const lead = Math.round(LEAD_SECONDS * RATE)
    // The tone starts at zero, so its first audible sample is a little after its start.
    expect(trimmed.length).toBeGreaterThan(sound.length - 10)
    expect(trimmed.length).toBeLessThanOrEqual(sound.length + lead)
    expect(trimSilence(silence, RATE).length).toBe(0)
  })

  it('says where the kept sound starts, so a trimmed clip can stay in time', () => {
    const lead = Math.round(LEAD_SECONDS * RATE)
    const padded = new Float32Array(RATE)
    padded.fill(0.5, 4410, 8820)
    expect(soundBounds(padded, RATE)).toEqual([4410 - lead, 8820])
    expect(soundBounds(new Float32Array(10), RATE)).toEqual([0, 0])
  })

  it('trims relative to the peak, so a quiet recording keeps its tail', () => {
    // Peaks at −80 dBFS, decaying to −120 dBFS: all of it is within 60 dB of its own peak.
    const quiet = Float32Array.from(
      { length: RATE / 10 },
      (_, i) => 1e-4 * 0.01 ** (i / (RATE / 10)),
    )
    expect(trimSilence(quiet, RATE).length).toBe(quiet.length)
  })

  it('reports durations without floating-point drift', () => {
    const wav = encodeWav(new Float32Array(177_723), RATE)
    expect(parseUploadWav(wav)).toMatchObject({ durationMs: Math.ceil((177_723 * 1000) / RATE) })
  })

  it('levels the peak to −1 dBFS', () => {
    const out = normalise(tone(0.1, 0.1))
    expect(Math.max(...out.map(Math.abs))).toBeCloseTo(PEAK, 3)
    expect([...normalise(new Float32Array(3))]).toEqual([0, 0, 0])
  })
})
