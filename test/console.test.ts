import { describe, expect, it } from 'vitest'
import { BPM } from '../shared/board'
import { namesPeople, personName, uploadedBy } from '../src/board/console/people'
import { TEMPO_RANGE, takeName, tempoFor } from '../src/board/transport'

describe('naming a take', () => {
  it("counts the recorder's own tracks", () => {
    const tracks = [{ author: 'me' }, { author: 'you' }, { author: 'me' }]
    expect(takeName('teal', 'me', tracks)).toBe('Teal 3')
    expect(takeName('coral', 'you', tracks)).toBe('Coral 2')
  })

  it('starts at 1', () => {
    expect(takeName('sky', 'me', [])).toBe('Sky 1')
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

  it('names each person by colour and marks you', () => {
    expect(personName({ id: 'me', color: 'teal' }, 'me')).toBe('Teal (you)')
    expect(personName({ id: 'them', color: 'coral' }, 'me')).toBe('Coral')
  })
})

describe('uploaded sounds', () => {
  it('say who uploaded them', () => {
    expect(uploadedBy({ author: 'them', color: 'coral' }, 'me')).toBe('Uploaded by Coral')
    expect(uploadedBy({ author: 'me', color: 'teal' }, 'me')).toBe('Uploaded by you')
  })
})
