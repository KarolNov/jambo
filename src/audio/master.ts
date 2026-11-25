import type { Master } from '../../shared/board'
import {
  DRIVE_HEADROOM,
  driveCurve,
  driveGlue,
  filterSweep,
  KNOB_RAMP,
  toneFilter,
  widthGains,
} from './knobs'

/** The master settings the chain plays. Swing is the scheduler's, not the chain's. */
export type MasterSound = Pick<Master, 'tone' | 'drive' | 'width' | 'filter'>

/** Every setting the chain plays at its default: the mix passes through unchanged. */
export const MASTER_SOUND_DEFAULTS: MasterSound = {
  tone: 0,
  drive: 0,
  width: 0,
  filter: { x: 0, y: 0 },
}

/**
 * The jam's master stage, between everything the loops and live pads send and the master gain:
 * input → filter → tone → drive → width → `out`. The filter is the touchpad's Filter mode. Drive is a shaper, then a compressor and its makeup gain;
 * it is switched out of the path at 0, since the compressor's lookahead would delay the whole mix
 * behind the dry clicks. Width is a mid/side mix built from per-ear gains. At the knobs' defaults
 * every stage passes the sound through unchanged.
 */
export class MasterChain {
  /** Where loops, their sends and live pads play into. */
  readonly input: GainNode
  private readonly filter: BiquadFilterNode
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

  constructor(
    private readonly ctx: BaseAudioContext,
    out: AudioNode,
  ) {
    this.input = ctx.createGain()
    // Always stereo, so a lone mono sound (a live pad, with nothing else playing) reaches both ears:
    // the width stage's splitter would otherwise put it in the left one only.
    this.input.channelCount = 2
    this.input.channelCountMode = 'explicit'
    this.input.channelInterpretation = 'speakers'
    this.filter = ctx.createBiquadFilter()
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

    this.input.connect(this.filter).connect(this.tone)
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
}
