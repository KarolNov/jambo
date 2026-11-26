import { useEffect, useRef, useState } from 'react'
import { prepareBuffer, type Prepared, UploadError } from '../audio/upload'
import { MAX_SECONDS, MicError, VoiceInput } from '../audio/voice/input'
import type { Latency } from '../audio/voice/latency'
import { loadMonitor, loadPreset, saveMonitor, savePreset } from '../audio/voice/prefs'
import { isPreset, PRESETS, type PresetId } from '../audio/voice/presets'
import { renderVoice } from '../audio/voice/render'
import { Button, Select, Switch } from '../ui'
import { useSession } from './session'

type Phase = 'idle' | 'opening' | 'recording' | 'rendering' | 'done'

const PRESET_GROUPS = [{ options: PRESETS.map((p) => ({ value: p.id, label: p.name })) }]

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
  const [monitor, setMonitor] = useState(loadMonitor)
  const [level, setLevel] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const [latency, setLatency] = useState<Latency>()
  const [error, setError] = useState<string>()
  const [prepared, setPrepared] = useState<Prepared>()
  const [listening, setListening] = useState(false)
  const input = useRef<VoiceInput>(undefined)
  const timer = useRef<number>(undefined)
  const playback = useRef<AudioBufferSourceNode>(undefined)
  const latest = useRef({ preset, onPrepared })
  latest.current = { preset, onPrepared }

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
  useEffect(
    () => () => {
      release()
      playback.current?.stop()
    },
    [],
  )

  const stop = async () => {
    const voice = input.current
    if (!voice) return
    clearInterval(timer.current)
    setPhase('rendering')
    const take = await voice.stop()
    const rate = voice.sampleRate
    release()
    try {
      const rendered = await renderVoice(take, rate, latest.current.preset)
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
      input.current = voice
      setLatency(voice.latency)
      voice.onLevel(setLevel)
      await voice.monitor(monitor, preset)
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
    const buffer = await ctx.decodeAudioData(prepared.wav.slice().buffer)
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

  const toggleMonitor = (on: boolean) => {
    setMonitor(on)
    saveMonitor(on)
    void input.current?.monitor(on, preset)
  }

  const recording = phase === 'recording'
  const busy = phase === 'opening' || phase === 'rendering'
  return (
    <div className="voice-recorder" aria-label="Record your voice" role="group">
      <div className="voice-settings">
        {/* Fixed once recording starts: the whole take renders through one preset. */}
        {recording || busy || disabled ? (
          <span className="voice-preset">{PRESETS.find((p) => p.id === preset)?.name}</span>
        ) : (
          <Select
            label="Voice preset"
            value={preset}
            groups={PRESET_GROUPS}
            onChange={pickPreset}
          />
        )}
        <Switch variant="slide" checked={monitor} onChange={toggleMonitor} disabled={disabled}>
          Monitor
        </Switch>
      </div>
      {monitor && (
        <p className="muted voice-hint">
          Use headphones: with speakers the mic hears itself and feeds back.
          {latency && latency.roundTrip > 0 && (
            <> You'll hear yourself about {Math.round(latency.roundTrip * 1000)} ms late.</>
          )}
        </p>
      )}
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
