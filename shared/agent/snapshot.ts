import { isMap } from 'duratom'
import { read } from 'duratom/core'
import type * as Y from 'yjs'
import {
  BPM,
  kindOf,
  type Master,
  masterOf,
  Meta,
  Pad,
  ROOTS,
  SHAPES,
  Sound,
  type SoundKind,
  Track,
} from '../board'
import type { ColorName } from '../colors'
import { padKeyOrder, SOUNDS } from '../sounds'

/** Someone in the jam as a run sees them. People have kind `person`; agents, their own kind. */
export interface SnapshotPresence {
  name: string
  kind: string
  color: ColorName
}

export interface SnapshotSound {
  id: string
  name: string
  /** `clip`: a voice sung into a take; tracks hit it by sound id, never on a pad. */
  kind: 'kit' | SoundKind
  /** Kit sounds: drums, percussion, tonal or fx. */
  category?: string
  /** Uploads and clips: the uploader's name, when known. */
  by?: string
  durationMs?: number
}

/**
 * The master as an agent reads it: repeat without its startBeat, which the jam stamps on
 * every repeat change and an agent can't set.
 */
export type SnapshotMaster = Omit<Master, 'repeat'> & { repeat: { x: number; y: number } }

/**
 * The jam as plain data, as an agent reads it when it joins. Unreadable
 * nodes are left out, as the UI leaves them out.
 */
export interface Snapshot {
  bpm: number
  pads: { id: string; key: string; row: number; col: number; soundId: string }[]
  sounds: SnapshotSound[]
  tracks: ({ id: string } & Track)[]
  /** The master knobs and touchpad modes, each at its default until someone sets it. */
  master: SnapshotMaster
  here: SnapshotPresence[]
}

function readAll<T>(map: Y.Map<unknown>, schema: Parameters<typeof read>[0], shape: object) {
  const out: [string, T][] = []
  map.forEach((node, id) => {
    if (!isMap(node)) return
    const r = read(schema, shape as never, node)
    if (r && !r.issues) out.push([id, r.value as T])
  })
  return out
}

const byId = ([a]: [string, unknown], [b]: [string, unknown]) => (a < b ? -1 : a > b ? 1 : 0)

function agentMaster({ repeat, ...rest }: Master): SnapshotMaster {
  return { ...rest, repeat: { x: repeat.x, y: repeat.y } }
}

/** The snapshot of board `doc`, with `here` being who is in the jam right now. */
export function snapshotOf(doc: Y.Doc, here: readonly SnapshotPresence[]): Snapshot {
  const meta = read(Meta, SHAPES.meta, doc.getMap<unknown>(ROOTS.meta))
  const pads = readAll<Pad>(doc.getMap(ROOTS.pads), Pad, SHAPES.pad)
    .map(([id, p]) => ({ id, key: p.key, row: p.row, col: p.col, soundId: p.soundId }))
    .sort((a, b) => padKeyOrder(a.key) - padKeyOrder(b.key))
  const listed = readAll<Sound>(doc.getMap(ROOTS.sounds), Sound, SHAPES.sound)
    .sort(byId)
    .map(([id, s]): SnapshotSound => ({
      id,
      name: s.name,
      kind: kindOf(s),
      ...(s.authorName ? { by: s.authorName } : {}),
      durationMs: s.durationMs,
    }))
  const kit = SOUNDS.map((s): SnapshotSound => ({
    id: s.id,
    name: s.name,
    kind: 'kit',
    category: s.category,
  }))
  const tracks = readAll<Track>(doc.getMap(ROOTS.tracks), Track, SHAPES.track)
    .sort(byId)
    .map(([id, t]) => ({ id, ...t }))
  return {
    bpm: meta && !meta.issues ? meta.value.bpm : BPM.default,
    pads,
    sounds: [...kit, ...listed],
    tracks,
    master: agentMaster(masterOf(doc.getArray(ROOTS.master))),
    here: here.map((p) => ({ ...p })),
  }
}
