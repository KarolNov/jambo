import { collection, select, typedAtom } from 'duratom'
import { atom } from 'jotai'
import { BPM, Meta, Pad, ROOTS, SHAPES, Sound, Track } from '../../shared/board'

/** Reads of the board doc. Writes never go through these atoms: they go through the board SDK. */
export const meta = typedAtom(select.map(ROOTS.meta), Meta, SHAPES.meta)
export const pads = collection(select.map(ROOTS.pads), Pad, SHAPES.pad)
export const tracks = collection(select.map(ROOTS.tracks), Track, SHAPES.track)
export const sounds = collection(select.map(ROOTS.sounds), Sound, SHAPES.sound)

export const bpmAtom = atom((get) => {
  const m = get(meta)
  return m && !m.issues ? m.value.bpm : BPM.default
})

/** Every readable pad by id. */
export const padsAtom = atom((get) => {
  const out = new Map<string, Pad>()
  for (const id of get(pads.ids)) {
    const p = get(pads.item(id))
    if (p && !p.issues) out.set(id, p.value)
  }
  return out
})

/** Every readable track by id, in creation order. */
export const tracksAtom = atom((get) => {
  const out = new Map<string, Track>()
  for (const id of get(tracks.ids)) {
    const t = get(tracks.item(id))
    if (t && !t.issues) out.set(id, t.value)
  }
  return out
})

/** Every readable upload of the jam by id, oldest first. */
export const soundsAtom = atom((get) => {
  const out: [string, Sound][] = []
  for (const id of get(sounds.ids)) {
    const s = get(sounds.item(id))
    if (s && !s.issues) out.push([id, s.value])
  }
  return new Map(out.sort(([, a], [, b]) => a.createdAt - b.createdAt))
})
