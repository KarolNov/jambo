import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { apply, type Sound } from '../../shared/board'
import { PAUSED_MESSAGES, UPLOADS } from '../../shared/sounds'
import { encodeWav } from '../../shared/wav'
import { Deck } from '../../src/board/console/Deck'
import { Mixer } from '../../src/board/console/Mixer'
import { padsAtom, soundsAtom, tracksAtom } from '../../src/board/model'
import { SWATCHES } from '../../src/theme/palette'
import type { Session } from '../../src/board/session'
import { refreshBudget } from '../../src/board/Uploads'
import {
  addTrack,
  addUploads,
  agreeClock,
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

/** Half a second of a test sample, as the jam's server serves an upload. */
const wavFile = () =>
  encodeWav(new Float32Array(UPLOADS.sampleRate / 2).fill(0.25), UPLOADS.sampleRate)

/** The buffers sources played with, in order, from `audioOn`'s spy. */
const playedBuffers = (start: Awaited<ReturnType<typeof audioOn>>) =>
  start.mock.contexts.map((src) => (src as AudioBufferSourceNode).buffer)

describe('playing the pads', () => {
  // @scenario board/pads: Play a pad
  it('plays the sound at once and pushes the pad in, by click or by key', async () => {
    const { screen } = await renderJam(<Deck slug={SLUG} />, session)
    const start = await audioOn()
    const ctx = session.engine['ctx']!
    const kick = screen.container.querySelector<HTMLElement>('[aria-keyshortcuts="1"]')!

    await userEvent.click(pad('1'))
    expect(start).toHaveBeenCalledTimes(1)
    // Scheduled for now, not a beat or a bar later.
    expect(start.mock.calls[0]![0]).toBeLessThanOrEqual(ctx.currentTime + 0.01)
    expect(playedBuffers(start)[0]).toBe(session.engine['buffers'].get('kick'))
    expect(kick.classList.contains('pressed')).toBe(true)

    await userEvent.keyboard('w')
    expect(start).toHaveBeenCalledTimes(2)
    expect(playedBuffers(start)[1]).toBe(session.engine['buffers'].get('tom-low'))
    const w = screen.container.querySelector<HTMLElement>('[aria-keyshortcuts="w"]')!
    expect(w.classList.contains('pressed')).toBe(true)
  })

  // @scenario board/pads: A loop plays through a pad
  it("lights the kick in the loop's colour each time the loop's kick is heard", async () => {
    // 240 BPM: a one-bar loop comes round every second.
    expect(session.board.tempo(240).ok).toBe(true)
    addTrack(session, { color: 'coral', hits: [{ padId: 'r0c0', beat: 0 }] })
    agreeClock(session)
    const { screen } = await renderJam(<Deck slug={SLUG} />, session)
    await audioOn()
    const kick = screen.container.querySelector<HTMLElement>('[aria-keyshortcuts="1"]')!
    const coral = SWATCHES.coral[document.documentElement.dataset.theme as 'dark' | 'light']

    for (let n = 0; n < 2; n++) {
      await expect.poll(() => kick.classList.contains('glow'), { timeout: 3000 }).toBe(true)
      expect(kick.style.getPropertyValue('--glow')).toBe(coral)
      await expect.poll(() => kick.classList.contains('glow'), { timeout: 3000 }).toBe(false)
    }
  })
})

describe("picking a pad's sound", () => {
  const openChangeSounds = () =>
    userEvent.click(page.getByRole('button', { name: 'Change sounds' }))

  // @scenario board/pads: Reassign
  it('puts the clap on Q for the board, and for tracks that hit Q', async () => {
    addTrack(session, { hits: [{ padId: 'r1c0', beat: 0 }] })
    await renderJam(<Deck slug={SLUG} />, session)
    const start = await audioOn()
    await openChangeSounds()
    await userEvent.click(pad('Q'))
    await userEvent.click(page.getByRole('option', { name: 'Clap', exact: true }))

    // On the board, so every client gets it.
    expect(session.jam.store.get(padsAtom).get('r1c0')?.soundId).toBe('clap')
    expect(session.jam.store.get(tracksAtom).size).toBe(1)
    await expect.element(pad('Q')).toHaveAccessibleName(/Clap/)
    // The engine plays the clap wherever Q is hit, the track's hits included.
    expect(session.engine['pads'].get('r1c0')).toBe('clap')
    await userEvent.click(page.getByRole('button', { name: 'Done' }))
    await userEvent.keyboard('q')
    expect(playedBuffers(start).at(-1)).toBe(session.engine['buffers'].get('clap'))
  })

  // @scenario board/pads: Pick an upload
  it('puts an upload on A, which plays once it has loaded', async () => {
    const id = uploadId(3)
    mockServer((url) => (url.endsWith(`/sounds/${id}`) ? new Response(wavFile()) : undefined))
    addUploads(session, [[id, upload({ name: 'Vox' })]])
    await renderJam(<Deck slug={SLUG} />, session)
    const start = await audioOn()
    await openChangeSounds()
    await userEvent.click(pad('A'))
    await userEvent.click(page.getByRole('option', { name: /\bVox\b/ }))

    expect(session.engine['pads'].get('r2c0')).toBe(id)
    await expect.poll(() => session.engine.samples.get(id)).toBeDefined()
    await userEvent.click(page.getByRole('button', { name: 'Done' }))
    await userEvent.keyboard('a')
    expect(playedBuffers(start).at(-1)).toBe(session.engine.samples.get(id))
  })
})

describe('uploading onto pads', () => {
  const openChangeSounds = () =>
    userEvent.click(page.getByRole('button', { name: 'Change sounds' }))
  const uploads = () => page.getByRole('region', { name: 'Uploaded sounds' })
  const room = { kind: 'system', id: 'room' } as const

  /**
   * The jam's server for uploads: a POST stores the file and the room lists it on the board as
   * `next`; a DELETE unlists it; a GET serves the sample. Returns the requests it answered.
   */
  function soundServer(next: string) {
    const requests: string[] = []
    mockServer((url, init) => {
      const method = init?.method ?? 'GET'
      if (!url.includes(`/api/jams/${SLUG}/sounds`)) return undefined
      requests.push(`${method} ${url.slice(url.indexOf('/api/'))}`)
      if (method === 'POST') {
        const sound: Sound = upload({ name: 'Vox 2', author: session.me.id })
        apply(session.jam.doc, [{ op: 'addSound', id: next, sound }], room)
        return Response.json({ id: next, sound }, { status: 201 })
      }
      if (method === 'DELETE') {
        const id = url.slice(url.lastIndexOf('/') + 1)
        apply(session.jam.doc, [{ op: 'removeSound', id }], room)
        return new Response(null, { status: 204 })
      }
      return new Response(wavFile())
    })
    return requests
  }

  /**
   * Presses Choose a file… in the upload dialog, picks a sample file in the file chooser it opens,
   * then sends the dialog with `button`.
   */
  async function chooseFile(button: 'Upload' | 'Replace') {
    const dialog = page.getByRole('form', { name: 'Upload a sound' })
    const fileInput = document.querySelector<HTMLInputElement>('input[type="file"]')!
    // The chooser opens from within the click; stand in for the browser's own file dialog.
    const opened = vi.spyOn(fileInput, 'click').mockImplementation(() => {})
    await userEvent.click(dialog.getByRole('button', { name: 'Choose a file…' }))
    expect(opened).toHaveBeenCalled()
    opened.mockRestore()
    const input = page.elementLocator(fileInput)
    await userEvent.upload(input, new File([wavFile()], 'vox 2.wav', { type: 'audio/wav' }))
    await userEvent.click(dialog.getByRole('button', { name: button, exact: true }))
    await expect.element(dialog).not.toBeInTheDocument()
  }

  // @scenario audio/sounds: Upload onto a pad
  it('lists the upload, puts it on Q, and plays it on Q', async () => {
    const id = uploadId(10)
    const requests = soundServer(id)
    await renderJam(<Deck slug={SLUG} />, session)
    const start = await audioOn()
    await openChangeSounds()
    await userEvent.click(pad('Q'))
    await userEvent.click(page.getByRole('option', { name: 'Upload a sound…' }))
    await chooseFile('Upload')

    expect(requests).toContain(`POST /api/jams/${SLUG}/sounds`)
    await expect.element(uploads().getByText('Vox 2')).toBeInTheDocument()
    // On the board, so every client puts it on Q.
    expect(session.jam.store.get(padsAtom).get('r1c0')?.soundId).toBe(id)
    // The uploader hears it at once: the file they chose is already loaded.
    await userEvent.click(page.getByRole('button', { name: 'Done' }))
    await userEvent.keyboard('q')
    expect(playedBuffers(start).at(-1)).toBe(session.engine.samples.get(id))
  })

  // @scenario audio/sounds: Replace
  it('swaps the new sound onto W and E and into the track, and removes the old upload', async () => {
    const old = uploadId(11)
    const next = uploadId(12)
    addUploads(session, [[old, upload({ name: 'Vox' })]])
    session.board.pad('r0c1').assign(old)
    session.board.pad('r0c2').assign(old)
    addTrack(session, { hits: [{ padId: 'r0c1', beat: 0 }] })
    const requests = soundServer(next)
    await renderJam(<Deck slug={SLUG} />, session)
    await audioOn()
    await openChangeSounds()
    await userEvent.click(uploads().getByRole('button', { name: 'Replace…' }))
    await chooseFile('Replace')

    const pads = session.jam.store.get(padsAtom)
    expect(pads.get('r0c1')?.soundId).toBe(next)
    expect(pads.get('r0c2')?.soundId).toBe(next)
    // The track hits W, so it plays the new sound too.
    expect(session.engine['pads'].get('r0c1')).toBe(next)
    // The old upload is removed from the jam's storage and its list.
    await expect.poll(() => requests).toContain(`DELETE /api/jams/${SLUG}/sounds/${old}`)
    await expect.poll(() => session.jam.store.get(soundsAtom).has(old)).toBe(false)
    expect([...session.jam.store.get(soundsAtom).keys()]).toEqual([next])
  })

  // @scenario audio/sounds: Join later
  it("plays a track's hits on an upload's pad once the upload has loaded", async () => {
    const id = uploadId(13)
    let release = () => {}
    const arrived = new Promise<void>((r) => (release = r))
    // The file arrives only when the test says so.
    mockServer((url) =>
      url.endsWith(`/sounds/${id}`) ? arrived.then(() => new Response(wavFile())) : undefined,
    )
    // The jam as someone opening it finds it: an upload on W, and a loop at 240 BPM that hits W.
    expect(session.board.tempo(240).ok).toBe(true)
    addUploads(session, [[id, upload({ name: 'Vox' })]])
    session.board.pad('r0c1').assign(id)
    addTrack(session, { hits: [{ padId: 'r0c1', beat: 0 }] })
    agreeClock(session)
    await renderJam(<Deck slug={SLUG} />, session)
    const start = await audioOn()

    // Loading: the loop comes round and plays nothing on W.
    await new Promise((r) => setTimeout(r, 1500))
    expect(start).not.toHaveBeenCalled()

    release()
    await expect.poll(() => session.engine.samples.get(id)).toBeDefined()
    await expect
      .poll(() => playedBuffers(start).includes(session.engine.samples.get(id)!), { timeout: 3000 })
      .toBe(true)
  })
})
