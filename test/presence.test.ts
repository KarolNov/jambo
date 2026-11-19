import { describe, expect, it } from 'vitest'
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import {
  controlKey,
  holdControl,
  joinPresence,
  listHolders,
  listPeople,
} from '../src/board/presence'
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
      { id: 'agent:a1', name: 'Groovy Claude', color: 'sky', agent: true },
      { id: 'agent:a2', name: 'Mellow Codex', color: 'pink', agent: true },
    ])
  })

  it('lists an agent once when two room states carry it', () => {
    expect(listPeople([room, room], me).map((p) => p.id)).toEqual([me.id, 'agent:a1', 'agent:a2'])
  })

  it('takes agents only from the room, and no person as an agent', () => {
    const spoof = { person: coral, agents: [{ id: 'x', name: 'Evil Claude', color: 'sky' }] }
    const fake = { person: { id: 'agent:a1', name: 'Evil Claude', color: 'sky' } }
    expect(listPeople([spoof, fake], me)).toEqual([me, coral])
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

describe('listHolders', () => {
  const knob = controlKey('t1', 'reverb')

  it('names who else is turning each control', () => {
    const states = [{ person: coral, control: knob }, { person: { id: 'x', color: 'sky' } }]
    expect(listHolders(states, me.id)).toEqual(new Map([[knob, coral]]))
  })

  it('never lists you, even turning it from another tab', () => {
    expect(listHolders([{ person: me, control: knob }], me.id).size).toBe(0)
  })

  it('keeps the first person on a control two people turn at once', () => {
    const sky = { id: 's', color: 'sky' } as const
    const states = [
      { person: coral, control: knob },
      { person: sky, control: knob },
    ]
    expect(listHolders(states, me.id).get(knob)).toEqual(coral)
  })

  it('skips a control without a readable person, and agents', () => {
    const states = [{ control: knob }, { person: { id: 'agent:a', color: 'sky' }, control: knob }]
    expect(listHolders(states, me.id).size).toBe(0)
  })
})

describe('holdControl', () => {
  const seated = () => {
    const awareness = new Awareness(new Y.Doc())
    const me = new Me({ id: 'me', key: 'k', name: 'Groovy Otter', color: 'sky' })
    const leave = joinPresence(awareness, me)
    me.seat({ name: 'Groovy Otter', color: 'sky' })
    return { awareness, me, leave }
  }

  it('publishes the control while held and clears it when let go, keeping the person', () => {
    const { awareness } = seated()
    holdControl(awareness, 't1.gain', true)
    expect(awareness.getLocalState()?.control).toBe('t1.gain')
    holdControl(awareness, 't1.gain', false)
    expect(awareness.getLocalState()).not.toHaveProperty('control')
    expect(awareness.getLocalState()?.person).toMatchObject({ id: 'me' })
  })

  it('keeps the person and the held control when the room renames you mid-drag', () => {
    const { awareness, me } = seated()
    holdControl(awareness, 't1.gain', true)
    me.seat({ name: 'Misty Yak', color: 'teal' })
    expect(awareness.getLocalState()).toMatchObject({
      person: { name: 'Misty Yak' },
      control: 't1.gain',
    })
  })

  it('leaves a newer control alone when an older one is let go', () => {
    const { awareness } = seated()
    holdControl(awareness, 't1.gain', true)
    holdControl(awareness, 't1.reverb', true)
    holdControl(awareness, 't1.gain', false)
    expect(awareness.getLocalState()?.control).toBe('t1.reverb')
  })

  it('does nothing after you leave the jam', () => {
    const { awareness, leave } = seated()
    leave()
    holdControl(awareness, 't1.gain', true)
    expect(awareness.getLocalState()).toBeNull()
  })
})
