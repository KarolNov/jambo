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

/** A soft two-position switch, sun then moon, with the knob over the theme being shown. */
export function ThemeToggle() {
  const dark = useTheme() === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      role="switch"
      aria-checked={dark}
      aria-label="Dark mode"
      title={dark ? 'Switch to light' : 'Switch to dark'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <span className="theme-toggle-knob" aria-hidden />
      <Sun />
      <Moon />
    </button>
  )
}
