import { exports } from 'cloudflare:workers'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as sync from 'y-protocols/sync'
import * as Y from 'yjs'
import { boardPath } from '../shared/parties'

const MESSAGE_SYNC = 0
const REMOTE = Symbol('remote')

/**
 * A minimal Yjs sync client over the Worker's own fetch: the same y-protocols sync messages
 * YProvider sends, without awareness. Good enough to prove two peers converge through a Board.
 */
export async function connectBoard(slug: string) {
  const res = await exports.default.fetch(`http://jambo.test${boardPath(slug)}`, {
    headers: { Upgrade: 'websocket' },
  })
  const ws = res.webSocket
  if (!ws) throw new Error(`no websocket: ${res.status}`)
  ws.accept()

  const doc = new Y.Doc()
  let synced = false
  const send = (encoder: encoding.Encoder) => ws.send(encoding.toUint8Array(encoder))

  // Binary frames arrive as Blobs here; read them in arrival order.
  let queue = Promise.resolve()
  ws.addEventListener('message', (event) => {
    const data = event.data as unknown
    if (typeof data === 'string') return
    queue = queue.then(async () => {
      const bytes = data instanceof Blob ? await data.arrayBuffer() : (data as ArrayBuffer)
      receive(new Uint8Array(bytes))
    })
  })

  const receive = (bytes: Uint8Array) => {
    const decoder = decoding.createDecoder(bytes)
    if (decoding.readVarUint(decoder) !== MESSAGE_SYNC) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    const type = sync.readSyncMessage(decoder, encoder, doc, REMOTE)
    if (type === sync.messageYjsSyncStep2) synced = true
    if (encoding.length(encoder) > 1) send(encoder)
  }

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    sync.writeUpdate(encoder, update)
    send(encoder)
  })

  const step1 = encoding.createEncoder()
  encoding.writeVarUint(step1, MESSAGE_SYNC)
  sync.writeSyncStep1(step1, doc)
  send(step1)

  await until(() => synced)
  return { doc, close: () => ws.close(1000, 'done') }
}

/** Polls `check` until it is true, failing after `timeout` ms. */
export async function until(check: () => boolean | Promise<boolean>, timeout = 3000) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}
