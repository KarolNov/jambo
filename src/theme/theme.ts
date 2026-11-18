import { useLayoutEffect, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { cssVar, resolveTheme, type Theme, type TokenName, TOKENS } from './palette'
import './theme.css'

const KEY = 'jambo.theme'

function readSaved(): unknown {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

const system = window.matchMedia('(prefers-color-scheme: dark)')
let saved = readSaved()
let current: Theme = resolveTheme(saved, system.matches)
let mounted = 0
const listeners = new Set<() => void>()

/** Publishes the current theme's tokens on the page, for as long as a themed page is mounted. */
function paint() {
  if (mounted === 0) return
  const root = document.documentElement
  root.dataset.theme = current
  for (const [name, value] of Object.entries(TOKENS[current]))
    root.style.setProperty(cssVar(name as TokenName), value)
}

function unpaint() {
  const root = document.documentElement
  delete root.dataset.theme
  for (const name of Object.keys(TOKENS.light)) root.style.removeProperty(cssVar(name as TokenName))
}

/**
 * Shows `next` as one even crossfade of the whole page: per-element transitions are off while it
 * swaps (they would each fade at their own speed), and where the browser has view transitions it
 * fades the old page into the new one.
 */
function show(next: Theme) {
  if (next === current) return
  const root = document.documentElement
  let updated = false
  const update = () => {
    if (updated) return
    updated = true
    current = next
    paint()
    flushSync(() => {
      for (const l of listeners) l()
    })
  }
  const done = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => root.classList.remove('theme-switching')),
    )
  root.classList.add('theme-switching')
  if (
    mounted > 0 &&
    document.startViewTransition &&
    !matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    const fade = document.startViewTransition(update)
    // A skipped fade rejects `ready`; that's expected, not an error.
    fade.ready.catch(() => {})
    void fade.finished.finally(done)
    // A page that isn't rendering frames (a background tab) never starts the fade: switch anyway.
    setTimeout(() => {
      if (updated) return
      fade.skipTransition()
      update()
      done()
    }, 300)
  } else {
    update()
    done()
  }
}

// Until this browser picks a theme, follow the system's.
system.addEventListener('change', () => {
  if (saved !== 'light' && saved !== 'dark') show(resolveTheme(saved, system.matches))
})

/** Picks a theme for this browser, remembered across visits. */
export function setTheme(theme: Theme) {
  saved = theme
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // Not remembered; this page still switches.
  }
  show(theme)
}

/** The theme being shown, re-rendering when it changes. */
export function useTheme(): Theme {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => current,
  )
}

/** Themes the page while the calling component is mounted, and returns the theme. */
export function useThemedPage(): Theme {
  // Before the first paint, so the page never shows a frame in the old colours.
  useLayoutEffect(() => {
    mounted++
    paint()
    return () => {
      if (--mounted === 0) unpaint()
    }
  }, [])
  return useTheme()
}
