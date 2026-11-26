import { UploadError } from '../audio/upload'
import type { JamSession } from './doc'
import { soundsAtom } from './model'

/** Resolves once the board lists `id` as a readable sound, so pads can be assigned to it. */
export function listed(store: JamSession['store'], id: string, timeout = 10_000): Promise<void> {
  if (store.get(soundsAtom).has(id)) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const stop = store.sub(soundsAtom, () => {
      if (!store.get(soundsAtom).has(id)) return
      stop()
      clearTimeout(timer)
      resolve()
    })
    const timer = setTimeout(() => {
      stop()
      reject(new UploadError('The upload is stored but has not reached this board yet'))
    }, timeout)
  })
}
