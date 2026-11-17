import { useEffect, useState } from 'react'
import { isJamSlug } from '../shared/slug'
import { Jam } from './board/Jam'

/** Routes `/` to a new jam and `/jam/:slug` to its board. No router library: two routes. */
export function App() {
  const path = window.location.pathname
  const match = /^\/jam\/([^/]+)\/?$/.exec(path)
  if (match) {
    const slug = decodeURIComponent(match[1]!)
    return isJamSlug(slug) ? <Jam slug={slug} /> : <NotFound />
  }
  if (path === '/') return <NewJam />
  return <NotFound />
}

/** Asks the Worker for a new slug and replaces `/` with the jam's link. */
function NewJam() {
  const [error, setError] = useState<string>()
  useEffect(() => {
    let cancelled = false
    fetch('/api/jams', { method: 'POST' })
      .then((res) =>
        res.ok ? (res.json() as Promise<{ slug: string }>) : Promise.reject(res.status),
      )
      .then(({ slug }) => {
        if (!cancelled) window.location.replace(`/jam/${slug}`)
      })
      .catch(() => {
        if (!cancelled) setError('Could not start a jam. Try again in a moment.')
      })
    return () => {
      cancelled = true
    }
  }, [])
  return <main className="center">{error ?? 'Starting a jam…'}</main>
}

function NotFound() {
  return (
    <main className="center">
      <h1>No jam here</h1>
      <p>
        <a href="/">Start a new jam</a>
      </p>
    </main>
  )
}
