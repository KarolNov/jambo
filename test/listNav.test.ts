import { describe, expect, it } from 'vitest'
import { initialIndex, navKey, stepIndex } from '../src/ui/listNav'

const opts = [
  { value: 'a' },
  { value: 'b', disabled: true },
  { value: 'c' },
  { value: 'd' },
  { value: 'e', disabled: true },
]

describe('list keyboard navigation', () => {
  it('moves to the next enabled option, skipping disabled ones and wrapping', () => {
    expect(stepIndex(opts, 0, 1)).toBe(2)
    expect(stepIndex(opts, 3, 1)).toBe(0)
    expect(stepIndex(opts, 0, -1)).toBe(3)
    expect(stepIndex(opts, 2, -1)).toBe(0)
  })

  it('stays put when nothing else can be picked', () => {
    expect(stepIndex([{ disabled: true }, {}], 1, 1)).toBe(1)
    expect(stepIndex([{ disabled: true }], 0, 1)).toBe(0)
  })

  it('opens on the current value, or the first enabled option', () => {
    expect(initialIndex(opts, 'c')).toBe(2)
    expect(initialIndex(opts, 'b')).toBe(0)
    expect(initialIndex(opts, 'zzz')).toBe(0)
  })

  it('maps keys to moves and picks', () => {
    expect(navKey('ArrowDown', opts, 0)).toBe(2)
    expect(navKey('ArrowUp', opts, 2)).toBe(0)
    expect(navKey('Home', opts, 3)).toBe(0)
    expect(navKey('End', opts, 0)).toBe(3)
    expect(navKey('Enter', opts, 2)).toBe('pick')
    expect(navKey(' ', opts, 2)).toBe('pick')
    expect(navKey('Enter', opts, 1)).toBeUndefined()
    expect(navKey('x', opts, 0)).toBeUndefined()
  })
})
