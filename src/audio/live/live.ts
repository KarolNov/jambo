import { BPM } from '../../../shared/board/schema'
import {
  encodeFrame,
  LIVE,
  LIVE_UNAVAILABLE,
  type LiveFrame,
  liveDelayMs,
  parseFrame,
} from '../../../shared/live'
import type { Engine } from '../engine'
import { type Key, keyName } from '../voice/dsp/tune'
import type { VoiceInput } from '../voice/input'
import { type PresetId, rackDelay } from '../voice/presets'
import type { VoiceLease } from '../voice/shared'
import { canEncode, LiveEncoder } from './encoder'
import { canDecode, LiveListener, type Played } from './listener'
import type { LiveSlot, SlotAnswer, SlotEnd } from './slot'
import type { LiveTransport } from './transport'

/** How many played frames the readout keeps. */
const KEEP_PLAYED = 200

/**
 * How long a voice goes without a frame before its listener is closed, in ms: longer than a bar at
 * the slowest tempo, so whatever it still had queued has played.
 */
const IDLE_MS = liveDelayMs(BPM.min) + 2_000

/** What singing live says when the room has no slot for it. */
const REFUSED: Record<Extract<SlotAnswer, { granted: false }>['why'], string> = {
  full: `This jam is full of live voices (${LIVE.maxVoices} at once).`,
  unseated: 'Not in the jam yet: try again in a moment.',
  offline: 'Not connected to the jam.',
}

/** What singing live says when the room ended it. */
const ENDED: Record<SlotEnd, string | undefined> = {
  hour: 'Live voice stops after an hour: turn it on again to carry on.',
  dropped: 'Live voice stopped: the connection to the jam dropped.',
  stopped: undefined,
}

/** What singing live says when its voice couldn't be published, so nobody would hear it. */
export const PUBLISH_FAILED = "Live voice stopped: couldn't reach the live voice service."

/** What singing live says when it is asked to start before this jam knows whether it can. */
export const STILL_CHECKING = 'Live voice is still starting: try again in a moment.'

/** How long starting to sing waits to learn whether live voice is set up here, in ms. */
const AVAILABLE_WAIT_MS = 3_000

/** Why singing live can't start in this browser at all. */
export const CANT_ENCODE = "This browser can't sing live."

/** What a listener's Who's here says when this browser can't play live voices. */
export const CANT_DECODE = "This browser can't play live voices."

/** How this client sings live: through which preset and key, and whether it hears itself. */
export interface LiveOptions {
  preset: PresetId
  key: Key
  /** Monitor through the preset while live, with no delay (never a bar late). */
  monitor?: boolean
}

/** The singer's side while live: its hold on the microphone, its preset's chain, and the encoder. */
interface Singing {
  lease: VoiceLease<VoiceInput>
  voice: VoiceInput
  /** The preset's chain into `bus`, swapped when the preset or key changes. */
  rack: { drop(): void }
  /** What the encoder captures: whichever chain is current. */
  bus: GainNode
  encoder: LiveEncoder
  options: LiveOptions
}

/**
 * Live voice in one jam: this client singing into the transport, and everyone else's voices played
 * from it, each one bar after it was sung, into the engine's live input. Listening starts once
 * audio has (frames that come before are dropped); singing is turned on and off with `sing`.
 */
export class Live {
  private singing?: Promise<Singing | undefined>
  private listeners = new Map<string, Promise<LiveListener | undefined>>()
  /** When each voice's last frame arrived (performance.now() ms), for closing idle listeners. */
  private heard = new Map<string, number>()
  private readonly sweep = setInterval(() => this.closeIdle(), 1_000)
  /** Why singing stopped by itself, if it did, for the readout. */
  error?: string
  /** People this listener has muted, by name: a mute follows them to each new voice id. */
  private mutedPeople = new Set<string>()
  /** Who is live, by name, as the room lists them: each one's voice id. */
  private voiceOf = new Map<string, string>()
  /** The voice ids muted now: the muted people's current voices. */
  private muted = new Set<string>()
  /** Counts `retune` calls, so one overtaken while its chain built does nothing. */
  private tunes = 0
  private changeListeners = new Set<() => void>()
  private stopTransport: () => void
  private stopFailed: () => void
  private stopSlot?: () => void
  private readonly availability: Promise<boolean>
  /**
   * Whether live voice is set up where this jam is served: undefined until known, false where the
   * Worker has neither Realtime credentials nor the local fake relay.
   */
  available?: boolean
  /** Frames sent, and the last few that played here, for the `?debug` readout and e2e tests. */
  readonly stats = { sent: 0, lastSent: undefined as LiveFrame | undefined, played: [] as Played[] }

  /**
   * `slot` is the room's say over who sings: without one (tests), singing needs no slot.
   * `available` says whether live voice is set up here at all (see `available`).
   */
  constructor(
    private readonly engine: Engine,
    private readonly transport: LiveTransport,
    private readonly slot?: LiveSlot,
    available: Promise<boolean> = Promise.resolve(true),
  ) {
    this.availability = available
    void available.then((on) => {
      this.available = on
      this.emit()
    })
    this.stopTransport = transport.onFrame((voice, bytes) => this.onFrame(voice, bytes))
    this.stopFailed = transport.onPublishFailed(() => {
      if (!this.singing) return
      this.error = PUBLISH_FAILED
      void this.stopSinging()
    })
    this.stopSlot = slot?.onEnd((why) => {
      if (!this.singing) return
      this.error = ENDED[why]
      void this.stopSinging()
    })
  }

  /** Whether this client is singing live (or starting to). */
  get live() {
    return this.singing !== undefined
  }

  /** Whether this browser can encode a live voice (it may still listen without). */
  static canSing(sampleRate = 48_000): Promise<boolean> {
    return canEncode(sampleRate)
  }

  /** Whether this browser can play others' live voices. */
  static canListen(): boolean {
    return canDecode()
  }

  /** Whether `person` (by name) is muted here. */
  isMuted(person: string) {
    return this.mutedPeople.has(person)
  }

  /**
   * Mutes or unmutes `person` (by name) for this listener only, whichever voice id they sing under
   * now or later: muted, their voice is unsubscribed from the transport and whatever of it was
   * queued stops at once; unmuted, it plays again from its next on-time frame.
   */
  mute(person: string, on: boolean) {
    if (on === this.mutedPeople.has(person)) return
    if (on) this.mutedPeople.add(person)
    else this.mutedPeople.delete(person)
    this.syncMuted()
    this.emit()
  }

  /** Who is live now, name to voice id, from the room's list: muted people's new voices stay muted. */
  setLive(voices: Map<string, string>) {
    this.voiceOf = voices
    this.syncMuted()
  }

  private syncMuted() {
    const want = new Set<string>()
    for (const person of this.mutedPeople) {
      const voice = this.voiceOf.get(person)
      if (voice) want.add(voice)
    }
    for (const voice of this.muted) {
      if (want.has(voice)) continue
      this.muted.delete(voice)
      this.transport.listen(voice, true)
    }
    for (const voice of want) {
      if (this.muted.has(voice)) continue
      this.muted.add(voice)
      this.transport.listen(voice, false)
      void this.listeners.get(voice)?.then((l) => l?.close())
      this.listeners.delete(voice)
      this.heard.delete(voice)
    }
  }

  /** Turns hearing yourself on or off while live. */
  setMonitor(on: boolean) {
    const current = this.singing
    void current?.then((s) => {
      if (!s || this.singing !== current) return
      s.options = { ...s.options, monitor: on }
      s.lease.monitor(on ? { preset: s.options.preset, key: s.options.key } : undefined)
    })
  }

  /** Sings through another preset or key from now on, staying live. */
  retune(preset: PresetId, key: Key) {
    const current = this.singing
    const call = ++this.tunes
    void current?.then(async (s) => {
      if (!s || (s.options.preset === preset && keyName(s.options.key) === keyName(key))) return
      const rack = await s.voice.liveRack(preset, key)
      // Stopped, or retuned again, while it built.
      if (this.singing !== current || call !== this.tunes) return rack.drop()
      rack.output.connect(s.bus)
      s.rack.drop()
      s.rack = rack
      s.options = { ...s.options, preset, key }
      if (s.options.monitor) s.lease.monitor({ preset, key })
    })
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
   * Starts or stops singing live. Starting asks the room for a live slot, then opens the microphone
   * (asking the first time); it throws an Error when the room has no slot to give or this browser
   * can't encode a live voice, and a `MicError` when the microphone can't be had.
   * Does nothing until audio has started and the clock is agreed.
   */
  async sing(on: boolean, options: LiveOptions): Promise<void> {
    if (!on) return this.stopSinging()
    const ctx = this.engine.audioContext
    if (this.singing || !ctx || !this.engine.liveTiming()) return
    const starting = this.startSinging(ctx, options)
    this.singing = starting
    this.error = undefined
    this.emit()
    try {
      await starting
      // Turned off while it started: `stopSinging` took it, and closes it.
      if (this.singing !== starting) return
    } catch (e) {
      // Turned off while it started: stopping it is why it failed, so there is nothing to say.
      if (this.singing !== starting) return
      this.singing = undefined
      this.emit()
      throw e
    }
  }

  private async startSinging(ctx: AudioContext, options: LiveOptions): Promise<Singing> {
    // Not before the Worker says live voice is set up here: else the voice would go nowhere.
    const available =
      this.available ??
      (await Promise.race([
        this.availability,
        new Promise<undefined>((r) => setTimeout(r, AVAILABLE_WAIT_MS)),
      ]))
    if (available === undefined) throw new Error(STILL_CHECKING)
    if (!available) throw new Error(LIVE_UNAVAILABLE)
    if (!(await canEncode(ctx.sampleRate))) throw new Error(CANT_ENCODE)
    const answer = await this.slot?.request()
    if (answer && !answer.granted) throw new Error(REFUSED[answer.why])
    // Published from the grant on, so listeners can subscribe while the microphone opens.
    if (answer) this.transport.publish(answer.voice)
    // The microphone a take's clips use too: holding M while live sings into both.
    const lease = this.engine.leaseVoice()
    let voice: VoiceInput
    try {
      voice = await lease.voice
    } catch (e) {
      lease.release()
      this.unpublish()
      throw e
    }
    try {
      const rack = await voice.liveRack(options.preset, options.key)
      const bus = ctx.createGain()
      rack.output.connect(bus)
      let singing: Singing | undefined
      const encoder: LiveEncoder = await LiveEncoder.open(ctx, bus, {
        onError: (e) => {
          // Only if it is still the encoder singing now.
          void this.singing?.then((s) => {
            if (s?.encoder !== encoder) return
            this.error = e.message
            void this.stopSinging()
          })
        },
        delay: () =>
          voice.latency.roundTrip +
          rackDelay(singing?.options.preset ?? options.preset, ctx.sampleRate),
        timing: () => this.engine.liveTiming(),
        onFrame: (frame) => {
          this.transport.send(encodeFrame(frame))
          this.stats.sent++
          this.stats.lastSent = frame
        },
      })
      singing = { lease, voice, rack, bus, encoder, options }
      if (options.monitor) lease.monitor({ preset: options.preset, key: options.key })
      return singing
    } catch (e) {
      lease.release()
      this.unpublish()
      throw e
    }
  }

  private async stopSinging() {
    const singing = this.singing
    if (!singing) return
    this.singing = undefined
    this.unpublish()
    this.emit()
    this.close(await singing?.catch(() => undefined))
  }

  /** Stops publishing and gives the slot back. */
  private unpublish() {
    this.transport.publish(undefined)
    this.slot?.release()
  }

  private close(s: Singing | undefined) {
    if (!s) return
    s.encoder.close()
    s.rack.drop()
    s.bus.disconnect()
    s.lease.release()
  }

  private onFrame(voice: string, bytes: Uint8Array) {
    const frame = parseFrame(bytes)
    const ctx = this.engine.audioContext
    const output = this.engine.liveInput
    if (!frame || !ctx || !output || this.muted.has(voice)) return
    this.heard.set(voice, performance.now())
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
      ).catch(() => undefined)
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

  /** Closes the listeners of voices that have stopped sending. */
  private closeIdle() {
    const now = performance.now()
    for (const [voice, at] of this.heard) {
      if (now - at < IDLE_MS) continue
      this.heard.delete(voice)
      void this.listeners.get(voice)?.then((l) => l?.close())
      this.listeners.delete(voice)
    }
  }

  dispose() {
    clearInterval(this.sweep)
    this.stopTransport()
    this.stopFailed()
    this.transport.close()
    this.stopSlot?.()
    void this.stopSinging()
    for (const l of this.listeners.values()) void l.then((x) => x?.close())
    this.listeners.clear()
    this.heard.clear()
    this.changeListeners.clear()
  }
}
