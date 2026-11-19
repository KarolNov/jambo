import { useEffect, useRef, useState } from 'react'
import { Switch } from '../ui'
import { setTheme, useTheme } from './theme'

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

/** How long the knob travels before the page swaps theme (the swap stops all transitions). */
const SLIDE_MS = 240

/**
 * The theme's switch: a sliding `Switch` whose knob sits over the sun or the moon. The knob
 * slides first and the theme follows, because the swap freezes transitions and crossfades the
 * page as one.
 */
export function ThemeToggle() {
  const dark = useTheme() === 'dark'
  const [on, setOn] = useState(dark)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => setOn(dark), [dark])
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <Switch
      variant="slide"
      className="theme-toggle"
      checked={on}
      onChange={(next) => {
        setOn(next)
        clearTimeout(timer.current)
        const still = matchMedia('(prefers-reduced-motion: reduce)').matches
        timer.current = setTimeout(() => setTheme(next ? 'dark' : 'light'), still ? 0 : SLIDE_MS)
      }}
      off={<Sun />}
      on={<Moon />}
      aria-label="Dark mode"
      title={on ? 'Switch to light' : 'Switch to dark'}
    />
  )
}
