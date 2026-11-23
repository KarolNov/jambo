import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Deck } from '../../src/board/console/Deck'
import { Mixer } from '../../src/board/console/Mixer'
import { bpmAtom, tracksAtom } from '../../src/board/model'
import type { Session } from '../../src/board/session'
import { addTrack, endSession, makeSession, mockServer, renderJam, SLUG } from './jam'

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
})
