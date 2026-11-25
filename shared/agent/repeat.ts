import { read } from 'duratom/core'
import type * as Y from 'yjs'
import { BPM, masterOf, Meta, type Op, ROOTS, SHAPES } from '../board'
import { repeatStamp } from '../looper'

/**
 * An agent's ops with each beat repeat move stamped, as a person's are, with the jam beat it takes
 * effect on, from the room's clock at `roomMs`: engaging and changing slice at the slice's next
 * grid line, letting go at the next 1/16. Agents can't send a start beat themselves, so without
 * this every client would pick its own line. Moves that only change the level stay as they are.
 */
export function stampRepeats(ops: readonly Op[], doc: Y.Doc, roomMs: number): Op[] {
  const meta = read(Meta, SHAPES.meta, doc.getMap<unknown>(ROOTS.meta))
  const bpm = meta && !meta.issues ? meta.value.bpm : BPM.default
  let repeat: { x: number; y: number } = masterOf(doc.getArray(ROOTS.master)).repeat
  return ops.map((op) => {
    if (op.op !== 'setFx' || op.mode !== 'repeat') return op
    const startBeat = repeatStamp(repeat, op, roomMs, bpm)
    repeat = op
    return startBeat === undefined ? op : { ...op, startBeat }
  })
}
