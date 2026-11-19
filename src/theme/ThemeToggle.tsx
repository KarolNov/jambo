import { useEffect, useState } from 'react'
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

/**
 * The theme's switch: a sliding `Switch` whose knob sits over the sun or the moon. The knob
 * moves at once; the theme follows when it lands (setTheme waits for running transitions).
 */
export function ThemeToggle() {
  const dark = useTheme() === 'dark'
  const [on, setOn] = useState(dark)
  useEffect(() => setOn(dark), [dark])
  return (
    <Switch
      variant="slide"
      className="theme-toggle"
      checked={on}
      onChange={(next) => {
        setOn(next)
        setTheme(next ? 'dark' : 'light')
      }}
      off={<Sun />}
      on={<Moon />}
      aria-label="Dark mode"
      title={on ? 'Switch to light' : 'Switch to dark'}
    />
  )
}
