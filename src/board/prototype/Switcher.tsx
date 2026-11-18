/** PROTOTYPE (neumorphism, throwaway): the light/dark switch in the header, kept in `?theme=`. */
import { useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'

type Theme = 'light' | 'dark'

const listeners = new Set<() => void>()

export function useTheme(): Theme {
  const search = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => window.location.search,
  )
  return new URLSearchParams(search).get('theme') === 'dark' ? 'dark' : 'light'
}

/**
 * Switches the theme as one even crossfade of the whole page: per-element transitions are
 * turned off while it swaps (they would each fade at their own speed), and where the browser has
 * view transitions it fades the old page into the new one.
 */
function setTheme(theme: Theme) {
  const root = document.querySelector<HTMLElement>('.neumo')
  const update = () => {
    const params = new URLSearchParams(window.location.search)
    params.set('theme', theme)
    history.replaceState(null, '', `${window.location.pathname}?${params}`)
    flushSync(() => {
      for (const l of listeners) l()
    })
  }
  const done = () =>
    requestAnimationFrame(() => requestAnimationFrame(() => root?.classList.remove('n-switching')))
  root?.classList.add('n-switching')
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches)
    void document.startViewTransition(update).finished.finally(done)
  else {
    update()
    done()
  }
}

const Sun = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <circle cx="12" cy="12" r="4.5" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
      <line key={a} x1="12" y1="2.5" x2="12" y2="5" transform={`rotate(${a} 12 12)`} />
    ))}
  </svg>
)
const Moon = () => (
  <svg viewBox="0 0 24 24" aria-hidden>
    <path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />
  </svg>
)

/** A soft two-position switch: sun on the left, moon on the right, the knob on the current one. */
export function ThemeToggle() {
  const theme = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className="n-theme"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? 'Switch to light' : 'Switch to dark'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <span className="n-theme-knob" aria-hidden />
      <Sun />
      <Moon />
    </button>
  )
}
