/** Where an upload is on this client: fetching or decoding, playable, or gone from storage. */
export type SampleState = 'loading' | 'ready' | 'missing'

interface Entry {
  state: SampleState
  /** The WAV, kept until audio starts and it can be decoded. */
  bytes?: ArrayBuffer
  buffer?: AudioBuffer
  /** Set when the jam stops listing it, so a late fetch or decode is dropped. */
  dropped?: boolean
}

const CONCURRENCY = 4
const RETRY_MS = [500, 1000, 2000]

/** The URL of an upload's file. */
export const soundUrl = (slug: string, id: string) =>
  `/api/jams/${slug}/sounds/${encodeURIComponent(id)}`

/**
 * Loads a jam's uploaded sounds. Fetching starts as soon as the board lists an upload, even
 * before audio is unlocked; decoding waits for the AudioContext. Ids are never reused, so a
 * loaded sample never goes stale, and the browser's HTTP cache keeps files across visits.
 */
export class SampleLoader {
  private entries = new Map<string, Entry>()
  private queue: string[] = []
  private active = 0
  private ctx?: BaseAudioContext
  private listeners = new Set<() => void>()
  private disposed = false

  constructor(private readonly slug: string) {}

  /** The buffer to play for `id`, once it has loaded. */
  get(id: string): AudioBuffer | undefined {
    return this.entries.get(id)?.buffer
  }

  /** Where `id` is; undefined when the jam doesn't list it. */
  state(id: string): SampleState | undefined {
    return this.entries.get(id)?.state
  }

  subscribe(listener: () => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit() {
    for (const l of this.listeners) l()
  }

  /** Matches what is loaded to the uploads the jam lists: fetches new ones, drops removed ones. */
  sync(ids: ReadonlySet<string>) {
    let changed = false
    for (const [id, entry] of this.entries) {
      if (ids.has(id)) continue
      entry.dropped = true
      this.entries.delete(id)
      changed = true
    }
    for (const id of ids) {
      if (this.entries.has(id)) continue
      this.entries.set(id, { state: 'loading' })
      this.queue.push(id)
      changed = true
    }
    this.pump()
    if (changed) this.emit()
  }

  /** Uses a WAV this client already has (its own upload) instead of fetching it. */
  seed(id: string, wav: ArrayBuffer) {
    const entry = this.entries.get(id) ?? { state: 'loading' as const }
    if (entry.buffer) return
    this.queue = this.queue.filter((q) => q !== id)
    entry.bytes = wav
    this.entries.set(id, entry)
    this.decode(id, entry)
  }

  /** Audio is on: decode everything fetched so far, and from now on as files arrive. */
  attach(ctx: BaseAudioContext) {
    this.ctx = ctx
    for (const [id, entry] of this.entries) this.decode(id, entry)
  }

  dispose() {
    this.disposed = true
    this.listeners.clear()
  }

  private pump() {
    while (this.active < CONCURRENCY && this.queue.length > 0) {
      const id = this.queue.shift()!
      const entry = this.entries.get(id)
      if (!entry || entry.bytes || entry.buffer) continue
      this.active++
      void this.fetchOne(id, entry).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async fetchOne(id: string, entry: Entry) {
    for (let attempt = 0; ; attempt++) {
      if (entry.dropped || this.disposed) return
      try {
        const res = await fetch(soundUrl(this.slug, id))
        // Gone, or downloads paused by the app's budget: retrying won't help.
        if (res.status === 404 || res.status === 503) return this.settle(entry, 'missing')
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        entry.bytes = await res.arrayBuffer()
        this.decode(id, entry)
        return
      } catch {
        if (attempt >= RETRY_MS.length) return this.settle(entry, 'missing')
        await new Promise((r) => setTimeout(r, RETRY_MS[attempt]))
      }
    }
  }

  private decode(_id: string, entry: Entry) {
    const ctx = this.ctx
    const bytes = entry.bytes
    if (!ctx || !bytes || entry.buffer) return
    entry.bytes = undefined
    // decodeAudioData takes the buffer over, so hand it a copy we never touch again.
    ctx.decodeAudioData(bytes.slice(0)).then(
      (buffer) => {
        entry.buffer = buffer
        this.settle(entry, 'ready')
      },
      () => this.settle(entry, 'missing'),
    )
  }

  private settle(entry: Entry, state: SampleState) {
    if (entry.dropped || this.disposed) return
    entry.state = state
    this.emit()
  }
}
