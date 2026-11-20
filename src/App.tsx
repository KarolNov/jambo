import {
  Component,
  type ComponentType,
  lazy,
  type ReactNode,
  Suspense,
  useEffect,
  useState,
} from 'react'
import { isJamSlug } from '../shared/slug'
import { Jam } from './board/Jam'
import { useThemedPage } from './theme/theme'

// The design showcase, loaded only when someone opens /ds, so the jam's bundle stays as it was.
const Showcase = lazy(() => import('./ds/Showcase'))
// The about page, lazy for the same reason.
const About = lazy(() => import('./about/About'))

/**
 * Routes `/` to a new jam, `/jam/:slug` to its board, `/about` to the about page (the Worker redirects `/docs` there) and
 * `/ds` to the design showcase. No router library: four routes.
 */
export function App() {
  useThemedPage()
  const path = window.location.pathname
  const match = /^\/jam\/([^/]+)\/?$/.exec(path)
  if (match) {
    const slug = decodeURIComponent(match[1]!)
    return isJamSlug(slug) ? <Jam slug={slug} /> : <NotFound />
  }
  if (path === '/') return <NewJam />
  if (path === '/about' || path === '/about/') return <Lazy page={About} />
  if (path === '/ds' || path === '/ds/') return <Lazy page={Showcase} />
  return <NotFound />
}

/** A lazy page, with a loading line and a reload link if its chunk fails to load. */
function Lazy({ page: Page }: { page: ComponentType }) {
  return (
    <LoadFailed>
      <Suspense fallback={<main className="center">Loading…</main>}>
        <Page />
      </Suspense>
    </LoadFailed>
  )
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

/** Shows a reload link instead of a blank page when a lazy chunk fails to load (a new deploy, offline). */
class LoadFailed extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="center">
        <p>
          Could not load this page. <a href="">Reload</a>
        </p>
      </main>
    )
  }
}

function NotFound() {
  return (
    <main className="center">
      <h1>No jam here</h1>
      <p>
        <a href="/">Start a new jam</a> · <a href="/about">What is jambo?</a>
      </p>
    </main>
  )
}
