import { describe, expect, it } from 'vitest'
import { BPM } from '../shared/board'
import { namesPeople, personName, uploadedBy } from '../src/board/console/people'
import { TEMPO_RANGE, takeName, tempoFor } from '../src/board/transport'

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

  it('uploaded before names say the colour', () => {
    expect(uploadedBy({ author: 'them', color: 'coral' }, 'me')).toBe('Uploaded by Coral')
  })
})
