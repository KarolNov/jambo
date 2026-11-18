import { describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { joinPresence, listPeople } from '../src/board/presence'
import { Me } from '../src/board/seat'

const me = { id: 'me', color: 'teal' } as const
const coral = { id: 'c', color: 'coral' } as const

describe('listPeople', () => {
  it('lists you first, then everyone else once per identity', () => {
    const states = [{ person: coral }, { person: me }, { person: coral }, { person: me }]
    expect(listPeople(states, me)).toEqual([me, coral])
  })

  it('lists only you when nobody else is here', () => {
    expect(listPeople([], me)).toEqual([me])
  })

  it('skips states without a readable person', () => {
    const unknown = { person: { id: 'x', color: 'beige' } }
    expect(listPeople([{}, null, { person: { id: 'x' } }, unknown, { person: coral }], me)).toEqual(
      [me, coral],
    )
  })

  it('reads a person from an older client, whose colour is a hex, by colour name', () => {
    const old = { person: { id: 'c', color: '#FF6B6B', colorName: 'Coral' } }
    expect(listPeople([old], me)).toEqual([me, coral])
  })
})

describe('reading people', () => {
  it('reads a name, and a person from a client older than names without one', () => {
    const named = { person: { id: 'n', name: 'Misty Yak', color: 'teal' } }
    expect(listPeople([named, { person: coral }], me)).toEqual([
      me,
      { id: 'n', name: 'Misty Yak', color: 'teal' },
      coral,
    ])
  })
})

describe('agents', () => {
  const room = {
    agents: [
      { id: 'a1', name: 'Groovy Claude', color: 'sky', kind: 'Claude', summary: 'Beat' },
      { id: 'a2', name: 'Mellow Codex', color: 'pink', kind: 'Codex' },
    ],
  }

  it('lists the agents the room publishes after people, marked as agents', () => {
    expect(listPeople([room, { person: coral }], me)).toEqual([
      me,
      coral,
      { id: 'agent:a1', name: 'Groovy Claude', color: 'sky', agent: { kind: 'Claude' } },
      { id: 'agent:a2', name: 'Mellow Codex', color: 'pink', agent: { kind: 'Codex' } },
    ])
  })

  it('skips agents it cannot read', () => {
    const bad = { agents: [{ id: 'x', color: 'sky' }, { name: 'No Id', color: 'sky' }, null] }
    expect(listPeople([bad], me)).toEqual([me])
  })
})

describe('joinPresence', () => {
  it('shows the name and colour the room seats you with, and leaves when you do', () => {
    const awareness = new Awareness(new Y.Doc())
    const me = new Me({ id: 'me', key: 'k', name: 'Groovy Otter', color: 'sky' })
    const leave = joinPresence(awareness, me)
    expect(awareness.getLocalState()?.person).toBeUndefined()
    me.seat({ name: 'Groovy Otter', color: 'sky' })
    expect(awareness.getLocalState()?.person).toEqual({
      id: 'me',
      name: 'Groovy Otter',
      color: 'sky',
    })
    me.seat({ name: 'Misty Yak', color: 'teal' })
    expect(awareness.getLocalState()?.person).toEqual({
      id: 'me',
      name: 'Misty Yak',
      color: 'teal',
    })
    expect(me.usual).toEqual({ name: 'Groovy Otter', color: 'sky' })
    leave()
    expect(awareness.getLocalState()).toBeNull()
  })
})
