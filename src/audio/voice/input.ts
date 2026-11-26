import { UPLOADS } from '../../../shared/sounds'
import captureUrl from './capture.worklet.ts?worker&url'
import { findClicks, loopbackClick, MAX_ROUND_TRIP } from './dsp/loopback'
import { DEFAULT_KEY, type Key, keyName } from './dsp/tune'
import { estimateLatency, type Latency, readLatency, withMeasured } from './latency'
import { loadRoundTrip, type RoundTripSetup, saveRoundTrip } from './prefs'
import { buildRack, type PresetId } from './presets'

/** The name `capture.worklet.ts` registers its processor under. */
const CAPTURE_PROCESSOR = 'jambo-voice-capture'

/** The longest recording: a voice is kept under the same limit as an upload. */
export const MAX_SECONDS = UPLOADS.maxSeconds

/** Why the microphone can't be used. */
export type MicProblem = 'blocked' | 'missing' | 'unavailable'

/** What each problem tells the person, and how to get past it. */
export const MIC_MESSAGES: Record<MicProblem, string> = {
  blocked:
    "The microphone is blocked. Allow it for this site in your browser's address bar or settings, then press Record again.",
  missing: 'No microphone was found. Connect one, then press Record again.',
  unavailable: "This browser can't record from a microphone here.",
}

export class MicError extends Error {
  constructor(readonly problem: MicProblem) {
    super(MIC_MESSAGES[problem])
  }
}

/** The loopback test's clicks: how many, and how far apart in seconds. */
const CLICKS = 5
const CLICK_SPACING = 0.35

/** The capture worklet, loaded once per context. */
const loaded = new WeakMap<BaseAudioContext, Promise<void>>()
function loadCapture(ctx: BaseAudioContext): Promise<void> {
  let load = loaded.get(ctx)
  if (!load) {
    load = ctx.audioWorklet.addModule(captureUrl)
    loaded.set(ctx, load)
    load.catch(() => loaded.delete(ctx))
  }
  return load
}

/**
 * The microphone with the browser's noise suppression and automatic gain on, so room noise is
 * cleared and a quiet or distant voice still comes through, and its echo cancellation off, which
 * would duck the voice whenever the jam plays. Not configurable for now. Asks for permission the
 * first time; throws a `MicError` when it can't be had.
 */
async function openMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) throw new MicError('unavailable')
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: false,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    })
  } catch (e) {
    const name = e instanceof DOMException ? e.name : ''
    if (name === 'NotAllowedError' || name === 'SecurityError') throw new MicError('blocked')
    if (name === 'NotFoundError' || name === 'OverconstrainedError') throw new MicError('missing')
    throw new MicError('unavailable')
  }
}

/**
 * The voice service's live side: the only place microphone audio goes. It captures the raw
 * microphone through a worklet, shows its level, and can monitor it through a preset's chain
 * (the same chain `renderVoice` renders what is kept through). Open one per recording and close
 * it after, so the browser's microphone light is on only while someone records.
 */
export class VoiceInput {
  private chunks: Float32Array[] = []
  private frames = 0
  private stopped?: () => void
  private levelListeners = new Set<(level: number) => void>()
  /** The monitor: the preset's chain into this gain, into the speakers. */
  private monitorGain: GainNode
  /** The monitored preset's chain, fed from its own input node so all of it can be let go. */
  private rack?: { input: AudioNode; output: AudioNode }
  /** What the monitored chain was built for: its preset and key. */
  private rackFor?: string
  /** The context frame the current recording's first sample was captured at, once known. */
  private startFrame?: number
  /** Counts `monitor` calls, so one overtaken while it built does nothing. */
  private monitorCalls = 0
  /** Ends a loopback test in progress early, when the input closes. */
  private cancelTest?: () => void
  /** The microphone and speakers this input uses, which a measured round trip belongs to. */
  private readonly setup: RoundTripSetup

  /** Opens the microphone into `ctx`, the jam's live context. */
  static async open(ctx: AudioContext): Promise<VoiceInput> {
    try {
      await loadCapture(ctx)
    } catch {
      throw new MicError('unavailable')
    }
    const stream = await openMic()
    try {
      return new VoiceInput(ctx, stream)
    } catch {
      // The microphone opened but can't be wired into the context: let go of it.
      for (const t of stream.getTracks()) t.stop()
      throw new MicError('unavailable')
    }
  }

  /** The delays this browser reports for this microphone, or the loopback test measured. */
  latency: Latency
  private readonly source: MediaStreamAudioSourceNode
  private readonly capture: AudioWorkletNode

  private constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
  ) {
    this.source = ctx.createMediaStreamSource(stream)
    this.capture = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
    })
    // Pulled by the speakers so it runs; it outputs silence.
    this.source.connect(this.capture).connect(ctx.destination)
    this.monitorGain = ctx.createGain()
    this.monitorGain.gain.value = 0
    this.monitorGain.connect(ctx.destination)
    const track = stream.getAudioTracks()[0]
    const estimate = estimateLatency(readLatency(ctx, track))
    const sinkId = (ctx as { sinkId?: unknown }).sinkId
    this.setup = {
      device: `${track?.getSettings().deviceId ?? ''} ${typeof sinkId === 'string' ? sinkId : ''}`,
      estimate: estimate.roundTrip,
    }
    this.latency = withMeasured(estimate, loadRoundTrip(this.setup))
    this.capture.port.onmessage = (
      e: MessageEvent<{ started?: number; samples?: Float32Array; level?: number; stopped?: true }>,
    ) => {
      const { started, samples, level, stopped } = e.data
      if (started !== undefined) this.startFrame = started
      if (samples) this.take(samples)
      if (level !== undefined) for (const l of this.levelListeners) l(level)
      if (stopped) this.stopped?.()
    }
  }

  /** The rate the microphone is captured at. */
  get sampleRate() {
    return this.ctx.sampleRate
  }

  /**
   * The context time the current recording's first sample was captured at, once the worklet has
   * said; known by the time `stop` resolves.
   */
  get startedAt(): number | undefined {
    return this.startFrame === undefined ? undefined : this.startFrame / this.ctx.sampleRate
  }

  /** Seconds recorded so far. */
  get seconds() {
    return this.frames / this.ctx.sampleRate
  }

  /** Calls `listener` with the input's peak level, 0 to 1, about 30 times a second. */
  onLevel(listener: (level: number) => void): () => void {
    this.levelListeners.add(listener)
    return () => this.levelListeners.delete(listener)
  }

  /**
   * Hears the voice through `preset` (tuned to `key`) while `on`; off, nothing reaches the
   * speakers.
   */
  async monitor(on: boolean, preset: PresetId, key: Key = DEFAULT_KEY) {
    const call = ++this.monitorCalls
    const rackFor = `${preset} ${keyName(key)}`
    if (on && this.rackFor !== rackFor) {
      const input = this.ctx.createGain()
      this.source.connect(input)
      const output = await buildRack(this.ctx, preset, input, key)
      const rack = { input, output }
      // A later call has moved on while this one built: it decides, so drop this one entirely.
      if (call !== this.monitorCalls) return this.dropRack(rack)
      this.dropRack(this.rack)
      this.rack = rack
      this.rackFor = rackFor
      output.connect(this.monitorGain)
    }
    this.monitorGain.gain.setTargetAtTime(on ? 1 : 0, this.ctx.currentTime, 0.01)
  }

  private dropRack(rack?: { input: AudioNode; output: AudioNode }) {
    if (!rack) return
    this.source.disconnect(rack.input)
    rack.input.disconnect()
    rack.output.disconnect()
  }

  /** Starts recording from now, dropping anything recorded before. */
  start() {
    this.chunks = []
    this.frames = 0
    this.startFrame = undefined
    this.capture.port.postMessage('start')
  }

  /** Stops recording; resolves with what was recorded, at most `MAX_SECONDS`, at `sampleRate`. */
  stop(): Promise<Float32Array> {
    return new Promise((resolve) => {
      this.stopped = () => {
        this.stopped = undefined
        const out = new Float32Array(this.frames)
        let at = 0
        for (const c of this.chunks) {
          out.set(c, at)
          at += c.length
        }
        this.chunks = []
        resolve(out)
      }
      this.capture.port.postMessage('stop')
    })
  }

  /**
   * The loopback latency test: plays a few clicks through the speakers, listens for them through
   * the microphone, and keeps the round trip in this browser. Resolves with it in seconds, or
   * undefined when the clicks weren't heard clearly (headphones on, speakers off, a noisy room).
   * Silences the monitor while it runs, and must not run while recording.
   */
  async measureRoundTrip(): Promise<number | undefined> {
    const ctx = this.ctx
    const rate = ctx.sampleRate
    const gain = this.monitorGain.gain
    const monitorLevel = gain.value
    gain.cancelScheduledValues(ctx.currentTime)
    gain.value = 0
    const click = ctx.createBuffer(1, loopbackClick(rate).length, rate)
    click.copyToChannel(loopbackClick(rate) as Float32Array<ArrayBuffer>, 0)
    const level = ctx.createGain()
    level.gain.value = 0.5
    level.connect(ctx.destination)
    const sources: AudioBufferSourceNode[] = []
    let cancelled = false
    try {
      this.start()
      const first = ctx.currentTime + 0.3
      const emits: number[] = []
      for (let i = 0; i < CLICKS; i++) {
        const when = first + i * CLICK_SPACING
        const src = ctx.createBufferSource()
        src.buffer = click
        src.connect(level)
        src.start(when)
        sources.push(src)
        emits.push(Math.round(when * rate))
      }
      const listen = first + (CLICKS - 1) * CLICK_SPACING + MAX_ROUND_TRIP + 0.1 - ctx.currentTime
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, listen * 1000)
        this.cancelTest = () => {
          cancelled = true
          clearTimeout(timer)
          resolve()
        }
      })
      if (cancelled) return undefined
      const recording = await this.stop()
      if (this.startFrame === undefined) return undefined
      const roundTrip = findClicks(recording, rate, this.startFrame, emits)
      if (roundTrip === undefined) return undefined
      saveRoundTrip(roundTrip, this.setup)
      this.latency = withMeasured(this.latency, roundTrip)
      return roundTrip
    } finally {
      this.cancelTest = undefined
      for (const src of sources) src.stop()
      level.disconnect()
      if (!cancelled) {
        gain.cancelScheduledValues(ctx.currentTime)
        gain.value = monitorLevel
      }
    }
  }

  private take(samples: Float32Array) {
    const room = Math.round(MAX_SECONDS * this.ctx.sampleRate) - this.frames
    if (room <= 0) return
    const kept = samples.length > room ? samples.subarray(0, room) : samples
    this.chunks.push(kept)
    this.frames += kept.length
  }

  /** Lets go of the microphone and disconnects everything. */
  close() {
    this.cancelTest?.()
    this.stopped?.()
    this.levelListeners.clear()
    this.capture.port.onmessage = null
    this.source.disconnect()
    this.capture.disconnect()
    if (this.rack) {
      this.rack.output.disconnect()
      this.rack.input.disconnect()
    }
    this.monitorGain.disconnect()
    for (const t of this.stream.getTracks()) t.stop()
  }
}
