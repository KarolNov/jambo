import { isMap } from 'duratom'
import { create, read, write } from 'duratom/core'
import * as Y from 'yjs'
import { isUploadId, PAD_KEYS, SOUND_IDS, UPLOADS } from '../sounds'
import { type Issue, Op, type OpResult } from './ops'
import { LIMITS, Meta, Pad, ROOTS, SHAPES, Sound, Track } from './schema'

/** Who made a change: tagged on the transaction, so undo and presence can tell people apart. */
export type Origin = { kind: 'user' | 'ai' | 'system'; id: string }

const fail = (message: string, path?: PropertyKey[]): OpResult => ({
  ok: false,
  issues: [{ message, ...(path ? { path } : {}) }],
})

type SchemaIssue = { message: string; path?: readonly (PropertyKey | { key: PropertyKey })[] }

const fromResult = (result: { issues?: readonly SchemaIssue[] }): OpResult =>
  result.issues
    ? {
        ok: false,
        issues: result.issues.map((i): Issue => ({
          message: i.message,
          ...(i.path ? { path: i.path.map((p) => (typeof p === 'object' ? p.key : p)) } : {}),
        })),
      }
    : { ok: true }

/**
 * Applies a batch of operations to a board doc in one transaction tagged with `origin`.
 * Each operation is validated on its own: an invalid one changes nothing and reports its issues,
 * and the rest of the batch still applies. Returns one result per operation, in order.
 */
export function apply(doc: Y.Doc, ops: readonly unknown[], origin: Origin): OpResult[] {
  const results: OpResult[] = []
  doc.transact(() => {
    for (const raw of ops) results.push(applyOne(doc, raw))
  }, origin)
  return results
}

const KEY_ORDER = PAD_KEYS.join('').toUpperCase()
const keyOrder = (key: string) => KEY_ORDER.indexOf(key)

function applyOne(doc: Y.Doc, raw: unknown): OpResult {
  const parsed = Op.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ message: i.message, path: i.path })),
    }
  }
  const op = parsed.data
  const meta = doc.getMap<unknown>(ROOTS.meta)
  const pads = doc.getMap<unknown>(ROOTS.pads)
  const tracks = doc.getMap<unknown>(ROOTS.tracks)
  const sounds = doc.getMap<unknown>(ROOTS.sounds)
  const isListed = (id: string) => {
    const node = sounds.get(id)
    const s = isMap(node) ? read(Sound, SHAPES.sound, node) : undefined
    return !!s && !s.issues
  }
  const uploadCount = () => {
    let n = 0
    sounds.forEach((_, id) => isListed(id) && n++)
    return n
  }
  // Only readable tracks count: the UI can't see or remove the rest.
  const trackCount = () => {
    let n = 0
    tracks.forEach((node) => {
      const t = isMap(node) ? read(Track, SHAPES.track, node) : undefined
      if (t && !t.issues) n++
    })
    return n
  }

  switch (op.op) {
    case 'setTempo': {
      if (trackCount() > 0) return fail('Tempo is locked while the jam has tracks', ['bpm'])
      return fromResult(write(Meta, SHAPES.meta, meta, { bpm: op.bpm }))
    }
    case 'assignPad': {
      const node = pads.get(op.padId)
      if (!isMap(node)) return fail(`No pad ${op.padId}`, ['padId'])
      if (!SOUND_IDS.has(op.soundId) && !isListed(op.soundId))
        return fail(`No sound ${op.soundId}`, ['soundId'])
      const current = read(Pad, SHAPES.pad, node)
      if (!current || current.issues) return fail(`Pad ${op.padId} is unreadable`, ['padId'])
      return fromResult(write(Pad, SHAPES.pad, node, { ...current.value, soundId: op.soundId }))
    }
    case 'addTrack': {
      if (tracks.has(op.id)) return fail(`Track ${op.id} already exists`, ['id'])
      if (trackCount() >= LIMITS.tracks) return fail(`A jam holds at most ${LIMITS.tracks} tracks`)
      return fromResult(create(Track, SHAPES.track, tracks, op.id, op.track))
    }
    case 'setTrack': {
      const node = tracks.get(op.id)
      if (!isMap(node)) return fail(`No track ${op.id}`, ['id'])
      const current = read(Track, SHAPES.track, node)
      if (!current || current.issues) return fail(`Track ${op.id} is unreadable`, ['id'])
      return fromResult(
        write(Track, SHAPES.track, node, { ...current.value, ...op.patch } as Track),
      )
    }
    case 'removeTrack': {
      if (!tracks.has(op.id)) return fail(`No track ${op.id}`, ['id'])
      tracks.delete(op.id)
      return { ok: true }
    }
    case 'addSound': {
      if (!isUploadId(op.id)) return fail(`${op.id} is not an upload id`, ['id'])
      if (sounds.has(op.id)) return fail(`Sound ${op.id} already exists`, ['id'])
      if (uploadCount() >= UPLOADS.perJam)
        return fail(`A jam holds at most ${UPLOADS.perJam} uploads`)
      return fromResult(create(Sound, SHAPES.sound, sounds, op.id, op.sound))
    }
    case 'removeSound': {
      if (!sounds.has(op.id)) return fail(`No sound ${op.id}`, ['id'])
      const keys: string[] = []
      pads.forEach((node) => {
        const p = isMap(node) ? read(Pad, SHAPES.pad, node) : undefined
        if (p && !p.issues && p.value.soundId === op.id) keys.push(p.value.key.toUpperCase())
      })
      if (keys.length > 0) {
        keys.sort((a, b) => keyOrder(a) - keyOrder(b))
        return fail(
          `Sound ${op.id} is on ${keys.length === 1 ? 'pad' : 'pads'} ${keys.join(', ')}`,
          ['id'],
        )
      }
      sounds.delete(op.id)
      return { ok: true }
    }
    case 'expireSounds': {
      for (const id of [...sounds.keys()]) sounds.delete(id)
      return { ok: true }
    }
  }
}
