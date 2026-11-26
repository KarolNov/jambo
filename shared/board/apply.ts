import { isMap } from 'duratom'
import { create, read, readKey, write, writeKey } from 'duratom/core'
import * as Y from 'yjs'
import { CLIPS, isUploadId, padKeyOrder, SOUND_IDS, UPLOADS } from '../sounds'
import { type Issue, Op, type OpResult } from './ops'
import {
  isSoundHit,
  kindOf,
  LIMITS,
  type MasterKey,
  MasterValues,
  Meta,
  Pad,
  ROOTS,
  SHAPES,
  Sound,
  type SoundKind,
  Track,
} from './schema'

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

/** The kind of the readable sound listed as `id`, or undefined when none is. */
const listedKind = (sounds: Y.Map<unknown>, id: string): SoundKind | undefined => {
  const node = sounds.get(id)
  const s = isMap(node) ? read(Sound, SHAPES.sound, node) : undefined
  return s && !s.issues ? kindOf(s.value) : undefined
}

const countKind = (doc: Y.Doc, kind: SoundKind) => {
  const sounds = doc.getMap<unknown>(ROOTS.sounds)
  let n = 0
  sounds.forEach((_, id) => listedKind(sounds, id) === kind && n++)
  return n
}

/** How many uploads a jam lists, clips aside: the count `addSound` holds to `UPLOADS.perJam`. */
export const countUploads = (doc: Y.Doc): number => countKind(doc, 'upload')

/** How many voice clips a jam lists: the count `addSound` holds to `CLIPS.perJam`. */
export const countClips = (doc: Y.Doc): number => countKind(doc, 'clip')

/** Each kind's limit, and what `addSound` says when a jam is full of it. */
const KIND_LIMITS: Record<SoundKind, { max: number; full: string }> = {
  upload: { max: UPLOADS.perJam, full: `A jam holds at most ${UPLOADS.perJam} uploads` },
  clip: { max: CLIPS.perJam, full: `A jam holds at most ${CLIPS.perJam} voice clips` },
}

/** The beat repeat's slice starts on, or 0 while repeat is unset or unreadable. */
const readStartBeat = (master: Y.Array<unknown>) => {
  const r = readKey(MasterValues.repeat, master, 'repeat')
  return r && !r.issues ? r.value.startBeat : 0
}

/** Checks `val` against the schema of master control `key`, keyed under the field name. */
const checkMaster = (key: MasterKey, val: unknown, path: PropertyKey[] = [key]) => {
  const r = MasterValues[key].safeParse(val)
  return r.success
    ? undefined
    : r.error.issues.map((i): Issue => ({ message: i.message, path: [...path, ...i.path] }))
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

/** The raw hits of a track node, whatever else about it is unreadable. */
const rawHits = (node: Y.Map<unknown>): unknown[] => {
  const hits = node.get('hits')
  return Array.isArray(hits) ? hits : []
}

const namesSound = (hit: unknown, soundId: string) =>
  typeof hit === 'object' && hit !== null && (hit as { soundId?: unknown }).soundId === soundId

/**
 * Tracks with a hit naming `soundId`, readable or not, as [track id, name] in id order (creation
 * order). Reads the raw hits, so a track that fails its schema still counts as using the sound.
 */
function tracksUsing(tracks: Y.Map<unknown>, soundId: string): [string, string][] {
  const out: [string, string][] = []
  tracks.forEach((node, id) => {
    if (!isMap(node) || !rawHits(node).some((h) => namesSound(h, soundId))) return
    const name = node.get('name')
    out.push([id, typeof name === 'string' && name.trim() ? name.trim() : id])
  })
  return out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
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
  const kind = (id: string) => listedKind(sounds, id)
  /** Whether a pad may hold `id`: a kit sound or a listed upload, never a clip. */
  const padSound = (id: string) => SOUND_IDS.has(id) || kind(id) === 'upload'
  /** Why a pad can't hold `id`, or undefined when it can. */
  const notPadSound = (id: string) =>
    padSound(id)
      ? undefined
      : kind(id) === 'clip'
        ? `Sound ${id} is a voice clip; clips can't go on pads`
        : `No sound ${id}`
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
      const refused = notPadSound(op.soundId)
      if (refused) return fail(refused, ['soundId'])
      const current = read(Pad, SHAPES.pad, node)
      if (!current || current.issues) return fail(`Pad ${op.padId} is unreadable`, ['padId'])
      return fromResult(write(Pad, SHAPES.pad, node, { ...current.value, soundId: op.soundId }))
    }
    case 'addTrack': {
      if (tracks.has(op.id)) return fail(`Track ${op.id} already exists`, ['id'])
      if (trackCount() >= LIMITS.tracks) return fail(`A jam holds at most ${LIMITS.tracks} tracks`)
      // Shape first, so the sound check below reads well-formed hits.
      const shaped = Track.safeParse(op.track)
      if (!shaped.success) return fromResult({ issues: shaped.error.issues })
      // A sound hit may name any sound the jam can play: the kit, an upload or a clip.
      const hits = shaped.data.hits
      for (let i = 0; i < hits.length; i++) {
        const hit = hits[i]!
        if (isSoundHit(hit) && !SOUND_IDS.has(hit.soundId) && !kind(hit.soundId))
          return fail(`No sound ${hit.soundId}`, ['track', 'hits', i, 'soundId'])
      }
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
      // An unknown kind fails the schema below; until then it counts as an upload.
      const k: SoundKind =
        (op.sound as Partial<Sound> | undefined)?.kind === 'clip' ? 'clip' : 'upload'
      if (countKind(doc, k) >= KIND_LIMITS[k].max) return fail(KIND_LIMITS[k].full)
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
      const names = tracksUsing(tracks, op.id).map(([, name]) => name)
      if (names.length > 0) {
        return fail(
          `Sound ${op.id} is in ${names.length === 1 ? 'track' : 'tracks'} ${names.join(', ')}`,
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
      const refused = notPadSound(op.to)
      if (refused) return fail(refused, ['to'])
      for (const [padId] of padsUsing(pads, op.from)) {
        const node = pads.get(padId)
        if (!isMap(node)) continue
        const current = read(Pad, SHAPES.pad, node)
        if (!current || current.issues) continue
        const written = write(Pad, SHAPES.pad, node, { ...current.value, soundId: op.to })
        if (written.issues) return fromResult(written)
      }
      // Sound hits follow too: the one way a track's hits change after it is added.
      for (const [trackId] of tracksUsing(tracks, op.from)) {
        const node = tracks.get(trackId)
        if (!isMap(node)) continue
        const current = read(Track, SHAPES.track, node)
        if (!current || current.issues) continue
        const hits = current.value.hits.map((h) =>
          isSoundHit(h) && h.soundId === op.from ? { soundId: op.to, beat: h.beat } : h,
        )
        const written = write(Track, SHAPES.track, node, { ...current.value, hits })
        if (written.issues) return fromResult(written)
      }
      return { ok: true }
    }
    case 'setMaster': {
      const entries = Object.entries(op.set) as [MasterKey, number][]
      const issues = entries.flatMap(([k, val]) => checkMaster(k, val, ['set', k]) ?? [])
      if (issues.length > 0) return { ok: false, issues }
      const master = doc.getArray(ROOTS.master)
      for (const [k, val] of entries) {
        const written = fromResult(writeKey(MasterValues[k], master, k, val))
        if (!written.ok) return written
      }
      return { ok: true }
    }
    case 'setFx': {
      if (op.mode !== 'repeat' && op.startBeat !== undefined)
        return fail(`Only repeat takes a start beat`, ['startBeat'])
      const master = doc.getArray(ROOTS.master)
      const val =
        op.mode === 'repeat'
          ? {
              x: op.x,
              y: op.y,
              startBeat: op.startBeat ?? readStartBeat(master),
            }
          : { x: op.x, y: op.y }
      const issues = checkMaster(op.mode, val, [])
      if (issues) return { ok: false, issues }
      return fromResult(writeKey(MasterValues[op.mode], master, op.mode, val as never))
    }
  }
}
