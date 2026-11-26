import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { kindOf } from '../../shared/board'
import { CLIPS } from '../../shared/sounds'
import type { RecorderState } from '../audio/engine'
import { MicError, type MicProblem } from '../audio/voice/input'
import { loadKey, loadMonitor, loadPreset, savePreset } from '../audio/voice/prefs'
import { isPreset, type PresetId } from '../audio/voice/presets'
import { soundsAtom } from './model'
import { useSession } from './session'
import { isTyping } from './typing'

/** Why Sing is disabled while the jam is full of clips. */
export const CLIPS_FULL = 'This jam has no room for more voice clips; removing tracks frees theirs'

/** What Sing says when the microphone can't be had. */
const SING_MIC: Record<MicProblem, string> = {
  blocked:
    "The microphone is blocked. Allow it for this site in your browser's address bar or settings, then hold Sing again.",
  missing: 'No microphone was found. Connect one, then hold Sing again.',
  unavailable: "This browser can't record from a microphone here.",
}

/** Whether this site may already use the microphone, so opening it won't ask. */
async function micAllowed(): Promise<boolean> {
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state === 'granted'
  } catch {
    return false
  }
}

/**
 * Sing into a take: hold M (except while typing) or the Sing button to record a voice clip, from
 * press to release, through the voice preset picked here. Enabled only while a take is recording
 * and the jam has room for another clip.
 */
export function useSing(phase: RecorderState['phase']) {
  const { engine } = useSession()
  const sounds = useAtomValue(soundsAtom)
  const [preset, setPreset] = useState<PresetId>(loadPreset)
  const [error, setError] = useState<string>()
  const singing = useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.singing,
  )
  const clips = useMemo(
    () => [...sounds.values()].filter((s) => kindOf(s) === 'clip').length,
    [sounds],
  )
  const full = clips >= CLIPS.perJam
  const enabled = phase === 'recording' && !full

  const latest = useRef({ enabled, preset, clips })
  latest.current = { enabled, preset, clips }

  const start = () => {
    const now = latest.current
    if (!now.enabled) return
    // The take's own clips aren't listed yet: they count against the room too.
    if (now.clips + (engine.take()?.clips.length ?? 0) >= CLIPS.perJam) {
      setError(CLIPS_FULL)
      return
    }
    setError(undefined)
    engine
      .sing({ preset: now.preset, key: loadKey(), monitor: loadMonitor() })
      .catch((e: unknown) =>
        setError(e instanceof MicError ? SING_MIC[e.problem] : "Couldn't start singing"),
      )
  }
  const end = () => engine.singEnd()

  // M sings while held, except while typing; letting go anywhere (or leaving the page) ends it.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code !== 'KeyM' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (isTyping(e.target)) return
      e.preventDefault()
      start()
    }
    const up = (e: KeyboardEvent) => {
      if (e.code === 'KeyM') end()
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', end)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', end)
    }
  })

  // Where the microphone is already allowed, it opens with the take, so the first Sing starts at
  // once instead of losing its first moments to the microphone starting up.
  const starting = phase === 'waiting' || phase === 'count-in'
  useEffect(() => {
    if (!starting || full) return
    let cancelled = false
    void micAllowed().then((ok) => {
      if (ok && !cancelled) engine.warmVoice()
    })
    return () => {
      cancelled = true
    }
  }, [starting, full, engine])

  // A new take starts without the last one's error.
  useEffect(() => {
    if (phase === 'waiting') setError(undefined)
  }, [phase])

  const pickPreset = (id: string) => {
    if (!isPreset(id)) return
    setPreset(id)
    savePreset(id)
  }

  return { preset, pickPreset, singing, enabled, full, error, start, end }
}
