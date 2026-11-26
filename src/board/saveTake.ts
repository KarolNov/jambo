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

/**
 * Stores a take's voice clips for its track: each is cut to the loop (`bars` at `bpm`), rendered
 * through its preset, trimmed and levelled like any recording, uploaded as a clip, and waited for
 * until this board lists it, so the track never names a sound it can't see. A clip's hit keeps the
 * beat it was sung on, moved by the silence the trim took off its start. A clip that fails is left
 * out and counted; one that falls wholly outside the loop is dropped, as a pad hit there would be.
 */
export async function saveClips(
  clips: readonly SungClip[],
  take: { bars: number; bpm: number; trackName: string },
  jam: { slug: string; me: Identity; store: JamSession['store'] },
): Promise<SavedClips> {
  const length = take.bars * BEATS_PER_BAR
  const beat = beatSeconds(take.bpm)
  const kept = clips.flatMap((c) => {
    const span = clipSpan(c.beat, c.samples.length / c.rate, length, take.bpm)
    return span ? [{ clip: c, span }] : []
  })
  const results = await Promise.allSettled(
    kept.map(async ({ clip, span }, i): Promise<SoundHit> => {
      const from = Math.round(span.skip * clip.rate)
      const raw = clip.samples.subarray(from, from + Math.round(span.keep * clip.rate))
      const rendered = await renderVoice(raw, clip.rate, clip.preset, clip.key)
      const prepared = await prepareBuffer(rendered, 'recording')
      const at = span.beat + prepared.trimmedStart / beat
      const { id } = await uploadClip(jam.slug, prepared, clipName(take.trackName, i + 1), jam.me)
      await listed(jam.store, id)
      return { soundId: id, beat: Math.min(at, length - 1e-6) }
    }),
  )
  const hits: SoundHit[] = []
  let lost = 0
  let reason: string | undefined
  for (const r of results) {
    if (r.status === 'fulfilled') hits.push(r.value)
    else {
      lost++
      reason ??= r.reason instanceof UploadError ? r.reason.message : undefined
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
