import { isMap } from 'duratom'
import { create, read, write } from 'duratom/core'
import * as Y from 'yjs'
import { isUploadId, padKeyOrder, SOUND_IDS, UPLOADS } from '../sounds'
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
    for (const raw of ops) results.push(applyOne(doc, raw, origin))
  }, origin)
  return results
}

const isListedSound = (sounds: Y.Map<unknown>, id: string) => {
  const node = sounds.get(id)
  const s = isMap(node) ? read(Sound, SHAPES.sound, node) : undefined
  return !!s && !s.issues
}

/** How many uploads a jam lists: the count `addSound` holds to `UPLOADS.perJam`. */
export function countUploads(doc: Y.Doc): number {
  const sounds = doc.getMap<unknown>(ROOTS.sounds)
  let n = 0
  sounds.forEach((_, id) => isListedSound(sounds, id) && n++)
  return n
}

/** Operations only the room may apply: it stores and deletes the audio they list. */
const ROOM_ONLY = new Set<Op['op']>(['addSound', 'removeSound', 'expireSounds'])

/**
 * Pads whose stored sound is `soundId`, readable or not, as [pad id, upper-case key] in key
 * order. Reads the raw field, so a pad that fails its schema still counts as using the sound.
 */
function padsUsing(pads: Y.Map<unknown>, soundId: string): [string, string][] {
  const out: [string, string][] = []
  pads.forEach((node, padId) => {
    if (!isMap(node) || node.get('soundId') !== soundId) return
    const key = node.get('key')
    out.push([padId, typeof key === 'string' ? key.toUpperCase() : padId])
  })
  return out.sort(([, a], [, b]) => padKeyOrder(a) - padKeyOrder(b))
}

function applyOne(doc: Y.Doc, raw: unknown, origin: Origin): OpResult {
  const parsed = Op.safeParse(raw)
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((i) => ({ message: i.message, path: i.path })),
    }
  }
  const op = parsed.data
  if (ROOM_ONLY.has(op.op) && origin.kind !== 'system')
    return fail(`Only the room can apply ${op.op}`)
  const meta = doc.getMap<unknown>(ROOTS.meta)
  const pads = doc.getMap<unknown>(ROOTS.pads)
  const tracks = doc.getMap<unknown>(ROOTS.tracks)
  const sounds = doc.getMap<unknown>(ROOTS.sounds)
  const isListed = (id: string) => isListedSound(sounds, id)
  const uploadCount = () => countUploads(doc)
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
      const keys = padsUsing(pads, op.id).map(([, key]) => key)
      if (keys.length > 0) {
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
    case 'replaceSound': {
      if (!SOUND_IDS.has(op.to) && !isListed(op.to)) return fail(`No sound ${op.to}`, ['to'])
      for (const [padId] of padsUsing(pads, op.from)) {
        const node = pads.get(padId)
        if (!isMap(node)) continue
        const current = read(Pad, SHAPES.pad, node)
        if (!current || current.issues) continue
        const written = write(Pad, SHAPES.pad, node, { ...current.value, soundId: op.to })
        if (written.issues) return fromResult(written)
      }
      return { ok: true }
    }
  }
}
