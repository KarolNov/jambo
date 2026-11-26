/**
 * The voice service's capture, run on the audio thread: while recording it posts each block of the
 * microphone's first channel to the main thread, and always posts the input's peak level about 30
 * times a second for the meter. It outputs silence. Loaded with `audioWorklet.addModule` (see
 * `loadCapture` in `./input`), which registers it as `CAPTURE_PROCESSOR` there; nothing imports
 * this file.
 *
 * Messages in: `'start'`, `'stop'`. Messages out: `{ started }` with the context frame of the
 * first sample recorded, `{ samples }` while recording, `{ level }`, and `{ stopped: true }` once
 * the last block before a stop has been posted.
 */

// The AudioWorklet global scope, which the DOM lib doesn't describe.
declare const sampleRate: number
declare const currentFrame: number
declare function registerProcessor(name: string, processor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
}

/** Level messages a second. */
const LEVELS_PER_SECOND = 30

class Capture extends AudioWorkletProcessor {
  private recording = false
  /** Recording has just started: the next block's frame is posted first. */
  private starting = false
  private peak = 0
  private sinceLevel = 0
  private readonly levelEvery = Math.round(sampleRate / LEVELS_PER_SECOND)

  constructor() {
    super()
    this.port.onmessage = (e: MessageEvent<'start' | 'stop'>) => {
      if (e.data === 'start') {
        this.recording = true
        this.starting = true
      }
      if (e.data === 'stop') {
        this.recording = false
        this.port.postMessage({ stopped: true })
      }
    }
  }

  process(inputs: Float32Array[][]) {
    const block = inputs[0]?.[0]
    if (block) {
      if (this.recording && this.starting) {
        this.starting = false
        this.port.postMessage({ started: currentFrame })
      }
      if (this.recording) this.port.postMessage({ samples: block.slice() })
      for (let i = 0; i < block.length; i++) {
        const x = Math.abs(block[i]!)
        if (x > this.peak) this.peak = x
      }
      this.sinceLevel += block.length
    }
    if (this.sinceLevel >= this.levelEvery) {
      this.port.postMessage({ level: this.peak })
      this.peak = 0
      this.sinceLevel = 0
    }
    return true
  }
}

registerProcessor('jambo-voice-capture', Capture)

export {}
