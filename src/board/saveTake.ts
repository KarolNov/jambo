import { BEATS_PER_BAR, type SoundHit } from '../../shared/board'
import { beatSeconds, clipSpan } from '../../shared/looper'
import type { SungClip } from '../audio/engine'
import { prepareBuffer, UploadError, uploadClip } from '../audio/upload'
import { renderVoice } from '../audio/voice/render'
import type { Identity } from './identity'
import type { JamSession } from './doc'
import { listed } from './listed'

/** Sound names are at most this long. */
const NAME_MAX = 40

/** What a take's `n`th clip is called: its track's name and its number, `Groovy Otter 3 · voice 2`. */
export function clipName(trackName: string, n: number): string {
  const suffix = ` · voice ${n}`
  return `${trackName.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`
}

/** What a take's clips came to: a sound hit for each one stored, and why the others were lost. */
export interface SavedClips {
  hits: SoundHit[]
  lost: number
  /** Why the first lost clip was lost, in words for the singer. */
  reason?: string
}

/** How long to wait before trying an upload again after the jam says too many, in ms. */
const RETRY_MS = 10_000
/** How many times an upload is tried while the jam says too many: about a minute, its window. */
const TRIES = 7

/** Uploads a clip, waiting and trying again while the jam's clip rate limit refuses it. */
async function uploadPatiently(...args: Parameters<typeof uploadClip>) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await uploadClip(...args)
    } catch (e) {
      if (!(e instanceof UploadError) || e.status !== 429 || attempt >= TRIES) throw e
      await new Promise((r) => setTimeout(r, RETRY_MS))
    }
  }
}

/**
 * Stores a take's voice clips for its track: each is cut to the loop (`bars` at `bpm`), rendered
 * through its preset, trimmed and levelled like any recording, uploaded as a clip, and waited for
 * until this board lists it, so the track never names a sound it can't see. A clip's hit keeps the
 * beat it was sung on, moved by the silence the trim took off its start. A clip that fails is left
 * out and counted, as are the latest clips past the track's `room` for more hits; one that falls
 * wholly outside the loop is dropped, as a pad hit there would be, and so is one that is silent.
 * Uploads go one at a time, waiting out the jam's clip rate limit.
 */
export async function saveClips(
  clips: readonly SungClip[],
  take: { bars: number; bpm: number; trackName: string; room: number },
  jam: { slug: string; me: Identity; store: JamSession['store'] },
): Promise<SavedClips> {
  const length = take.bars * BEATS_PER_BAR
  const beat = beatSeconds(take.bpm)
  const inLoop = clips
    .flatMap((c) => {
      const span = clipSpan(c.beat, c.samples.length / c.rate, length, take.bpm)
      return span ? [{ clip: c, span }] : []
    })
    .sort((a, b) => a.span.beat - b.span.beat)
  const room = Math.max(0, take.room)
  const kept = inLoop.slice(0, room)
  const prepared = await Promise.allSettled(
    kept.map(async ({ clip, span }) => {
      const from = Math.round(span.skip * clip.rate)
      const raw = clip.samples.subarray(from, from + Math.round(span.keep * clip.rate))
      const rendered = await renderVoice(raw, clip.rate, clip.preset, clip.key)
      // Nothing audible was sung: there is no clip to keep, and nothing went wrong.
      if (rendered.getChannelData(0).every((s) => s === 0)) return undefined
      const sample = await prepareBuffer(rendered, 'recording')
      return { sample, at: span.beat + sample.trimmedStart / beat }
    }),
  )
  const hits: SoundHit[] = []
  let lost = inLoop.length - kept.length
  let reason: string | undefined = lost ? 'the track has no room for more hits' : undefined
  const lose = (e: unknown) => {
    lost++
    reason ??= e instanceof UploadError ? e.message : undefined
  }
  let n = 0
  for (const p of prepared) {
    if (p.status === 'rejected') {
      lose(p.reason)
      continue
    }
    if (!p.value) continue
    const { sample, at } = p.value
    try {
      const { id } = await uploadPatiently(jam.slug, sample, clipName(take.trackName, ++n), jam.me)
      await listed(jam.store, id)
      hits.push({ soundId: id, beat: Math.min(at, length - 1e-6) })
    } catch (e) {
      lose(e)
    }
  }
  return { hits, lost, ...(reason ? { reason } : {}) }
}

/** What the singer is told about clips that were lost: how many, and why the first one was. */
export function lostMessage(saved: Pick<SavedClips, 'lost' | 'reason'>, trackAdded: boolean) {
  if (saved.lost === 0) return undefined
  const clips = saved.lost === 1 ? '1 voice clip was' : `${saved.lost} voice clips were`
  const why = saved.reason ? ` (${saved.reason})` : ''
  return trackAdded
    ? `${clips} lost${why}; the rest of the take was saved`
    : `${clips} lost${why}, so no track was added`
}
