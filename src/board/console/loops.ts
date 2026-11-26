/** The mixer's wording and geometry, kept apart from React so it can be tested. */
import {
  BEATS_PER_BAR,
  type FxMode,
  type MasterKnob,
  QUANTIZE,
  SOUND_KNOB_NAMES,
  SOUND_KNOBS,
  type SoundKnob,
  soundOf,
} from '../../../shared/board'
import { type REPEAT_SLICES, repeatZone } from '../../../shared/looper'
import { lofiCrush, type THROW_BEATS, throwZone } from '../../audio/knobs'

const SNAP_LABEL: Record<(typeof QUANTIZE)[number], string> = {
  0: 'Off',
  0.125: '1/32',
  0.25: '1/16',
  0.5: '1/8',
  1: '1/4',
}

/** What a snap setting is called in the Snap menu. */
export const snapLabel = (q: number) => SNAP_LABEL[q as (typeof QUANTIZE)[number]] ?? String(q)

/** The Snap menu's options, finest last. */
export const SNAP_OPTIONS = QUANTIZE.map((q) => ({ value: String(q), label: snapLabel(q) }))

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** A loop's length and size under its name: "2 bars · 6 hits". */
export const loopSummary = (bars: number, hits: number) =>
  `${plural(bars, 'bar')} · ${plural(hits, 'hit')}`

/** Where `beat` sits across a loop of `bars`, as a CSS percentage. */
export const beatPosition = (beat: number, bars: number) =>
  `${(beat / (bars * BEATS_PER_BAR)) * 100}%`

/**
 * Where a voice clip sounding from beat `start` to `end` sits across a loop of `bars`, as CSS
 * `left` and `width` percentages: cut at the loop's end, where it stops playing.
 */
export function clipBar(start: number, end: number, bars: number) {
  const length = bars * BEATS_PER_BAR
  const from = Math.min(length, Math.max(0, start))
  const to = Math.min(length, Math.max(from, end))
  return { left: beatPosition(from, bars), width: `${((to - from) / length) * 100}%` }
}

const pct = (v: number) => Math.round(Math.abs(v) * 100)

/** How each sound knob is named and reads under it in the Effects strip. */
export const SOUND_READOUTS: Record<SoundKnob, { label: string; format: (v: number) => string }> = {
  reverb: { label: 'Reverb', format: (v) => `${pct(v)}%` },
  echo: { label: 'Echo', format: (v) => `${pct(v)}%` },
  tone: {
    label: 'Tone',
    format: (v) => (pct(v) === 0 ? 'Flat' : `${v < 0 ? 'Dark' : 'Bright'} ${pct(v)}%`),
  },
  pitch: {
    label: 'Pitch',
    // `|| 0` so a -0 reads 0.
    format: (v) => (Math.round(v) > 0 ? `+${Math.round(v)}` : String(Math.round(v) || 0)),
  },
  pan: {
    label: 'Pan',
    format: (v) => (pct(v) === 0 ? 'C' : `${v < 0 ? 'L' : 'R'} ${pct(v)}`),
  },
}

/** Whether any of a track's sound knobs is away from its default: the Effects toggle's dot. */
export const soundChanged = (track: Partial<Record<SoundKnob, number>>) => {
  const sound = soundOf(track)
  return SOUND_KNOB_NAMES.some((k) => sound[k] !== SOUND_KNOBS[k].default)
}

/** The master knobs the console shows, in order. */
export const MASTER_CONSOLE_KNOBS = [
  'tone',
  'drive',
  'width',
  'swing',
] as const satisfies readonly MasterKnob[]

/** Each master knob's name and how its value reads, for its label and bubble. */
export const MASTER_READOUTS: Record<
  (typeof MASTER_CONSOLE_KNOBS)[number],
  { label: string; format: (v: number) => string }
> = {
  tone: SOUND_READOUTS.tone,
  drive: { label: 'Drive', format: (v) => (pct(v) === 0 ? 'Off' : `${pct(v)}%`) },
  width: {
    label: 'Width',
    format: (v) =>
      pct(v) === 0
        ? 'Stereo'
        : pct(v) === 100 && v < 0
          ? 'Mono'
          : `${v < 0 ? 'Narrow' : 'Wide'} ${pct(v)}%`,
  },
  // As drum machines count it: 50% is straight, 75% (swing 1) plays each off-beat 16th half a 16th late.
  swing: {
    label: 'Swing',
    format: (v) => (v === 0 ? 'Straight' : `${Math.max(51, Math.round(50 + v * 25))}%`),
  },
}

/** The touchpad's modes, in the picker's order. */
export const TOUCHPAD_MODES = [
  'filter',
  'throw',
  'lofi',
  'repeat',
] as const satisfies readonly FxMode[]

/** Throw's echo time in each of its X zones, as `THROW_BEATS` lists them. */
const THROW_NOTES = ['1/8', 'Dotted 1/8', '1/4'] as const satisfies {
  length: typeof THROW_BEATS.length
}

/** Repeat's slice in each of its X zones, as `REPEAT_SLICES` lists them. */
const REPEAT_NOTES = ['1/4', '1/8', '1/16', '1/32'] as const satisfies {
  length: typeof REPEAT_SLICES.length
}

/** An axis of a touchpad mode as it reads: its name, and its value in the bubble and to screen readers. */
type AxisReadout = { label: string; format: (v: number) => string }

/** Each touchpad mode's name on its tab, and how its X and Y read. */
export const TOUCHPAD_READOUTS: Record<
  (typeof TOUCHPAD_MODES)[number],
  { label: string; x: AxisReadout; y: AxisReadout }
> = {
  filter: {
    label: 'Filter',
    x: {
      label: 'Cutoff',
      format: (v) =>
        v === 0 ? 'Open' : `${v < 0 ? 'Low-pass' : 'High-pass'} ${Math.max(1, pct(v))}%`,
    },
    y: { label: 'Resonance', format: (v) => `${pct(v)}%` },
  },
  throw: {
    label: 'Throw',
    x: {
      label: 'Time',
      format: (v) => `${THROW_NOTES[throwZone(v)]} echo`,
    },
    y: { label: 'Send', format: (v) => (pct(v) === 0 ? 'Off' : `${pct(v)}%`) },
  },
  lofi: {
    label: 'Lo-fi',
    x: {
      label: 'Rate',
      format: (v) =>
        pct(v) === 0 ? 'Full rate' : `${(lofiCrush(v, 0).rate / 1000).toFixed(1)} kHz`,
    },
    y: { label: 'Bits', format: (v) => `${Math.round(lofiCrush(0, v).bits)}-bit` },
  },
  repeat: {
    label: 'Repeat',
    x: { label: 'Slice', format: (v) => `${REPEAT_NOTES[repeatZone(v)]} slice` },
    y: { label: 'Level', format: (v) => (pct(v) === 0 ? 'Off' : `${pct(v)}%`) },
  },
}
