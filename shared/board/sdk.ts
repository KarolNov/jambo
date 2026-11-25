import type * as Y from 'yjs'
import { apply, type Origin } from './apply'
import type { Op, OpResult, TrackPatch } from './ops'
import type { FxMode, MasterKnob, Track } from './schema'

/**
 * The board SDK: a thin, fluent way to write operations. Every method emits exactly one
 * operation through `apply`, so what any caller did is always a readable list of operations.
 *
 * ```ts
 * const b = board(doc, { kind: 'user', id: me })
 * b.tempo(110)
 * b.pad('r0c0').assign('kick')
 * b.track(id).set({ mute: true })
 * b.track(id).set({ reverb: 0.4, pitch: -5 })
 * b.master({ tone: -0.6, swing: 0.5 })
 * b.fx('filter').set(-0.5, 0.2)
 * ```
 */
export function board(doc: Y.Doc, origin: Origin) {
  const one = (op: Op): OpResult => apply(doc, [op], origin)[0]!
  return {
    /** Applies several operations as one change. */
    apply: (ops: readonly Op[]) => apply(doc, ops, origin),
    tempo: (bpm: number) => one({ op: 'setTempo', bpm }),
    pad: (padId: string) => ({
      assign: (soundId: string) => one({ op: 'assignPad', padId, soundId }),
    }),
    /** Moves every pad on sound `from` to sound `to`. Tracks follow, since they hit pads. */
    replaceSound: (from: string, to: string) => one({ op: 'replaceSound', from, to }),
    addTrack: (id: string, track: Track) => one({ op: 'addTrack', id, track }),
    /** Sets any of the master knobs; the rest keep their value. */
    master: (set: Partial<Record<MasterKnob, number>>) => one({ op: 'setMaster', set }),
    fx: (mode: FxMode) => ({
      /** Puts the mode at `x`, `y`. Repeat takes the jam beat its slice starts on. */
      set: (x: number, y: number, startBeat?: number) =>
        one({ op: 'setFx', mode, x, y, ...(startBeat === undefined ? {} : { startBeat }) }),
      /** Puts the mode back to 0/0, which is off. */
      reset: () => one({ op: 'setFx', mode, x: 0, y: 0 }),
    }),
    track: (id: string) => ({
      set: (patch: TrackPatch) => one({ op: 'setTrack', id, patch }),
      remove: () => one({ op: 'removeTrack', id }),
    }),
  }
}

export type Board = ReturnType<typeof board>

/** A time-sortable id, so a collection's sorted ids are creation order. */
export function newId(now = Date.now()): string {
  const random = crypto.getRandomValues(new Uint8Array(4))
  return `${now.toString(36).padStart(9, '0')}-${Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('')}`
}
