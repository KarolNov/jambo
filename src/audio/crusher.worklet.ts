/**
 * The touchpad's Lo-fi crusher, run on the audio thread: it holds each sample for a lower sample
 * rate (`rate`, Hz) and rounds it to a bit depth (`bits`). At a `rate` at or above the context's
 * own and `bits` at 16 it passes the sound through untouched. Loaded with
 * `audioWorklet.addModule` (see `loadCrusher` in `./master`), which registers it as
 * `CRUSHER_PROCESSOR` there; nothing imports this file.
 */

// The AudioWorklet global scope, which the DOM lib doesn't describe.
declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {}

/** Within this of the context's rate, or of 16 bits, counts as untouched, so a ramp that settles a hair short still passes the sound through. */
const NEAR = 1e-3

class Crusher extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {
        name: 'rate',
        // Above any context's own, so a fresh crusher passes the sound through.
        defaultValue: 192000,
        minValue: 1,
        maxValue: 192000,
        automationRate: 'k-rate',
      },
      { name: 'bits', defaultValue: 16, minValue: 1, maxValue: 16, automationRate: 'k-rate' },
    ]
  }

  /** How far through the held sample the crusher is: a new one is taken each time it passes 1. */
  private phase = 0
  /** The sample each channel is holding. */
  private held: number[] = []

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ) {
    const input = inputs[0] ?? []
    const output = outputs[0] ?? []
    const step = Math.min(1, parameters.rate![0]! / sampleRate)
    const hold = step < 1 - NEAR
    const bits = parameters.bits![0]!
    // Levels on each side of 0; 0 leaves samples as they are.
    const levels = bits < 16 - NEAR ? 2 ** (bits - 1) : 0
    // Every channel steps together from the same phase, whether or not it has input this block.
    const start = this.phase
    const frames = output[0]?.length ?? 0
    this.phase = hold ? (start + step * frames) % 1 : 0
    for (let ch = 0; ch < output.length; ch++) {
      const from = input[ch] ?? input[0]
      const to = output[ch]!
      if (!from) {
        to.fill(0)
        continue
      }
      if (!hold && !levels) {
        to.set(from)
        continue
      }
      let phase = start
      let held = this.held[ch] ?? 0
      for (let i = 0; i < to.length; i++) {
        phase += step
        if (!hold || phase >= 1) {
          phase -= Math.floor(phase)
          held = levels ? Math.round(from[i]! * levels) / levels : from[i]!
        }
        to[i] = held
      }
      this.held[ch] = held
    }
    return true
  }
}

registerProcessor('jambo-crusher', Crusher)

export {}
