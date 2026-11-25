import { describe, expect, it } from 'vitest'
import { QUANTIZE } from '../shared/board'
import {
  beatPosition,
  loopSummary,
  SNAP_OPTIONS,
  SOUND_READOUTS,
  snapLabel,
  soundChanged,
  TOUCHPAD_READOUTS,
} from '../src/board/console/loops'

describe('the mixer', () => {
  it("reads the filter's cutoff as Open only at exactly 0", () => {
    const cutoff = TOUCHPAD_READOUTS.filter.x.format
    expect(cutoff(0)).toBe('Open')
    expect(cutoff(-0.004)).toBe('Low-pass 1%')
    expect(cutoff(0.6)).toBe('High-pass 60%')
  })

  it('names every snap setting the board allows', () => {
    expect(SNAP_OPTIONS.map((o) => o.label)).toEqual(['Off', '1/32', '1/16', '1/8', '1/4'])
    expect(SNAP_OPTIONS.map((o) => Number(o.value))).toEqual([...QUANTIZE])
    expect(snapLabel(0.25)).toBe('1/16')
  })

  it('sums a loop up in bars and hits, singular when there is one', () => {
    expect(loopSummary(2, 6)).toBe('2 bars · 6 hits')
    expect(loopSummary(1, 1)).toBe('1 bar · 1 hit')
    expect(loopSummary(4, 0)).toBe('4 bars · 0 hits')
  })

  it('places beats across the whole loop', () => {
    expect(beatPosition(0, 2)).toBe('0%')
    expect(beatPosition(4, 2)).toBe('50%')
    expect(beatPosition(1, 1)).toBe('25%')
  })

  it('reads each sound knob the way the strip shows it', () => {
    const read = (k: keyof typeof SOUND_READOUTS, v: number) => SOUND_READOUTS[k].format(v)
    expect(read('reverb', 0.4)).toBe('40%')
    expect(read('echo', 0)).toBe('0%')
    expect(read('tone', -0.4)).toBe('Dark 40%')
    expect(read('tone', 0)).toBe('Flat')
    expect(read('tone', 0.004)).toBe('Flat')
    expect(read('tone', 0.4)).toBe('Bright 40%')
    expect(read('pitch', 3)).toBe('+3')
    expect(read('pitch', 0)).toBe('0')
    expect(read('pitch', -0)).toBe('0')
    expect(read('pitch', -5)).toBe('-5')
    expect(read('pan', -0.3)).toBe('L 30')
    expect(read('pan', 0)).toBe('C')
    expect(read('pan', 0.3)).toBe('R 30')
  })

  // @scenario audio/looper: Changed loop at a glance
  it('marks a loop whose sound is away from the defaults', () => {
    expect(soundChanged({})).toBe(false)
    expect(soundChanged({ reverb: 0, pitch: 0 })).toBe(false)
    expect(soundChanged({ tone: -0.4 })).toBe(true)
    expect(soundChanged({ pitch: 1 })).toBe(true)
  })
})
