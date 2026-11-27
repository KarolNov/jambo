import { LIVE, type LiveFrame, liveStamp } from '../../../shared/live'
import { CAPTURE_PROCESSOR, loadCapture } from '../voice/input'

/** The encoder's settings at `sampleRate`: Opus, mono, 20 ms frames. */
const config = (sampleRate: number): AudioEncoderConfig => ({
  codec: 'opus',
  sampleRate,
  numberOfChannels: 1,
  bitrate: LIVE.bitrate,
  opus: { frameDuration: LIVE.frameMs * 1000 },
})

/** Whether this browser can encode a live voice from a context at `sampleRate`. */
export async function canEncode(sampleRate: number): Promise<boolean> {
  if (typeof AudioEncoder === 'undefined') return false
  try {
    return (await AudioEncoder.isConfigSupported(config(sampleRate))).supported === true
  } catch {
    return false
  }
}

/** The jam's timing as the encoder needs it: room → audio shift and tempo; undefined unsynced. */
export type LiveTiming = () => { shift: number; bpm: number } | undefined

/**
 * A singer's live encoder: captures `input` (the voice after its preset) through the capture
 * worklet, encodes it as 20 ms Opus frames with WebCodecs, and stamps each with the room time it
 * was sung at: when its first sample reached the context, less `delay()` seconds (the singer's
 * round trip and the preset's own delay), on the jam's current shift.
 */
export class LiveEncoder {
  private seq = 0
  /** The context frame the capture's first sample was taken at, once the worklet says. */
  private startFrame?: number
  /** Samples captured since. */
  private captured = 0
  private readonly encoder: AudioEncoder
  private readonly capture: AudioWorkletNode

  static async open(
    ctx: AudioContext,
    input: AudioNode,
    options: { delay: () => number; timing: LiveTiming; onFrame: (frame: LiveFrame) => void },
  ): Promise<LiveEncoder> {
    await loadCapture(ctx)
    return new LiveEncoder(ctx, input, options)
  }

  private constructor(
    private readonly ctx: AudioContext,
    private readonly input: AudioNode,
    private readonly options: {
      delay: () => number
      timing: LiveTiming
      onFrame: (frame: LiveFrame) => void
    },
  ) {
    this.encoder = new AudioEncoder({
      output: (chunk) => this.onChunk(chunk),
      error: () => this.close(),
    })
    this.encoder.configure(config(ctx.sampleRate))
    this.capture = new AudioWorkletNode(ctx, CAPTURE_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
    })
    // Pulled by the speakers so it runs; it outputs silence.
    input.connect(this.capture).connect(ctx.destination)
    this.capture.port.onmessage = (
      e: MessageEvent<{ started?: number; samples?: Float32Array }>,
    ) => {
      const { started, samples } = e.data
      if (started !== undefined) this.startFrame = started
      if (samples && this.startFrame !== undefined) this.encode(samples)
    }
    this.capture.port.postMessage('start')
  }

  /** Hands a block to the encoder, timestamped with its context time (µs). */
  private encode(samples: Float32Array) {
    if (this.encoder.state !== 'configured') return
    const frame = this.startFrame! + this.captured
    this.captured += samples.length
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: this.ctx.sampleRate,
      numberOfFrames: samples.length,
      numberOfChannels: 1,
      timestamp: Math.round((frame / this.ctx.sampleRate) * 1e6),
      data: samples as Float32Array<ArrayBuffer>,
    })
    this.encoder.encode(data)
    data.close()
  }

  /** Stamps an encoded frame on the jam's current shift, so audio clock drift is followed. */
  private onChunk(chunk: EncodedAudioChunk) {
    const timing = this.options.timing()
    if (!timing) return
    const payload = new Uint8Array(chunk.byteLength)
    chunk.copyTo(payload)
    const stamp = liveStamp(chunk.timestamp / 1e6, this.options.delay(), timing.shift)
    this.options.onFrame({ seq: this.seq++, stamp, bpm: timing.bpm, payload })
  }

  close() {
    this.capture.port.onmessage = null
    this.capture.port.postMessage('stop')
    try {
      this.input.disconnect(this.capture)
    } catch {
      // Already let go.
    }
    this.capture.disconnect()
    if (this.encoder.state !== 'closed') this.encoder.close()
  }
}
