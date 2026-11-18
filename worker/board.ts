import type { Connection } from 'partyserver'
import { YServer } from 'y-partyserver'
import * as Y from 'yjs'
import { parseClockMessage, pong } from '../shared/clock'
import { seedBoard } from '../shared/board/seed'

const SNAPSHOT_KEY = 'doc'

/**
 * One Durable Object per jam: holds the jam's board doc, relays edits and presence between everyone
 * connected, keeps a snapshot of the doc in its own SQLite-backed storage, and is the jam's clock.
 */
export class Board extends YServer<Env> {
  static override callbackOptions = {
    debounceWait: 1000,
    debounceMaxWait: 5000,
    timeout: 5000,
  }

  override async onLoad() {
    const saved = await this.ctx.storage.get<Uint8Array>(SNAPSHOT_KEY)
    if (saved) Y.applyUpdate(this.document, saved)
    seedBoard(this.document)
  }

  // Called a moment after edits, and when the last client leaves.
  override async onSave() {
    await this.ctx.storage.put(SNAPSHOT_KEY, Y.encodeStateAsUpdate(this.document))
  }

  // The jam clock: answers a ping, to that client alone, with its own timestamp and the room's time.
  // Each message is its own event, so Date.now() is fresh.
  override onCustomMessage(connection: Connection, message: string) {
    const msg = parseClockMessage(message)
    if (msg?.t === 'ping') this.sendCustomMessage(connection, pong(msg.c, Date.now()))
  }
}
