import { beatSeconds } from '../../shared/looper'

/**
 * The pure mappings from a track's sound knobs (see `SOUND_KNOBS`) to audio parameters. The engine
 * applies them to nodes; keeping them here lets them be tested without an AudioContext.
 */

/** Below this cutoff tone's low-pass is fully closed (tone -1). */
export const TONE_LOW_HZ = 300
/** Tone's high-pass reaches this cutoff at tone +1. */
export const TONE_HIGH_HZ = 3000
/** Where the low-pass sits at 0 when no Nyquist is given: above anything audible. */
const LOWPASS_OPEN_HZ = 20000
/** Where the high-pass starts at a hair above 0: below anything audible. */
const HIGHPASS_OPEN_HZ = 20

/** How loud each echo repeat is next to the one before it. */
export const ECHO_FEEDBACK = 0.35
/** The echo repeats on a dotted eighth note. */
export const ECHO_BEATS = 0.75

/** Seconds of generated room the reverb rings for. */
export const REVERB_SECONDS = 2.5

/** Ramp time constant for knob changes, in seconds (about 20 ms to settle). */
export const KNOB_RAMP = 0.007

/**
 * The filter for a tone: at 0 and below a low-pass swept down from `open` to `TONE_LOW_HZ` at -1;
 * above 0 a high-pass swept up from fully open to `TONE_HIGH_HZ` at +1. Pass the context's Nyquist
 * as `open`: a low-pass there passes the sound through unchanged. Sweeps are exponential, so equal
 * knob turns sound like equal steps. The two sides are open at opposite ends, so the engine sets
 * the cutoff straight away when the type changes rather than sweeping across.
 */
export function toneFilter(
  tone: number,
  open = LOWPASS_OPEN_HZ,
): {
  type: 'lowpass' | 'highpass'
  frequency: number
} {
  if (tone > 0)
    return {
      type: 'highpass',
      frequency: HIGHPASS_OPEN_HZ * (TONE_HIGH_HZ / HIGHPASS_OPEN_HZ) ** tone,
    }
  return { type: 'lowpass', frequency: open * (TONE_LOW_HZ / open) ** -tone }
}

/** The playback rate that shifts a sound by `semitones`: +12 doubles it, -12 halves it. */
export function pitchRate(semitones: number): number {
  return 2 ** (semitones / 12)
}

/** Seconds between echo repeats at `bpm`: a dotted eighth note. */
export function echoSeconds(bpm: number): number {
  return ECHO_BEATS * beatSeconds(bpm)
}

/**
 * The reverb's impulse response, one channel per ear: decaying noise over `seconds`, each channel
 * from its own seed so the room sounds wide. Deterministic, so every client hears the same room.
 */
export function reverbImpulse(
  sampleRate: number,
  seconds = REVERB_SECONDS,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const length = Math.ceil(sampleRate * seconds)
  const channel = (seed: number) => {
    const next = () => (seed = (seed * 16807) % 2147483647)
    // Small seeds start near 0, which would give both ears the same first sample: skip ahead.
    for (let i = 0; i < 16; i++) next()
    const data = new Float32Array(length)
    for (let i = 0; i < length; i++) {
      next()
      const t = i / length
      // Falls to -60 dB 90% of the way through, and to silence at the end.
      data[i] = ((seed / 2147483647) * 2 - 1) * (1 - t) ** 3
    }
    return data
  }
  return [channel(1), channel(7)]
}
