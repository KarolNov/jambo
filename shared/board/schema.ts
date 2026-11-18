import { z } from 'zod'
import { NAME_MAX } from '../names'
import { Color } from '../colors'
import { UPLOADS } from '../sounds'

/** Limits that keep a jam's doc small. */
export const LIMITS = { tracks: 32, hitsPerTrack: 512, bars: 16 } as const

export const BPM = { min: 40, max: 240, default: 100 } as const

/** Beats per bar: v1 is always 4/4. */
export const BEATS_PER_BAR = 4

/** Quantize grids in beats: 0 is off, 0.25 is a sixteenth note. */
export const QUANTIZE = [0, 0.125, 0.25, 0.5, 1] as const

/** The jam's settings, in the root map `meta`. */
export const Meta = z.object({
  bpm: z.number().int().min(BPM.min).max(BPM.max),
})
export type Meta = z.infer<typeof Meta>

/** One pad of the board, in the root map `pads` keyed by pad id. */
export const Pad = z.object({
  row: z.number().int().min(0).max(15),
  col: z.number().int().min(0).max(15),
  key: z.string().length(1),
  soundId: z.string().min(1).max(64),
})
export type Pad = z.infer<typeof Pad>

/** One pad hit in a track: which pad, and when, in beats from the track's start. */
export const Hit = z.object({
  padId: z.string().min(1).max(32),
  beat: z.number().min(0),
})
export type Hit = z.infer<typeof Hit>

/** One loop track, in the root map `tracks` keyed by a time-sortable id. */
export const Track = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'A track needs a name')
      .max(40, 'Keep names under 40 characters'),
    author: z.string().min(1).max(64),
    /** The recorder's colour, by name; the UI decides what it looks like. */
    color: Color,
    bars: z.number().int().min(1).max(LIMITS.bars),
    hits: z.array(Hit).min(1).max(LIMITS.hitsPerTrack),
    gain: z.number().min(0).max(1.5),
    mute: z.boolean(),
    quantize: z.union(
      QUANTIZE.map((q) => z.literal(q)) as [z.ZodLiteral<0>, ...z.ZodLiteral<number>[]],
    ),
    /** The jam bar where the take began; its loop cycles from there. Set once, when recorded. */
    startBar: z.number().int().min(0).optional(),
    /** Reserved for delay and stretch; always empty in v1. */
    effects: z.array(z.never()).max(0),
  })
  .refine((t) => t.hits.every((h) => h.beat < t.bars * BEATS_PER_BAR), {
    message: 'Every hit must fall inside the track',
    path: ['hits'],
  })
export type Track = z.infer<typeof Track>

/**
 * A sound someone uploaded to the jam, in the root map `sounds` keyed by its upload id. Only
 * details live here; the audio is stored by the room and fetched by id.
 */
export const Sound = z.object({
  name: z.string().trim().min(1, 'A sound needs a name').max(40, 'Keep names under 40 characters'),
  author: z.string().min(1).max(64),
  /** The uploader's name at upload time; sounds uploaded before names have none. */
  authorName: z.string().trim().min(1).max(NAME_MAX).optional(),
  /** The uploader's colour, by name. */
  color: Color,
  durationMs: z
    .number()
    .int()
    .min(1)
    .max(UPLOADS.maxSeconds * 1000),
  bytes: z.number().int().min(1).max(UPLOADS.maxBytes),
  createdAt: z.number().int().min(0),
})
export type Sound = z.infer<typeof Sound>

/** Which fields of each node are shared types. Tracks' hits are a plain value, written once. */
export const SHAPES = {
  meta: {},
  pad: {},
  track: {},
  sound: {},
} as const

/** Root maps of a board doc. */
export const ROOTS = { meta: 'meta', pads: 'pads', tracks: 'tracks', sounds: 'sounds' } as const
