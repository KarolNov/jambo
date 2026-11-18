/** The mixer's wording and geometry, kept apart from React so it can be tested. */
import { BEATS_PER_BAR, QUANTIZE } from '../../../shared/board'

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
