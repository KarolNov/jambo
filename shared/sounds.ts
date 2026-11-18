/**
 * The fixed kit every jam plays. Ids are stable: tracks and pads refer to sounds by id, so an id
 * is never reused for a different sound. v1 sounds are synthesized in the browser
 * (`src/audio/synth.ts`); a sample kit can replace them later under the same ids.
 */
export const SOUNDS = [
  { id: 'kick', name: 'Kick', category: 'drums' },
  { id: 'snare', name: 'Snare', category: 'drums' },
  { id: 'clap', name: 'Clap', category: 'drums' },
  { id: 'hat', name: 'Hi-hat', category: 'drums' },
  { id: 'open-hat', name: 'Open hat', category: 'drums' },
  { id: 'tom-low', name: 'Low tom', category: 'drums' },
  { id: 'tom-high', name: 'High tom', category: 'drums' },
  { id: 'rim', name: 'Rim', category: 'percussion' },
  { id: 'cowbell', name: 'Cowbell', category: 'percussion' },
  { id: 'shaker', name: 'Shaker', category: 'percussion' },
  { id: 'bass-c', name: 'Bass C', category: 'tonal' },
  { id: 'bass-g', name: 'Bass G', category: 'tonal' },
  { id: 'pluck-e', name: 'Pluck E', category: 'tonal' },
  { id: 'pluck-g', name: 'Pluck G', category: 'tonal' },
  { id: 'stab', name: 'Chord stab', category: 'tonal' },
  { id: 'blip', name: 'Blip', category: 'fx' },
  { id: 'zap', name: 'Zap', category: 'fx' },
] as const

export type SoundId = (typeof SOUNDS)[number]['id']

export const SOUND_IDS = new Set<string>(SOUNDS.map((s) => s.id))

export const soundName = (id: string) => SOUNDS.find((s) => s.id === id)?.name

/**
 * Limits for sounds people upload to a jam. The browser turns every upload into 16-bit mono WAV
 * at `sampleRate`, so `maxSeconds` of it fits in `maxBytes` with room for the header.
 */
export const UPLOADS = {
  maxSeconds: 10,
  maxBytes: 900_000,
  perJam: 32,
  sampleRate: 44_100,
  /** The largest file the browser will try to decode before it is converted. */
  maxFileBytes: 20 * 1024 * 1024,
} as const

/** Header names for an upload's details, sent with the WAV as the request body. */
export const UPLOAD_HEADERS = {
  name: 'X-Sound-Name',
  author: 'X-Sound-Author',
  color: 'X-Sound-Color',
} as const

const UPLOAD_ID = /^u-[a-z2-7]{12}$/
const BASE32 = 'abcdefghijklmnopqrstuvwxyz234567'

/** Whether `id` has the form of an uploaded sound's id. No kit id has it. */
export const isUploadId = (id: string) => UPLOAD_ID.test(id)

/** A fresh upload id: `u-` and 12 random base32 characters. Only the jam's room mints them. */
export function newUploadId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return `u-${Array.from(bytes, (b) => BASE32[b & 31]).join('')}`
}

/** Keyboard keys for the 4×4 grid, row by row. */
export const PAD_KEYS = ['1234', 'qwer', 'asdf', 'zxcv'] as const

/** The layout a new jam starts with: drums on top, tonal sounds below. */
export const DEFAULT_LAYOUT: readonly (readonly SoundId[])[] = [
  ['kick', 'snare', 'clap', 'hat'],
  ['open-hat', 'tom-low', 'tom-high', 'rim'],
  ['cowbell', 'shaker', 'blip', 'zap'],
  ['bass-c', 'bass-g', 'pluck-e', 'stab'],
]

export const padId = (row: number, col: number) => `r${row}c${col}`
