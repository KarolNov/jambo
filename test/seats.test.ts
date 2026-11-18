import { describe, expect, it } from 'vitest'
import { COLOR_NAMES } from '../shared/colors'
import { assignColor, hello, parseSeatMessage, seated } from '../shared/seats'

const seat = (id: string, color: (typeof COLOR_NAMES)[number]) => ({ id, color })

describe('assigning a colour', () => {
  it('gives your usual colour when nobody here has it', () => {
    expect(assignColor([seat('a', 'teal')], 'me', 'sky')).toBe('sky')
    expect(assignColor([], 'me', 'sky')).toBe('sky')
  })

  it('gives the first free colour when someone here has yours', () => {
    expect(assignColor([seat('a', 'sky')], 'me', 'sky')).toBe('teal')
    expect(assignColor([seat('a', 'sky'), seat('b', 'teal')], 'me', 'sky')).toBe('coral')
  })

  it('gives the colour you already have in another tab', () => {
    expect(assignColor([seat('a', 'sky'), seat('me', 'teal')], 'me', 'sky')).toBe('teal')
  })

  it('counts a person once, however many tabs they have open', () => {
    const others = COLOR_NAMES.slice(1).map((c, i) => seat(`p${i}`, c))
    // Seven people, one in two tabs: teal is still free.
    expect(assignColor([...others, seat('p0', 'coral')], 'me', 'sky')).toBe('teal')
  })

  it('past eight people, gives the least used colour, yours on a tie', () => {
    const full = COLOR_NAMES.map((c, i) => seat(`p${i}`, c))
    expect(assignColor(full, 'me', 'sky')).toBe('sky')
    expect(assignColor([...full, seat('p9', 'sky')], 'me', 'sky')).toBe('teal')
  })
})

describe('seat messages', () => {
  it('round-trip', () => {
    expect(parseSeatMessage(hello('me', 'sky'))).toEqual({ t: 'hello', id: 'me', color: 'sky' })
    expect(parseSeatMessage(seated('teal'))).toEqual({ t: 'seat', color: 'teal' })
  })

  it('reject anything else', () => {
    expect(parseSeatMessage('not json')).toBeUndefined()
    expect(
      parseSeatMessage(JSON.stringify({ t: 'hello', id: 'me', color: 'beige' })),
    ).toBeUndefined()
    expect(parseSeatMessage(JSON.stringify({ t: 'hello', id: '', color: 'sky' }))).toBeUndefined()
    expect(parseSeatMessage(JSON.stringify({ t: 'ping', c: 1 }))).toBeUndefined()
  })
})
