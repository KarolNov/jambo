import { z } from 'zod'
import { Track } from './schema'

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
export const Op = z.discriminatedUnion('op', [
  z.object({ op: z.literal('setTempo'), bpm: z.number() }),
  z.object({ op: z.literal('assignPad'), padId: z.string(), soundId: z.string() }),
  z.object({ op: z.literal('addTrack'), id: z.string().min(1).max(64), track: z.custom<Track>() }),
  z.object({ op: z.literal('setTrack'), id: z.string(), patch: TrackPatch }),
  z.object({ op: z.literal('removeTrack'), id: z.string() }),
])
export type Op = z.infer<typeof Op>

/** One problem with one operation; the operation changed nothing. */
export interface Issue {
  message: string
  path?: readonly PropertyKey[]
}

export type OpResult = { ok: true } | { ok: false; issues: readonly Issue[] }
