import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useState,
} from 'react'
import { fraction, litFraction, snap, stepBy } from './fader'
import { haptic } from './haptics'
import './ui.css'

type Tone = 'default' | 'primary' | 'danger' | 'quiet'
type Size = 'sm' | 'md' | 'lg'

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** primary: the main action here; danger: record or destructive; quiet: a low-key text action. */
  tone?: Tone
  size?: Size
}

/**
 * A soft button: raised, and pressed in while held or while `aria-pressed` is true. Use
 * `aria-pressed` for toggles such as Mute.
 */
export function Button({
  tone = 'default',
  size = 'md',
  className = '',
  type = 'button',
  ...rest
}: ButtonProps) {
  return <button type={type} className={`ui-button ui-${tone} ui-${size} ${className}`} {...rest} />
}

/** A round soft button with only an icon; `label` names it for screen readers and its tooltip. */
export function IconButton({
  label,
  className = '',
  ...rest
}: Omit<ButtonProps, 'aria-label'> & { label: string }) {
  return (
    <Button
      aria-label={label}
      title={rest.title ?? label}
      className={`ui-icon-button ${className}`}
      {...rest}
    />
  )
}

/**
 * An on/off switch: an I/O rocker that tips down toward the side that is on, with the I lit in
 * the accent when on, then its label. Flipping it ticks on phones that support haptics.
 */
export function Switch({
  checked,
  onChange,
  children,
  className = '',
  ...rest
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      className={`ui-switch ${className}`}
      onClick={() => {
        haptic('flip')
        onChange(!checked)
      }}
      {...rest}
    >
      <span className="ui-rocker" aria-hidden>
        <span className="ui-rocker-plate">
          <span className="ui-rocker-o">O</span>
          <span className="ui-rocker-i">I</span>
        </span>
      </span>
      {children}
    </button>
  )
}

export type RangeProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step'
> & {
  label: string
  /** The cap's index line and the lit LEDs (default: the focus accent). */
  color?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  /** How finely a drag moves it (default 0.01). */
  step?: number
  /** How far an arrow key moves it, on a grid of this step (default: `step`). */
  keyStep?: number
  /** Values to draw tick marks at. */
  marks?: readonly number[]
  /** A value a drag sticks to when it lands close, with a tick; its mark is drawn taller. */
  detent?: number
  /** How the value reads in the bubble and to screen readers (default: the number). */
  format?: (value: number) => string
}

const KEY_DELTA: Partial<Record<string, number>> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
}

/**
 * A mixer fader: a thin slot, a solid cap with ridges and an index line, an LED strip lit to the
 * value in `color`, optional tick marks and a detent. The value shows in a bubble while dragged.
 * It stays a native range input, so keys and screen readers work as usual.
 */
export function Range({
  label,
  color,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  keyStep = step,
  marks,
  detent,
  format = String,
  className = '',
  style,
  onKeyDown,
  onPointerDown,
  ...rest
}: RangeProps) {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    if (!dragging) return
    const end = () => setDragging(false)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging])

  // Drags stick to the detent; keys step on their own grid, so they can always leave it.
  const change = (v: number) => {
    if (v === value) return
    if (v === detent) haptic('detent')
    onChange(v)
  }

  const f = fraction(value, min, max)
  const vars = { '--f': f, '--lit': litFraction(f) } as CSSProperties
  if (color) Object.assign(vars, { '--ui-c': color })
  return (
    <span
      className={`ui-fader ${dragging ? 'is-dragging' : ''} ${className}`}
      style={{ ...style, ...vars }}
    >
      {marks && (
        <span className="ui-fader-ticks" aria-hidden>
          {marks.map((m) => (
            <b
              key={m}
              className={m === detent ? 'is-detent' : undefined}
              style={{ left: `${fraction(m, min, max) * 100}%` }}
            />
          ))}
        </span>
      )}
      <span className="ui-fader-leds" aria-hidden />
      <span className="ui-fader-bubble" aria-hidden>
        {format(value)}
      </span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={format(value)}
        className="ui-range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => change(snap(Number(e.target.value), detent))}
        onPointerDown={(e) => {
          setDragging(true)
          onPointerDown?.(e)
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          const delta = KEY_DELTA[e.key]
          if (e.defaultPrevented || delta === undefined) return
          e.preventDefault()
          change(stepBy(value, delta, keyStep, min, max))
        }}
        {...rest}
      />
    </span>
  )
}
