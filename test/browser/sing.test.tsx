import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { apply, isSoundHit, type Sound } from '../../shared/board'
import { CLIPS, UPLOAD_HEADERS, UPLOADS } from '../../shared/sounds'
import { parseUploadWav } from '../../shared/wav'
import { SING_TAIL } from '../../src/audio/engine'
import { Deck } from '../../src/board/console/Deck'
import { tracksAtom } from '../../src/board/model'
import { clipName, lostMessage } from '../../src/board/saveTake'
import type { Session } from '../../src/board/session'
import { CLIPS_FULL } from '../../src/board/useSing'
import {
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

const room = { kind: 'system', id: 'room' } as const
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

let session: Session

beforeEach(() => {
  localStorage.clear()
  session = makeSession()
  // 120 BPM: half a second a beat.
  expect(session.board.tempo(120).ok).toBe(true)
})

afterEach(() => {
  endSession(session)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

/** A microphone that hears a steady tone; counts how often it was asked for. */
function toneMic() {
  let asked = 0
  let stream: MediaStream | undefined
  vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async () => {
    asked++
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    gain.gain.value = 0.3
    const out = ctx.createMediaStreamDestination()
    osc.connect(gain).connect(out)
    osc.start()
    stream = out.stream
    return stream
  })
  return {
    asked: () => asked,
    live: () => stream?.getAudioTracks().some((t) => t.readyState === 'live') ?? false,
  }
}

/**
 * The room's clip route: each posted clip is listed on the board as a clip, unless `refuse` says
 * to refuse the `n`th (from 1). `gate` holds the answers back until it resolves.
 */
function clipRoom(
  refuse: (n: number) => Response | undefined = () => undefined,
  gate?: Promise<void>,
) {
  const posted: { name: string; wav: Uint8Array }[] = []
  mockServer((url, init) => {
    if (!url.endsWith(`/api/jams/${SLUG}/clips`) || init?.method !== 'POST') return undefined
    return answer(init)
  })
  const answer = async (init: RequestInit): Promise<Response> => {
    const wav = new Uint8Array(await new Response(init.body).arrayBuffer())
    const headers = new Headers(init.headers)
    const name = decodeURIComponent(headers.get(UPLOAD_HEADERS.name) ?? '')
    posted.push({ name, wav })
    const n = posted.length
    await gate
    const refused = refuse(n)
    if (refused) return refused
    const id = uploadId(100 + n)
    const sound: Sound = upload({ kind: 'clip', name, author: session.me.id })
    apply(session.jam.doc, [{ op: 'addSound', id, sound }], room)
    return Response.json({ id, sound }, { status: 201 })
  }
  return posted
}

const sing = () => page.getByRole('button', { name: /^Sing/ })
const record = () => page.getByRole('button', { name: 'Record' })

async function startTake() {
  agreeClock(session)
  await renderJam(<Deck slug={SLUG} />, session)
  await userEvent.click(record())
  await expect.poll(() => session.engine.state.phase, { timeout: 8000 }).toBe('recording')
}

/** Holds M for `ms`, then lets go, once the clip has really started. */
async function holdM(ms: number) {
  await userEvent.keyboard('{m>}')
  await expect.poll(() => session.engine.take()?.clips.length ?? 0).toBeGreaterThan(0)
  await wait(ms)
  await userEvent.keyboard('{/m}')
}

const tracks = () => [...session.jam.store.get(tracksAtom).values()]

describe('sing into a take', () => {
  // @scenario audio/voice: Not recording
  it('is disabled with no take recording, and M records nothing', async () => {
    const mic = toneMic()
    clipRoom()
    agreeClock(session)
    await renderJam(<Deck slug={SLUG} />, session)
    await expect.element(sing()).toBeDisabled()
    await userEvent.keyboard('{m>}')
    await wait(200)
    await userEvent.keyboard('{/m}')
    expect(session.engine.singing).toBe(false)
    expect(mic.asked()).toBe(0)
  })

  // @scenario audio/looper: Only a voice
  it('adds a track holding just the clip, stored as a clip named after the track', async () => {
    const mic = toneMic()
    let open!: () => void
    const posted = clipRoom(undefined, new Promise((r) => (open = r)))
    await startTake()
    await expect.element(sing()).toBeEnabled()
    await holdM(600)
    // The take's lane shows the clip as a bar.
    await expect
      .poll(() => document.querySelectorAll('.console-take-lane .console-clip').length)
      .toBe(1)
    await userEvent.click(page.getByRole('button', { name: 'Stop' }))

    // Saving: the clip uploads before the track is added, and recording waits for it.
    await expect.element(page.getByRole('button', { name: 'Saving the take…' })).toBeDisabled()
    expect(tracks()).toHaveLength(0)
    open()
    await expect.poll(() => tracks().length, { timeout: 5000 }).toBe(1)
    await expect.element(record()).toBeEnabled()

    const [track] = tracks()
    expect(track!.hits).toHaveLength(1)
    const [hit] = track!.hits
    expect(isSoundHit(hit!)).toBe(true)
    expect(hit!.beat).toBeGreaterThanOrEqual(0)
    expect(posted).toHaveLength(1)
    expect(posted[0]!.name).toBe(clipName(track!.name, 1))
    const info = parseUploadWav(posted[0]!.wav)
    expect(info).toMatchObject({ sampleRate: UPLOADS.sampleRate, channels: 1 })
    // Held 600 ms, and it keeps recording a moment after the release, so the last note isn't cut.
    expect((info as { durationMs: number }).durationMs).toBeGreaterThan(600 + SING_TAIL * 800)
    // The microphone is let go with the take.
    await expect.poll(mic.live).toBe(false)
  })

  // @scenario audio/voice: One clip fails
  it('adds the track with the pad hits and the clips that stored, and says how many were lost', async () => {
    toneMic()
    const posted = clipRoom((n) =>
      n === 2 ? Response.json({ error: 'The upload failed' }, { status: 500 }) : undefined,
    )
    await startTake()
    await userEvent.keyboard('1')
    await holdM(300)
    await userEvent.keyboard('2')
    await wait(200)
    await holdM(300)
    await userEvent.keyboard('3')
    await userEvent.keyboard('4')
    await userEvent.click(page.getByRole('button', { name: 'Stop' }))

    await expect.poll(() => tracks().length, { timeout: 8000 }).toBe(1)
    const [track] = tracks()
    expect(posted).toHaveLength(2)
    expect(track!.hits.filter((h) => !isSoundHit(h))).toHaveLength(4)
    expect(track!.hits.filter(isSoundHit)).toHaveLength(1)
    await expect
      .element(
        page.getByText('1 voice clip was lost (The upload failed); the rest of the take was saved'),
      )
      .toBeVisible()
  })

  // @scenario audio/voice: Full of clips
  it('is disabled and says so while the jam is full of clips, and pad hits still record', async () => {
    toneMic()
    clipRoom()
    addUploads(
      session,
      Array.from({ length: CLIPS.perJam }, (_, i) => [
        uploadId(i),
        upload({ kind: 'clip', name: `Voice ${i}` }),
      ]),
    )
    await startTake()
    await expect.element(sing()).toBeDisabled()
    await expect.element(page.getByText(CLIPS_FULL)).toBeVisible()
    await userEvent.keyboard('{m>}')
    await wait(200)
    await userEvent.keyboard('{/m}')
    expect(session.engine.take()?.clips).toHaveLength(0)
    await userEvent.keyboard('1')
    await userEvent.click(page.getByRole('button', { name: 'Stop' }))
    await expect.poll(() => tracks().length).toBe(1)
    expect(tracks()[0]!.hits).toHaveLength(1)
  })
})

describe('the microphone', () => {
  it('is asked for as the take starts, before any Sing, and once for the whole take', async () => {
    const mic = toneMic()
    clipRoom()
    agreeClock(session)
    await renderJam(<Deck slug={SLUG} />, session)
    await userEvent.click(record())
    await expect.poll(mic.asked).toBe(1)
    expect(session.engine.state.phase).not.toBe('recording')
    await expect.poll(() => session.engine.state.phase, { timeout: 8000 }).toBe('recording')
    await holdM(200)
    await wait(SING_TAIL * 1000 + 200)
    await holdM(200)
    expect(mic.asked()).toBe(1)
    await userEvent.click(page.getByRole('button', { name: 'Stop' }))
    await expect.poll(mic.live).toBe(false)
  })

  it('says the microphone is blocked when Sing is pressed, and pad hits still record', async () => {
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(
      new DOMException('Denied', 'NotAllowedError'),
    )
    clipRoom()
    await startTake()
    await userEvent.keyboard('{m>}')
    await expect.element(page.getByRole('alert')).toHaveTextContent(/microphone is blocked/)
    await userEvent.keyboard('{/m}')
    await userEvent.keyboard('1')
    await userEvent.click(page.getByRole('button', { name: 'Stop' }))
    await expect.poll(() => tracks().length).toBe(1)
  })
})

describe('clip names and lost clips', () => {
  it("names a clip after its track and number, within a sound name's 40 characters", () => {
    expect(clipName('Groovy Otter 3', 2)).toBe('Groovy Otter 3 · voice 2')
    expect(clipName('x'.repeat(40), 12)).toHaveLength(40)
  })

  it('says how many clips were lost, and whether a track was still added', () => {
    expect(lostMessage({ lost: 0 }, true)).toBeUndefined()
    expect(lostMessage({ lost: 2 }, false)).toBe('2 voice clips were lost, so no track was added')
  })
})
