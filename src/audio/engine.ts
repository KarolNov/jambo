import type { Hit, Master, Track } from '../../shared/board'
import { BEATS_PER_BAR, BPM, soundOf } from '../../shared/board'
import {
  SHIFT_THRESHOLD_MS,
  audioShift,
  audioToRoom,
  heardAt,
  roomToAudio,
} from '../../shared/clock'
import {
  barMs,
  barStart,
  beatSeconds,
  ceilNear,
  finishTake,
  hitsInWindow,
  jamBeatMs,
  nextGridLine,
  nextJamBar,
  repeatLine,
  repeatSlice,
  swingDelay,
  trackStart,
} from '../../shared/looper'
import type { JamClock } from './clock'
import {
  ECHO_FEEDBACK,
  KNOB_RAMP,
  echoSeconds,
  pitchRate,
  reverbImpulse,
  throwEcho,
  toneFilter,
} from './knobs'
import { MASTER_SOUND_DEFAULTS, MasterChain, type MasterSound } from './master'
import type { SampleLoader } from './samples'
import { click, renderKit } from './synth'
import { keepAwake, preferPlayback } from './session'

const LOOKAHEAD = 0.12 // seconds of audio scheduled ahead
const TICK_MS = 25
/** How long a removed loop fades before its chain is disconnected. */
const RELEASE_MS = 100
/**
 * Room ms every window edge is moved back by, so a hit right on an edge (a grid line where repeat
 * changes, or where one tick's window ends) falls in exactly one window despite rounding.
 */
const EDGE_MS = 1e-3

/**
 * A stretch of beat repeat, from jam beat `at` until the next one's: off, or repeating the loops'
 * hits from the `slice` beats starting at jam beat `start`, at `level` against the loops.
 */
interface RepeatSpan {
  at: number
  start: number
  slice?: number
  level: number
}

/** A loop hit scheduled but maybe not yet started: what a repeat change cancels and plays again. */
interface Scheduled {
  /** Where the hit sits on the grid, in room ms, before swing. */
  grid: number
  /** When it starts, in audio seconds. */
  at: number
  source: AudioBufferSourceNode
  timer?: ReturnType<typeof setTimeout>
}

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

/** A pad sounding: played live by this client, or by a loop (`trackId`). */
export interface PadHit {
  padId: string
  trackId?: string
}

/**
 * A loop's chain: hits → filter (tone) → panner (pan) → gain (level, mute) → the master chain,
 * with the gain also feeding the shared reverb and echo through its sends, so a muted loop sends
 * nothing.
 */
interface Chain {
  filter: BiquadFilterNode
  panner: StereoPannerNode
  gain: GainNode
  reverb: GainNode
  echo: GainNode
}

/**
 * Makes the context the engine plays into. A live `AudioContext` gets the real-time lookahead,
 * is kept awake and announces hits as they are heard; an `OfflineAudioContext` gets none of that,
 * so a test can fill it with `scheduleWindow` and `hitPad` and render it.
 */
export type ContextFactory = () => AudioContext | OfflineAudioContext

const liveContext: ContextFactory = () => new AudioContext({ latencyHint: 'interactive' })

const isLive = (ctx: AudioContext | OfflineAudioContext): ctx is AudioContext =>
  !(ctx instanceof OfflineAudioContext)

interface Playing {
  id: string
  track: Track
  /** Undefined until audio starts. */
  chain?: Chain
  /** The targets last set on the chain, so unchanged ones aren't scheduled again. */
  applied?: Record<string, number | string>
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
  private ctx?: AudioContext | OfflineAudioContext
  /** The master gain: the master chain plays into it, and so do the clicks, which stay dry. */
  private master?: GainNode
  /** The master stage everything but the clicks plays through. */
  private chain?: MasterChain
  /** The board's master knobs, kept for when audio starts. */
  private masterSound: MasterSound = MASTER_SOUND_DEFAULTS
  /** The shared room every loop's reverb send feeds. */
  private reverb?: ConvolverNode
  /** The shared echo every loop's echo send feeds; its time follows the tempo. */
  private echo?: DelayNode
  /** The tempo the echo's time was last set for. */
  private echoBpm?: number
  /** The master throw's echo time last set, in seconds. */
  private throwSeconds?: number
  /** The board's master swing. */
  private swing = 0
  /** The board's repeat setting last fed. */
  private repeat?: Master['repeat']
  /** Beat repeat over time, by `at`; before the first span (or with none) it is off. */
  private repeats: RepeatSpan[] = []
  /** Loop hits scheduled and not yet started, so a repeat change can take them back. */
  private scheduled: Scheduled[] = []
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
  private hitListeners = new Set<(hit: PadHit) => void>()
  /** Timers that announce scheduled loop hits when they are heard. */
  private hitTimers = new Set<ReturnType<typeof setTimeout>>()
  private unsubscribeClock: () => void

  constructor(
    readonly clock: JamClock,
    /** The jam's uploaded sounds, played by id beside the kit. */
    readonly samples: SampleLoader,
    /** The context audio plays into; a live one unless a test renders offline. */
    private readonly createContext: ContextFactory = liveContext,
  ) {
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
    const ctx = this.createContext()
    if (isLive(ctx)) this.sleep = keepAwake(ctx)
    const master = ctx.createGain()
    master.gain.value = 0.8
    master.connect(ctx.destination)
    const chain = await MasterChain.create(ctx, master)
    const [left, right] = reverbImpulse(ctx.sampleRate)
    const impulse = ctx.createBuffer(2, left.length, ctx.sampleRate)
    impulse.copyToChannel(left, 0)
    impulse.copyToChannel(right, 1)
    const reverb = ctx.createConvolver()
    reverb.buffer = impulse
    reverb.connect(chain.input)
    const echo = ctx.createDelay(echoSeconds(BPM.min))
    echo.delayTime.value = echoSeconds(this.bpm)
    const feedback = ctx.createGain()
    feedback.gain.value = ECHO_FEEDBACK
    echo.connect(feedback).connect(echo)
    echo.connect(chain.input)
    this.buffers = await renderKit(ctx.sampleRate)
    this.samples.attach(ctx)
    this.ctx = ctx
    this.master = master
    this.chain = chain
    this.reverb = reverb
    this.echo = echo
    // The tempo and the master settings may have changed while the kit rendered.
    chain.set(this.masterSound, true)
    this.syncEcho()
    this.syncThrow()
    for (const p of this.playing.values()) this.attach(p)
    // Only a live context runs in real time; an offline one is scheduled up front and rendered.
    if (isLive(ctx)) this.timer = setInterval(() => this.tick(), TICK_MS)
    this.emit()
  }

  dispose() {
    this.sleep?.()
    clearInterval(this.timer)
    this.scheduled = []
    for (const t of this.hitTimers) clearTimeout(t)
    this.hitTimers.clear()
    this.hitListeners.clear()
    this.unsubscribeClock()
    this.samples.dispose()
    if (this.ctx && isLive(this.ctx)) void this.ctx.close()
  }

  /** Subscribes to recorder state, readiness and clock changes. */
  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const l of this.listeners) l()
  }

  /**
   * Subscribes to pads sounding, as they are heard: live hits at once, loop hits when the
   * scheduled sound leaves the speakers. For lighting pads; nothing here changes the board.
   */
  onHit(listener: (hit: PadHit) => void) {
    this.hitListeners.add(listener)
    return () => {
      this.hitListeners.delete(listener)
    }
  }

  private announce(hit: PadHit) {
    for (const l of this.hitListeners) l(hit)
  }

  /** Announces a loop hit scheduled for `at` (audio seconds) when it is heard. Returns its timer. */
  private announceAt(hit: PadHit, at: number) {
    const ctx = this.ctx
    // An offline render has no speakers to hear it from.
    if (this.hitListeners.size === 0 || !ctx || !isLive(ctx)) return undefined
    const delay = Math.max(0, heardAt(at, this.heard(ctx)) - performance.now())
    const t = setTimeout(() => {
      this.hitTimers.delete(t)
      this.announce(hit)
    }, delay)
    this.hitTimers.add(t)
    return t
  }

  /**
   * Feeds the board's current state: tempo, pad sounds, uploads, every readable track by id, and
   * the master settings (left as they are when not given; swing and repeat too).
   */
  update(state: {
    bpm: number
    pads: Map<string, string>
    tracks: Map<string, Track>
    uploads: ReadonlySet<string>
    master?: MasterSound & Partial<Pick<Master, 'swing' | 'repeat'>>
  }) {
    this.samples.sync(state.uploads)
    this.boardBpm = state.bpm
    if (this.recorder.phase === 'idle') this.bpm = this.boardBpm
    if (state.master) {
      const { tone, drive, width, filter, throw: echo, lofi, swing, repeat } = state.master
      this.masterSound = { tone, drive, width, filter, throw: echo, lofi }
      this.chain?.set(this.masterSound)
      if (swing !== undefined) this.swing = swing
      if (repeat) this.setRepeat(repeat)
    }
    this.syncEcho()
    this.syncThrow()
    this.pads = state.pads
    for (const [id, p] of this.playing) {
      if (!state.tracks.has(id)) {
        // Tracks added before audio started have no chain yet.
        if (p.chain) this.release(p.chain)
        this.playing.delete(id)
      }
    }
    for (const [id, track] of state.tracks) {
      const existing = this.playing.get(id)
      if (existing) {
        existing.track = track
        this.setSound(existing)
        continue
      }
      // Someone else's track plays from its current point in its loop; one this client just
      // recorded also plays what its second cycle has already passed.
      const p: Playing = { id, track }
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
    const ctx = this.ctx!
    const chain: Chain = {
      filter: ctx.createBiquadFilter(),
      panner: ctx.createStereoPanner(),
      gain: ctx.createGain(),
      reverb: ctx.createGain(),
      echo: ctx.createGain(),
    }
    chain.filter.connect(chain.panner).connect(chain.gain).connect(this.chain!.input)
    chain.gain.connect(chain.reverb).connect(this.reverb!)
    chain.gain.connect(chain.echo).connect(this.echo!)
    p.chain = chain
    p.applied = undefined
    this.setSound(p, true)
  }

  /** Fades a removed loop's chain out, so hits still ringing don't click, then disconnects it. */
  private release(chain: Chain) {
    chain.gain.gain.setTargetAtTime(0, this.ctx!.currentTime, KNOB_RAMP)
    setTimeout(() => {
      for (const node of Object.values(chain)) node.disconnect()
    }, RELEASE_MS)
  }

  /** Moves a loop's chain to its track's level, mute and knobs; `now` jumps there instead of ramping. */
  private setSound(p: Playing, now = false) {
    const ctx = this.ctx
    const chain = p.chain
    if (!chain || !ctx) return
    const applied = (p.applied ??= {})
    const set = (key: string, param: AudioParam, value: number) => {
      if (applied[key] === value) return
      applied[key] = value
      if (now) param.value = value
      else param.setTargetAtTime(value, ctx.currentTime, KNOB_RAMP)
    }
    const sound = soundOf(p.track)
    set('gain', chain.gain.gain, p.track.mute ? 0 : p.track.gain)
    set('reverb', chain.reverb.gain, sound.reverb)
    set('echo', chain.echo.gain, sound.echo)
    set('pan', chain.panner.pan, sound.pan)
    const tone = toneFilter(sound.tone, ctx.sampleRate / 2)
    // A type can't ramp, and the two sides are open at opposite ends, so a new type starts
    // straight at its own cutoff instead of sweeping from the old one's.
    if (applied.type !== tone.type) {
      applied.type = chain.filter.type = tone.type
      chain.filter.frequency.cancelScheduledValues(0)
      chain.filter.frequency.value = applied.frequency = tone.frequency
    } else set('frequency', chain.filter.frequency, tone.frequency)
  }

  /** Keeps the echo on a dotted eighth of the current tempo. */
  private syncEcho() {
    const echo = this.echo
    if (!echo || !this.ctx || this.echoBpm === this.bpm) return
    this.echoBpm = this.bpm
    const seconds = echoSeconds(this.bpm)
    echo.delayTime.setTargetAtTime(seconds, this.ctx.currentTime, KNOB_RAMP)
  }

  /**
   * Keeps the master throw's echo on its zone's note at the current tempo. A change waits for the
   * jam's next 1/16, so everyone hears it on the same grid line; before the clock is agreed (and
   * the first time) it applies at once. While the send is closed (Y 0, as after a reset) the time
   * stays, so echoes still sounding ring out at their own spacing; it moves once the send opens.
   */
  private syncThrow() {
    const ctx = this.ctx
    const chain = this.chain
    if (!ctx || !chain) return
    if (this.throwSeconds !== undefined && this.masterSound.throw.y === 0) return
    const seconds = throwEcho(this.masterSound.throw.x, 0).beats * beatSeconds(this.bpm)
    if (seconds === this.throwSeconds) return
    const first = this.throwSeconds === undefined
    this.throwSeconds = seconds
    const shift = this.shift
    if (first || shift === undefined) return chain.throwTime(seconds)
    const line = nextGridLine(audioToRoom(ctx.currentTime, shift), this.bpm)
    chain.throwTime(seconds, roomToAudio(line, shift))
  }

  /**
   * Follows the board's beat repeat. A move stamped with a new start beat takes effect on that
   * beat, the same one for every client; a move without one (an agent's, or a reset) takes effect
   * at this client's next grid line. A change of level alone applies at once. Loop hits already
   * scheduled past the change are taken back and scheduled again, so the change lands on its line
   * even when it arrives inside the lookahead.
   */
  private setRepeat(next: Master['repeat']) {
    const prev = this.repeat
    this.repeat = next
    const slice = next.y > 0 ? repeatSlice(next.x) : undefined
    const last = this.repeats.at(-1)
    const stamped = !prev || next.startBeat !== prev.startBeat
    if (!stamped && last?.slice === slice) {
      if (last) last.level = next.y
      return
    }
    let at = next.startBeat
    if (!stamped) {
      const ctx = this.ctx
      const now =
        ctx && this.shift !== undefined
          ? audioToRoom(ctx.currentTime, this.shift)
          : (this.clock.now() ?? 0)
      at = repeatLine(now, this.bpm, slice)
    }
    // A span that never started gives way to one starting at or before it.
    while (this.repeats.length > 0 && this.repeats.at(-1)!.at >= at) this.repeats.pop()
    this.repeats.push({ at, start: at, slice, level: next.y })
    this.redo(jamBeatMs(at, this.bpm))
  }

  /** Takes back the loop hits scheduled on the grid at or after room time `from`, and schedules them again. */
  private redo(from: number) {
    const ctx = this.ctx
    const shift = this.shift
    if (!ctx || shift === undefined || from >= this.scheduledUntil) return
    // What has started stays; the change can only apply from now on.
    const start = Math.max(from, audioToRoom(ctx.currentTime, shift))
    this.scheduled = this.scheduled.filter((s) => {
      if (s.grid < start - EDGE_MS || s.at <= ctx.currentTime) return true
      s.source.stop()
      if (s.timer !== undefined) {
        clearTimeout(s.timer)
        this.hitTimers.delete(s.timer)
      }
      return false
    })
    this.scheduleLoops(start, this.scheduledUntil, shift)
  }

  /** Plays a pad now, and records the hit if a take is running. */
  hitPad(padId: string) {
    const ctx = this.ctx
    if (!ctx) return
    // Live pads are part of the mix, so they go through the master stage too.
    this.play(this.pads.get(padId), ctx.currentTime, this.chain!.input)
    this.announce({ padId })
    const now = this.heardNow()
    if (this.recorder.phase !== 'idle' && now !== undefined) {
      // People play to what they hear: the room time of what is leaving the speakers now, on the
      // same shift the clicks were scheduled with, so a hit right on a click lands on its beat.
      const beat = (now - this.recorder.recordStart) / (beatSeconds(this.bpm) * 1000)
      this.takeHits.push({ padId, beat })
    }
  }

  private play(soundId: string | undefined, at: number, out: AudioNode, rate = 1, level = 1) {
    // An upload that hasn't loaded yet plays nothing; its hits sound once it has.
    const buffer = soundId ? (this.buffers.get(soundId) ?? this.samples.get(soundId)) : undefined
    const ctx = this.ctx
    if (!buffer || !ctx) return undefined
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.playbackRate.value = rate
    if (level === 1) src.connect(out)
    else {
      const gain = ctx.createGain()
      gain.gain.value = level
      src.connect(gain).connect(out)
    }
    src.start(at)
    return src
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
    this.syncEcho()
    this.syncThrow()
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

  /**
   * The take so far, as heard: `beat` counts from its first beat (negative before it, during the
   * count-in) and `hits` are those played so far, unsnapped. Undefined between takes.
   */
  take(): { beat: number; hits: readonly Hit[] } | undefined {
    const rec = this.recorder
    const now = this.heardNow()
    if (rec.phase === 'idle' || now === undefined) return undefined
    return { beat: (now - rec.recordStart) / (beatSeconds(this.bpm) * 1000), hits: this.takeHits }
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
    if (!ctx || !isLive(ctx) || this.shift === undefined) return undefined
    const h = this.heard(ctx)
    return audioToRoom(h.contextTime + (performance.now() - h.performanceTime) / 1000, this.shift)
  }

  /** Sets the first shift once the clock is agreed. Returns whether there is one. */
  private ensureShift(): boolean {
    if (this.shift !== undefined) return true
    const ctx = this.ctx
    if (!ctx || !isLive(ctx) || this.clock.offset === undefined) return false
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
    // Ticks only run on a live context.
    const ctx = this.ctx as AudioContext
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
        this.scheduleWindow(from, line, this.shift!, this.recorder)
        this.shift = this.pendingShift
        this.pendingShift = undefined
        // Everything before the line is scheduled. A forward jump (audio suspended, a big offset
        // correction) skips what is already past instead of playing it all at once.
        from = Math.max(line, audioToRoom(ctx.currentTime, this.shift))
        this.scheduledUntil = from
        to = audioToRoom(ctx.currentTime + LOOKAHEAD, this.shift)
      }
    }
    this.scheduleWindow(from, to, this.shift!, this.recorder)
    this.scheduledUntil = Math.max(this.scheduledUntil, to)
    this.scheduled = this.scheduled.filter((s) => s.at > ctx.currentTime)
    // Repeat spans that ended a while ago are done with.
    const past = audioToRoom(ctx.currentTime, this.shift!) - 1000
    while (this.repeats.length > 1 && jamBeatMs(this.repeats[1]!.at, this.bpm) <= past)
      this.repeats.shift()
  }

  /** Schedules every unmuted loop's hits on the grid in room window [from, to). */
  private scheduleLoops(from: number, to: number, shift: number) {
    for (const p of this.playing.values()) this.scheduleLoop(p, from, to, shift)
  }

  /**
   * Schedules one loop's hits on the grid in room window [from, to): each sounds swung, and while
   * repeat is on the loop plays its repeated slice at the repeat's level and itself at the rest.
   */
  private scheduleLoop(p: Playing, from: number, to: number, shift: number) {
    const ctx = this.ctx
    const chain = p.chain
    if (!ctx || !chain || p.track.mute || to <= from) return
    // Pitch is read per hit, so a change applies from the next one.
    const rate = pitchRate(soundOf(p.track).pitch)
    const bpm = this.bpm
    const beatMs = beatSeconds(bpm) * 1000
    const origin = trackStart(p.track, bpm) / 1000
    // Edges move back a hair, so a hit on one lands in exactly one window (see `EDGE_MS`).
    const grid = (a: number, b: number) =>
      hitsInWindow(p.track, origin, bpm, (a - EDGE_MS) / 1000, (b - EDGE_MS) / 1000)
    const sound = (padId: string, gridMs: number, beat: number, level: number) => {
      if (level <= 0) return
      const swung = gridMs + swingDelay(beat, this.swing) * beatMs
      const at = Math.max(ctx.currentTime, roomToAudio(swung, shift))
      const source = this.play(this.pads.get(padId), at, chain.filter, rate, level)
      if (!source) return
      const timer = this.announceAt({ padId, trackId: p.id }, at)
      this.scheduled.push({ grid: gridMs, at, source, timer })
    }
    // The window in parts, one per repeat span it crosses.
    const spans = this.repeats
    let a = from
    for (let i = -1; i < spans.length && a < to; i++) {
      const span = spans[i]
      const next = spans[i + 1]
      const b = next ? Math.min(to, jamBeatMs(next.at, bpm)) : to
      if (b <= a) continue
      const level = span?.slice === undefined ? 0 : span.level
      for (const h of grid(a, b)) sound(h.padId, h.time * 1000, h.beat, 1 - level)
      if (span?.slice !== undefined && level > 0) {
        const start = jamBeatMs(span.start, bpm)
        const length = span.slice * beatMs
        const slice = grid(start, start + length)
        // Each repeat plays the slice's hits again at the same offsets, swung as they were.
        for (let k = Math.max(0, Math.floor((a - start) / length)); start + k * length < b; k++)
          for (const h of slice) {
            const at = h.time * 1000 + k * length
            if (at >= a - EDGE_MS && at < b - EDGE_MS) sound(h.padId, at, h.beat, level)
          }
      }
      a = b
    }
  }

  /**
   * Schedules everything in room window [from, to) (room ms) onto the context, at audio time
   * `room / 1000 + shift`: every unmuted loop's hits through its chain (swung and repeated as the
   * master says), and the clicks `recorder` calls for (the count-in, and the metronome while
   * recording). The lookahead calls it each tick; an offline render calls it once before rendering.
   * Does nothing before audio starts.
   */
  scheduleWindow(from: number, to: number, shift: number, recorder: RecorderState) {
    const ctx = this.ctx
    if (!ctx || to <= from) return
    for (const p of this.playing.values()) {
      // A just-recorded track's next loop may have begun before it was added: play what it missed now.
      if (p.catchUpFrom !== undefined && p.catchUpFrom < from)
        this.scheduleLoop(p, p.catchUpFrom, from, shift)
      p.catchUpFrom = undefined
    }
    this.scheduleLoops(from, to, shift)
    // Clicks only around a take: always during the count-in, and while recording if the metronome is on.
    const rec = recorder
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
