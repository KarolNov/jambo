import { useAtomValue } from 'jotai'
import { CONTROL_KEYS, MASTER_KNOBS } from '../../../shared/board'
import { Knob } from '../../ui'
import { useSwatch } from '../colors'
import { masterAtom } from '../model'
import { holdControl, useHolders } from '../presence'
import { useSession } from '../session'
import { MASTER_CONSOLE_KNOBS, MASTER_READOUTS } from './loops'
import { personName } from './people'
import './master.css'

/**
 * The master stage: knobs that shape the whole jam's mix, shared with everyone and left where they
 * are set. Live as they turn; while someone else holds one it shows them and stays put for you.
 */
export function Master() {
  const master = useAtomValue(masterAtom)
  const { board, jam, me } = useSession()
  const holders = useHolders(jam.awareness, me.id)
  const swatch = useSwatch()
  return (
    <section className="console-master" aria-labelledby="console-master-title">
      <h2 id="console-master-title" className="console-master-title">
        Master
      </h2>
      <div className="console-master-knobs" role="group" aria-label="Master knobs">
        {MASTER_CONSOLE_KNOBS.map((k) => {
          const { min, max, step, default: home } = MASTER_KNOBS[k]
          const { label, format } = MASTER_READOUTS[k]
          const key = CONTROL_KEYS.master(k)
          const holder = holders.get(key)
          return (
            <div key={k} className="console-master-knob">
              <Knob
                live
                segments={16}
                label={`Master ${label.toLowerCase()}`}
                min={min}
                max={max}
                step={step}
                defaultValue={home}
                format={format}
                value={master[k]}
                onChange={(v) => board.master({ [k]: v })}
                heldBy={holder && { name: personName(holder, me.id), color: swatch(holder.color) }}
                onDragChange={(dragging) => holdControl(jam.awareness, key, dragging)}
              />
              <span className="console-master-name" aria-hidden>
                {label}
              </span>
              <span className="console-master-value" aria-hidden>
                {format(master[k])}
              </span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
