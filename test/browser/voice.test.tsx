import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'
import { apply, type Sound } from '../../shared/board'
import { UPLOADS } from '../../shared/sounds'
import { parseUploadWav, PEAK } from '../../shared/wav'
import { Deck } from '../../src/board/console/Deck'
import { padsAtom } from '../../src/board/model'
import type { Session } from '../../src/board/session'
import { prepareBuffer, UploadError } from '../../src/audio/upload'
import { MIC_MESSAGES } from '../../src/audio/voice/input'
import { midiOf } from '../../src/audio/voice/dsp/tune'
import { yin } from '../../src/audio/voice/dsp/yin'
import { estimateLatency, withMeasured } from '../../src/audio/voice/latency'
import {
  loadKey,
  loadMonitor,
  loadPreset,
  loadRoundTrip,
  saveKey,
  saveRoundTrip,
} from '../../src/audio/voice/prefs'
import { PRESETS } from '../../src/audio/voice/presets'
import { renderVoice } from '../../src/audio/voice/render'
import { endSession, makeSession, mockServer, renderJam, SLUG, upload, uploadId } from './jam'

/** `seconds` of a sine at `hz`, at `rate`, at amplitude `gain`. */
function tone(seconds: number, rate: number, hz = 440, gain = 0.3) {
  const out = new Float32Array(Math.round(seconds * rate))
  for (let i = 0; i < out.length; i++) out[i] = gain * Math.sin((2 * Math.PI * hz * i) / rate)
  return out
}

const rms = (x: Float32Array) => Math.sqrt(x.reduce((s, v) => s + v * v, 0) / x.length)
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

/** An AudioBuffer holding `samples` at `rate`. */
function bufferOf(samples: Float32Array, rate: number) {
  const ctx = new OfflineAudioContext(1, samples.length, rate)
  const b = ctx.createBuffer(1, samples.length, rate)
  b.copyToChannel(samples as Float32Array<ArrayBuffer>, 0)
  return b
}

/** The samples of a prepared WAV. */
function samplesOf(wav: Uint8Array) {
  const view = new DataView(wav.buffer, wav.byteOffset + 44, wav.byteLength - 44)
  return Float32Array.from(
    { length: view.byteLength / 2 },
    (_, i) => view.getInt16(i * 2, true) / 0x8000,
  )
}

describe('voice render', () => {
  it('renders a take through Clean at the upload rate, keeping the voice and cutting rumble', async () => {
    const rate = 48_000
    const voice = await renderVoice(tone(1, rate), rate, 'clean')
    expect(voice.sampleRate).toBe(UPLOADS.sampleRate)
    expect(voice.length).toBe(UPLOADS.sampleRate)
    // A 440 Hz voice passes as it was.
    const middle = voice.getChannelData(0).subarray(4410, 40_000)
    expect(rms(middle)).toBeCloseTo(0.3 / Math.SQRT2, 2)

    // A constant offset (DC) is below the low cut and dies away.
    const dc = await renderVoice(new Float32Array(rate).fill(0.5), rate, 'clean')
    expect(Math.abs(dc.getChannelData(0).at(-1)!)).toBeLessThan(0.01)
  })
})

describe('prepareBuffer', () => {
  it('trims silence at both ends and levels a recording to −1 dBFS as upload WAV', async () => {
    const rate = UPLOADS.sampleRate
    const take = new Float32Array(rate * 2)
    take.set(tone(0.5, rate, 440, 0.1), rate / 2)
    const prepared = await prepareBuffer(bufferOf(take, rate), 'recording')

    const info = parseUploadWav(prepared.wav)
    expect('error' in info).toBe(false)
    // Half a second of sound, plus the few ms kept before it.
    expect(prepared.durationMs).toBeGreaterThanOrEqual(495)
    expect(prepared.durationMs).toBeLessThanOrEqual(510)
    expect(peak(samplesOf(prepared.wav))).toBeCloseTo(PEAK, 2)
  })

  it('resamples a buffer at another rate to the upload rate', async () => {
    const prepared = await prepareBuffer(bufferOf(tone(1, 48_000), 48_000), 'recording')
    const info = parseUploadWav(prepared.wav)
    expect(info).toMatchObject({ sampleRate: UPLOADS.sampleRate })
    expect(prepared.durationMs).toBeGreaterThanOrEqual(995)
    expect(prepared.durationMs).toBeLessThanOrEqual(1001)
  })

  it('refuses a silent recording, saying it is a recording', async () => {
    const silent = bufferOf(new Float32Array(UPLOADS.sampleRate), UPLOADS.sampleRate)
    await expect(prepareBuffer(silent, 'recording')).rejects.toThrow(
      new UploadError('That recording is silent'),
    )
  })
})

describe('estimateLatency', () => {
  it('adds what the browser reports, ignoring what it leaves out or gets wrong', () => {
    expect(estimateLatency({ input: 0.01, base: 0.005, output: 0.02 })).toEqual({
      input: 0.01,
      output: 0.025,
      roundTrip: 0.035,
      measured: false,
    })
    expect(estimateLatency({ base: 0.005, output: Number.NaN, input: -1 })).toEqual({
      input: 0,
      output: 0.005,
      roundTrip: 0.005,
      measured: false,
    })
  })

  it('gives way to a measured round trip', () => {
    const estimate = estimateLatency({ input: 0.01, base: 0.01, output: 0.02 })
    expect(withMeasured(estimate, undefined)).toBe(estimate)
    const measured = withMeasured(estimate, 0.12)
    expect(measured.roundTrip).toBe(0.12)
    expect(measured.measured).toBe(true)
    expect(measured.input + measured.output).toBeCloseTo(0.12)
  })
})

describe('voice prefs', () => {
  it('keeps the key and the measured round trip in this browser', () => {
    expect(loadKey()).toEqual({ root: 0, scale: 'major' })
    saveKey({ root: 9, scale: 'minor' })
    expect(loadKey()).toEqual({ root: 9, scale: 'minor' })
    localStorage.setItem('jambo.voice.key', '{"root":13,"scale":"major"}')
    expect(loadKey()).toEqual({ root: 0, scale: 'major' })

    expect(loadRoundTrip()).toBeUndefined()
    saveRoundTrip(0.12)
    expect(loadRoundTrip()).toBe(0.12)
  })
})

/** A voice-like tone: a sawtooth's first eight harmonics, after `lead` seconds of silence. */
function sung(hz: number, seconds: number, rate: number, lead = 0) {
  const out = new Float32Array(Math.round((seconds + lead) * rate))
  const from = Math.round(lead * rate)
  for (let i = from; i < out.length; i++) {
    const phase = (2 * Math.PI * hz * (i - from)) / rate
    let x = 0
    for (let h = 1; h <= 8; h++) x += Math.sin(h * phase) / h
    out[i] = 0.15 * x
  }
  return out
}

/** The pitch heard in the middle of `buffer`. */
function heard(buffer: AudioBuffer) {
  const x = buffer.getChannelData(0)
  const mid = Math.floor(x.length / 2)
  return yin(x.subarray(mid - 2048, mid + 2048), buffer.sampleRate)!.hz
}

describe('voice presets', () => {
  const rate = 48_000

  it.each(PRESETS.map((p) => p.id))(
    'renders %s at the upload rate, with the voice in it',
    async (preset) => {
      const voice = await renderVoice(sung(220, 0.6, rate), rate, preset)
      expect(voice.sampleRate).toBe(UPLOADS.sampleRate)
      expect(voice.length).toBe(Math.round(0.6 * UPLOADS.sampleRate))
      const middle = voice.getChannelData(0).subarray(8000, 20_000)
      expect(rms(middle)).toBeGreaterThan(0.02)
      expect(peak(voice.getChannelData(0))).toBeLessThan(1.5)
    },
  )

  // @scenario audio/voice: Auto-tune key: Snap to the scale
  it('holds an A when hard auto-tune in A minor hears a note between A and B flat', async () => {
    const voice = await renderVoice(sung(452, 1, rate), rate, 'tune-hard', {
      root: 9,
      scale: 'minor',
    })
    expect(Math.abs(heard(voice) - 440)).toBeLessThan(2)
    // Natural gets there too, on a steady note.
    const natural = await renderVoice(sung(452, 1, rate), rate, 'tune-natural', {
      root: 9,
      scale: 'minor',
    })
    expect(Math.abs(heard(natural) - 440)).toBeLessThan(2)
  })

  it('moves the pitch for Chipmunk and Demon', async () => {
    const from = midiOf(196)
    const at = async (preset: 'chipmunk' | 'demon') =>
      midiOf(heard(await renderVoice(sung(196, 0.8, rate), rate, preset)))
    expect((await at('chipmunk')) - from).toBeCloseTo(9, 0)
    expect((await at('demon')) - from).toBeCloseTo(-7, 0)
  })

  it('keeps a shifted voice in time with the take', async () => {
    const take = sung(220, 0.4, rate, 0.2)
    for (const preset of ['clean', 'tune-hard', 'chipmunk'] as const) {
      const x = (await renderVoice(take, rate, preset)).getChannelData(0)
      const onset = x.findIndex((v) => Math.abs(v) > 0.05) / UPLOADS.sampleRate
      expect(Math.abs(onset - 0.2)).toBeLessThan(0.015)
    }
  })
})

describe('recording a sound', () => {
  let session: Session
  const room = { kind: 'system', id: 'room' } as const
  const openChangeSounds = () =>
    userEvent.click(page.getByRole('button', { name: 'Change sounds' }))
  const pad = (key: string) =>
    page.getByRole('group', { name: 'Pads' }).getByRole('button', { name: new RegExp(`^${key} `) })
  const dialog = () => page.getByRole('form', { name: 'Upload a sound' })

  beforeEach(() => {
    localStorage.clear()
    session = makeSession()
  })

  afterEach(() => {
    endSession(session)
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    localStorage.clear()
  })

  /** A microphone that hears a steady tone, and what it was asked for. */
  function toneMic() {
    const asked: MediaStreamConstraints[] = []
    let stream: MediaStream | undefined
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockImplementation(async (c) => {
      asked.push(c!)
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
    return { asked, live: () => stream?.getAudioTracks().some((t) => t.readyState === 'live') }
  }

  // @scenario audio/voice: Record onto a pad
  it('records with the browser’s noise suppression and auto gain on, then keeps it on the pad as an upload', async () => {
    const id = uploadId(20)
    let posted: Uint8Array | undefined
    mockServer((url, init) => {
      if (!url.endsWith(`/api/jams/${SLUG}/sounds`) || init?.method !== 'POST') return undefined
      return new Response(init.body).arrayBuffer().then((body) => {
        posted = new Uint8Array(body)
        const sound: Sound = upload({ name: 'Hey', author: session.me.id })
        apply(session.jam.doc, [{ op: 'addSound', id, sound }], room)
        return Response.json({ id, sound }, { status: 201 })
      })
    })
    const mic = toneMic()
    await renderJam(<Deck slug={SLUG} />, session)
    await openChangeSounds()
    await userEvent.click(pad('Q'))
    await userEvent.click(page.getByRole('option', { name: 'Upload a sound…' }))
    await userEvent.click(dialog().getByRole('button', { name: 'Record', exact: true }))
    // Clean is picked by default; monitoring is off.
    await expect
      .element(dialog().getByRole('button', { name: 'Voice preset: Clean' }))
      .toBeVisible()
    await expect.element(dialog().getByRole('switch', { name: 'Monitor' })).not.toBeChecked()

    await userEvent.click(dialog().getByRole('button', { name: 'Record', exact: true }))
    await expect.element(dialog().getByRole('button', { name: 'Stop' })).toBeVisible()
    expect(mic.asked[0]!.audio).toMatchObject({
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true,
    })
    await expect
      .poll(() => Number(dialog().getByRole('meter').element().getAttribute('aria-valuenow')))
      .toBeGreaterThan(10)
    await new Promise((r) => setTimeout(r, 800))
    await userEvent.click(dialog().getByRole('button', { name: 'Stop' }))

    // The microphone is let go once it stops; listen back, then keep it.
    await expect.element(dialog().getByRole('button', { name: 'Listen' })).toBeVisible()
    expect(mic.live()).toBe(false)
    const name = dialog().getByRole('textbox', { name: 'Name' })
    await userEvent.fill(name, 'Hey')
    await userEvent.click(dialog().getByRole('button', { name: 'Keep' }))
    await expect.element(dialog()).not.toBeInTheDocument()

    const info = parseUploadWav(posted!)
    expect(info).toMatchObject({ sampleRate: UPLOADS.sampleRate, channels: 1 })
    expect((info as { durationMs: number }).durationMs).toBeGreaterThan(500)
    expect(session.jam.store.get(padsAtom).get('r1c0')?.soundId).toBe(id)
  })

  // @scenario audio/voice: Redo
  it('drops the first recording when Record is pressed again, uploading nothing', async () => {
    const fetch = mockServer()
    toneMic()
    await renderJam(<Deck slug={SLUG} />, session)
    await openChangeSounds()
    await userEvent.click(
      page
        .getByRole('region', { name: 'Uploaded sounds' })
        .getByRole('button', { name: 'Upload a sound…' }),
    )
    await userEvent.click(dialog().getByRole('button', { name: 'Record', exact: true }))
    await userEvent.click(dialog().getByRole('button', { name: 'Record', exact: true }))
    await new Promise((r) => setTimeout(r, 400))
    await userEvent.click(dialog().getByRole('button', { name: 'Stop' }))
    await expect.element(dialog().getByRole('button', { name: 'Keep' })).toBeEnabled()

    await userEvent.click(dialog().getByRole('button', { name: 'Record again' }))
    // The first take is gone: nothing to keep until this one stops.
    await expect.element(dialog().getByRole('button', { name: 'Keep' })).toBeDisabled()
    await userEvent.click(dialog().getByRole('button', { name: 'Stop' }))
    await userEvent.click(dialog().getByRole('button', { name: 'Cancel' }))
    expect(fetch.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)
  })

  // @scenario audio/voice: Refused
  it('says the microphone is blocked and how to allow it, and the pads still play', async () => {
    mockServer()
    vi.spyOn(navigator.mediaDevices, 'getUserMedia').mockRejectedValue(
      new DOMException('Permission denied', 'NotAllowedError'),
    )
    await renderJam(<Deck slug={SLUG} />, session)
    await openChangeSounds()
    await userEvent.click(
      page
        .getByRole('region', { name: 'Uploaded sounds' })
        .getByRole('button', { name: 'Upload a sound…' }),
    )
    await userEvent.click(dialog().getByRole('button', { name: 'Record', exact: true }))
    await userEvent.click(dialog().getByRole('button', { name: 'Record', exact: true }))
    await expect.element(dialog().getByRole('alert')).toHaveTextContent(MIC_MESSAGES.blocked)

    const start = vi.spyOn(AudioBufferSourceNode.prototype, 'start')
    await userEvent.click(page.getByRole('button', { name: 'Done' }))
    await userEvent.keyboard('1')
    expect(start).toHaveBeenCalled()
  })

  it('shows the key for auto-tune, remembers it, and offers the delay test', async () => {
    mockServer()
    await renderJam(<Deck slug={SLUG} />, session)
    await openChangeSounds()
    await userEvent.click(
      page
        .getByRole('region', { name: 'Uploaded sounds' })
        .getByRole('button', { name: 'Upload a sound…' }),
    )
    await userEvent.click(dialog().getByRole('button', { name: 'Record', exact: true }))
    await expect.element(dialog().getByRole('button', { name: 'Test delay' })).toBeVisible()
    expect(dialog().getByRole('button', { name: /^Key:/ }).query()).toBeNull()

    await userEvent.click(dialog().getByRole('button', { name: 'Voice preset: Clean' }))
    await userEvent.click(page.getByRole('option', { name: 'Auto-tune (hard)' }))
    await userEvent.click(dialog().getByRole('button', { name: 'Key: C major' }))
    await userEvent.click(page.getByRole('option', { name: 'A minor' }))
    await expect.element(dialog().getByRole('button', { name: 'Key: A minor' })).toBeVisible()
    expect(loadPreset()).toBe('tune-hard')
    expect(loadKey()).toEqual({ root: 9, scale: 'minor' })
  })

  // @scenario audio/voice: Monitor
  it('remembers the monitor setting and advises headphones', async () => {
    mockServer()
    await renderJam(<Deck slug={SLUG} />, session)
    await openChangeSounds()
    await userEvent.click(
      page
        .getByRole('region', { name: 'Uploaded sounds' })
        .getByRole('button', { name: 'Upload a sound…' }),
    )
    await userEvent.click(dialog().getByRole('button', { name: 'Record', exact: true }))
    expect(loadMonitor()).toBe(false)
    await userEvent.click(dialog().getByRole('switch', { name: 'Monitor' }))
    await expect.element(dialog().getByText(/Use headphones/)).toBeVisible()
    expect(loadMonitor()).toBe(true)
    expect(loadPreset()).toBe('clean')
  })
})
