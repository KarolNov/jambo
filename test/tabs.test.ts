import { describe, expect, it } from 'vitest'
import { TAB_GAP, visibleTabs } from '../src/ui/tabFit'

const W = [60, 100, 80, 70, 60, 50] // six tabs: 420 wide, 450 with their gaps (6 px)
const MORE = 40

describe('folder tabs fitting their strip', () => {
  it('shows every tab while they fit', () => {
    expect(visibleTabs(W, 0, 420 + 5 * TAB_GAP, MORE)).toEqual([0, 1, 2, 3, 4, 5])
  })

  // @scenario ui: Phone
  it('shows as many of the first tabs as fit beside "+N"', () => {
    // 60 + 100 + 80 + 2 gaps = 252, + gap + 40 = 298
    expect(visibleTabs(W, 0, 300, MORE)).toEqual([0, 1, 2])
  })

  // @scenario ui: Pick from +N
  it('keeps the selected tab in view, in place of the last one that fits', () => {
    expect(visibleTabs(W, 4, 300, MORE)).toEqual([0, 1, 4])
  })

  it('shows at least the selected tab', () => {
    expect(visibleTabs(W, 3, 50, MORE)).toEqual([3])
  })

  it('has nothing to fit with no tabs', () => {
    expect(visibleTabs([], 0, 100, MORE)).toEqual([])
  })
})
