import { describe, expect, it, vi } from 'vitest'
import { applyAwarenessUpdate, Awareness, encodeAwarenessUpdate } from 'y-protocols/awareness'
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
  // @scenario board/session: Two tabs
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

  // @scenario board/session: An agent joins
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

  // @scenario board/session: Browser posing as an agent
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
  /** This tab: client 5. */
  const self = { id: me.id, clientID: 5 }
  const sky = { id: 's', color: 'sky' } as const
  const states = (...list: [number, unknown][]) => list

  // @scenario board/session: Someone turns the reverb
  it('names who else is turning each control', () => {
    const held = states([1, { person: coral, control: knob }], [2, { person: sky }])
    expect(listHolders(held, self)).toEqual(new Map([[knob, coral]]))
  })

  it('never lists you, even turning it from another tab', () => {
    expect(listHolders(states([5, { person: me, control: knob }]), self).size).toBe(0)
    expect(listHolders(states([1, { person: me, control: knob }]), self).size).toBe(0)
  })

  // @scenario board/session: Holder drops
  it("lets go of a control within about 30 seconds of its holder's connection dropping", () => {
    vi.useFakeTimers()
    try {
      const mine = new Awareness(new Y.Doc())
      const theirDoc = new Y.Doc()
      const theirs = new Awareness(theirDoc)
      theirs.setLocalState({ person: coral, control: knob })
      applyAwarenessUpdate(mine, encodeAwarenessUpdate(theirs, [theirDoc.clientID]), 'net')
      const here = { id: me.id, clientID: mine.clientID }
      expect(listHolders(mine.getStates(), here).get(knob)).toEqual(coral)
      // Their connection drops: nothing more arrives from them. Awareness reads the clock through
      // lib0, which holds the real `Date.now`, so age their last update instead of faking the clock.
      theirs.destroy()
      const silentFor = (ms: number) => {
        mine.meta.get(theirDoc.clientID)!.lastUpdated -= ms
        vi.advanceTimersByTime(3_000) // One run of awareness's timeout check.
      }
      silentFor(25_000)
      expect(listHolders(mine.getStates(), here).get(knob)).toEqual(coral)
      silentFor(6_000)
      expect(listHolders(mine.getStates(), here).has(knob)).toBe(false)
      mine.destroy()
    } finally {
      vi.useRealTimers()
    }
  })

  // @scenario board/session: Grab at once
  it('gives a control two people grab at once to the lower client id', () => {
    const both = states([7, { person: sky, control: knob }], [3, { person: coral, control: knob }])
    expect(listHolders(both, self).get(knob)).toEqual(coral)
  })

  it('lists who beat this tab to a control, and nobody when this tab wins', () => {
    const lost = states([5, { person: me, control: knob }], [3, { person: coral, control: knob }])
    expect(listHolders(lost, self).get(knob)).toEqual(coral)
    const won = states([5, { person: me, control: knob }], [9, { person: coral, control: knob }])
    expect(listHolders(won, self).size).toBe(0)
  })

  it("doesn't let your other tab win a control from someone else", () => {
    const tabs = states([1, { person: me, control: knob }], [3, { person: coral, control: knob }])
    expect(listHolders(tabs, self).get(knob)).toEqual(coral)
  })

  it('skips a control without a readable person, and agents', () => {
    const held = states(
      [1, { control: knob }],
      [2, { person: { id: 'agent:a', color: 'sky' }, control: knob }],
    )
    expect(listHolders(held, self).size).toBe(0)
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

  // @scenario board/session: Let go
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
