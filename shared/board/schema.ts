import { readKey } from 'duratom/core'
import type * as Y from 'yjs'
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

/**
 * The jam's master knobs: each one's range, step and default. Every default leaves the mix
 * unchanged. Shared by the schema, the engine, the console and the agent docs.
 */
export const MASTER_KNOBS = {
  /** Below 0 darkens (low-pass), above 0 thins (high-pass), as a track's tone does. */
  tone: { min: -1, max: 1, step: 0.01, default: 0 },
  /** Saturates the mix and evens its loudness. */
  drive: { min: 0, max: 1, step: 0.01, default: 0 },
  /** -1 is mono, 0 as recorded, +1 extra wide. */
  width: { min: -1, max: 1, step: 0.01, default: 0 },
  /** Delays every off-beat 16th, by up to half a 16th at 1. Applied at playback only. */
  swing: { min: 0, max: 1, step: 0.01, default: 0 },
} as const
export type MasterKnob = keyof typeof MASTER_KNOBS
export const MASTER_KNOB_NAMES = Object.keys(MASTER_KNOBS) as MasterKnob[]

/**
 * The touchpad's modes: each one's X and Y range. Every mode is off at 0/0, its default.
 * Repeat also stores the jam beat its slice starts on.
 */
export const FX_MODES = {
  /** X below 0 low-pass, above 0 high-pass; Y is resonance. */
  filter: { x: { min: -1, max: 1 }, y: { min: 0, max: 1 } },
  /** X picks the echo time, Y the send and feedback. */
  throw: { x: { min: 0, max: 1 }, y: { min: 0, max: 1 } },
  /** X lowers the sample rate, Y the bit depth. */
  lofi: { x: { min: 0, max: 1 }, y: { min: 0, max: 1 } },
  /** X picks the slice, Y the repeats' level; Y 0 is off. */
  repeat: { x: { min: 0, max: 1 }, y: { min: 0, max: 1 } },
} as const
export type FxMode = keyof typeof FX_MODES
export const FX_MODE_NAMES = Object.keys(FX_MODES) as FxMode[]

const masterKnob = (k: MasterKnob) => z.number().min(MASTER_KNOBS[k].min).max(MASTER_KNOBS[k].max)

const fxAxes = (m: FxMode) =>
  z.object({
    x: z.number().min(FX_MODES[m].x.min).max(FX_MODES[m].x.max),
    y: z.number().min(FX_MODES[m].y.min).max(FX_MODES[m].y.max),
  })

/** The latest jam beat repeat's slice may start on. */
export const REPEAT_START_BEAT_MAX = 10_000_000

/**
 * One stored value per master control, in the root array `master`, kept in y-utility's
 * `YKeyValue` layout through duratom's key-value kind (`readKey`, `writeKey`, `keyValueAtom`).
 * Knobs hold a number; filter, throw and lofi hold `{x, y}`; repeat also holds `startBeat`.
 */
export const MasterValues = {
  tone: masterKnob('tone'),
  drive: masterKnob('drive'),
  width: masterKnob('width'),
  swing: masterKnob('swing'),
  filter: fxAxes('filter'),
  throw: fxAxes('throw'),
  lofi: fxAxes('lofi'),
  /** startBeat sits on the 16th grid, below a cap (weeks of play at any tempo). */
  repeat: fxAxes('repeat').extend({
    startBeat: z.number().min(0).max(REPEAT_START_BEAT_MAX).multipleOf(0.25),
  }),
} as const
export type MasterKey = keyof typeof MasterValues
export const MASTER_KEYS = Object.keys(MasterValues) as MasterKey[]

/** Every master setting, with missing or unreadable ones at their defaults. */
export type Master = { [K in MasterKey]: z.infer<(typeof MasterValues)[K]> }

export const MASTER_DEFAULTS: Master = {
  tone: MASTER_KNOBS.tone.default,
  drive: MASTER_KNOBS.drive.default,
  width: MASTER_KNOBS.width.default,
  swing: MASTER_KNOBS.swing.default,
  filter: { x: 0, y: 0 },
  throw: { x: 0, y: 0 },
  lofi: { x: 0, y: 0 },
  repeat: { x: 0, y: 0, startBeat: 0 },
}

/**
 * Every master setting stored in the `master` array, with missing or unreadable ones at their
 * defaults. Each key reads its current entry (the rightmost, as in `YKeyValue`) through its schema.
 */
export function masterOf(master: Y.Array<unknown> | undefined): Master {
  const out: Record<string, unknown> = {}
  for (const key of MASTER_KEYS) {
    const r = readKey(MasterValues[key], master, key)
    out[key] = r && !r.issues ? r.value : MASTER_DEFAULTS[key]
  }
  return out as Master
}

/** Master settings from a `keyValueAtom` read: each valid value, or its default. */
export function masterFromRead(read: {
  [K in MasterKey]?: { value: Master[K] } | { issues: unknown } | undefined
}): Master {
  const out: Record<string, unknown> = {}
  for (const key of MASTER_KEYS) {
    const r = read[key]
    out[key] = r && 'value' in r ? r.value : MASTER_DEFAULTS[key]
  }
  return out as Master
}

/**
 * Whether a touchpad mode sounds, so its tab shows a dot: away from 0/0, and for repeat, Y above
 * 0 (its Y 0 is off).
 */
export const fxOn = (mode: FxMode, p: { x: number; y: number }) =>
  mode === 'repeat' ? p.y !== 0 : p.x !== 0 || p.y !== 0

/**
 * Live controls as presence names them while someone holds one (the `control` awareness key).
 * Each kind has its own prefix, so a track id can never name a master knob or touchpad mode.
 */
export const CONTROL_KEYS = {
  /** A loop's level or sound knob: `track.<trackId>.<field>`, the field as `setTrack` names it. */
  track: (trackId: string, field: string) => `track.${trackId}.${field}`,
  /** A master knob: `master.<knob>`. */
  master: (knob: MasterKnob) => `master.${knob}`,
  /** A touchpad mode: `fx.<mode>`. */
  fx: (mode: FxMode) => `fx.${mode}`,
} as const

/** Root types of a board doc: maps, except `master`, a key-value array (`select.keyValue`). */
export const ROOTS = {
  meta: 'meta',
  pads: 'pads',
  tracks: 'tracks',
  sounds: 'sounds',
  master: 'master',
} as const
