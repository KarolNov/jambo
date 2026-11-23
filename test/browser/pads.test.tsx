import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { apply } from '../../shared/board'
import { PAUSED_MESSAGES, UPLOADS } from '../../shared/sounds'
import { encodeWav } from '../../shared/wav'
import { Deck } from '../../src/board/console/Deck'
import { Mixer } from '../../src/board/console/Mixer'
import type { Session } from '../../src/board/session'
import { refreshBudget } from '../../src/board/Uploads'
import {
  addTrack,
  addUploads,
  endSession,
  makeSession,
  mockServer,
  renderJam,
  SLUG,
  upload,
  uploadId,
} from './jam'

let session: Session

beforeEach(() => {
  mockServer()
  session = makeSession()
})

afterEach(async () => {
  endSession(session)
  vi.restoreAllMocks()
  // The sound budget is the page's: open it again for the next test.
  mockServer()
  await refreshBudget()
  vi.unstubAllGlobals()
})

/** The pads the jam's console shows, by key. */
const pad = (key: string) =>
  page.getByRole('group', { name: 'Pads' }).getByRole('button', { name: new RegExp(`^${key} `) })

/** Audio started, as after a first tap; returns a spy on the sources the engine starts. */
async function audioOn() {
  await session.engine.unlock()
  return vi.spyOn(AudioBufferSourceNode.prototype, 'start')
}

describe('pad keys', () => {
  // @scenario board/pads: Typing in a field
  it('plays no pad while someone types a pad key into a track name', async () => {
    addTrack(session)
    await renderJam(
      <>
        <Deck slug={SLUG} />
        <Mixer />
      </>,
      session,
    )
    const hit = vi.spyOn(session.engine, 'hitPad')
    await userEvent.click(page.getByRole('textbox', { name: 'Loop name' }))
    // The click puts the caret wherever it lands: type at the end of the name.
    await userEvent.keyboard('{End}q')
    expect(hit).not.toHaveBeenCalled()
    await expect
      .element(page.getByRole('textbox', { name: 'Loop name' }))
      .toHaveValue('Misty Yak 1q')

    // Out of the field, the same key plays its pad.
    ;(document.activeElement as HTMLElement).blur()
    await userEvent.keyboard('q')
    expect(hit).toHaveBeenCalledTimes(1)
  })

  // @scenario board/pads: Shortcuts and held keys
  it('plays a held key once, and not at all with Cmd, Ctrl or Alt', async () => {
    await renderJam(<Deck slug={SLUG} />, session)
    const hit = vi.spyOn(session.engine, 'hitPad')
    await userEvent.keyboard('{Meta>}q{/Meta}{Control>}w{/Control}{Alt>}e{/Alt}')
    expect(hit).not.toHaveBeenCalled()

    // Held: the browser repeats the keydown, flagged as a repeat, until it is let go.
    await userEvent.keyboard('{a>}')
    for (let i = 0; i < 5; i++)
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', repeat: true, bubbles: true }))
    await userEvent.keyboard('{/a}')
    expect(hit).toHaveBeenCalledTimes(1)
  })
})

describe('sounds on pads', () => {
  // @scenario audio/sounds: Still loading
  it('plays nothing on a pad whose upload has not loaded, and shows its name as loading', async () => {
    // The upload's file never arrives.
    mockServer((url) => (url.includes('/sounds/u-') ? new Promise<Response>(() => {}) : undefined))
    const id = uploadId(1)
    addUploads(session, [[id, upload({ name: 'Vox' })]])
    session.board.pad('r0c1').assign(id)
    const { screen } = await renderJam(<Deck slug={SLUG} />, session)
    const start = await audioOn()

    await userEvent.click(pad('2'))
    expect(start).not.toHaveBeenCalled()
    const name = screen.container.querySelector('.ui-pad-sound-loading')
    expect(name?.textContent).toBe('Vox')

    // The kick beside it plays.
    await userEvent.click(pad('1'))
    expect(start).toHaveBeenCalledTimes(1)
  })

  // @scenario audio/sounds: Removed sound
  it('plays nothing on a pad whose sound is gone, and reads Empty', async () => {
    const id = uploadId(2)
    addUploads(session, [[id, upload()]])
    session.board.pad('r0c1').assign(id)
    // The upload is gone; the pad still names it.
    apply(session.jam.doc, [{ op: 'expireSounds' }], { kind: 'system', id: 'room' })
    await renderJam(<Deck slug={SLUG} />, session)
    const start = await audioOn()

    await expect.element(pad('2')).toHaveAccessibleName('2 Empty')
    await userEvent.click(pad('2'))
    expect(start).not.toHaveBeenCalled()
  })
})

describe('Change sounds', () => {
  const openChangeSounds = () =>
    userEvent.click(page.getByRole('button', { name: 'Change sounds' }))
  const uploads = () => page.getByRole('region', { name: 'Uploaded sounds' })

  // @scenario audio/sounds: Replace in a full jam
  it('disables Replace… for every upload while the jam is full', async () => {
    addUploads(
      session,
      Array.from({ length: UPLOADS.perJam }, (_, n) => [
        uploadId(n),
        upload({ name: `Sound ${n + 1}`, createdAt: 1_700_000_000_000 + n }),
      ]),
    )
    await renderJam(<Deck slug={SLUG} />, session)
    await openChangeSounds()

    const replace = uploads().getByRole('button', { name: 'Replace…' })
    await expect.element(replace.first()).toBeInTheDocument()
    const buttons = replace.all()
    expect(buttons).toHaveLength(UPLOADS.perJam)
    for (const b of buttons) await expect.element(b).toBeDisabled()
  })

  // @scenario audio/sounds: Storage full
  it('disables uploading and replacing while storage is full, and says why', async () => {
    mockServer((url) =>
      url.endsWith('/api/sounds/status')
        ? Response.json({ uploads: 'storage', reads: 'open' })
        : undefined,
    )
    addUploads(session, [[uploadId(1), upload({ name: 'Vox' })]])
    await renderJam(<Deck slug={SLUG} />, session)
    await openChangeSounds()

    await expect.element(uploads().getByRole('status')).toHaveTextContent(PAUSED_MESSAGES.storage)
    expect(PAUSED_MESSAGES.storage).toMatch(/storage is full.*Removing unused uploads frees space/)
    await expect.element(uploads().getByRole('button', { name: 'Upload a sound…' })).toBeDisabled()
    await expect.element(uploads().getByRole('button', { name: 'Replace…' })).toBeDisabled()

    // Each pad's picker shows uploads as paused.
    await userEvent.click(pad('Q'))
    const option = page.getByRole('option', { name: 'Uploads paused' })
    await expect.element(option).toBeInTheDocument()
    await expect.element(option).toHaveAttribute('aria-disabled', 'true')
    await expect
      .element(page.getByRole('option', { name: 'Upload a sound…' }))
      .not.toBeInTheDocument()
  })

  // @scenario audio/sounds: Paused mid-upload
  it('says why an upload was refused when the budget just ran out, and disables uploading', async () => {
    let spent = false
    mockServer((url, init) => {
      if (url.endsWith('/api/sounds/status'))
        return Response.json({ uploads: spent ? 'writes' : 'open', reads: 'open' })
      if (url.endsWith(`/api/jams/${SLUG}/sounds`) && init?.method === 'POST') {
        spent = true
        return Response.json({ error: PAUSED_MESSAGES.writes }, { status: 503 })
      }
    })
    await refreshBudget()
    await renderJam(<Deck slug={SLUG} />, session)
    await openChangeSounds()
    const uploadButton = uploads().getByRole('button', { name: 'Upload a sound…' })
    await expect.element(uploadButton).toBeEnabled()

    const wav = encodeWav(new Float32Array(UPLOADS.sampleRate / 2).fill(0.25), UPLOADS.sampleRate)
    const input = page.elementLocator(document.querySelector('input[type="file"]')!)
    await userEvent.upload(input, new File([wav], 'vox.wav', { type: 'audio/wav' }))
    const dialog = page.getByRole('form', { name: 'Upload a sound' })
    await userEvent.click(dialog.getByRole('button', { name: 'Upload', exact: true }))

    await expect.element(dialog.getByRole('alert')).toHaveTextContent(PAUSED_MESSAGES.writes)
    await expect.element(uploadButton).toBeDisabled()
  })
})
