import type { Holds } from './held'
import type { Snapshot, SnapshotMaster, SnapshotPresence, SnapshotSound } from './snapshot'

type SnapshotTrack = Snapshot['tracks'][number]

/**
 * One thing that differs between two snapshots of a jam, as `listen` tells an agent. Values are
 * the new ones; a changed track lists only the fields that changed.
 */
export type Change =
  | { what: 'tempo'; bpm: number }
  | { what: 'pad'; id: string; soundId: string }
  | { what: 'soundAdded'; sound: SnapshotSound }
  | { what: 'soundRemoved'; id: string; name: string }
  | { what: 'trackAdded'; track: SnapshotTrack }
  | { what: 'trackRemoved'; id: string; name: string }
  | { what: 'trackChanged'; id: string; name: string; set: Partial<SnapshotTrack> }
  | { what: 'master'; set: Partial<SnapshotMaster> }
  | { what: 'joined'; who: SnapshotPresence }
  | { what: 'left'; who: SnapshotPresence }

/** Someone turning a control right now: its key (`CONTROL_KEYS`) and their name. */
export interface Holding {
  control: string
  by: string
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** Who is holding what, in a stable order. */
export function holdingOf(holds: Holds): Holding[] {
  return [...holds]
    .map(([control, by]) => ({ control, by }))
    .sort((a, b) => (a.control < b.control ? -1 : a.control > b.control ? 1 : 0))
}

/** What changed from `before` to `after`, in a fixed order: tempo, pads, sounds, tracks, master, people. */
export function changesBetween(before: Snapshot, after: Snapshot): Change[] {
  const out: Change[] = []
  if (before.bpm !== after.bpm) out.push({ what: 'tempo', bpm: after.bpm })

  const padsBefore = new Map(before.pads.map((p) => [p.id, p.soundId]))
  for (const p of after.pads)
    if (padsBefore.get(p.id) !== p.soundId) out.push({ what: 'pad', id: p.id, soundId: p.soundId })

  const soundsBefore = new Map(before.sounds.map((s) => [s.id, s]))
  const soundsAfter = new Set(after.sounds.map((s) => s.id))
  for (const s of after.sounds)
    if (!soundsBefore.has(s.id)) out.push({ what: 'soundAdded', sound: s })
  for (const s of before.sounds)
    if (!soundsAfter.has(s.id)) out.push({ what: 'soundRemoved', id: s.id, name: s.name })

  const tracksBefore = new Map(before.tracks.map((t) => [t.id, t]))
  const tracksAfter = new Set(after.tracks.map((t) => t.id))
  for (const t of after.tracks) {
    const was = tracksBefore.get(t.id)
    if (!was) {
      out.push({ what: 'trackAdded', track: t })
      continue
    }
    const set: Record<string, unknown> = {}
    for (const key of new Set([...Object.keys(was), ...Object.keys(t)]) as Set<keyof SnapshotTrack>)
      if (!same(was[key], t[key])) set[key] = t[key]
    if (Object.keys(set).length > 0)
      out.push({ what: 'trackChanged', id: t.id, name: t.name, set: set as Partial<SnapshotTrack> })
  }
  for (const t of before.tracks)
    if (!tracksAfter.has(t.id)) out.push({ what: 'trackRemoved', id: t.id, name: t.name })

  const master: Record<string, unknown> = {}
  for (const key of Object.keys(after.master) as (keyof SnapshotMaster)[])
    if (!same(before.master[key], after.master[key])) master[key] = after.master[key]
  if (Object.keys(master).length > 0)
    out.push({ what: 'master', set: master as Partial<SnapshotMaster> })

  const key = (p: SnapshotPresence) => `${p.kind}\n${p.name}`
  const hereBefore = new Set(before.here.map(key))
  const hereAfter = new Set(after.here.map(key))
  for (const p of after.here) if (!hereBefore.has(key(p))) out.push({ what: 'joined', who: p })
  for (const p of before.here) if (!hereAfter.has(key(p))) out.push({ what: 'left', who: p })
  return out
}
