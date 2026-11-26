import { UPLOADS } from '../../../shared/sounds'
import { DEFAULT_KEY, type Key } from './dsp/tune'
import { buildRack, type PresetId, rackDelay } from './presets'

/**
 * Renders a raw take through `preset`'s chain, offline, at the upload rate: the effect goes into
 * the sound that is kept, in time with the take (the chain's own delay is taken back out).
 * `takeRate` is the rate it was captured at (the live context's); `key` is what auto-tune tunes to.
 */
export async function renderVoice(
  take: Float32Array,
  takeRate: number,
  preset: PresetId,
  key: Key = DEFAULT_KEY,
): Promise<AudioBuffer> {
  const rate = UPLOADS.sampleRate
  const frames = Math.max(1, Math.ceil((take.length * rate) / takeRate))
  const delay = Math.round(rackDelay(preset, rate) * rate)
  const ctx = new OfflineAudioContext(1, frames + delay, rate)
  const buffer = ctx.createBuffer(1, Math.max(1, take.length), takeRate)
  buffer.copyToChannel(take as Float32Array<ArrayBuffer>, 0)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const out = await buildRack(ctx, preset, src, key)
  out.connect(ctx.destination)
  src.start()
  const rendered = await ctx.startRendering()
  if (!delay) return rendered
  const kept = new AudioBuffer({ length: frames, sampleRate: rate, numberOfChannels: 1 })
  kept.copyToChannel(rendered.getChannelData(0).subarray(delay), 0)
  return kept
}
