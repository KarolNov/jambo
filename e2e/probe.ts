/**
 * An init script that listens in on the page's Web Audio, so a test can check what a person would
 * hear without changing the app: when each metronome click leaves the speakers, and where each
 * loop's reverb send is headed. It runs in the page before the app, so it has to be
 * self-contained: Playwright serialises the function's source.
 *
 * - Clicks: the only oscillators started on a live AudioContext (the kit renders offline; pads and
 *   loops play buffers). Each start is logged as the Unix ms it will be heard at, from the
 *   context's output timestamp, the same way the engine pairs audio and wall time.
 * - Reverb sends: the gains that connect into the shared ConvolverNode, one per loop. Their latest
 *   target (`setTargetAtTime`, or a plain `value =`) is what that loop sends to the reverb.
 */
export function installAudioProbe() {
  const clicks: number[] = []
  const sends = new Set<AudioParam>()
  const targets = new Map<AudioParam, number>()

  const heardAt = (ctx: AudioContext, when: number) => {
    const ts = ctx.getOutputTimestamp?.()
    const pair =
      ts?.contextTime && ts.performanceTime
        ? { contextTime: ts.contextTime, performanceTime: ts.performanceTime }
        : {
            contextTime: ctx.currentTime - (ctx.outputLatency || 0) - ctx.baseLatency,
            performanceTime: performance.now(),
          }
    const at = Math.max(when, ctx.currentTime)
    return performance.timeOrigin + pair.performanceTime + (at - pair.contextTime) * 1000
  }

  const start = OscillatorNode.prototype.start
  OscillatorNode.prototype.start = function (when = 0) {
    if (this.context instanceof AudioContext) clicks.push(heardAt(this.context, when))
    return start.call(this, when)
  }

  const connect = AudioNode.prototype.connect as (...args: unknown[]) => unknown
  AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
    if (this instanceof GainNode && args[0] instanceof ConvolverNode) sends.add(this.gain)
    return connect.apply(this, args)
  } as typeof AudioNode.prototype.connect
  // A removed loop's chain is disconnected: its send is gone.
  const disconnect = AudioNode.prototype.disconnect as (...args: unknown[]) => unknown
  AudioNode.prototype.disconnect = function (this: AudioNode, ...args: unknown[]) {
    if (this instanceof GainNode && (args.length === 0 || args[0] instanceof ConvolverNode)) {
      sends.delete(this.gain)
      targets.delete(this.gain)
    }
    return disconnect.apply(this, args)
  } as typeof AudioNode.prototype.disconnect

  const setTarget = AudioParam.prototype.setTargetAtTime
  AudioParam.prototype.setTargetAtTime = function (value, startTime, timeConstant) {
    if (sends.has(this)) targets.set(this, value)
    return setTarget.call(this, value, startTime, timeConstant)
  }
  const value = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value')!
  Object.defineProperty(AudioParam.prototype, 'value', {
    ...value,
    set(this: AudioParam, v: number) {
      if (sends.has(this)) targets.set(this, v)
      value.set!.call(this, v)
    },
  })

  Object.assign(window, {
    __probe: {
      /** When each click is heard, in Unix ms. */
      clicks: () => [...clicks],
      /** Each loop's reverb send, as last set (0 to 1). */
      reverb: () => [...sends].map((p) => targets.get(p) ?? p.value),
    },
  })
}

export interface Probe {
  clicks: () => number[]
  reverb: () => number[]
}
