/** What a browser reports about its audio delays, in seconds; any of them may be missing. */
export interface ReportedLatency {
  /** The microphone track's `latency` setting. */
  input?: number
  /** The context's `baseLatency`: its own processing. */
  base?: number
  /** The context's `outputLatency`: from the context to the speakers. */
  output?: number
}

/** The delays a voice meets, in seconds. */
export interface Latency {
  /** From the microphone into the context. */
  input: number
  /** From the context out to the speakers. */
  output: number
  /** Both: what monitoring adds, and how late a sung note lands against what the singer heard. */
  roundTrip: number
}

/** A usable number of seconds, else 0: browsers leave some of these out or report nonsense. */
const seconds = (x: number | undefined) =>
  typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 2 ? x : 0

/** Estimates a voice's delays from what the browser reports. */
export function estimateLatency(reported: ReportedLatency): Latency {
  const input = seconds(reported.input)
  const output = seconds(reported.base) + seconds(reported.output)
  return { input, output, roundTrip: input + output }
}

/** Reads what this browser reports for `track` played into `ctx`. */
export function readLatency(ctx: AudioContext, track?: MediaStreamTrack): ReportedLatency {
  const settings = track?.getSettings() as (MediaTrackSettings & { latency?: number }) | undefined
  return { input: settings?.latency, base: ctx.baseLatency, output: ctx.outputLatency }
}
