import playbackUrl from './playback.worklet.ts?worker&url'

/** The name `playback.worklet.ts` registers its processor under. */
const PLAYBACK_PROCESSOR = 'jambo-live-playback'

/** The playback worklet, loaded once per context. */
const loaded = new WeakMap<BaseAudioContext, Promise<void>>()
function loadPlayback(ctx: BaseAudioContext): Promise<void> {
  let load = loaded.get(ctx)
  if (!load) {
    load = ctx.audioWorklet.addModule(playbackUrl)
    loaded.set(ctx, load)
    load.catch(() => loaded.delete(ctx))
  }
  return load
}

/** What became of a frame handed to playback. */
export type PlaybackEvent = { played: number; frame: number } | { late: number }

/**
 * One live voice's playback: decoded frames go to the playback worklet with the context frame
 * each starts on, and it plays them there, mono, into `output` (the engine's live input).
 */
export class LivePlayback {
  private listeners = new Set<(e: PlaybackEvent) => void>()

  static async open(ctx: AudioContext, output: AudioNode): Promise<LivePlayback> {
    await loadPlayback(ctx)
    return new LivePlayback(ctx, output)
  }

  private readonly node: AudioWorkletNode

  private constructor(
    private readonly ctx: AudioContext,
    output: AudioNode,
  ) {
    this.node = new AudioWorkletNode(ctx, PLAYBACK_PROCESSOR, {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    })
    this.node.connect(output)
    this.node.port.onmessage = (e: MessageEvent<PlaybackEvent>) => {
      for (const l of this.listeners) l(e.data)
    }
  }

  /** Plays `samples` (at the context's rate) from audio time `at`; `id` names it in events. */
  play(id: number, at: number, samples: Float32Array) {
    const frame = Math.round(at * this.ctx.sampleRate)
    this.node.port.postMessage({ id, at: frame, samples }, [samples.buffer])
  }

  /** Calls `listener` as each frame starts playing, or is found too late to. */
  onEvent(listener: (e: PlaybackEvent) => void) {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  close() {
    this.listeners.clear()
    this.node.port.onmessage = null
    this.node.port.postMessage('clear')
    this.node.disconnect()
  }
}
