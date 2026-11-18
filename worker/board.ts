import type { Connection, ConnectionContext } from 'partyserver'
import { YServer } from 'y-partyserver'
import * as Y from 'yjs'
import { apply, ROOTS, Sound, type Origin } from '../shared/board'
import { seedBoard } from '../shared/board/seed'
import { parseClockMessage, pong } from '../shared/clock'
import { newUploadId, UPLOADS } from '../shared/sounds'
import { parseUploadWav } from '../shared/wav'

const SNAPSHOT_KEY = 'doc'
/** Set by the retention alarm when the doc wasn't loaded, so the next load unlists the uploads. */
const EXPIRED_KEY = 'soundsExpired'
/** Every upload id this jam has issued, so none is ever issued twice. */
const ISSUED_PREFIX = 'issued:'

const DAY_MS = 24 * 60 * 60 * 1000
/** A jam's uploaded audio is deleted after this long with nobody connecting. */
export const SOUND_RETENTION_MS = 90 * DAY_MS

const ROOM: Origin = { kind: 'system', id: 'room' }

/** Where an upload's audio lives in R2: under the jam's prefix, so a jam's audio can go at once. */
export const soundPrefix = (slug: string) => `jams/${slug}/`
export const soundKey = (slug: string, id: string) => `${soundPrefix(slug)}${id}.wav`

/** What an upload or removal came to: a result, or an HTTP status and a message for people. */
export type SoundResult<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; status: 400 | 404 | 409; error: string }

export interface UploadInput {
  wav: ArrayBuffer
  name: string
  author: string
  color: string
}

/**
 * One Durable Object per jam: holds the jam's board doc, relays edits and presence between everyone
 * connected, keeps a snapshot of the doc in its own SQLite-backed storage, and is the jam's clock.
 * It also lists and unlists uploaded sounds, storing their audio in R2, and deletes that audio
 * once the jam goes unvisited for `SOUND_RETENTION_MS`.
 */
export class Board extends YServer<Env> {
  static override callbackOptions = {
    debounceWait: 1000,
    debounceMaxWait: 5000,
    timeout: 5000,
  }

  /** Whether the doc is in memory: the retention alarm can fire without loading it. */
  private loaded = false

  override async onLoad() {
    const saved = await this.ctx.storage.get<Uint8Array>(SNAPSHOT_KEY)
    if (saved) Y.applyUpdate(this.document, saved)
    seedBoard(this.document)
    this.loaded = true
    if (await this.ctx.storage.get(EXPIRED_KEY)) {
      apply(this.document, [{ op: 'expireSounds' }], ROOM)
      await this.onSave()
      await this.ctx.storage.delete(EXPIRED_KEY)
    }
  }

  // Called a moment after edits, and when the last client leaves.
  override async onSave() {
    await this.ctx.storage.put(SNAPSHOT_KEY, Y.encodeStateAsUpdate(this.document))
  }

  override onConnect(connection: Connection, ctx: ConnectionContext) {
    super.onConnect(connection, ctx)
    // A visit keeps the jam's audio for another retention period.
    this.ctx.waitUntil(this.keepSounds())
  }

  // The jam clock: answers a ping, to that client alone, with its own timestamp and the room's time.
  // Each message is its own event, so Date.now() is fresh.
  override onCustomMessage(connection: Connection, message: string) {
    const msg = parseClockMessage(message)
    if (msg?.t === 'ping') this.sendCustomMessage(connection, pong(msg.c, Date.now()))
  }

  /**
   * Stores an uploaded WAV and lists it on the board. The file must already be what the browser
   * makes of an upload (see `parseUploadWav`); the room never decodes audio.
   */
  async uploadSound(input: UploadInput): Promise<SoundResult<{ id: string; sound: Sound }>> {
    const info = parseUploadWav(new Uint8Array(input.wav))
    if ('error' in info) return { ok: false, status: 400, error: info.error }
    const parsed = Sound.safeParse({
      name: input.name,
      author: input.author,
      color: input.color,
      durationMs: info.durationMs,
      bytes: input.wav.byteLength,
      createdAt: Date.now(),
    })
    if (!parsed.success)
      return { ok: false, status: 400, error: parsed.error.issues[0]?.message ?? 'Invalid sound' }
    const sounds = this.document.getMap<unknown>(ROOTS.sounds)
    if (sounds.size >= UPLOADS.perJam)
      return { ok: false, status: 409, error: `This jam already has ${UPLOADS.perJam} sounds` }

    let id = newUploadId()
    while (sounds.has(id) || (await this.ctx.storage.get(ISSUED_PREFIX + id))) id = newUploadId()
    await this.ctx.storage.put(ISSUED_PREFIX + id, true)

    const key = soundKey(this.name, id)
    await this.env.SOUND_FILES.put(key, input.wav, { httpMetadata: { contentType: 'audio/wav' } })
    const [result] = apply(this.document, [{ op: 'addSound', id, sound: parsed.data }], ROOM)
    if (!result?.ok) {
      await this.env.SOUND_FILES.delete(key)
      return { ok: false, status: 409, error: result?.issues[0]?.message ?? 'Not added' }
    }
    await this.keepSounds()
    return { ok: true, id, sound: parsed.data }
  }

  /** Unlists an upload no pad uses, then deletes its audio. */
  async removeSound(id: string): Promise<SoundResult> {
    if (!this.document.getMap<unknown>(ROOTS.sounds).has(id))
      return { ok: false, status: 404, error: 'No such sound' }
    const [result] = apply(this.document, [{ op: 'removeSound', id }], ROOM)
    if (!result?.ok)
      return { ok: false, status: 409, error: result?.issues[0]?.message ?? 'In use' }
    await this.env.SOUND_FILES.delete(soundKey(this.name, id))
    return { ok: true }
  }

  /**
   * Pushes the retention alarm a full period ahead. Skips the write while the alarm is less than
   * a day short of that, so a busy jam doesn't write on every connection.
   */
  private async keepSounds() {
    if (this.document.getMap<unknown>(ROOTS.sounds).size === 0) return
    const target = Date.now() + SOUND_RETENTION_MS
    const current = await this.ctx.storage.getAlarm()
    if (current === null || current < target - DAY_MS) await this.ctx.storage.setAlarm(target)
  }

  /** Retention: with nobody here, deletes the jam's audio and unlists its uploads. */
  override async alarm() {
    if ([...this.getConnections()].length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + SOUND_RETENTION_MS)
      return
    }
    const prefix = soundPrefix(this.name)
    let cursor: string | undefined
    do {
      const page = await this.env.SOUND_FILES.list({ prefix, cursor })
      if (page.objects.length > 0) await this.env.SOUND_FILES.delete(page.objects.map((o) => o.key))
      cursor = page.truncated ? page.cursor : undefined
    } while (cursor)
    if (this.loaded) {
      apply(this.document, [{ op: 'expireSounds' }], ROOM)
      await this.onSave()
    } else {
      await this.ctx.storage.put(EXPIRED_KEY, true)
    }
  }
}
