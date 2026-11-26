/**
 * The voice rack: the presets a voice is recorded through. A preset builds the same chain into a
 * live context (to monitor) and into an offline one (to render what is kept), so what you hear
 * while recording is what is saved.
 */

/** Every preset, in the order the picker lists them. */
export const PRESETS = [{ id: 'clean', name: 'Clean' }] as const

export type PresetId = (typeof PRESETS)[number]['id']

export const DEFAULT_PRESET: PresetId = 'clean'

export const isPreset = (id: unknown): id is PresetId => PRESETS.some((p) => p.id === id)

/** Clean's low cut, in Hz: below a voice, where handling noise and room rumble sit. */
export const CLEAN_LOW_CUT = 80

/**
 * Builds `preset`'s chain in `ctx` from `input`, and returns its output for the caller to
 * connect. Async, as a preset may need to load a worklet into `ctx` first.
 */
export async function buildRack(
  ctx: BaseAudioContext,
  preset: PresetId,
  input: AudioNode,
): Promise<AudioNode> {
  switch (preset) {
    case 'clean': {
      const lowCut = ctx.createBiquadFilter()
      lowCut.type = 'highpass'
      lowCut.frequency.value = CLEAN_LOW_CUT
      lowCut.Q.value = Math.SQRT1_2
      return input.connect(lowCut)
    }
  }
}
