import type { Hit, Track } from '../../shared/board'
import { BEATS_PER_BAR } from '../../shared/board'
import { SHIFT_THRESHOLD_MS, audioShift, audioToRoom, roomToAudio } from '../../shared/clock'
import {
  barMs,
  barStart,
  beatSeconds,
  ceilNear,
  finishTake,
  hitsInWindow,
  nextJamBar,
  trackStart,
} from '../../shared/looper'
import type { JamClock } from './clock'
import { click, renderKit } from './synth'
import { keepAwake, preferPlayback } from './session'

const LOOKAHEAD = 0.12 // seconds of audio scheduled ahead
const TICK_MS = 25

/**
 * The recorder's phases. Times are room ms on the jam's clock: `countStart` is the count-in's first
 * click, `recordStart` the take's first beat (one bar later).
 */
export type RecorderState =
  | { phase: 'idle' }
  | {
      phase: 'waiting' | 'count-in' | 'recording'
      countStart: number
      recordStart: number
      /** The jam bar the take begins on (`recordStart`'s bar). */
      recordBar: number
    }

interface Playing {
  track: Track
  gain: GainNode
  /** For a track this client just recorded: schedule from here (room ms) once, so hits missed since its loop came round still sound. */
  catchUpFrom?: number
}

/**
 * The looper's audio: one AudioContext, the kit rendered into buffers, and a lookahead scheduler
 * that loops every unmuted track on the jam's shared bar grid. The grid lives on the room's clock
 * (see `JamClock`); `shift` maps room time onto this context's timeline so that a sound scheduled
 * for room time t leaves this client's speakers at t. React feeds it the board's state with
 * `update`; it never writes to the board. The recorder lives here because it needs the audio clock.
 */
export class Engine {
  private ctx?: AudioContext
  private master?: GainNode
  private buffers = new Map<string, AudioBuffer>()
  /** Room ms → audio seconds: `audio = room / 1000 + shift`. Undefined until the clock is agreed. */
  private shift?: number
  /** A new shift waiting for the next bar line, so the grid never jumps mid-bar. */
  private pendingShift?: number
  /** Room ms scheduled up to. */
  private scheduledUntil = 0
  private timer?: ReturnType<typeof setInterval>
  private bpm = 100
  /** The board's tempo; it reaches `bpm` only between takes, so a take keeps one tempo. */
  private boardBpm = 100
  private starting?: Promise<void>
  /** Stops resuming the context after iOS interrupts it. */
  private sleep?: () => void
  private pads = new Map<string, string>()
  private playing = new Map<string, Playing>()
  /** Tracks this client just recorded, by the tempo their take ran at, so they keep looping seamlessly. */
  private claimed = new Map<string, number>()
  /** The tempo of the last take `stop` returned. */
  private takeBpm?: number
  private recorder: RecorderState = { phase: 'idle' }
  private takeHits: Hit[] = []
  /** While it is on, the metronome clicks every beat of a take. */
  metronome = loadMetronome()
  private listeners = new Set<() => void>()
  private unsubscribeClock: () => void

  constructor(readonly clock: JamClock) {
    this.unsubscribeClock = clock.subscribe(() => this.emit())
  }

  get ready() {
    return !!this.ctx
  }

  /** Whether this client has agreed its clock with the jam; recording waits for it. */
  get synced() {
    return this.clock.synced
  }

  get state(): RecorderState {
    return this.recorder
  }

  /** Starts audio. Browsers only allow it from a user gesture, so call it from a click or key. */
  async unlock() {
    if (this.ctx) return this.ctx.resume()
    this.starting ??= this.start()
    return this.starting
  }

  /** Creates the context (still inside the gesture), renders the kit, then goes live all at once. */
  private async start() {
    preferPlayback()
    const ctx = new AudioContext({ latencyHint: 'interactive' })
    this.sleep = keepAwake(ctx)
    const master = ctx.createGain()
    master.gain.value = 0.8
    master.connect(ctx.destination)
    this.buffers = await renderKit(ctx.sampleRate)
    this.ctx = ctx
    this.master = master
    for (const p of this.playing.values()) this.attach(p)
    this.timer = setInterval(() => this.tick(), TICK_MS)
    this.emit()
  }

  dispose() {
    this.sleep?.()
    clearInterval(this.timer)
    this.unsubscribeClock()
    void this.ctx?.close()
  }

  /** Subscribes to recorder state, readiness and clock changes. */
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const l of this.listeners) l()
  }

  /** Feeds the board's current state: tempo, pad sounds, and every readable track by id. */
  update(state: { bpm: number; pads: Map<string, string>; tracks: Map<string, Track> }) {
    this.boardBpm = state.bpm
    if (this.recorder.phase === 'idle') this.bpm = this.boardBpm
    this.pads = state.pads
    for (const [id, p] of this.playing) {
      if (!state.tracks.has(id)) {
        // Tracks added before audio started have no gain node yet.
        p.gain?.disconnect()
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
      // Someone else's track plays from its current point in its loop; one this client just
      // recorded also plays what its second cycle has already passed.
      const p: Playing = { track, gain: undefined! }
      const takeBpm = this.claimed.get(id)
      this.claimed.delete(id)
      // A take whose tempo changed under it has no second cycle on this grid to catch up with.
      if (takeBpm === this.bpm)
        p.catchUpFrom = trackStart(track, this.bpm) + track.bars * barMs(this.bpm)
      this.playing.set(id, p)
      if (this.ctx) this.attach(p)
    }
  }

  private attach(p: Playing) {
    p.gain = this.ctx!.createGain()
    p.gain.connect(this.master!)
    this.setGain(p)
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
    const now = this.heardNow()
    if (this.recorder.phase !== 'idle' && now !== undefined) {
      // People play to what they hear: the room time of what is leaving the speakers now, on the
      // same shift the clicks were scheduled with, so a hit right on a click lands on its beat.
      const beat = (now - this.recorder.recordStart) / (beatSeconds(this.bpm) * 1000)
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

  /**
   * Starts a take: a one-bar count-in from the jam's next bar, then recording until `stop`.
   * Does nothing until audio is on and the clock is agreed.
   */
  record() {
    const ctx = this.ctx
    if (!ctx || this.recorder.phase !== 'idle' || !this.ensureShift()) return
    // Not before what is already scheduled, or the count-in's first click would be skipped.
    const earliest = Math.max(this.scheduledUntil, audioToRoom(ctx.currentTime + 0.05, this.shift!))
    const countBar = nextJamBar(earliest, this.bpm)
    this.takeHits = []
    this.recorder = {
      phase: 'waiting',
      countStart: barStart(countBar, this.bpm),
      recordStart: barStart(countBar + 1, this.bpm),
      recordBar: countBar + 1,
    }
    this.advanceRecorder()
    this.emit()
  }

  /**
   * Ends the take. Returns the new track's bars, hits and jam start bar, or null when it is empty
   * or stopped before recording began. The caller adds the track and claims it with `claim`.
   */
  stop(): { bars: number; hits: Hit[]; startBar: number } | null {
    const rec = this.recorder
    this.recorder = { phase: 'idle' }
    this.emit()
    const now = this.heardNow()
    if (rec.phase === 'idle' || now === undefined) return null
    const elapsedBeats = (now - rec.recordStart) / (barMs(this.bpm) / BEATS_PER_BAR)
    const take = elapsedBeats > 0 ? finishTake(this.takeHits, elapsedBeats) : null
    this.takeBpm = this.bpm
    // A tempo change that arrived during the take applies now.
    this.bpm = this.boardBpm
    return take && { ...take, startBar: rec.recordBar }
  }

  /** Turns the metronome on or off; remembered in this browser. */
  setMetronome(on: boolean) {
    this.metronome = on
    try {
      localStorage.setItem(METRONOME_KEY, on ? '1' : '0')
    } catch {
      // Not remembered; fine.
    }
    this.emit()
  }

  /** Marks a track as one this client just recorded, so it keeps looping from where its take started. */
  claim(trackId: string) {
    if (this.takeBpm !== undefined) this.claimed.set(trackId, this.takeBpm)
  }

  /** Where each track is in its loop, from 0 to 1, as heard; undefined before it starts. */
  position(trackId: string): number | undefined {
    const p = this.playing.get(trackId)
    const now = this.heardNow()
    if (!p || now === undefined) return undefined
    const start = trackStart(p.track, this.bpm)
    if (now < start) return undefined
    const loop = p.track.bars * barMs(this.bpm)
    return ((now - start) % loop) / loop
  }

  /** For the `?debug` readout: the next downbeat, in room ms. */
  nextDownbeat(): number | undefined {
    const now = this.clock.now()
    return now === undefined ? undefined : barStart(nextJamBar(now, this.bpm), this.bpm)
  }

  /**
   * Pairs an audio time with the `performance.now()` at which it leaves the speakers. Browsers
   * that report output timestamps already include output latency; otherwise subtract it.
   */
  private heard(ctx: AudioContext) {
    const ts = ctx.getOutputTimestamp?.()
    if (ts?.contextTime && ts.performanceTime)
      return { contextTime: ts.contextTime, performanceTime: ts.performanceTime }
    return {
      contextTime: ctx.currentTime - (ctx.outputLatency || 0) - ctx.baseLatency,
      performanceTime: performance.now(),
    }
  }

  /** The room time of what is leaving the speakers now, on the current shift; undefined without one. */
  private heardNow(): number | undefined {
    const ctx = this.ctx
    if (!ctx || this.shift === undefined) return undefined
    const h = this.heard(ctx)
    return audioToRoom(h.contextTime + (performance.now() - h.performanceTime) / 1000, this.shift)
  }

  /** Sets the first shift once the clock is agreed. Returns whether there is one. */
  private ensureShift(): boolean {
    if (this.shift !== undefined) return true
    const ctx = this.ctx
    if (!ctx || this.clock.offset === undefined) return false
    this.shift = audioShift(this.heard(ctx), this.clock.offset, performance.timeOrigin)
    this.scheduledUntil = audioToRoom(ctx.currentTime, this.shift)
    return true
  }

  private advanceRecorder() {
    const rec = this.recorder
    const now = this.clock.now()
    if (rec.phase === 'idle' || now === undefined) return
    const phase =
      now >= rec.recordStart ? 'recording' : now >= rec.countStart ? 'count-in' : 'waiting'
    if (phase !== rec.phase) {
      this.recorder = { ...rec, phase }
      this.emit()
    }
  }

  private tick() {
    const ctx = this.ctx!
    this.advanceRecorder()
    // Loops wait for the clock; once it is agreed they start on the jam's grid.
    if (!this.ensureShift()) return
    const candidate = audioShift(this.heard(ctx), this.clock.offset!, performance.timeOrigin)
    // Jitter is ignored; real moves (a new offset, audio clock drift) wait for the next bar line.
    if (Math.abs(candidate - this.shift!) * 1000 >= SHIFT_THRESHOLD_MS)
      this.pendingShift = candidate
    else this.pendingShift = undefined

    let from = this.scheduledUntil
    let to = audioToRoom(ctx.currentTime + LOOKAHEAD, this.shift!)
    if (this.pendingShift !== undefined) {
      const line = barStart(nextJamBar(from, this.bpm), this.bpm)
      if (line < to) {
        this.schedule(from, line)
        this.shift = this.pendingShift
        this.pendingShift = undefined
        // Everything before the line is scheduled. A forward jump (audio suspended, a big offset
        // correction) skips what is already past instead of playing it all at once.
        from = Math.max(line, audioToRoom(ctx.currentTime, this.shift))
        this.scheduledUntil = from
        to = audioToRoom(ctx.currentTime + LOOKAHEAD, this.shift)
      }
    }
    this.schedule(from, to)
    this.scheduledUntil = Math.max(this.scheduledUntil, to)
  }

  /** Schedules everything in room window [from, to). */
  private schedule(from: number, to: number) {
    if (to <= from) return
    const ctx = this.ctx!
    const shift = this.shift!
    for (const p of this.playing.values()) {
      // A just-recorded track's next loop may have begun before it was added: play what it missed now.
      const start = Math.min(from, p.catchUpFrom ?? from)
      p.catchUpFrom = undefined
      if (!p.gain || p.track.mute) continue
      const origin = trackStart(p.track, this.bpm) / 1000
      for (const hit of hitsInWindow(p.track, origin, this.bpm, start / 1000, to / 1000)) {
        const at = Math.max(ctx.currentTime, roomToAudio(hit.time * 1000, shift))
        this.play(this.pads.get(hit.padId), at, p.gain)
      }
    }
    // Clicks only around a take: always during the count-in, and while recording if the metronome is on.
    const rec = this.recorder
    if (rec.phase === 'idle') return
    const beat = beatSeconds(this.bpm) * 1000
    // Beat indices, not times, bound the window, so a beat on the edge falls in exactly one.
    for (let n = ceilNear(from / beat), end = ceilNear(to / beat); n < end; n++) {
      const at = n * beat
      const counting = at >= rec.countStart - 1e-3 && at < rec.recordStart - 1e-3
      const recording = at >= rec.recordStart - 1e-3
      if (counting || (this.metronome && recording))
        click(ctx, this.master!, roomToAudio(at, shift), n % BEATS_PER_BAR === 0)
    }
  }
}

const METRONOME_KEY = 'jambo.metronome'

function loadMetronome(): boolean {
  try {
    return localStorage.getItem(METRONOME_KEY) !== '0'
  } catch {
    return true
  }
}
