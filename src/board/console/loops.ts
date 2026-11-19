/** The mixer's wording and geometry, kept apart from React so it can be tested. */
import {
  BEATS_PER_BAR,
  QUANTIZE,
  SOUND_KNOB_NAMES,
  SOUND_KNOBS,
  type SoundKnob,
  soundOf,
} from '../../../shared/board'

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
