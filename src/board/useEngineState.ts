import { useSyncExternalStore } from 'react'
import { useSession } from './session'

/** The recorder's state, re-rendering when it changes. */
export function useRecorderState() {
  const { engine } = useSession()
  return useSyncExternalStore(
    (l) => engine.subscribe(l),
    () => engine.state,
  )
}
