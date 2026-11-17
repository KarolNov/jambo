import { Provider } from 'jotai'
import { useEffect, useState } from 'react'
import { Board } from './Board'
import { type ConnectionStatus, type JamSession, onStatus, openJam } from './doc'

/** One jam: opens its doc and connection for as long as the page shows it. */
export function Jam({ slug }: { slug: string }) {
  const [session, setSession] = useState<JamSession>()
  const [status, setStatus] = useState<ConnectionStatus>('connecting')

  useEffect(() => {
    const next = openJam(slug)
    setSession(next)
    const stop = onStatus(next.provider, setStatus)
    return () => {
      stop()
      next.destroy()
    }
  }, [slug])

  if (!session) return null
  return (
    <Provider store={session.store}>
      <Board slug={slug} status={status} />
    </Provider>
  )
}
