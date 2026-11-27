import { encodeFrame, type LiveFrame, parseFrame } from '../../../shared/live'
import type { Engine } from '../engine'
import type { Key } from '../voice/dsp/tune'
import { VoiceInput } from '../voice/input'
import { type PresetId, rackDelay } from '../voice/presets'
import { canEncode, LiveEncoder } from './encoder'
import { LiveListener, type Played } from './listener'
import type { LiveTransport } from './transport'

/** How many played frames the readout keeps. */
const KEEP_PLAYED = 200

/** How this client sings live: through which preset and key. */
export interface LiveOptions {
  preset: PresetId
  key: Key
}

/** The singer's side while live: the microphone, its preset, and the encoder. */
interface Singing {
  voice: VoiceInput
  rack: { drop(): void }
  encoder: LiveEncoder
}

/**
 * Live voice in one jam: this client singing into the transport, and everyone else's voices played
 * from it, each one bar after it was sung, into the engine's live input. Listening starts once
 * audio has (frames that come before are dropped); singing is turned on and off with `sing`.
 */
export class Live {
  private singing?: Promise<Singing | undefined>
  private listeners = new Map<string, Promise<LiveListener | undefined>>()
  private changeListeners = new Set<() => void>()
  private stopTransport: () => void
  /** Frames sent, and the last few that played here, for the `?debug` readout and e2e tests. */
  readonly stats = { sent: 0, lastSent: undefined as LiveFrame | undefined, played: [] as Played[] }

  constructor(
    private readonly engine: Engine,
    private readonly transport: LiveTransport,
  ) {
    this.stopTransport = transport.onFrame((voice, bytes) => this.onFrame(voice, bytes))
  }

  /** Whether this client is singing live (or starting to). */
  get live() {
    return this.singing !== undefined
  }

  /** Frames dropped here so far, across every voice. */
  async dropped(): Promise<number> {
    let n = 0
    for (const l of this.listeners.values()) n += (await l)?.dropped ?? 0
    return n
  }

  subscribe(listener: () => void) {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  private emit() {
    for (const l of this.changeListeners) l()
  }

  /**
   * Starts or stops singing live. Starting opens the microphone (asking the first time) and throws
   * a `MicError` when it can't be had, or an Error when this browser can't encode a live voice.
   * Does nothing until audio has started and the clock is agreed.
   */
  async sing(on: boolean, options: LiveOptions): Promise<void> {
    if (!on) return this.stopSinging()
    const ctx = this.engine.audioContext
    if (this.singing || !ctx || !this.engine.liveTiming()) return
    const starting = this.startSinging(ctx, options)
    this.singing = starting
    this.emit()
    try {
      const s = await starting
      // Turned off while it started.
      if (this.singing !== starting) this.close(s)
    } catch (e) {
      if (this.singing === starting) this.singing = undefined
      this.emit()
      throw e
    }
  }

  private async startSinging(ctx: AudioContext, { preset, key }: LiveOptions): Promise<Singing> {
    if (!(await canEncode(ctx.sampleRate))) throw new Error("This browser can't sing live.")
    const voice = await VoiceInput.open(ctx)
    try {
      const rack = await voice.liveRack(preset, key)
      const encoder = await LiveEncoder.open(ctx, rack.output, {
        delay: () => voice.latency.roundTrip + rackDelay(preset, ctx.sampleRate),
        timing: () => this.engine.liveTiming(),
        onFrame: (frame) => {
          this.transport.send(encodeFrame(frame))
          this.stats.sent++
          this.stats.lastSent = frame
        },
      })
      return { voice, rack, encoder }
    } catch (e) {
      voice.close()
      throw e
    }
  }

  private async stopSinging() {
    const singing = this.singing
    this.singing = undefined
    this.emit()
    this.close(await singing?.catch(() => undefined))
  }

  private close(s: Singing | undefined) {
    if (!s) return
    s.encoder.close()
    s.rack.drop()
    s.voice.close()
  }

  private onFrame(voice: string, bytes: Uint8Array) {
    const frame = parseFrame(bytes)
    const ctx = this.engine.audioContext
    const output = this.engine.liveInput
    if (!frame || !ctx || !output) return
    let listener = this.listeners.get(voice)
    if (!listener) {
      listener = LiveListener.open(
        ctx,
        output,
        voice,
        () => this.engine.liveTiming(),
        (p) => {
          this.stats.played.push(p)
          if (this.stats.played.length > KEEP_PLAYED) this.stats.played.shift()
        },
      )
      // A voice whose listener couldn't start is tried again on its next frame.
      void listener.then((l) => {
        if (!l && this.listeners.get(voice) === listener) this.listeners.delete(voice)
      })
      this.listeners.set(voice, listener)
      // Frames sung before this listener started are dropped anyway.
      return
    }
    void listener.then((l) => l?.push(frame))
  }

  dispose() {
    this.stopTransport()
    this.transport.close()
    void this.stopSinging()
    for (const l of this.listeners.values()) void l.then((x) => x?.close())
    this.listeners.clear()
    this.changeListeners.clear()
  }
}
