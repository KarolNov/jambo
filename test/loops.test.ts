import { describe, expect, it } from 'vitest'
import { QUANTIZE } from '../shared/board'
import { beatPosition, loopSummary, SNAP_OPTIONS, snapLabel } from '../src/board/console/loops'

describe('the mixer', () => {
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
})
