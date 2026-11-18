import { describe, expect, it } from 'vitest'
import { COLOR_NAMES } from '../shared/colors'
import { ANIMALS, NAME_MAX, randomName, toName } from '../shared/names'
import {
  assignColor,
  assignName,
  assignSeat,
  hello,
  parseSeatMessage,
  seated,
} from '../shared/seats'
import { ADJECTIVES } from '../shared/words'

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

describe('assigning a name', () => {
  const picks =
    (...names: string[]) =>
    () =>
      names.shift() ?? 'Out Of Names'

  it('gives your usual name when nobody here has it', () => {
    expect(assignName([{ id: 'a', name: 'Jolly Owl' }], 'me', 'Groovy Otter')).toBe('Groovy Otter')
  })

  it('picks another name nobody here has when yours is taken, ignoring case', () => {
    const others = [
      { id: 'a', name: 'Groovy Otter' },
      { id: 'b', name: 'Jolly Owl' },
    ]
    expect(assignName(others, 'me', 'groovy otter', picks('Jolly Owl', 'Misty Yak'))).toBe(
      'Misty Yak',
    )
  })

  it('gives the name you already have in another tab', () => {
    expect(assignName([{ id: 'me', name: 'Misty Yak' }], 'me', 'Groovy Otter')).toBe('Misty Yak')
  })

  it('never repeats a name, even when colours have to', () => {
    const others = COLOR_NAMES.map((c, i) => ({ id: `p${i}`, name: `Name ${i}`, color: c }))
    const mine = assignSeat(
      others,
      'me',
      { name: 'Name 3', color: 'sky' },
      picks('Name 5', 'Fresh'),
    )
    expect(mine).toEqual({ id: 'me', name: 'Fresh', color: 'sky' })
  })
})

describe('names', () => {
  it('are a fun adjective and an animal', () => {
    expect(randomName(() => 0)).toBe('Funky Otter')
    const name = randomName()
    const [adjective, animal] = name.toLowerCase().split(' ')
    expect(ADJECTIVES).toContain(adjective)
    expect(ANIMALS).toContain(animal)
  })

  it('always fit', () => {
    const longest =
      Math.max(...ADJECTIVES.map((a) => a.length)) + 1 + Math.max(...ANIMALS.map((a) => a.length))
    expect(longest).toBeLessThanOrEqual(NAME_MAX)
  })

  it('read only when they fit', () => {
    expect(toName('  Groovy Otter ')).toBe('Groovy Otter')
    expect(toName('')).toBeUndefined()
    expect(toName('x'.repeat(NAME_MAX + 1))).toBeUndefined()
    expect(toName(7)).toBeUndefined()
  })
})

describe('seat messages', () => {
  it('round-trip', () => {
    expect(parseSeatMessage(hello('me', 'Groovy Otter', 'sky'))).toEqual({
      t: 'hello',
      id: 'me',
      name: 'Groovy Otter',
      color: 'sky',
    })
    expect(parseSeatMessage(seated({ name: 'Misty Yak', color: 'teal' }))).toEqual({
      t: 'seat',
      name: 'Misty Yak',
      color: 'teal',
    })
  })

  it('reject anything else', () => {
    const msg = (m: object) => JSON.stringify(m)
    expect(parseSeatMessage('not json')).toBeUndefined()
    expect(
      parseSeatMessage(msg({ t: 'hello', id: 'me', name: 'A B', color: 'beige' })),
    ).toBeUndefined()
    expect(parseSeatMessage(msg({ t: 'hello', id: '', name: 'A B', color: 'sky' }))).toBeUndefined()
    expect(parseSeatMessage(msg({ t: 'hello', id: 'me', color: 'sky' }))).toBeUndefined()
    expect(parseSeatMessage(msg({ t: 'ping', c: 1 }))).toBeUndefined()
  })
})
