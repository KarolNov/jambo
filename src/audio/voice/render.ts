import { UPLOADS } from '../../../shared/sounds'
import { buildRack, type PresetId } from './presets'

/**
 * Renders a raw take through `preset`'s chain, offline, at the upload rate: the effect goes into
 * the sound that is kept. `takeRate` is the rate it was captured at (the live context's).
 */
export async function renderVoice(
  take: Float32Array,
  takeRate: number,
  preset: PresetId,
): Promise<AudioBuffer> {
  const rate = UPLOADS.sampleRate
  const frames = Math.max(1, Math.ceil((take.length * rate) / takeRate))
  const ctx = new OfflineAudioContext(1, frames, rate)
  const buffer = ctx.createBuffer(1, Math.max(1, take.length), takeRate)
  buffer.copyToChannel(take as Float32Array<ArrayBuffer>, 0)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  const out = await buildRack(ctx, preset, src)
  out.connect(ctx.destination)
  src.start()
  return ctx.startRendering()
}
