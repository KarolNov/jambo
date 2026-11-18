import { useEffect, useState } from 'react'
import { useSession } from './session'

/**
 * The `?debug` readout: this client's clock offset from the jam, its round trip, and the room time
 * of the next downbeat. Two people comparing it can check their downbeats agree within 20 ms.
 */
export function Debug() {
  const { engine } = useSession()
  const [, setFrame] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setFrame((f) => f + 1), 250)
    return () => clearInterval(t)
  }, [])
  const { offset, rtt } = engine.clock
  const next = engine.nextDownbeat()
  return (
    <dl className="debug" aria-label="Clock debug">
      <dt>offset</dt>
      <dd>{offset === undefined ? '—' : `${offset.toFixed(1)} ms`}</dd>
      <dt>rtt</dt>
      <dd>{rtt === undefined ? '—' : `${rtt.toFixed(1)} ms`}</dd>
      <dt>next downbeat</dt>
      <dd>{next === undefined ? '—' : new Date(next).toISOString().slice(11, 23)}</dd>
    </dl>
  )
}
