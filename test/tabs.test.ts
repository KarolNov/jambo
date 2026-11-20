import { describe, expect, it } from 'vitest'
import { TAB_GAP, tabStep } from '../src/ui/tabFit'

describe('folder tabs fitting their strip', () => {
  it('keeps the gap while the tabs fit', () => {
    expect(tabStep([60, 80, 70], 400, 12)).toBe(TAB_GAP)
  })

  it('closes the gap, then overlaps, just enough to fit', () => {
    // 210 of tabs in 214: 2 px between each.
    expect(tabStep([60, 80, 70], 214, 12)).toBe(2)
    // 210 of tabs in 190: each neighbour covers 10 px.
    expect(tabStep([60, 80, 70], 190, 12)).toBe(-10)
  })

  it('overlaps no further than the side padding, so labels stay readable; the strip scrolls past that', () => {
    expect(tabStep([60, 80, 70], 50, 12)).toBe(-12)
  })

  it('has nothing to fit with one tab or none', () => {
    expect(tabStep([120], 40, 12)).toBe(TAB_GAP)
    expect(tabStep([], 40, 12)).toBe(TAB_GAP)
  })
})
