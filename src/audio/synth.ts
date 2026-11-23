import type { SoundId } from '../../shared/sounds'

/**
 * The v1 kit, synthesized: each recipe draws one short sound into an OfflineAudioContext, which
 * is rendered once into an AudioBuffer. Playback only ever deals with buffers, so a sample kit
 * can replace a recipe later without changing anything else.
 */
type Recipe = { seconds: number; draw: (ctx: OfflineAudioContext, out: AudioNode) => void }

const env = (ctx: BaseAudioContext, peak: number, attack: number, decay: number, at = 0) => {
  const g = ctx.createGain()
  g.gain.setValueAtTime(0, at)
  g.gain.linearRampToValueAtTime(peak, at + attack)
  g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay)
  return g
}

const noise = (ctx: BaseAudioContext, seconds: number) => {
  const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * seconds), ctx.sampleRate)
  const data = buffer.getChannelData(0)
  // Deterministic noise, so every client renders the same kit.
  let seed = 1
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 16807) % 2147483647
    data[i] = (seed / 2147483647) * 2 - 1
  }
  const src = ctx.createBufferSource()
  src.buffer = buffer
  return src
}

const tone = (
  ctx: BaseAudioContext,
  out: AudioNode,
  type: OscillatorType,
  freq: number,
  peak: number,
  decay: number,
  opts: { to?: number; sweep?: number; filter?: number; at?: number } = {},
) => {
  const at = opts.at ?? 0
  const osc = ctx.createOscillator()
  osc.type = type
  osc.frequency.setValueAtTime(freq, at)
  if (opts.to) osc.frequency.exponentialRampToValueAtTime(opts.to, at + (opts.sweep ?? decay))
  const g = env(ctx, peak, 0.002, decay, at)
  let node: AudioNode = osc
  if (opts.filter) {
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.frequency.setValueAtTime(opts.filter, at)
    f.frequency.exponentialRampToValueAtTime(Math.max(200, opts.filter / 6), at + decay)
    osc.connect(f)
    node = f
  }
  node.connect(g).connect(out)
  osc.start(at)
  osc.stop(at + decay + 0.05)
}

const hiss = (
  ctx: BaseAudioContext,
  out: AudioNode,
  type: BiquadFilterType,
  freq: number,
  peak: number,
  decay: number,
  at = 0,
) => {
  const src = noise(ctx, decay + 0.05)
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = freq
  src
    .connect(f)
    .connect(env(ctx, peak, 0.001, decay, at))
    .connect(out)
  src.start(at)
}

const note = (n: number) => 440 * 2 ** ((n - 69) / 12)

const RECIPES: Record<SoundId, Recipe> = {
  kick: { seconds: 0.5, draw: (c, o) => tone(c, o, 'sine', 150, 1, 0.45, { to: 45, sweep: 0.12 }) },
  snare: {
    seconds: 0.3,
    draw: (c, o) => {
      tone(c, o, 'triangle', 190, 0.5, 0.1, { to: 140 })
      hiss(c, o, 'highpass', 1500, 0.7, 0.2)
    },
  },
  clap: {
    seconds: 0.35,
    draw: (c, o) => {
      for (const at of [0, 0.012, 0.024]) hiss(c, o, 'bandpass', 1200, 0.6, 0.03, at)
      hiss(c, o, 'bandpass', 1200, 0.6, 0.25, 0.036)
    },
  },
  hat: { seconds: 0.1, draw: (c, o) => hiss(c, o, 'highpass', 7000, 0.4, 0.05) },
  'open-hat': { seconds: 0.45, draw: (c, o) => hiss(c, o, 'highpass', 6500, 0.35, 0.4) },
  'tom-low': { seconds: 0.5, draw: (c, o) => tone(c, o, 'sine', 120, 0.9, 0.4, { to: 70 }) },
  'tom-high': { seconds: 0.4, draw: (c, o) => tone(c, o, 'sine', 210, 0.8, 0.3, { to: 130 }) },
  rim: {
    seconds: 0.08,
    draw: (c, o) => {
      tone(c, o, 'triangle', 1700, 0.5, 0.03)
      hiss(c, o, 'bandpass', 3000, 0.3, 0.02)
    },
  },
  cowbell: {
    seconds: 0.4,
    draw: (c, o) => {
      tone(c, o, 'square', 560, 0.18, 0.3, { filter: 3000 })
      tone(c, o, 'square', 845, 0.18, 0.3, { filter: 3000 })
    },
  },
  shaker: { seconds: 0.15, draw: (c, o) => hiss(c, o, 'bandpass', 5000, 0.4, 0.09) },
  'bass-c': {
    seconds: 0.6,
    draw: (c, o) => tone(c, o, 'sawtooth', note(36), 0.5, 0.5, { filter: 900 }),
  },
  'bass-g': {
    seconds: 0.6,
    draw: (c, o) => tone(c, o, 'sawtooth', note(43), 0.5, 0.5, { filter: 900 }),
  },
  'pluck-e': {
    seconds: 0.5,
    draw: (c, o) => tone(c, o, 'sawtooth', note(64), 0.3, 0.4, { filter: 4000 }),
  },
  'pluck-g': {
    seconds: 0.5,
    draw: (c, o) => tone(c, o, 'sawtooth', note(67), 0.3, 0.4, { filter: 4000 }),
  },
  stab: {
    seconds: 0.5,
    draw: (c, o) => {
      for (const n of [60, 63, 67, 70])
        tone(c, o, 'sawtooth', note(n), 0.12, 0.35, { filter: 3500 })
    },
  },
  blip: {
    seconds: 0.2,
    draw: (c, o) => tone(c, o, 'square', note(84), 0.15, 0.12, { filter: 6000 }),
  },
  zap: {
    seconds: 0.3,
    draw: (c, o) => tone(c, o, 'sawtooth', 1800, 0.25, 0.25, { to: 90, filter: 5000 }),
  },
}

/** Renders every sound of the kit into buffers at `sampleRate`. */
export async function renderKit(sampleRate: number): Promise<Map<string, AudioBuffer>> {
  const entries = await Promise.all(
    Object.entries(RECIPES).map(async ([id, recipe]) => {
      const ctx = new OfflineAudioContext(1, Math.ceil(sampleRate * recipe.seconds), sampleRate)
      const out = ctx.createGain()
      out.connect(ctx.destination)
      recipe.draw(ctx, out)
      return [id, await ctx.startRendering()] as const
    }),
  )
  return new Map(entries)
}

/** The metronome click: a short sine blip, higher on the first beat of a bar. */
export function click(ctx: BaseAudioContext, out: AudioNode, at: number, accent: boolean) {
  tone(ctx, out, 'sine', accent ? 1800 : 1200, accent ? 0.35 : 0.2, 0.04, { at })
}
