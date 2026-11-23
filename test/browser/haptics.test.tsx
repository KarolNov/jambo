import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { Deck } from '../../src/board/console/Deck'
import { board } from '../../shared/board'
import { Mixer } from '../../src/board/console/Mixer'
import { tracksAtom } from '../../src/board/model'
import type { Session } from '../../src/board/session'
import { addTrack, endSession, makeSession, mockServer, renderJam, SLUG } from './jam'

let session: Session
let vibrate: MockInstance<Navigator['vibrate']>

/** An Android phone: a touchscreen (a coarse pointer) and the Vibration API. */
function android() {
  const real = window.matchMedia.bind(window)
  vi.stubGlobal('matchMedia', (query: string) => {
    const list = real(query)
    // The real list, so its media and listeners still work; only `matches` is the phone's.
    if (query === '(any-pointer: coarse)') Object.defineProperty(list, 'matches', { value: true })
    return list
  })
  vibrate = vi.spyOn(Navigator.prototype, 'vibrate').mockReturnValue(true)
}

beforeEach(() => {
  mockServer()
  android()
  session = makeSession()
})

afterEach(() => {
  endSession(session)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('haptics', () => {
  // @scenario ui: Press a pad
  it("ticks when someone taps a pad, and not when a loop's hit lights it", async () => {
    const track = addTrack(session)
    const { screen } = await renderJam(<Deck slug={SLUG} />, session)
    vi.spyOn(session.engine, 'unlock').mockResolvedValue(undefined)
    const kick = page.getByRole('button', { name: /^1 Kick/ })

    await userEvent.click(kick)
    expect(vibrate).toHaveBeenCalledTimes(1)

    // The loop's hit, as the engine announces it when it is heard.
    vibrate.mockClear()
    session.engine['announce']({ padId: 'r0c0', trackId: track })
    const el = screen.container.querySelector('[aria-keyshortcuts="1"]')!
    expect(el.classList.contains('glow')).toBe(true)
    expect(vibrate).not.toHaveBeenCalled()
  })

  // @scenario ui: Someone else's change
  it("doesn't tick when another person sets a loop's level to unity", async () => {
    const id = addTrack(session, { name: 'Bassline', gain: 0.7 })
    await renderJam(<Mixer />, session)
    const level = page.getByRole('slider', { name: 'Level of Bassline' })
    await expect.element(level).toHaveValue('0.7')

    // Another person's change, arriving in this client's doc.
    const theirs = board(session.jam.doc, { kind: 'user', id: 'someone-else' })
    expect(theirs.track(id).set({ gain: 1 }).ok).toBe(true)
    await expect.element(level).toHaveValue('1')
    expect(vibrate).not.toHaveBeenCalled()
  })

  // @scenario ui: Keys
  it('moves a fader with the arrow keys without ticking', async () => {
    const id = addTrack(session, { name: 'Bassline', gain: 0.7 })
    await renderJam(<Mixer />, session)
    const level = page.getByRole('slider', { name: 'Level of Bassline' })
    await userEvent.click(level)
    vibrate.mockClear()
    const gain = () => session.jam.store.get(tracksAtom).get(id)?.gain
    const before = gain()

    await userEvent.keyboard('{ArrowRight}{ArrowRight}{ArrowLeft}{ArrowRight}')
    await expect.poll(gain).not.toBe(before)
    expect(vibrate).not.toHaveBeenCalled()
  })
})
