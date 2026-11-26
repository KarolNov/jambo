import { DEFAULT_PRESET, isPreset, type PresetId } from './presets'

/** The voice settings this browser keeps: they are the person's, not the jam's. */
const PRESET_KEY = 'jambo.voice.preset'
const MONITOR_KEY = 'jambo.voice.monitor'

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
