/**
 * The voice rack's pitch node, run on the audio thread: YIN pitch detection driving a PSOLA
 * shifter (`./dsp/tune`), for auto-tune, Robot, Chipmunk and Demon. Its `PitchOptions` come as
 * `processorOptions`; its output is `pitchDelay` late. Loaded with `audioWorklet.addModule` (see
 * `loadWorklet` in `./presets`), which registers it as `PITCH_PROCESSOR` there; nothing imports
 * this file.
 */

import { type PitchOptions, pitchDelay, VoicePitch } from './dsp/tune'

// The AudioWorklet global scope, which the DOM lib doesn't describe.
declare const sampleRate: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {}

class Pitch extends AudioWorkletProcessor {
  private readonly voice: VoicePitch
  /** Fed while the input is disconnected, so what is still in the shifter plays out. */
  private silence = new Float32Array(128)
  /** Frames still to play out once the input goes, before the node may be let go. */
  private tail = 0
  private readonly tailFrames = Math.ceil(pitchDelay(sampleRate) * sampleRate) + 128

  constructor(options: { processorOptions: PitchOptions }) {
    super()
    this.voice = new VoicePitch(sampleRate, options.processorOptions)
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const out = outputs[0]?.[0]
    let input = inputs[0]?.[0]
    if (input) this.tail = this.tailFrames
    if (!out) return true
    if (!input) {
      if (this.tail <= 0) return false
      this.tail -= out.length
      if (this.silence.length !== out.length) this.silence = new Float32Array(out.length)
      input = this.silence
    }
    this.voice.process(input, out)
    // Kept alive while fed, then until its tail has played, so a dropped rack can be let go.
    return true
  }
}

registerProcessor('jambo-voice-pitch', Pitch)

export {}
