import { describe, expect, it } from 'vitest'
import { BPM, LIMITS } from '../shared/board'
import { byAgent, namesPeople, personName, uploadedBy } from '../src/board/console/people'
import { TEMPO_RANGE, takeMarks, takeName, takeView, tempoFor } from '../src/board/transport'

describe('naming a take', () => {
  it("is the recorder's name and the next number after the jam's takes with it", () => {
    const tracks = [{ name: 'Groovy Otter 1' }, { name: 'Misty Yak 1' }, { name: 'Groovy Otter 2' }]
    expect(takeName('Groovy Otter', tracks)).toBe('Groovy Otter 3')
    expect(takeName('Misty Yak', tracks)).toBe('Misty Yak 2')
  })

  it('starts at 1, and ignores names that only start the same', () => {
    expect(takeName('Groovy Otter', [])).toBe('Groovy Otter 1')
    expect(takeName('Groovy Otter', [{ name: 'Groovy Otter Remix' }, { name: 'Groovy 9' }])).toBe(
      'Groovy Otter 1',
    )
  })
})

describe('the take lane', () => {
  it('waits, then counts the count-in bar 1 to 4', () => {
    expect(takeView(-6)).toEqual({ stage: 'waiting' })
    expect(takeView(-4)).toEqual({ stage: 'count-in', count: 1 })
    expect(takeView(-2.5)).toEqual({ stage: 'count-in', count: 2 })
    expect(takeView(-0.01)).toEqual({ stage: 'count-in', count: 4 })
  })

  it('shows the bar and beat recorded, on a lane that grows a bar at a time', () => {
    expect(takeView(0)).toEqual({ stage: 'recording', bar: 1, beat: 1, bars: 1 })
    expect(takeView(3.9)).toEqual({ stage: 'recording', bar: 1, beat: 4, bars: 1 })
    expect(takeView(5.2)).toEqual({ stage: 'recording', bar: 2, beat: 2, bars: 2 })
  })

  it('stops growing the lane at the longest loop', () => {
    const view = takeView(LIMITS.bars * 4 + 1)
    expect(view).toMatchObject({ bar: LIMITS.bars + 1, bars: LIMITS.bars })
  })

  it('puts hits where they will play: snapped to 1/16, an early one on the first beat', () => {
    const hits = [
      { padId: 'a', beat: -0.2 },
      { padId: 'b', beat: 1.1 },
      { padId: 'c', beat: 2.4 },
    ]
    expect(takeMarks(hits, 1)).toEqual([
      { padId: 'a', beat: 0 },
      { padId: 'b', beat: 1 },
      { padId: 'c', beat: 2.5 },
    ])
  })

  it('leaves out hits too early for the take and past the lane', () => {
    const hits = [
      { padId: 'a', beat: -1 },
      { padId: 'b', beat: 3.9 },
    ]
    expect(takeMarks(hits, 1)).toEqual([])
    expect(takeMarks(hits, 2)).toEqual([{ padId: 'b', beat: 4 }])
  })
})

describe('typing a tempo', () => {
  it('sets a tempo in range as typed', () => {
    expect(tempoFor(120, 100)).toEqual({ bpm: 120, clamped: false })
  })

  it('holds the tempo to its range and says so', () => {
    expect(tempoFor(300, 100)).toEqual({ bpm: BPM.max, clamped: true })
    expect(tempoFor(5, 100)).toEqual({ bpm: BPM.min, clamped: true })
    expect(TEMPO_RANGE).toBe('Tempo is 40–240 BPM')
  })

  it('changes nothing for the current tempo or no number', () => {
    expect(tempoFor(100, 100)).toBeUndefined()
    expect(tempoFor(Number.NaN, 100)).toBeUndefined()
  })
})

describe("who's here", () => {
  it('names people while there are three or fewer, then shows only dots', () => {
    expect(namesPeople(1)).toBe(true)
    expect(namesPeople(3)).toBe(true)
    expect(namesPeople(4)).toBe(false)
  })

  it('names each person and marks you', () => {
    expect(personName({ id: 'me', name: 'Groovy Otter', color: 'teal' }, 'me')).toBe(
      'Groovy Otter (you)',
    )
    expect(personName({ id: 'them', name: 'Misty Yak', color: 'coral' }, 'me')).toBe('Misty Yak')
  })

  it('names a client older than names by its colour', () => {
    expect(personName({ id: 'them', color: 'coral' }, 'me')).toBe('Coral')
  })
})

describe('uploaded sounds', () => {
  it('say who uploaded them', () => {
    expect(uploadedBy({ author: 'them', authorName: 'Misty Yak', color: 'coral' }, 'me')).toBe(
      'Uploaded by Misty Yak',
    )
    expect(uploadedBy({ author: 'me', authorName: 'Groovy Otter', color: 'teal' }, 'me')).toBe(
      'Uploaded by you',
    )
  })

  it('uploaded by an agent name the agent', () => {
    const sound = { author: 'agent:a1', authorName: 'Groovy Claude', color: 'sky' } as const
    expect(uploadedBy(sound, 'me')).toBe('Uploaded by Groovy Claude')
    expect(byAgent(sound)).toBe(true)
  })

  it('uploaded before names say the colour', () => {
    expect(uploadedBy({ author: 'them', color: 'coral' }, 'me')).toBe('Uploaded by Coral')
  })
})

describe('agent loops', () => {
  it('are marked; loops people recorded are not', () => {
    expect(byAgent({ author: 'agent:a1' })).toBe(true)
    expect(byAgent({ author: 'p1' })).toBe(false)
  })
})
