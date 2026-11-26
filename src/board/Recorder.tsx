import { useEffect, useRef, useState } from 'react'
import { prepareBuffer, type Prepared, UploadError } from '../audio/upload'
import { MAX_SECONDS, MicError, VoiceInput } from '../audio/voice/input'
import { type Key, keyName, NOTE_NAMES, type Scale } from '../audio/voice/dsp/tune'
import type { Latency } from '../audio/voice/latency'
import {
  loadKey,
  loadMonitor,
  loadPreset,
  loadRoundTrip,
  saveKey,
  saveMonitor,
  savePreset,
} from '../audio/voice/prefs'
import { isPreset, PRESETS, type PresetId, rackDelay, usesKey } from '../audio/voice/presets'
import { renderVoice } from '../audio/voice/render'
import { Button, Select, Switch } from '../ui'
import { useSession } from './session'

type Phase = 'idle' | 'opening' | 'recording' | 'rendering' | 'done' | 'testing'

const PRESET_GROUPS = [{ options: PRESETS.map((p) => ({ value: p.id, label: p.name })) }]

const SCALES: Scale[] = ['major', 'minor']
const KEY_GROUPS = SCALES.map((scale) => ({
  label: scale === 'major' ? 'Major' : 'Minor',
  options: NOTE_NAMES.map((_, root) => ({
    value: keyName({ root, scale }),
    label: keyName({ root, scale }),
  })),
}))
const keyOf = (name: string): Key | undefined => {
  for (const scale of SCALES) {
    const root = NOTE_NAMES.findIndex((_, r) => keyName({ root: r, scale }) === name)
    if (root >= 0) return { root, scale }
  }
  return undefined
}

/**
 * Records a voice in the upload dialog: pick a preset, optionally monitor through it, record up to
 * `MAX_SECONDS` (it stops by itself), then listen back or record again. Each kept recording is
 * rendered through the preset and prepared like a file; `onPrepared` gets it, or undefined when
 * it is dropped for a new one.
 */
export function Recorder({
  onPrepared,
  disabled,
}: {
  onPrepared: (prepared: Prepared | undefined) => void
  /** The dialog is uploading: hold still. */
  disabled: boolean
}) {
  const { engine } = useSession()
  const [phase, setPhase] = useState<Phase>('idle')
  const [preset, setPreset] = useState<PresetId>(loadPreset)
  const [key, setKey] = useState<Key>(loadKey)
  const [monitor, setMonitor] = useState(loadMonitor)
  const [roundTrip, setRoundTrip] = useState(loadRoundTrip)
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [latency, setLatency] = useState<Latency>()
  const [error, setError] = useState<string>()
  const [prepared, setPrepared] = useState<Prepared>()
  const [listening, setListening] = useState(false)
  const input = useRef<VoiceInput>(undefined)
  const timer = useRef<number>(undefined)
  const playback = useRef<AudioBufferSourceNode>(undefined)
  const decoding = useRef(false)
  // False once the dialog has closed, so a recording still opening lets go of the microphone.
  const alive = useRef(true)
  const latest = useRef({ preset, key, monitor, onPrepared })
  latest.current = { preset, key, monitor, onPrepared }

  const stopListening = () => {
    playback.current?.stop()
    playback.current = undefined
    setListening(false)
  }

  const release = () => {
    clearInterval(timer.current)
    input.current?.close()
    input.current = undefined
    setLevel(0)
  }

  // Let go of the microphone and stop playback if the dialog closes mid-way.
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      release()
      playback.current?.stop()
    }
  }, [])

  const stop = async () => {
    const voice = input.current
    if (!voice) return
    clearInterval(timer.current)
    setPhase('rendering')
    const take = await voice.stop()
    const rate = voice.sampleRate
    release()
    try {
      const rendered = await renderVoice(take, rate, latest.current.preset, latest.current.key)
      const p = await prepareBuffer(rendered, 'recording')
      setPrepared(p)
      latest.current.onPrepared(p)
      setPhase('done')
    } catch (e) {
      setError(e instanceof UploadError ? e.message : 'Could not keep that recording')
      setPhase('idle')
    }
  }

  const record = async () => {
    stopListening()
    setError(undefined)
    setPrepared(undefined)
    onPrepared(undefined)
    setPhase('opening')
    try {
      await engine.unlock()
      const ctx = engine.audioContext
      if (!ctx) throw new MicError('unavailable')
      const voice = await VoiceInput.open(ctx)
      if (!alive.current) return voice.close()
      input.current = voice
      setLatency(voice.latency)
      voice.onLevel(setLevel)
      // The switch may have moved while the microphone opened.
      await voice.monitor(latest.current.monitor, preset, latest.current.key)
      if (!alive.current) return
      voice.start()
      setElapsed(0)
      setPhase('recording')
      timer.current = window.setInterval(() => {
        setElapsed(voice.seconds)
        if (voice.seconds >= MAX_SECONDS) void stop()
      }, 100)
    } catch (e) {
      release()
      setError(e instanceof MicError ? e.message : "Couldn't start recording")
      setPhase('idle')
    }
  }

  const listen = async () => {
    const ctx = engine.audioContext
    if (!ctx || !prepared) return
    if (listening) return stopListening()
    if (decoding.current) return
    decoding.current = true
    let buffer: AudioBuffer
    try {
      buffer = await ctx.decodeAudioData(prepared.wav.slice().buffer)
    } catch {
      setError("Couldn't play that recording")
      return
    } finally {
      decoding.current = false
    }
    if (!alive.current) return
    const src = ctx.createBufferSource()
    src.buffer = buffer
    src.connect(ctx.destination)
    src.onended = () => {
      if (playback.current === src) stopListening()
    }
    playback.current = src
    setListening(true)
    src.start()
  }

  const pickPreset = (id: string) => {
    if (!isPreset(id)) return
    setPreset(id)
    savePreset(id)
  }

  const pickKey = (name: string) => {
    const k = keyOf(name)
    if (!k) return
    setKey(k)
    saveKey(k)
  }

  const toggleMonitor = (on: boolean) => {
    setMonitor(on)
    saveMonitor(on)
    void input.current?.monitor(on, preset, key)
  }

  /** The loopback test: opens the microphone just for it, plays clicks, listens for them. */
  const testDelay = async () => {
    stopListening()
    setError(undefined)
    setPhase('testing')
    try {
      await engine.unlock()
      const ctx = engine.audioContext
      if (!ctx) throw new MicError('unavailable')
      const voice = await VoiceInput.open(ctx)
      if (!alive.current) return voice.close()
      input.current = voice
      const measured = await voice.measureRoundTrip()
      if (!alive.current) return
      if (measured === undefined) {
        setError(
          "Couldn't hear the clicks. Take off headphones, turn the speakers up, and try again somewhere quiet.",
        )
      } else {
        setRoundTrip(measured)
        setLatency(voice.latency)
      }
    } catch (e) {
      setError(e instanceof MicError ? e.message : "Couldn't run the delay test")
    }
    release()
    setPhase(prepared ? 'done' : 'idle')
  }

  const recording = phase === 'recording'
  const busy = phase === 'opening' || phase === 'rendering' || phase === 'testing'
  const delayMs = (latency?.roundTrip ?? roundTrip ?? 0) * 1000
  const heardLate = Math.round(
    delayMs + rackDelay(preset, engine.audioContext?.sampleRate ?? 48_000) * 1000,
  )
  return (
    <div className="voice-recorder" aria-label="Record your voice" role="group">
      <div className="voice-settings">
        {/* Fixed once recording starts: the whole take renders through one preset. */}
        {recording || busy || disabled ? (
          <span className="voice-preset">
            {PRESETS.find((p) => p.id === preset)?.name}
            {usesKey(preset) && ` · ${keyName(key)}`}
          </span>
        ) : (
          <>
            <Select
              label="Voice preset"
              value={preset}
              groups={PRESET_GROUPS}
              onChange={pickPreset}
            />
            {usesKey(preset) && (
              <Select label="Key" value={keyName(key)} groups={KEY_GROUPS} onChange={pickKey} />
            )}
          </>
        )}
        <Switch variant="slide" checked={monitor} onChange={toggleMonitor} disabled={disabled}>
          Monitor
        </Switch>
      </div>
      {monitor && (
        <p className="muted voice-hint">
          Use headphones: with speakers the mic hears itself and feeds back.
          {heardLate > 0 && <> You'll hear yourself about {heardLate} ms late.</>}
        </p>
      )}
      <div className="voice-latency">
        <span className="muted">
          {phase === 'testing'
            ? 'Listening for clicks: keep the speakers on and the room quiet…'
            : roundTrip !== undefined
              ? `Delay: ${Math.round(roundTrip * 1000)} ms, measured.`
              : latency && latency.roundTrip > 0
                ? `Delay: about ${Math.round(latency.roundTrip * 1000)} ms, estimated.`
                : 'Delay: estimated from your browser.'}
        </span>
        <Button onClick={() => void testDelay()} disabled={recording || busy || disabled}>
          {roundTrip !== undefined ? 'Test again' : 'Test delay'}
        </Button>
      </div>
      <div className="voice-take">
        <Button
          tone="danger"
          aria-pressed={recording}
          disabled={busy || disabled}
          onClick={() => void (recording ? stop() : record())}
        >
          {recording ? 'Stop' : prepared ? 'Record again' : 'Record'}
        </Button>
        <div
          className="voice-meter"
          role="meter"
          aria-label="Input level"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(level * 100)}
        >
          <span style={{ transform: `scaleX(${Math.min(1, level)})` }} />
        </div>
        <span className="muted voice-time" aria-live="off">
          {phase === 'opening'
            ? 'Starting…'
            : phase === 'rendering'
              ? 'Saving…'
              : recording
                ? `${elapsed.toFixed(1)} / ${MAX_SECONDS} s`
                : prepared
                  ? `${(prepared.durationMs / 1000).toFixed(1)} s`
                  : `Up to ${MAX_SECONDS} s`}
        </span>
        {prepared && !recording && (
          <Button onClick={() => void listen()} disabled={busy || disabled}>
            {listening ? 'Stop listening' : 'Listen'}
          </Button>
        )}
      </div>
      {error && (
        <p className="message" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
