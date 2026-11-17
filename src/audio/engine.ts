import type { Hit, Track } from '../../shared/board'
import { BEATS_PER_BAR } from '../../shared/board'
import { barSeconds, beatSeconds, finishTake, hitsInWindow, nextBar } from '../../shared/looper'
import { click, renderKit } from './synth'

const LOOKAHEAD = 0.12 // seconds of audio scheduled ahead
const TICK_MS = 25

export type RecorderState =
  | { phase: 'idle' }
  | { phase: 'count-in'; recordStart: number }
  | { phase: 'recording'; recordStart: number }

interface Playing {
  track: Track
  startAt: number
  gain: GainNode
}

/**
 * The looper's audio: one AudioContext, the kit rendered into buffers, and a lookahead scheduler
 * that loops every unmuted track on this client's bar grid. React feeds it the board's state with
 * `update`; it never writes to the board. The recorder lives here because it needs the audio clock.
 */
export class Engine {
  private ctx?: AudioContext
  private master?: GainNode
  private buffers = new Map<string, AudioBuffer>()
  private origin = 0
  private scheduledUntil = 0
  private timer?: ReturnType<typeof setInterval>
  private bpm = 100
  private pads = new Map<string, string>()
  private playing = new Map<string, Playing>()
  /** Start times claimed for tracks this client just recorded, so they keep looping seamlessly. */
  private claimed = new Map<string, number>()
  private recorder: RecorderState = { phase: 'idle' }
  private takeHits: Hit[] = []
  private metronomeFrom = Infinity
  metronome = true
  private listeners = new Set<() => void>()

  get ready() {
    return !!this.ctx
  }

  get state(): RecorderState {
    return this.recorder
  }

  /** Starts audio. Browsers only allow it from a user gesture, so call it from a click or key. */
  async unlock() {
    if (this.ctx) return this.ctx.resume()
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.ctx = ctx
    this.master = ctx.createGain()
    this.master.gain.value = 0.8
    this.master.connect(ctx.destination)
    this.buffers = await renderKit(ctx.sampleRate)
    this.origin = ctx.currentTime + 0.05
    this.scheduledUntil = this.origin
    for (const p of this.playing.values()) this.attach(p)
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.emit()
  }

  dispose() {
    clearInterval(this.timer)
    void this.ctx?.close()
  }

  /** Subscribes to recorder state and readiness changes. */
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const l of this.listeners) l()
  }

  /** Feeds the board's current state: tempo, pad sounds, and every readable track by id. */
  update(state: { bpm: number; pads: Map<string, string>; tracks: Map<string, Track> }) {
    this.bpm = state.bpm
    this.pads = state.pads
    for (const [id, p] of this.playing) {
      if (!state.tracks.has(id)) {
        p.gain.disconnect()
        this.playing.delete(id)
      }
    }
    for (const [id, track] of state.tracks) {
      const existing = this.playing.get(id)
      if (existing) {
        existing.track = track
        this.setGain(existing)
        continue
      }
      const p: Playing = { track, startAt: this.claimed.get(id) ?? Infinity, gain: undefined! }
      this.claimed.delete(id)
      this.playing.set(id, p)
      if (this.ctx) this.attach(p)
    }
  }

  private attach(p: Playing) {
    const ctx = this.ctx!
    p.gain = ctx.createGain()
    p.gain.connect(this.master!)
    this.setGain(p)
    if (p.startAt === Infinity)
      p.startAt = nextBar(this.origin, this.bpm, ctx.currentTime + LOOKAHEAD)
  }

  private setGain(p: Playing) {
    if (!p.gain || !this.ctx) return
    p.gain.gain.setTargetAtTime(p.track.mute ? 0 : p.track.gain, this.ctx.currentTime, 0.01)
  }

  /** Plays a pad now, and records the hit if a take is running. */
  hitPad(padId: string) {
    const ctx = this.ctx
    if (!ctx) return
    this.play(this.pads.get(padId), ctx.currentTime, this.master!)
    if (this.recorder.phase !== 'idle') {
      const beat = (ctx.currentTime - this.recorder.recordStart) / beatSeconds(this.bpm)
      this.takeHits.push({ padId, beat })
    }
  }

  private play(soundId: string | undefined, at: number, out: AudioNode) {
    const buffer = soundId ? this.buffers.get(soundId) : undefined
    if (!buffer || !this.ctx) return
    const src = this.ctx.createBufferSource()
    src.buffer = buffer
    src.connect(out)
    src.start(at)
  }

  /** Starts a take: a one-bar count-in from the next bar line, then recording until `stop`. */
  record() {
    const ctx = this.ctx
    if (!ctx || this.recorder.phase !== 'idle') return
    const countStart = nextBar(this.origin, this.bpm, ctx.currentTime + 0.05)
    const recordStart = countStart + barSeconds(this.bpm)
    this.takeHits = []
    this.metronomeFrom = countStart
    this.recorder = { phase: 'count-in', recordStart }
    this.emit()
  }

  /**
   * Ends the take. Returns the new track's bars, hits and start time, or null when it is empty
   * or stopped during the count-in. The caller adds the track and claims its start with `claim`.
   */
  stop(): { bars: number; hits: Hit[]; startAt: number } | null {
    const ctx = this.ctx
    const rec = this.recorder
    this.recorder = { phase: 'idle' }
    this.metronomeFrom = Infinity
    this.emit()
    if (!ctx || rec.phase === 'idle') return null
    const elapsedBeats = (ctx.currentTime - rec.recordStart) / beatSeconds(this.bpm)
    if (elapsedBeats <= 0) return null
    const take = finishTake(this.takeHits, elapsedBeats)
    return take && { ...take, startAt: rec.recordStart }
  }

  /** Makes a track this client recorded keep looping from where its take started. */
  claim(trackId: string, startAt: number) {
    this.claimed.set(trackId, startAt)
  }

  /** Where each track is in its loop, from 0 to 1; undefined before it starts. */
  position(trackId: string): number | undefined {
    const p = this.playing.get(trackId)
    if (!p || !this.ctx || this.ctx.currentTime < p.startAt) return undefined
    const loop = p.track.bars * barSeconds(this.bpm)
    return ((this.ctx.currentTime - p.startAt) % loop) / loop
  }

  private tick() {
    const ctx = this.ctx!
    if (this.recorder.phase === 'count-in' && ctx.currentTime >= this.recorder.recordStart) {
      this.recorder = { phase: 'recording', recordStart: this.recorder.recordStart }
      this.emit()
    }
    const from = Math.max(this.scheduledUntil, ctx.currentTime)
    const to = ctx.currentTime + LOOKAHEAD
    if (to <= from) return
    for (const p of this.playing.values()) {
      if (!p.gain || p.track.mute) continue
      for (const hit of hitsInWindow(p.track, p.startAt, this.bpm, from, to)) {
        this.play(this.pads.get(hit.padId), hit.time, p.gain)
      }
    }
    if (this.metronome && this.metronomeFrom < to) {
      const beat = beatSeconds(this.bpm)
      const first = Math.ceil(
        (Math.max(from, this.metronomeFrom) - this.metronomeFrom) / beat - 1e-9,
      )
      for (let n = first; this.metronomeFrom + n * beat < to; n++) {
        click(ctx, this.master!, this.metronomeFrom + n * beat, n % BEATS_PER_BAR === 0)
      }
    }
    this.scheduledUntil = to
  }
}
