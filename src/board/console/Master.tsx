import { useAtomValue } from 'jotai'
import { useState } from 'react'
import { CONTROL_KEYS, FX_MODES, fxOn, MASTER_KNOBS, type Master } from '../../../shared/board'
import { repeatStamp } from '../../../shared/looper'
import { Button, type Holder, Knob, Tabs, XYPad } from '../../ui'
import { useSwatch } from '../colors'
import { bpmAtom, masterAtom } from '../model'
import { holdControl, type Person, useHolders } from '../presence'
import { useSession } from '../session'
import { MASTER_CONSOLE_KNOBS, MASTER_READOUTS, TOUCHPAD_MODES, TOUCHPAD_READOUTS } from './loops'
import { personName } from './people'
import './master.css'

type TouchpadMode = (typeof TOUCHPAD_MODES)[number]

/**
 * The master stage: the touchpad and the knobs that shape the whole jam's mix, shared with
 * everyone and left where they are set. Live as they move; while someone else holds one it shows
 * them and stays put for you.
 */
export function Master() {
  const master = useAtomValue(masterAtom)
  const bpm = useAtomValue(bpmAtom)
  const { board, jam, me, engine } = useSession()
  const holders = useHolders(jam.awareness, me.id)
  const swatch = useSwatch()
  const heldBy = (key: string): Holder | undefined => {
    const holder: Person | undefined = holders.get(key)
    return holder && { name: personName(holder, me.id), color: swatch(holder.color) }
  }
  // Which mode your touchpad shows is yours alone; each mode's position is the jam's.
  const [mode, setMode] = useState<TouchpadMode>(TOUCHPAD_MODES[0])
  // Repeat engages, changes slice and lets go on the jam's grid: the move carries the beat it
  // takes effect on, so every client switches on the same line.
  const move = (m: TouchpadMode, x: number, y: number) => {
    if (m !== 'repeat') return board.fx(m).set(x, y)
    const now = engine.clock.now() ?? Date.now()
    board.fx(m).set(x, y, repeatStamp(master.repeat, { x, y }, now, bpm))
  }
  return (
    <section className="console-master" aria-labelledby="console-master-title">
      <h2 id="console-master-title" className="console-master-title">
        Master
      </h2>
      <div className="console-master-body">
        <Tabs
          className="console-touchpad"
          label="Touchpad mode"
          value={mode}
          onChange={(id) => setMode(id as TouchpadMode)}
          tabs={TOUCHPAD_MODES.map((m) => ({
            id: m,
            label: TOUCHPAD_READOUTS[m].label,
            dot: fxOn(m, master[m]) ? 'on' : '',
            content: (
              <ModePad
                mode={m}
                at={master[m]}
                heldBy={heldBy(CONTROL_KEYS.fx(m))}
                onChange={(x, y) => move(m, x, y)}
                onReset={() => move(m, 0, 0)}
                onDragChange={(dragging) =>
                  holdControl(jam.awareness, CONTROL_KEYS.fx(m), dragging)
                }
              />
            ),
          }))}
        />
        <div className="console-master-knobs" role="group" aria-label="Master knobs">
          {MASTER_CONSOLE_KNOBS.map((k) => {
            const { min, max, step, default: home } = MASTER_KNOBS[k]
            const { label, format } = MASTER_READOUTS[k]
            const key = CONTROL_KEYS.master(k)
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
                  heldBy={heldBy(key)}
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
      </div>
    </section>
  )
}

/**
 * One touchpad mode: its pad, latched where it is left, how it reads, and its reset to 0/0 (off),
 * there whenever it is away from 0/0.
 * While someone else holds it, neither the pad nor the reset moves it for you.
 */
function ModePad({
  mode,
  at,
  heldBy,
  onChange,
  onReset,
  onDragChange,
}: {
  mode: TouchpadMode
  at: Master[TouchpadMode]
  heldBy?: Holder
  onChange: (x: number, y: number) => void
  onReset: () => void
  onDragChange: (dragging: boolean) => void
}) {
  const { label, x, y } = TOUCHPAD_READOUTS[mode]
  const range = FX_MODES[mode]
  return (
    <div className="console-touchpad-mode">
      <XYPad
        live
        label={label}
        x={at.x}
        y={at.y}
        xAxis={{ ...range.x, label: `${label} ${x.label.toLowerCase()}`, format: x.format }}
        yAxis={{ ...range.y, label: `${label} ${y.label.toLowerCase()}`, format: y.format }}
        home={{ x: 0, y: 0 }}
        onChange={onChange}
        heldBy={heldBy}
        onDragChange={onDragChange}
        className="console-touchpad-pad"
      />
      <div className="console-touchpad-foot">
        <span className="console-touchpad-reading" aria-hidden>
          {x.format(at.x)} · {y.label} {y.format(at.y)}
        </span>
        <Button
          size="sm"
          tone="quiet"
          aria-label={`Reset ${label}`}
          disabled={!!heldBy || (at.x === 0 && at.y === 0)}
          onClick={onReset}
        >
          Reset
        </Button>
      </div>
    </div>
  )
}
