/** Where an upload is on this client: fetching or decoding, playable, or gone from storage. */
export type SampleState = 'loading' | 'ready' | 'missing'

interface Entry {
  state: SampleState
  /** The WAV, kept until audio starts and it can be decoded. */
  bytes?: ArrayBuffer
  buffer?: AudioBuffer
  /** Set when the jam stops listing it, so a late fetch or decode is dropped. */
  dropped?: boolean
  /** This client's own upload: its WAV came from here, so it is never fetched. */
  seeded?: boolean
  /** Whether the jam has listed it yet; a seeded entry waits for that before it can be dropped. */
  listed?: boolean
  /** Cancels a fetch in flight. */
  abort?: AbortController
}

const CONCURRENCY = 4
const RETRY_MS = [500, 1000, 2000]
/** How long a sample that couldn't load waits before it is tried again (rate limits last a minute). */
const RECOVER_MS = 60_000

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
      if (ids.has(id)) {
        entry.listed = true
        continue
      }
      // Seeded before the room's listing reached this board: keep it until it arrives.
      if (entry.seeded && !entry.listed) continue
      entry.dropped = true
      entry.abort?.abort()
      this.entries.delete(id)
      changed = true
    }
    for (const id of ids) {
      if (this.entries.has(id)) continue
      this.entries.set(id, { state: 'loading', listed: true })
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
    entry.seeded = true
    entry.abort?.abort()
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
      if (!entry || entry.seeded || entry.bytes || entry.buffer) continue
      this.active++
      void this.fetchOne(id, entry).finally(() => {
        this.active--
        this.pump()
      })
    }
  }

  private async fetchOne(id: string, entry: Entry) {
    const stale = () => entry.dropped || entry.seeded || this.disposed
    for (let attempt = 0; ; attempt++) {
      if (stale()) return
      try {
        entry.abort = new AbortController()
        const res = await fetch(soundUrl(this.slug, id), { signal: entry.abort.signal })
        // Gone from storage: retrying won't help.
        if (res.status === 404) return this.settle(entry, 'missing')
        // Anything else (rate limit, paused downloads, a network blip) may pass: retry.
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const bytes = await res.arrayBuffer()
        if (stale()) return
        entry.bytes = bytes
        if (entry.state === 'missing') this.settle(entry, 'loading')
        this.decode(id, entry)
        return
      } catch {
        if (stale()) return
        if (attempt >= RETRY_MS.length) return this.recoverLater(id, entry)
        await new Promise((r) => setTimeout(r, RETRY_MS[attempt]))
      } finally {
        entry.abort = undefined
      }
    }
  }

  /** Marks `id` missing for now and queues it again later, so a passing failure isn't final. */
  private recoverLater(id: string, entry: Entry) {
    this.settle(entry, 'missing')
    setTimeout(() => {
      if (entry.dropped || entry.seeded || this.disposed || entry.bytes || entry.buffer) return
      this.queue.push(id)
      this.pump()
    }, RECOVER_MS)
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
