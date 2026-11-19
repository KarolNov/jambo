import { z } from 'zod'
import { Sound, Track } from './schema'

/** The fields of a track anyone can change after it is recorded. */
export const TrackPatch = z
  .object({
    name: z.string(),
    gain: z.number(),
    mute: z.boolean(),
    quantize: z.number(),
  })
  .partial()
export type TrackPatch = z.infer<typeof TrackPatch>

/**
 * Every change to a board, as plain data. The UI, tests and, later, code written by an AI all
 * produce these; `apply` is the only thing that writes them into the doc.
 */
export const SetTempo = z.object({ op: z.literal('setTempo'), bpm: z.number() })
export const AssignPad = z.object({
  op: z.literal('assignPad'),
  padId: z.string(),
  soundId: z.string(),
})
export const SetTrack = z.object({ op: z.literal('setTrack'), id: z.string(), patch: TrackPatch })
export const RemoveTrack = z.object({ op: z.literal('removeTrack'), id: z.string() })
/** Moves every pad on sound `from` to sound `to`. Tracks follow, since they hit pads. */
export const ReplaceSound = z.object({
  op: z.literal('replaceSound'),
  from: z.string(),
  to: z.string(),
})

export const Op = z.discriminatedUnion('op', [
  SetTempo,
  AssignPad,
  z.object({ op: z.literal('addTrack'), id: z.string().min(1).max(64), track: z.custom<Track>() }),
  SetTrack,
  RemoveTrack,
  /** Lists an upload whose audio the room has stored. Only the room applies it. */
  z.object({ op: z.literal('addSound'), id: z.string(), sound: z.custom<Sound>() }),
  /** Unlists an upload no pad uses. Only the room applies it, then deletes the audio. */
  z.object({ op: z.literal('removeSound'), id: z.string() }),
  /** Unlists every upload, whatever uses it: the room's retention, after it deleted the audio. */
  z.object({ op: z.literal('expireSounds') }),
  ReplaceSound,
])
export type Op = z.infer<typeof Op>

/** One problem with one operation; the operation changed nothing. */
export interface Issue {
  message: string
  path?: readonly PropertyKey[]
}

export type OpResult = { ok: true } | { ok: false; issues: readonly Issue[] }
