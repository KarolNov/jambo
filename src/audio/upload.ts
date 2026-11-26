import type { Sound } from '../../shared/board'
import { UPLOAD_HEADERS, UPLOADS } from '../../shared/sounds'
import { encodeWav, mixDown, normalise, soundBounds } from '../../shared/wav'
import type { Identity } from '../board/identity'
import { soundUrl } from './samples'

/** Why an upload didn't happen, in words for the person who tried. */
export class UploadError extends Error {
  /** The HTTP status that refused it, when the jam refused it. */
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message)
  }
}

/** Drops unpaired surrogates, which a cut at a length can leave and `encodeURIComponent` rejects. */
const wellFormed = (text: string) =>
  text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '')

/** A sample ready to upload: what the room stores, and how long it is. */
export interface Prepared {
  wav: Uint8Array<ArrayBuffer>
  durationMs: number
  /** Seconds of leading silence trimmed off: where the kept sound starts in what was given. */
  trimmedStart: number
}

/** The name an upload starts with: the file's name without its extension, at most 40 characters. */
export const defaultName = (fileName: string) =>
  fileName
    .replace(/\.[^.]+$/, '')
    .trim()
    .slice(0, 40)
    .replace(/[\uD800-\uDBFF]$/, '') || 'Sound'

/**
 * Turns a picked file into what the room stores: decoded and resampled to the upload rate, then
 * `prepareBuffer`'s trim, level and WAV.
 */
export async function prepareSample(file: Blob): Promise<Prepared> {
  if (file.size > UPLOADS.maxFileBytes) throw new UploadError('That file is too big (over 20 MB)')
  let decoded: AudioBuffer
  try {
    // An offline context at the upload rate decodes straight to that rate.
    decoded = await new OfflineAudioContext(1, 1, UPLOADS.sampleRate).decodeAudioData(
      await file.arrayBuffer(),
    )
  } catch {
    throw new UploadError("That isn't a sound file this browser can read")
  }
  return prepareBuffer(decoded, 'file')
}

/** `buffer` at the upload rate: as it is when it already is, else resampled by an offline render. */
async function atUploadRate(buffer: AudioBuffer): Promise<AudioBuffer> {
  const rate = UPLOADS.sampleRate
  if (buffer.sampleRate === rate) return buffer
  const frames = Math.max(1, Math.round((buffer.length * rate) / buffer.sampleRate))
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, frames, rate)
  const src = ctx.createBufferSource()
  src.buffer = buffer
  src.connect(ctx.destination)
  src.start()
  return ctx.startRendering()
}

/**
 * Turns decoded or rendered audio (a picked file, a voice recording) into what the room stores:
 * at the upload rate, mixed down to mono, trimmed of silence at both ends, levelled to −1 dBFS,
 * as 16-bit WAV. `what` names it in the errors.
 */
export async function prepareBuffer(
  buffer: AudioBuffer,
  what: 'file' | 'recording' = 'file',
): Promise<Prepared> {
  const rate = UPLOADS.sampleRate
  const audio = await atUploadRate(buffer)
  const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i))
  const mixed = mixDown(channels)
  const [start, end] = soundBounds(mixed, rate)
  const trimmed = mixed.slice(start, end)
  if (trimmed.length === 0) throw new UploadError(`That ${what} is silent`)
  const seconds = trimmed.length / rate
  if (seconds > UPLOADS.maxSeconds)
    throw new UploadError(
      `Samples must be ${UPLOADS.maxSeconds} seconds or less (this one is ${seconds.toFixed(1)} s)`,
    )
  return {
    wav: encodeWav(normalise(trimmed), rate),
    durationMs: Math.ceil((trimmed.length * 1000) / rate),
    trimmedStart: start / rate,
  }
}

async function failure(res: Response, fallback: string): Promise<UploadError> {
  if (res.status === 413) return new UploadError('That sample is too big', res.status)
  try {
    const body = (await res.json()) as { error?: string }
    if (body.error) return new UploadError(body.error, res.status)
  } catch {
    // Not JSON: use the fallback.
  }
  return new UploadError(fallback, res.status)
}

/** Posts a prepared sample to the jam's `path` (`sounds` or `clips`) with its details. */
async function postSample(
  slug: string,
  path: 'sounds' | 'clips',
  sample: Prepared,
  name: string,
  me: Identity,
): Promise<{ id: string; sound: Sound }> {
  let res: Response
  try {
    res = await fetch(`/api/jams/${slug}/${path}`, {
      method: 'POST',
      body: sample.wav,
      headers: {
        'Content-Type': 'audio/wav',
        [UPLOAD_HEADERS.name]: encodeURIComponent(wellFormed(name.trim())),
        [UPLOAD_HEADERS.author]: encodeURIComponent(me.id),
        [UPLOAD_HEADERS.authorName]: encodeURIComponent(wellFormed(me.name)),
        [UPLOAD_HEADERS.color]: encodeURIComponent(me.color),
      },
    })
  } catch {
    throw new UploadError("Couldn't reach the jam; check your connection")
  }
  if (!res.ok) throw await failure(res, 'The upload failed')
  return (await res.json()) as { id: string; sound: Sound }
}

/** Uploads a prepared sample to the jam; the room lists it on the board for everyone. */
export const uploadSound = (slug: string, sample: Prepared, name: string, me: Identity) =>
  postSample(slug, 'sounds', sample, name, me)

/**
 * Uploads a voice clip sung into a take; the room lists it as a clip, and frees it again unless a
 * track names it soon (see `ORPHAN_CLIP_MS` in `worker/board.ts`).
 */
export const uploadClip = (slug: string, sample: Prepared, name: string, me: Identity) =>
  postSample(slug, 'clips', sample, name, me)

/** Removes an upload no pad uses. */
export async function removeSound(slug: string, id: string): Promise<void> {
  let res: Response
  try {
    res = await fetch(soundUrl(slug, id), { method: 'DELETE' })
  } catch {
    throw new UploadError("Couldn't reach the jam; check your connection")
  }
  if (!res.ok && res.status !== 404) throw await failure(res, "Couldn't remove it")
}
