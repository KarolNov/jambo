import { describe, expect, it } from 'vitest'
import { listPeople } from '../src/board/presence'

const me = { id: 'me', color: '#2ab7ca', colorName: 'Teal' }
const coral = { id: 'c', color: '#ff6b6b', colorName: 'Coral' }

describe('listPeople', () => {
  it('lists you first, then everyone else once per identity', () => {
    const states = [{ person: coral }, { person: me }, { person: coral }, { person: me }]
    expect(listPeople(states, me)).toEqual([me, coral])
  })

  it('lists only you when nobody else is here', () => {
    expect(listPeople([], me)).toEqual([me])
  })

  it('skips states without a readable person', () => {
    expect(listPeople([{}, null, { person: { id: 'x' } }, { person: coral }], me)).toEqual([
      me,
      coral,
    ])
  })
})
