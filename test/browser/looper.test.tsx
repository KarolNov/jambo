import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { Deck } from '../../src/board/console/Deck'
import { Mixer } from '../../src/board/console/Mixer'
import { bpmAtom, tracksAtom } from '../../src/board/model'
import type { Session } from '../../src/board/session'
import { addTrack, agreeClock, endSession, makeSession, mockServer, renderJam, SLUG } from './jam'

let session: Session

beforeEach(() => {
  mockServer()
  session = makeSession()
})

afterEach(() => {
  endSession(session)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const bpm = () => session.jam.store.get(bpmAtom)
const tempoField = () => page.getByRole('textbox', { name: 'Tempo in BPM' })

describe('track name', () => {
  // @scenario audio/looper: Blank name
  it('shows an error for a cleared name and keeps the old one', async () => {
    const id = addTrack(session, { name: 'Bassline' })
    await renderJam(<Mixer />, session)
    const name = page.getByRole('textbox', { name: 'Loop name' })

    await userEvent.clear(name)
    await expect.element(name).toHaveAttribute('aria-invalid', 'true')
    await expect.element(page.getByRole('alert')).toHaveTextContent('A track needs a name')
    expect(session.jam.store.get(tracksAtom).get(id)?.name).toBe('Bassline')

    // Leaving the field shows the name it kept.
    await userEvent.tab()
    await expect.element(name).toHaveValue('Bassline')
  })
})

describe('tempo', () => {
  // @scenario audio/looper: Cancel an edit
  it('stays as it was after Escape, or after clearing the field and leaving it', async () => {
    await renderJam(<Deck slug={SLUG} />, session)
    expect(bpm()).toBe(100)

    await userEvent.fill(tempoField(), '130')
    await userEvent.keyboard('{Escape}')
    expect(bpm()).toBe(100)
    await expect.element(tempoField()).toHaveValue('100')

    await userEvent.clear(tempoField())
    await userEvent.tab()
    expect(bpm()).toBe(100)
    await expect.element(tempoField()).toHaveValue('100')
  })

  // @scenario audio/looper: Locked by tracks
  it('ignores every tap while the jam has a track, and says why', async () => {
    addTrack(session)
    const tip = page.getByText(
      "Tempo is locked while the jam has loops, since they're all timed to it",
    )
    // Disabled parts let the tap through to the row; force skips Playwright's wait for enabled.
    const taps = [
      () => page.getByRole('button', { name: 'Slower' }),
      () => page.getByRole('button', { name: 'Faster' }),
      tempoField,
      // The BPM label: the readout above also says BPM, so find it by its class.
      () => page.elementLocator(document.querySelector('.ui-scrub-label')!),
      () => page.getByRole('button', { name: 'Why is the tempo locked?' }),
    ]
    for (const target of taps) {
      // A fresh deck for each tap, so each one has to bring the note up itself.
      const { screen } = await renderJam(<Deck slug={SLUG} />, session)
      await expect.element(tip).not.toBeInTheDocument()
      await userEvent.click(target(), { force: true })
      expect(bpm()).toBe(100)
      await expect.element(tip).toBeVisible()
      await expect.element(tempoField()).toHaveValue('100')
      await screen.unmount()
    }
  })

  // @scenario audio/looper: Locked while recording
  it('is disabled from the count-in on, for the person recording', async () => {
    agreeClock(session)
    await renderJam(<Deck slug={SLUG} />, session)
    await expect.element(tempoField()).toBeEnabled()
    await userEvent.click(page.getByRole('button', { name: 'Record' }))
    await expect.element(tempoField()).toBeDisabled()
    await expect.element(page.getByRole('button', { name: 'Faster' })).toBeDisabled()
  })
})

describe('record', () => {
  // @scenario audio/looper: First press
  it('starts audio and the count-in on the first press', async () => {
    agreeClock(session)
    await renderJam(<Deck slug={SLUG} />, session)
    expect(session.engine.ready).toBe(false)
    await userEvent.click(page.getByRole('button', { name: 'Record' }))
    await expect.poll(() => session.engine.state.phase).not.toBe('idle')
    expect(session.engine.ready).toBe(true)
  })

  // @scenario audio/looper: Record right after opening
  it('says it is syncing until the clock is agreed, then records', async () => {
    await renderJam(<Deck slug={SLUG} />, session)
    const syncing = page.getByRole('button', { name: 'Syncing…' })
    await expect.element(syncing).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(syncing)
    await expect.poll(() => session.engine.ready).toBe(true)
    expect(session.engine.state.phase).toBe('idle')

    agreeClock(session)
    const record = page.getByRole('button', { name: 'Record' })
    await expect.element(record).toHaveAttribute('aria-busy', 'false')
    await userEvent.click(record)
    await expect.poll(() => session.engine.state.phase).not.toBe('idle')
  })

  // @scenario audio/looper: Stop during the count-in
  it('adds no track and says nothing was recorded when stopped before the take begins', async () => {
    agreeClock(session)
    await renderJam(<Deck slug={SLUG} />, session)
    await userEvent.click(page.getByRole('button', { name: 'Record' }))
    await expect.poll(() => session.engine.state.phase).not.toBe('idle')
    expect(session.engine.state.phase).not.toBe('recording')

    await userEvent.click(page.getByRole('button', { name: /\(stop\)$/ }))
    expect(session.engine.state.phase).toBe('idle')
    await expect.element(page.getByText('Nothing recorded')).toBeVisible()
    expect(session.jam.store.get(tracksAtom).size).toBe(0)
  })
})

describe('scrub the tempo', () => {
  let pressed = false
  afterEach(async () => {
    if (pressed) await commands.mouseUp()
    pressed = false
  })

  // @scenario audio/looper: Scrub the tempo
  it('applies the scrubbed tempo once, when the label is let go', async () => {
    await renderJam(<Deck slug={SLUG} />, session)
    const tempo = vi.spyOn(session.board, 'tempo')
    const at = await commands.mouseDown('.ui-scrub-label')
    pressed = true
    // Right, a pixel at a time, until the field reads 112 (the test page may be scaled).
    const shown = () => (tempoField().element() as HTMLInputElement).value
    for (let dx = 1; dx < 200 && shown() !== '112'; dx++)
      await commands.mouseMove(at.x + dx, at.y, 1)
    expect(shown()).toBe('112')
    expect(tempo).not.toHaveBeenCalled()
    expect(bpm()).toBe(100)

    await commands.mouseUp()
    pressed = false
    await expect.poll(bpm).toBe(112)
    expect(tempo).toHaveBeenCalledTimes(1)
    expect(tempo).toHaveBeenCalledWith(112)
  })
})

describe('a take, in real time', () => {
  const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

  // @scenario audio/looper: Record
  // @scenario audio/looper: Your own take
  it('turns four hits into a new track at their beats, which loops on in time', async () => {
    // 120 BPM: half a second a beat, two seconds a bar.
    expect(session.board.tempo(120).ok).toBe(true)
    agreeClock(session)
    await renderJam(<Deck slug={SLUG} />, session)
    const { engine } = session
    const beatMs = 500

    await userEvent.click(page.getByRole('button', { name: 'Record' }))
    await expect.poll(() => engine.state.phase, { timeout: 6000 }).toBe('recording')
    const rec = engine.state
    if (rec.phase === 'idle') throw new Error('not recording')

    for (let n = 0; n < 4; n++) {
      if (n) await wait(beatMs)
      await userEvent.keyboard('1')
    }
    const played = engine.take()!.hits
    expect(played).toHaveLength(4)
    await userEvent.click(page.getByRole('button', { name: 'Stop' }))

    // Record: one new track holding the four hits, on the kick's pad, a beat apart as played.
    const tracks = [...session.jam.store.get(tracksAtom)]
    expect(tracks).toHaveLength(1)
    const [id, track] = tracks[0]!
    expect(track.author).toBe(session.me.id)
    expect(track.bars).toBe(1)
    expect(track.hits).toEqual(played.map((h) => ({ padId: 'r0c0', beat: Math.max(0, h.beat) })))
    for (let n = 1; n < 4; n++)
      expect(Math.abs(track.hits[n]!.beat - track.hits[n - 1]!.beat - 1)).toBeLessThan(0.2)

    // Your own take: the loop goes on from where the take is, on the take's own bar grid.
    await wait(300)
    const position = engine.position(id)
    expect(position).toBeDefined()
    const bar = 4 * beatMs
    const expected = ((engine.clock.now()! - rec.recordStart) % bar) / bar
    // As heard, so allow for the output's latency: within a tenth of a bar, either side of the wrap.
    const off = Math.abs(position! - expected)
    expect(Math.min(off, 1 - off)).toBeLessThan(0.1)
  })
})
