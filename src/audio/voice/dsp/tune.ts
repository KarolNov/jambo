/**
 * The pitch side of the voice rack: auto-tune to a key, flatten to one note (Robot), or shift by
 * a fixed interval (Chipmunk, Demon), with an optional ring modulator. `VoicePitch` ties the YIN
 * tracker to the PSOLA shifter; `pitch.worklet.ts` runs it on the audio thread. Pure, so it is
 * unit-tested directly.
 */

import { PsolaShifter, psolaDelay } from './psola'
import { PitchTracker } from './yin'

/** The note names, from C, as the key picker shows them. */
export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'] as const

export type Scale = 'major' | 'minor'

/** A key to tune to: a root (0 is C, 9 is A) and a scale. */
export interface Key {
  root: number
  scale: Scale
}

export const DEFAULT_KEY: Key = { root: 0, scale: 'major' }

const STEPS: Record<Scale, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  // Natural minor.
  minor: [0, 2, 3, 5, 7, 8, 10],
}

export const isKey = (k: unknown): k is Key =>
  typeof k === 'object' &&
  k !== null &&
  Number.isInteger((k as Key).root) &&
  (k as Key).root >= 0 &&
  (k as Key).root < 12 &&
  ((k as Key).scale === 'major' || (k as Key).scale === 'minor')

export const keyName = (k: Key) => `${NOTE_NAMES[k.root]} ${k.scale}`

/** The pitch classes (0 is C) of `key`'s scale. */
export const scaleNotes = (key: Key): number[] => STEPS[key.scale].map((s) => (s + key.root) % 12)

/** `hz` as a MIDI note number, fractional: 69 is A440. */
export const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440)
export const hzOf = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

/** The note of `notes` (pitch classes) nearest `midi`, as a whole MIDI note. */
export function nearestNote(midi: number, notes: readonly number[]): number {
  let best = Math.round(midi)
  let distance = Infinity
  const base = Math.floor(midi)
  // The nearest scale note is within a few semitones either way.
  for (let n = base - 6; n <= base + 7; n++) {
    if (!notes.includes(((n % 12) + 12) % 12)) continue
    const d = Math.abs(n - midi)
    if (d < distance) {
      distance = d
      best = n
    }
  }
  return best
}

/** What the pitch node does to a voice. */
export type PitchMode =
  | {
      kind: 'tune'
      /** The pitch classes to correct to. */
      notes: number[]
      /** How long a correction takes to settle, in seconds; 0 snaps at once (hard). */
      glide: number
      /** Semitones the voice must stray from its note before it moves to another. */
      hold: number
    }
  | {
      kind: 'shift'
      semitones: number
      /** How far the formants move, as a factor: above 1 smaller, below 1 bigger. */
      formant: number
    }

export interface PitchOptions {
  mode: PitchMode
  /** A ring modulator after the shift: its frequency in Hz and how much of it is heard, 0 to 1. */
  ring?: { hz: number; mix: number }
}

/** The pitch node's delay at `rate`, in seconds. */
export const pitchDelay = (rate: number) => psolaDelay(rate) / rate

/**
 * A voice through the pitch node, a block at a time: tracks the pitch, works out the shift the
 * mode wants, and shifts. Its output is `pitchDelay` late.
 */
export class VoicePitch {
  private readonly tracker: PitchTracker
  private readonly shifter: PsolaShifter
  /** The correction in semitones now heard, gliding toward the one wanted. */
  private correction = 0
  /** The note auto-tune is holding, as a MIDI note, or NaN when none yet. */
  private note = Number.NaN
  private ringPhase = 0

  constructor(
    private readonly rate: number,
    private readonly options: PitchOptions,
  ) {
    this.tracker = new PitchTracker(rate)
    this.shifter = new PsolaShifter(rate)
  }

  process(input: Float32Array, output: Float32Array) {
    this.tracker.push(input)
    const { mode, ring } = this.options
    const hz = this.tracker.hz
    let ratio = 1
    let formant = 1
    if (mode.kind === 'shift') {
      ratio = 2 ** (mode.semitones / 12)
      formant = mode.formant
    } else {
      const wanted = hz > 0 ? this.target(midiOf(hz), mode) - midiOf(hz) : 0
      if (hz <= 0) this.note = Number.NaN
      const blockSeconds = input.length / this.rate
      const settle = mode.glide > 0 ? 1 - Math.exp(-blockSeconds / mode.glide) : 1
      this.correction += (wanted - this.correction) * settle
      ratio = 2 ** (this.correction / 12)
    }
    this.shifter.process(input, output, this.tracker.period, ratio, formant)
    if (ring && ring.mix > 0) {
      const step = (2 * Math.PI * ring.hz) / this.rate
      for (let i = 0; i < output.length; i++) {
        const y = output[i]!
        output[i] = y * (1 - ring.mix) + y * Math.sin(this.ringPhase) * ring.mix
        this.ringPhase += step
      }
      this.ringPhase %= 2 * Math.PI
    }
  }

  /** The note to correct `midi` to: the nearest in the mode's notes, held within `hold`. */
  private target(midi: number, mode: Extract<PitchMode, { kind: 'tune' }>) {
    if (!Number.isNaN(this.note) && Math.abs(midi - this.note) < 0.5 + mode.hold) return this.note
    this.note = nearestNote(midi, mode.notes)
    return this.note
  }
}
