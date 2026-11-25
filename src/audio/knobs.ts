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

/*
 * The master knobs (see `MASTER_KNOBS`). Master tone uses `toneFilter`, as a track's tone does.
 */

/** How far above full scale the drive's shaper reads: its curve spans ±this, so a hot mix isn't clipped flat. */
export const DRIVE_HEADROOM = 4
/** Points in the drive's shaping curve. Odd, so 0 maps to 0 exactly. */
const DRIVE_CURVE_POINTS = 2049
/** How hard drive 1 bends the mix: tanh's slope. */
const DRIVE_BEND = 4

/**
 * The drive's shaping curve over input ±`DRIVE_HEADROOM` (the engine scales the mix by its inverse
 * on the way in): `tanh(k·x)/k`, which keeps quiet sounds at their level and rounds loud ones off
 * toward `1/k`. At 0 it is a straight line.
 */
export function driveCurve(drive: number): Float32Array<ArrayBuffer> {
  const k = DRIVE_BEND * drive
  const curve = new Float32Array(DRIVE_CURVE_POINTS)
  for (let i = 0; i < DRIVE_CURVE_POINTS; i++) {
    const x = ((i / (DRIVE_CURVE_POINTS - 1)) * 2 - 1) * DRIVE_HEADROOM
    curve[i] = k > 0 ? Math.tanh(k * x) / k : x
  }
  return curve
}

/**
 * The glue after the shaper: a compressor that squeezes harder as drive rises (threshold down to
 * -24 dB, ratio up to 6:1), and the gain that brings the squeezed mix back up, so driving the mix
 * evens it out without leaving it quieter.
 */
export function driveGlue(drive: number): { threshold: number; ratio: number; makeup: number } {
  return { threshold: -24 * drive, ratio: 1 + 5 * drive, makeup: 1 + 2 * drive }
}

/**
 * The stereo width as a mid/side mix, written as two gains per ear: `direct` from the same side and
 * `cross` from the other. 0 leaves the mix as it is (1, 0); -1 folds it to mono (½, ½); +1 doubles
 * the side signal (1.5, -½).
 */
export function widthGains(width: number): { direct: number; cross: number } {
  return { direct: (2 + width) / 2, cross: -width / 2 }
}

/*
 * The touchpad's modes (see `FX_MODES`).
 */

/** The filter mode's resonance as a linear Q: none (a Butterworth's 0.7) at Y 0, strong at Y 1. */
export const FILTER_Q_MIN = Math.SQRT1_2
export const FILTER_Q_MAX = 12

/**
 * The filter mode at `x`, `y`: X sweeps the whole mix as `toneFilter` does (a low-pass closing
 * toward -1, a high-pass rising toward +1, open at 0), and Y raises the resonance, exponentially
 * from `FILTER_Q_MIN` to `FILTER_Q_MAX`. `q` is in decibels, as a low- or high-pass
 * `BiquadFilterNode` reads its Q. At x 0 the low-pass sits at `open` (pass the Nyquist), where it
 * passes the sound through whatever the resonance.
 */
export function filterSweep(
  x: number,
  y: number,
  open?: number,
): { type: 'lowpass' | 'highpass'; frequency: number; q: number } {
  const q = FILTER_Q_MIN * (FILTER_Q_MAX / FILTER_Q_MIN) ** y
  return { ...toneFilter(x, open), q: 20 * Math.log10(q) }
}
