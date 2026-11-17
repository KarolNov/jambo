import { create, read } from 'duratom/core'
import type * as Y from 'yjs'
import { DEFAULT_LAYOUT, PAD_KEYS, padId } from '../sounds'
import { BPM, Meta, Pad, ROOTS, SHAPES } from './schema'

/**
 * Gives an empty board its defaults: the tempo and the default pad layout. Runs on the server
 * when a jam's doc loads, so every client sees the same pads; leaves anything already set alone.
 */
export function seedBoard(doc: Y.Doc) {
  doc.transact(
    () => {
      const meta = doc.getMap<unknown>(ROOTS.meta)
      if (!read(Meta, SHAPES.meta, meta) || meta.size === 0) meta.set('bpm', BPM.default)
      const pads = doc.getMap<unknown>(ROOTS.pads)
      if (pads.size > 0) return
      DEFAULT_LAYOUT.forEach((row, r) =>
        row.forEach((soundId, c) => {
          const key = PAD_KEYS[r]![c]!
          create(Pad, SHAPES.pad, pads, padId(r, c), { row: r, col: c, key, soundId })
        }),
      )
    },
    { kind: 'system', id: 'seed' },
  )
}
