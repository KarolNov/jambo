import { exports } from 'cloudflare:workers'
import * as decoding from 'lib0/decoding'
import * as encoding from 'lib0/encoding'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as sync from 'y-protocols/sync'
import * as Y from 'yjs'
import { boardPath } from '../shared/parties'

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1
const REMOTE = Symbol('remote')
const CUSTOM = '__YPS:'

/**
 * A minimal Yjs client over the Worker's own fetch: the same y-protocols sync and awareness
 * messages YProvider sends. Good enough to prove two peers converge through a Board.
 */
export async function connectBoard(slug: string) {
  const res = await exports.default.fetch(`http://jambo.test${boardPath(slug)}`, {
    headers: { Upgrade: 'websocket' },
  })
  const ws = res.webSocket
  if (!ws) throw new Error(`no websocket: ${res.status}`)
  ws.accept()

  const doc = new Y.Doc()
  const awareness = new awarenessProtocol.Awareness(doc)
  // Start without local state; tests set it when they want to be seen.
  awareness.setLocalState(null)
  let synced = false
  let closed = false
  /** Custom (`__YPS:`) messages received, without the prefix. */
  const custom: string[] = []
  const send = (encoder: encoding.Encoder) => ws.send(encoding.toUint8Array(encoder))

  // Binary frames arrive as Blobs here; read them in arrival order.
  let queue = Promise.resolve()
  ws.addEventListener('message', (event) => {
    const data = event.data as unknown
    if (typeof data === 'string') {
      if (data.startsWith(CUSTOM)) custom.push(data.slice(CUSTOM.length))
      return
    }
    queue = queue.then(async () => {
      const bytes = data instanceof Blob ? await data.arrayBuffer() : (data as ArrayBuffer)
      receive(new Uint8Array(bytes))
    })
  })

  const receive = (bytes: Uint8Array) => {
    const decoder = decoding.createDecoder(bytes)
    const type = decoding.readVarUint(decoder)
    if (type === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoder), REMOTE)
      return
    }
    if (type !== MESSAGE_SYNC) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    const step = sync.readSyncMessage(decoder, encoder, doc, REMOTE)
    if (step === sync.messageYjsSyncStep2) synced = true
    if (encoding.length(encoder) > 1) send(encoder)
  }

  doc.on('update', (update: Uint8Array, origin: unknown) => {
    if (origin === REMOTE) return
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    sync.writeUpdate(encoder, update)
    send(encoder)
  })

  awareness.on(
    'update',
    ({ added, updated, removed }: Record<string, number[]>, origin: unknown) => {
      if (origin === REMOTE || closed) return
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(awareness, [...added!, ...updated!, ...removed!]),
      )
      send(encoder)
    },
  )

  const step1 = encoding.createEncoder()
  encoding.writeVarUint(step1, MESSAGE_SYNC)
  sync.writeSyncStep1(step1, doc)
  send(step1)

  await until(() => synced)
  return {
    doc,
    awareness,
    custom,
    /** Sends a custom message, as YProvider's `sendMessage` does. */
    sendCustom: (message: string) => ws.send(CUSTOM + message),
    /** Closes the socket without saying goodbye, as a closed tab does. */
    close: () => {
      closed = true
      ws.close(1000, 'done')
      awareness.destroy()
    },
  }
}

/** Polls `check` until it is true, failing after `timeout` ms. */
export async function until(check: () => boolean | Promise<boolean>, timeout = 3000) {
  const start = Date.now()
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 10))
  }
}
