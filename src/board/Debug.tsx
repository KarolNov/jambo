import { useEffect, useState } from 'react'
import { liveDelayMs } from '../../shared/live'
import { loadKey, loadPreset } from '../audio/voice/prefs'
import { Switch } from '../ui'
import { useSession } from './session'

/**
 * The `?debug` readout: this client's clock offset from the jam, its round trip, and the room time
 * of the next downbeat. Two people comparing it can check their downbeats agree within 20 ms.
 *
 * It also holds live voice's debug toggle, until the mic control arrives: on, this browser sings
 * live through its remembered preset and key, and everyone else in the jam (on the fake transport,
 * so a local Worker only) hears it one bar later. The readout shows frames sent, and how far after
 * its stamp the last frame heard here played; `window.__jamboLive` exposes the same for e2e tests.
 */
export function Debug() {
  const { engine, live } = useSession()
  const [, setFrame] = useState(0)
  const [error, setError] = useState<string>()
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => f + 1), 250)
    return () => clearInterval(t)
  }, [])
  useEffect(() => {
    if (!live) return
    const w = window as unknown as { __jamboLive?: unknown }
    w.__jamboLive = live
    const stop = live.subscribe(() => setFrame((f) => f + 1))
    return () => {
      stop()
      if (w.__jamboLive === live) delete w.__jamboLive
    }
  }, [live])
  const { offset, rtt } = engine.clock
  const next = engine.nextDownbeat()
  const heard = live?.stats.played.at(-1)
  const timing = engine.liveTiming()
  const toggle = (on: boolean) => {
    setError(undefined)
    live
      ?.sing(on, { preset: loadPreset(), key: loadKey() })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
  }
  return (
    <dl className="debug" aria-label="Clock debug">
      <dt>offset</dt>
      <dd>{offset === undefined ? '—' : `${offset.toFixed(1)} ms`}</dd>
      <dt>rtt</dt>
      <dd>{rtt === undefined ? '—' : `${rtt.toFixed(1)} ms`}</dd>
      <dt>next downbeat</dt>
      <dd>{next === undefined ? '—' : new Date(next).toISOString().slice(11, 23)}</dd>
      {live && (
        <>
          <dt>live</dt>
          <dd>
            <Switch
              variant="slide"
              checked={live.live}
              onChange={toggle}
              disabled={!live.live && (!engine.ready || !timing)}
            >
              Sing live (debug)
            </Switch>
            {(error ?? live.error) && <span role="alert"> {error ?? live.error}</span>}
          </dd>
          <dt>live sent</dt>
          <dd>{live.stats.sent}</dd>
          <dt>live heard</dt>
          <dd>
            {heard && timing
              ? `${(heard.at - heard.stamp - liveDelayMs(timing.bpm)).toFixed(1)} ms off a bar`
              : '—'}
          </dd>
        </>
      )}
    </dl>
  )
}
