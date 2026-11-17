import { collection, select } from 'duratom'
import { z } from 'zod'

/** A track on the board. The scaffold's toy model: just a name; clips come in a later blueprint. */
export const Track = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'A track needs a name')
    .max(60, 'Keep track names under 60 characters'),
})
export type Track = z.infer<typeof Track>

/** Every track, in the root map `tracks`; `name` is shared text so two people can type in it. */
export const tracks = collection(select.map('tracks'), Track, { name: 'text' })

/** Track ids sort by creation time, so the collection's sorted `ids` is creation order. */
export function newTrackId(now = Date.now()): string {
  const random = crypto.getRandomValues(new Uint8Array(4))
  return `${now.toString(36).padStart(9, '0')}-${Array.from(random, (b) => b.toString(16).padStart(2, '0')).join('')}`
}
