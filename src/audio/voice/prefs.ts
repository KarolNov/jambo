import { DEFAULT_KEY, isKey, type Key } from './dsp/tune'
import { DEFAULT_PRESET, isPreset, type PresetId } from './presets'

/** The voice settings this browser keeps: they are the person's, not the jam's. */
const PRESET_KEY = 'jambo.voice.preset'
const MONITOR_KEY = 'jambo.voice.monitor'
const TUNE_KEY = 'jambo.voice.key'
const ROUND_TRIP_KEY = 'jambo.voice.roundTrip'

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage blocked: the choice lasts until the page closes.
  }
}

/** The preset last picked here, else Clean. */
export function loadPreset(): PresetId {
  const id = read(PRESET_KEY)
  return isPreset(id) ? id : DEFAULT_PRESET
}

export const savePreset = (id: PresetId) => write(PRESET_KEY, id)

/** Whether monitoring was last on here; off by default, since speakers feed back. */
export const loadMonitor = () => read(MONITOR_KEY) === '1'

export const saveMonitor = (on: boolean) => write(MONITOR_KEY, on ? '1' : '0')

/** The key auto-tune last tuned to here, else C major. */
export function loadKey(): Key {
  try {
    const key: unknown = JSON.parse(read(TUNE_KEY) ?? 'null')
    return isKey(key) ? { root: key.root, scale: key.scale } : DEFAULT_KEY
  } catch {
    return DEFAULT_KEY
  }
}

export const saveKey = (key: Key) => write(TUNE_KEY, JSON.stringify(key))

/**
 * The audio setup a round trip was measured on: the microphone and speakers it went through, and
 * what the browser estimated for them. A measurement only holds while these still match.
 */
export interface RoundTripSetup {
  device: string
  estimate: number
}

/** How far the browser's estimate may move before a measurement no longer counts, in seconds. */
const SAME_ESTIMATE = 0.02

/**
 * The round trip the loopback test last measured here, in seconds, if it has run; given `setup`,
 * only if it was measured on that setup.
 */
export function loadRoundTrip(setup?: RoundTripSetup): number | undefined {
  try {
    const saved = JSON.parse(read(ROUND_TRIP_KEY) ?? 'null') as Partial<
      Record<'roundTrip' | 'device' | 'estimate', unknown>
    > | null
    const s = saved?.roundTrip
    if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0 || s >= 2) return undefined
    if (
      setup &&
      (saved!.device !== setup.device ||
        typeof saved!.estimate !== 'number' ||
        Math.abs(saved!.estimate - setup.estimate) > SAME_ESTIMATE)
    ) {
      return undefined
    }
    return s
  } catch {
    return undefined
  }
}

export const saveRoundTrip = (roundTrip: number, setup: RoundTripSetup) =>
  write(ROUND_TRIP_KEY, JSON.stringify({ roundTrip, ...setup }))
