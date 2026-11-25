import { BPM, type Master } from '../../shared/board'
import { beatSeconds } from '../../shared/looper'
import crusherUrl from './crusher.worklet.ts?worker&url'
import {
  DRIVE_HEADROOM,
  driveCurve,
  driveGlue,
  filterSweep,
  KNOB_RAMP,
  lofiCrush,
  THROW_BEATS,
  throwEcho,
  toneFilter,
  widthGains,
} from './knobs'

/** The master settings the chain plays. Swing and repeat are the scheduler's, not the chain's. */
export type MasterSound = Pick<Master, 'tone' | 'drive' | 'width' | 'filter' | 'throw' | 'lofi'>

/** The name `crusher.worklet.ts` registers its processor under. */
const CRUSHER_PROCESSOR = 'jambo-crusher'

/** The longest throw: its longest echo at the slowest tempo. */
const THROW_MAX_SECONDS = THROW_BEATS[THROW_BEATS.length - 1]! * beatSeconds(BPM.min)

/** What a feedback loop adds to its delay's time on each pass, by sample rate, once measured. */
const loopLatencies = new Map<number, Promise<number>>()

/**
 * Seconds a feedback loop through a DelayNode adds on each pass beyond the delay's own time.
 * Chromium breaks the cycle a render quantum late, so each repeat would land 128 frames later
 * than the one before and the throw would drift off the grid; other engines may add nothing.
 * Measured once per sample rate by rendering a short loop offline.
 */
function loopLatency(sampleRate: number): Promise<number> {
  let latency = loopLatencies.get(sampleRate)
  if (!latency) {
    const frames = 256
    const ctx = new OfflineAudioContext(1, frames * 4, sampleRate)
    const impulse = ctx.createBuffer(1, 1, sampleRate)
    impulse.getChannelData(0)[0] = 1
    const src = ctx.createBufferSource()
    src.buffer = impulse
    const delay = ctx.createDelay(1)
    delay.delayTime.value = frames / sampleRate
    const loop = ctx.createGain()
    src.connect(delay).connect(loop).connect(delay)
    delay.connect(ctx.destination)
    src.start()
    latency = ctx.startRendering().then(
      (out) => {
        // The first repeat is at `frames`; the second shows what the loop added.
        const data = out.getChannelData(0)
        const second = data.findIndex((x, i) => i > frames && Math.abs(x) > 0.5)
        return second < 0 ? 0 : Math.max(0, second - 2 * frames) / sampleRate
      },
      () => 0,
    )
    loopLatencies.set(sampleRate, latency)
  }
  return latency
}

/**
 * Loads the Lo-fi crusher into `ctx`, once per context. Resolves false where the browser can't run
 * it (no AudioWorklet, say, outside a secure context); the chain then plays without Lo-fi.
 */
async function loadCrusher(ctx: BaseAudioContext): Promise<boolean> {
  try {
    await ctx.audioWorklet.addModule(crusherUrl)
    return true
  } catch (e) {
    console.warn('Lo-fi is unavailable:', e)
    return false
  }
}

/** Every setting the chain plays at its default: the mix passes through unchanged. */
export const MASTER_SOUND_DEFAULTS: MasterSound = {
  tone: 0,
  drive: 0,
  width: 0,
  filter: { x: 0, y: 0 },
  throw: { x: 0, y: 0 },
  lofi: { x: 0, y: 0 },
}

/**
 * The jam's master stage, between everything the loops and live pads send and the master gain:
 * input → filter → throw → lo-fi → tone → drive → width → `out`. Filter, throw and lo-fi are the
 * touchpad's modes. The throw sends the mix into an echo whose output joins the dry mix; its time
 * moves only through `throwTime`, so the engine can put the change on the jam's grid. Lo-fi is an
 * AudioWorklet (`crusher.worklet.ts`), so build the chain with `MasterChain.create`, which loads
 * it first. Drive is a shaper, then a compressor and its makeup gain;
 * it is switched out of the path at 0, since the compressor's lookahead would delay the whole mix
 * behind the dry clicks. Width is a mid/side mix built from per-ear gains. At the knobs' defaults
 * every stage passes the sound through unchanged.
 */
export class MasterChain {
  /** Where loops, their sends and live pads play into. */
  readonly input: GainNode
  private readonly filter: BiquadFilterNode
  /** The filter's output trim, so its resonance doesn't clip a loud mix. */
  private readonly filterTrim: GainNode
  /**
   * The throw: the mix's send into its echo, the echo, and the echo's feedback. The echo is a
   * fixed `throwLatency` ahead of a looped delay `throwLatency` shorter than its time, so the
   * first repeat and every one after it land on the echo's time.
   */
  private readonly throwSend: GainNode
  private readonly throwPre: DelayNode
  private readonly throwDelay: DelayNode
  private readonly throwFeedback: GainNode
  /** The Lo-fi crusher; missing where the browser can't run it. */
  private readonly crusher?: AudioWorkletNode
  private readonly tone: BiquadFilterNode
  private readonly dry: GainNode
  private readonly wet: GainNode
  private readonly shaper: WaveShaperNode
  private readonly compressor: DynamicsCompressorNode
  private readonly makeup: GainNode
  /** Width's gains: each ear from its own side (`direct`) and from the other (`cross`). */
  private readonly direct: [GainNode, GainNode]
  private readonly cross: [GainNode, GainNode]
  /** The values last set, so unchanged ones aren't scheduled again. */
  private applied: Record<string, number | string> = {}

  /** A chain into `out`, with Lo-fi once its worklet has loaded into `ctx`. */
  static async create(ctx: BaseAudioContext, out: AudioNode) {
    const [crusher, latency] = await Promise.all([loadCrusher(ctx), loopLatency(ctx.sampleRate)])
    return new MasterChain(ctx, out, crusher, latency)
  }

  private constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
    crusher: boolean,
    private readonly throwLatency: number,
  ) {
    this.input = ctx.createGain()
    // Always stereo, so a lone mono sound (a live pad, with nothing else playing) reaches both ears:
    // the width stage's splitter would otherwise put it in the left one only.
    this.input.channelCount = 2
    this.input.channelCountMode = 'explicit'
    this.input.channelInterpretation = 'speakers'
    this.filter = ctx.createBiquadFilter()
    this.filterTrim = ctx.createGain()
    this.throwSend = ctx.createGain()
    this.throwPre = ctx.createDelay(1)
    this.throwPre.delayTime.value = throwLatency
    this.throwDelay = ctx.createDelay(THROW_MAX_SECONDS)
    this.throwFeedback = ctx.createGain()
    if (crusher)
      this.crusher = new AudioWorkletNode(ctx, CRUSHER_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
        channelCount: 2,
        channelCountMode: 'explicit',
      })
    this.tone = ctx.createBiquadFilter()
    this.dry = ctx.createGain()
    this.wet = ctx.createGain()
    this.wet.gain.value = 0
    const headroom = ctx.createGain()
    headroom.gain.value = 1 / DRIVE_HEADROOM
    this.shaper = ctx.createWaveShaper()
    this.shaper.oversample = '2x'
    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.knee.value = 12
    this.compressor.attack.value = 0.01
    this.compressor.release.value = 0.2
    this.makeup = ctx.createGain()

    const split = ctx.createChannelSplitter(2)
    const merge = ctx.createChannelMerger(2)
    this.direct = [ctx.createGain(), ctx.createGain()]
    this.cross = [ctx.createGain(), ctx.createGain()]
    for (const ear of [0, 1] as const) {
      // Left out = left · direct + right · cross, and the mirror for the right.
      split.connect(this.direct[ear], ear).connect(merge, 0, ear)
      split.connect(this.cross[ear], 1 - ear).connect(merge, 0, ear)
    }

    // The throw's echo joins the dry mix ahead of the crusher, so Lo-fi crushes the tail too.
    const throwOut = ctx.createGain()
    this.input.connect(this.filter).connect(this.filterTrim).connect(throwOut)
    this.filterTrim
      .connect(this.throwSend)
      .connect(this.throwPre)
      .connect(this.throwDelay)
      .connect(throwOut)
    this.throwDelay.connect(this.throwFeedback).connect(this.throwDelay)
    if (this.crusher) throwOut.connect(this.crusher).connect(this.tone)
    else throwOut.connect(this.tone)
    this.tone.connect(this.dry).connect(split)
    this.tone
      .connect(headroom)
      .connect(this.shaper)
      .connect(this.compressor)
      .connect(this.makeup)
      .connect(this.wet)
      .connect(split)
    merge.connect(out)
    this.set(MASTER_SOUND_DEFAULTS, true)
  }

  /** Moves the chain to `sound`; `now` jumps there instead of ramping. */
  set(sound: MasterSound, now = false) {
    const ctx = this.ctx
    const applied = this.applied
    const set = (key: string, param: AudioParam, value: number, jump = now) => {
      if (applied[key] === value) return
      applied[key] = value
      if (jump) param.value = value
      else param.setTargetAtTime(value, ctx.currentTime, KNOB_RAMP)
    }

    // As a track's tone: a new type starts at its own cutoff rather than sweeping across.
    const sweep = (name: string, node: BiquadFilterNode, to: ReturnType<typeof toneFilter>) => {
      if (applied[`${name}Type`] !== to.type) {
        applied[`${name}Type`] = node.type = to.type
        node.frequency.cancelScheduledValues(0)
        node.frequency.value = applied[`${name}Frequency`] = to.frequency
      } else set(`${name}Frequency`, node.frequency, to.frequency)
    }
    const nyquist = ctx.sampleRate / 2
    const filter = filterSweep(sound.filter.x, sound.filter.y, nyquist)
    sweep('filter', this.filter, filter)
    set('filterQ', this.filter.Q, filter.q)
    set('filterTrim', this.filterTrim.gain, filter.gain)

    // The throw's time is `throwTime`'s. Down at Y 0 the send closes but the feedback stays, so
    // echoes already sounding ring out as they would have.
    const echo = throwEcho(sound.throw.x, sound.throw.y)
    set('throwSend', this.throwSend.gain, echo.send)
    if (sound.throw.y > 0 || applied.throwFeedback === undefined)
      set('throwFeedback', this.throwFeedback.gain, echo.feedback)

    if (this.crusher) {
      const crush = lofiCrush(sound.lofi.x, sound.lofi.y)
      set('lofiRate', this.crusher.parameters.get('rate')!, crush.rate)
      set('lofiBits', this.crusher.parameters.get('bits')!, crush.bits)
    }

    sweep('tone', this.tone, toneFilter(sound.tone, nyquist))

    if (applied.drive !== sound.drive) {
      applied.drive = sound.drive
      this.shaper.curve = driveCurve(sound.drive)
    }
    // Switched, not crossfaded: the wet path runs behind the compressor's lookahead, so a fade
    // would play both copies a few milliseconds apart and comb the mix.
    const on = sound.drive > 0 ? 1 : 0
    set('dry', this.dry.gain, 1 - on, true)
    set('wet', this.wet.gain, on, true)
    const glue = driveGlue(sound.drive)
    set('threshold', this.compressor.threshold, glue.threshold)
    set('ratio', this.compressor.ratio, glue.ratio)
    set('makeup', this.makeup.gain, glue.makeup)

    const width = widthGains(sound.width)
    for (const ear of [0, 1] as const) {
      set(`direct${ear}`, this.direct[ear].gain, width.direct)
      set(`cross${ear}`, this.cross[ear].gain, width.cross)
    }
  }

  /**
   * Moves the throw's echo time to `seconds` at audio time `at` (at once when not given): the
   * engine passes the jam's next 1/16, so everyone hears the change on the same grid line.
   */
  throwTime(seconds: number, at?: number) {
    seconds -= this.throwLatency
    const time = this.throwDelay.delayTime
    if (at === undefined) {
      time.cancelScheduledValues(0)
      time.value = seconds
    } else time.setTargetAtTime(seconds, Math.max(at, this.ctx.currentTime), KNOB_RAMP)
  }
}
