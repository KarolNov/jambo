/**
 * The voice rack: the presets a voice is recorded through. A preset builds the same chain into a
 * live context (to monitor) and into an offline one (to render what is kept), so what you hear
 * while recording is what is saved.
 */

import crusherUrl from '../crusher.worklet.ts?worker&url'
import { DEFAULT_KEY, type Key, type PitchOptions, pitchDelay, scaleNotes } from './dsp/tune'
import pitchUrl from './pitch.worklet.ts?worker&url'

/** Every preset, in the order the picker lists them. `key`: it tunes to the person's key. */
export const PRESETS = [
  { id: 'clean', name: 'Clean', key: false },
  { id: 'tune-hard', name: 'Auto-tune (hard)', key: true },
  { id: 'tune-natural', name: 'Auto-tune (natural)', key: true },
  { id: 'robot', name: 'Robot', key: false },
  { id: 'chipmunk', name: 'Chipmunk', key: false },
  { id: 'demon', name: 'Demon', key: false },
  { id: 'radio', name: 'Radio', key: false },
  { id: 'lofi', name: 'Lofi', key: false },
] as const

export type PresetId = (typeof PRESETS)[number]['id']

export const DEFAULT_PRESET: PresetId = 'clean'

export const isPreset = (id: unknown): id is PresetId => PRESETS.some((p) => p.id === id)

/** Whether `preset` tunes to a key, so the rack shows the key picker. */
export const usesKey = (preset: PresetId) => PRESETS.find((p) => p.id === preset)!.key

/** Clean's low cut, in Hz: below a voice, where handling noise and room rumble sit. */
export const CLEAN_LOW_CUT = 80

/** The names `pitch.worklet.ts` and `crusher.worklet.ts` register their processors under. */
const PITCH_PROCESSOR = 'jambo-voice-pitch'
const CRUSHER_PROCESSOR = 'jambo-crusher'

/** Each worklet module, loaded once per context. */
const loaded = new WeakMap<BaseAudioContext, Map<string, Promise<void>>>()
function loadWorklet(ctx: BaseAudioContext, url: string): Promise<void> {
  let modules = loaded.get(ctx)
  if (!modules) loaded.set(ctx, (modules = new Map()))
  let load = modules.get(url)
  if (!load) {
    load = ctx.audioWorklet.addModule(url)
    modules.set(url, load)
    load.catch(() => modules.delete(url))
  }
  return load
}

/** What each pitch preset asks of the pitch node, given the person's key. */
function pitchOptions(preset: PresetId, key: Key): PitchOptions | undefined {
  switch (preset) {
    // Snaps at once and holds nothing: the stepped, robotic auto-tune sound.
    case 'tune-hard':
      return { mode: { kind: 'tune', notes: scaleNotes(key), glide: 0, hold: 0 } }
    // Settles over 60 ms and stays on a note through small wobbles, so vibrato survives.
    case 'tune-natural':
      return { mode: { kind: 'tune', notes: scaleNotes(key), glide: 0.06, hold: 0.3 } }
    // One note (A) in whatever octave is nearest, through a ring modulator.
    case 'robot':
      return { mode: { kind: 'tune', notes: [9], glide: 0, hold: 0 }, ring: { hz: 70, mix: 0.5 } }
    // Up a major sixth with the formants: a smaller throat.
    case 'chipmunk':
      return { mode: { kind: 'shift', semitones: 9, formant: 2 ** (9 / 12) } }
    // Down a fifth with the formants lower still: a bigger one.
    case 'demon':
      return { mode: { kind: 'shift', semitones: -7, formant: 0.7 } }
    default:
      return undefined
  }
}

/** How late `preset`'s chain is, in seconds, at `rate`: the pitch node's delay where it has one. */
export const rackDelay = (preset: PresetId, rate: number) =>
  pitchOptions(preset, DEFAULT_KEY) ? pitchDelay(rate) : 0

const biquad = (
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q = Math.SQRT1_2,
  gain = 0,
) => {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = frequency
  f.Q.value = q
  f.gain.value = gain
  return f
}

/** A soft clipper: `drive` 1 is gentle, higher is dirtier; peaks stay within ±1. */
function saturate(ctx: BaseAudioContext, drive: number) {
  const shaper = ctx.createWaveShaper()
  const n = 1025
  const curve = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = Math.tanh(drive * x) / Math.tanh(drive)
  }
  shaper.curve = curve
  shaper.oversample = '2x'
  return shaper
}

const gain = (ctx: BaseAudioContext, value: number) => {
  const g = ctx.createGain()
  g.gain.value = value
  return g
}

/** Connects `nodes` in a line from `input`, returning the last. */
function chain(input: AudioNode, ...nodes: AudioNode[]): AudioNode {
  return nodes.reduce((from, to) => from.connect(to), input)
}

/**
 * Builds `preset`'s chain in `ctx` from `input`, and returns its output for the caller to
 * connect. Async, as a preset may need to load a worklet into `ctx` first. Every preset but
 * Radio and Lofi starts with Clean's low cut (those two cut higher); the auto-tune presets tune
 * to `key`.
 */
export async function buildRack(
  ctx: BaseAudioContext,
  preset: PresetId,
  input: AudioNode,
  key: Key = DEFAULT_KEY,
): Promise<AudioNode> {
  const lowCut = () => biquad(ctx, 'highpass', CLEAN_LOW_CUT)
  const options = pitchOptions(preset, key)
  if (options) {
    await loadWorklet(ctx, pitchUrl)
    const pitch = new AudioWorkletNode(ctx, PITCH_PROCESSOR, {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
      channelCount: 1,
      channelCountMode: 'explicit',
      processorOptions: options,
    })
    const out = chain(input, lowCut(), pitch)
    if (preset === 'demon') {
      return chain(out, biquad(ctx, 'lowshelf', 250, Math.SQRT1_2, 5), saturate(ctx, 1.5))
    }
    return out
  }
  switch (preset) {
    case 'clean':
      return chain(input, lowCut())
    // A small speaker down a phone line: only the middle of the voice, pushed into its edges.
    case 'radio':
      return chain(
        input,
        biquad(ctx, 'highpass', 400, 0.9),
        biquad(ctx, 'lowpass', 3200, 0.9),
        biquad(ctx, 'peaking', 1800, 1, 6),
        gain(ctx, 2),
        saturate(ctx, 3),
        gain(ctx, 0.7),
      )
    // A worn tape at a low sample rate: dull, crunchy and a little warm.
    case 'lofi': {
      await loadWorklet(ctx, crusherUrl)
      const crusher = new AudioWorkletNode(ctx, CRUSHER_PROCESSOR, {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      })
      crusher.parameters.get('rate')!.value = 11_025
      crusher.parameters.get('bits')!.value = 8
      return chain(
        input,
        biquad(ctx, 'highpass', 150),
        biquad(ctx, 'lowpass', 4500),
        crusher,
        biquad(ctx, 'lowpass', 3800),
        saturate(ctx, 1.5),
      )
    }
    default:
      return chain(input, lowCut())
  }
}
