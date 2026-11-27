import { useAtomValue } from 'jotai'
import { useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react'
import { kindOf } from '../../shared/board'
import { CLIPS } from '../../shared/sounds'
import type { RecorderState } from '../audio/engine'
import { MicError, type MicProblem } from '../audio/voice/input'
import { Live } from '../audio/live/live'
import {
  loadHeadphones,
  loadKey,
  loadMonitor,
  loadPreset,
  saveHeadphones,
  saveMonitor,
  savePreset,
} from '../audio/voice/prefs'
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

/**
 * Sing into a take: hold M (except while typing) or the Sing button to record a voice clip, from
 * press to just after release, through the voice preset picked here. Enabled only while a take is
 * recording and the jam has room for another clip. The microphone opens as each take starts.
 */
export function useSing(phase: RecorderState['phase']) {
  const { engine, live } = useSession()
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

  // The microphone opens as each take starts, asking the first time, so the first Sing starts at
  // once instead of losing its first moments to the microphone starting up. If it can't be had,
  // nothing is said yet: Sing tries again when pressed, and says why then.
  const starting = phase === 'waiting' || phase === 'count-in'
  useEffect(() => {
    if (starting && !full) engine.warmVoice().catch(() => undefined)
  }, [starting, full, engine])

  // A new take starts without the last one's error.
  useEffect(() => {
    if (phase === 'waiting') setError(undefined)
  }, [phase])

  const pickPreset = (id: string) => {
    if (!isPreset(id)) return
    setPreset(id)
    savePreset(id)
    // Live keeps singing, through the new preset from now on.
    live?.retune(id, loadKey())
  }

  return { preset, pickPreset, singing, enabled, full, error, start, end }
}

/** What the mic control says when the microphone can't be had for singing live. */
const LIVE_MIC: Record<MicProblem, string> = {
  blocked:
    "The microphone is blocked. Allow it for this site in your browser's address bar or settings, then turn the live mic on again.",
  missing: 'No microphone was found. Connect one, then turn the live mic on again.',
  unavailable: "This browser can't record from a microphone here.",
}

/**
 * The live mic beside Sing: on, this person sings live into the jam through the preset picked
 * beside Sing, and everyone else hears them a bar later. The first time in a browser it asks them
 * to confirm headphones (`asking`, answered with `confirm` or `cancel`), and remembers it. Says why
 * it can't go on (`error`: a full jam, the microphone) or why it went off by itself (the hour, a
 * dropped connection), `unsupported` where this browser can't encode a live voice, and
 * `unavailable` where live voice isn't set up (no Realtime credentials in this Worker). `monitor`
 * hears yourself through the preset, at once, while live or singing a take; remembered here.
 * Undefined in tests without live voice.
 */
export function useLiveMic() {
  const { engine, live } = useSession()
  const [, changed] = useReducer((n: number) => n + 1, 0)
  const [asking, setAsking] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string>()
  const [monitor, setMonitor] = useState(loadMonitor)
  const [canSing, setCanSing] = useState<boolean>()

  useEffect(() => live?.subscribe(changed), [live])
  useEffect(() => {
    let on = true
    void Live.canSing(engine.audioContext?.sampleRate).then((can) => on && setCanSing(can))
    return () => {
      on = false
    }
  }, [engine])

  if (!live) return undefined

  const go = async () => {
    setError(undefined)
    setStarting(true)
    try {
      await engine.unlock()
      if (!engine.liveTiming()) {
        setError('Still syncing with the jam: try again in a moment.')
        return
      }
      await live.sing(true, { preset: loadPreset(), key: loadKey(), monitor: loadMonitor() })
    } catch (e) {
      setError(
        e instanceof MicError
          ? LIVE_MIC[e.problem]
          : e instanceof Error
            ? e.message
            : "Couldn't go live",
      )
    } finally {
      setStarting(false)
    }
  }

  const toggle = () => {
    if (live.live) {
      setError(undefined)
      void live.sing(false, { preset: loadPreset(), key: loadKey() })
      return
    }
    if (starting) return
    if (!loadHeadphones()) return setAsking(true)
    void go()
  }

  const confirm = () => {
    saveHeadphones()
    setAsking(false)
    void go()
  }

  const toggleMonitor = (on: boolean) => {
    setMonitor(on)
    saveMonitor(on)
    live.setMonitor(on)
  }

  return {
    on: live.live,
    starting,
    asking,
    unsupported: canSing === false,
    unavailable: live.available === false,
    error: error ?? live.error,
    monitor,
    toggle,
    confirm,
    cancel: () => setAsking(false),
    toggleMonitor,
  }
}
