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

/**
 * A track's sound knobs: each one's range, step and default. A track stores none, some or all of
 * them; a missing knob plays at its default, which leaves the sound unchanged. Shared by the
 * schema, the engine, the mixer and the agent docs.
 */
export const SOUND_KNOBS = {
  /** How much of the track goes into the shared room. */
  reverb: { min: 0, max: 1, step: 0.01, default: 0 },
  /** How loud the tempo-timed echo is. */
  echo: { min: 0, max: 1, step: 0.01, default: 0 },
  /** Below 0 darkens (low-pass), above 0 thins (high-pass). */
  tone: { min: -1, max: 1, step: 0.01, default: 0 },
  /** Whole semitones; changes playback speed. */
  pitch: { min: -12, max: 12, step: 1, default: 0 },
  /** -1 is the left speaker, +1 the right. */
  pan: { min: -1, max: 1, step: 0.01, default: 0 },
} as const
export type SoundKnob = keyof typeof SOUND_KNOBS
export const SOUND_KNOB_NAMES = Object.keys(SOUND_KNOBS) as SoundKnob[]

const knob = (k: SoundKnob) => {
  const { min, max, step } = SOUND_KNOBS[k]
  const n = z.number().min(min).max(max)
  return (step === 1 ? n.int() : n).optional()
}

/** Every sound knob of a track, with missing ones at their defaults. */
export function soundOf(track: Partial<Record<SoundKnob, number>>): Record<SoundKnob, number> {
  return Object.fromEntries(
    SOUND_KNOB_NAMES.map((k) => [k, track[k] ?? SOUND_KNOBS[k].default]),
  ) as Record<SoundKnob, number>
}

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
    /** Reserved; always empty. The sound knobs below are separate fields. */
    effects: z.array(z.never()).max(0),
    /** Sound knobs, each optional: see `SOUND_KNOBS` for ranges and defaults. */
    reverb: knob('reverb'),
    echo: knob('echo'),
    tone: knob('tone'),
    pitch: knob('pitch'),
    pan: knob('pan'),
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
