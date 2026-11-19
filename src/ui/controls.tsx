import {
  type ButtonHTMLAttributes,
  type CSSProperties,
  type InputHTMLAttributes,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react'
import { fraction, litFraction, snap } from './fader'
import { haptic } from './haptics'
import { useScrub } from './scrub'
import { keyValue } from './scrubSteps'
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

export type SwitchProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'checked' | 'onChange' | 'children'
> & {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Its visible label. Without one, give it an `aria-label`. */
  children?: ReactNode
  /** rocker (default): an I/O rocker that tips; slide: a knob that slides along a track. */
  variant?: 'rocker' | 'slide'
  /** The off mark: the rocker's left side (default O), or the slide's knob while off. */
  off?: ReactNode
  /** The on mark: the rocker's right side (default I), or the slide's knob while on. */
  on?: ReactNode
}

/**
 * An on/off switch, then its label. The rocker tips down toward the side that is on, with the I
 * lit in the accent when on. The slide moves a knob along an inset track onto the side that is
 * on, stretching while held; with marks, the knob shows the current one, like an LED readout,
 * and without them the track lights behind it. Flipping either ticks on phones
 * that support haptics.
 *
 * Underneath it is a native `<input type="checkbox" switch>`, invisible and laid over the whole
 * control, so a tap lands on a real switch: iOS Safari gives that its own haptic tick, which
 * scripts can no longer trigger there (iOS 26.5 closed that). Elsewhere `haptic('flip')` ticks.
 */
export function Switch({
  checked,
  onChange,
  children,
  variant = 'rocker',
  off = variant === 'rocker' ? 'O' : null,
  on = variant === 'rocker' ? 'I' : null,
  className = '',
  ...rest
}: SwitchProps) {
  return (
    <label className={`ui-switch ui-switch-${variant} ${className}`}>
      <input
        type="checkbox"
        // Safari's native switch: React passes the unknown attribute through as written.
        {...{ switch: '' }}
        role="switch"
        className="ui-switch-input"
        checked={checked}
        onChange={(e) => {
          haptic('flip')
          onChange(e.target.checked)
        }}
        {...rest}
      />
      {variant === 'rocker' ? (
        <span className="ui-rocker" aria-hidden>
          <span className="ui-rocker-plate">
            <span className="ui-rocker-o">{off}</span>
            <span className="ui-rocker-i">{on}</span>
          </span>
        </span>
      ) : (
        <span className="ui-slide" aria-hidden>
          <span className="ui-slide-well">
            <span className="ui-slide-carriage">
              {!off && !on && <span className="ui-slide-fill" />}
              <span className="ui-slide-knob">
                {(off || on) && (
                  <>
                    <span className="ui-slide-off">{off}</span>
                    <span className="ui-slide-on">{on}</span>
                  </>
                )}
              </span>
            </span>
          </span>
        </span>
      )}
      {children}
    </label>
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

/** How many key steps Page Up and Page Down move the fader. */
const PAGE_STEPS = 5

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
  // While dragged, the fader shows `draft` at once and hands it on at most once a frame, so a
  // drag doesn't send a change for every 0.01 it passes.
  const [draft, setDraft] = useState<number>()
  const shown = draft ?? value
  const held = useRef(false)
  const pending = useRef<number>(undefined)
  const frame = useRef(0)
  const latest = useRef(onChange)
  useEffect(() => {
    latest.current = onChange
  })
  const flush = () => {
    cancelAnimationFrame(frame.current)
    frame.current = 0
    const v = pending.current
    pending.current = undefined
    if (v !== undefined) latest.current(v)
  }

  useEffect(() => {
    if (!dragging) return
    const end = () => {
      held.current = false
      flush()
      setDraft(undefined)
      setDragging(false)
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [dragging])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])

  // Drags stick to the detent, with a tick; keys step on their own grid, so they can always
  // leave it, and never tick.
  const drag = (raw: number) => {
    const v = snap(raw, detent)
    if (v === shown) return
    if (!held.current) {
      onChange(v) // Moved some other way (a screen reader): no drag to coalesce.
      return
    }
    if (v === detent) haptic('detent')
    setDraft(v)
    pending.current = v
    frame.current ||= requestAnimationFrame(flush)
  }

  const f = fraction(shown, min, max)
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
        {format(shown)}
      </span>
      <input
        type="range"
        aria-label={label}
        aria-valuetext={format(shown)}
        className="ui-range"
        min={min}
        max={max}
        step={step}
        value={shown}
        onChange={(e) => drag(Number(e.target.value))}
        onPointerDown={(e) => {
          held.current = true
          setDragging(true)
          onPointerDown?.(e)
        }}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented) return
          const v = keyValue(e, shown, { min, max, step: keyStep }, PAGE_STEPS)
          if (v === undefined) return
          e.preventDefault()
          if (v !== shown) onChange(v)
        }}
        {...rest}
      />
    </span>
  )
}

export type ScrubFieldProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'value' | 'defaultValue' | 'onChange' | 'min' | 'max' | 'step' | 'children'
> & {
  /** The label, which is also the drag handle: drag it sideways to change the value. */
  label: ReactNode
  value: number
  /** Called once per change: on release after a scrub, on Enter or blur after typing, per arrow. */
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  /** Pixels of drag per step (default 4). */
  pixelsPerStep?: number
  /** Beside the field, inside the control: steppers, say. */
  start?: ReactNode
  end?: ReactNode
}

/**
 * A number field whose label scrubs it, like a design tool's input labels: drag the label right
 * to raise the value, left to lower it, Shift for ten steps. The field shows the value while
 * dragging and applies it once on release; Escape puts it back. The field can also be typed in
 * (Enter or leaving it applies, Escape cancels) and stepped with the arrow keys. Typed values go
 * to `onChange` as typed, so the owner clamps them and can say why. Disabled, the label doesn't
 * scrub.
 */
export function ScrubField({
  label,
  value,
  onChange,
  min = -Infinity,
  max = Infinity,
  step = 1,
  pixelsPerStep = 4,
  start,
  end,
  disabled,
  className = '',
  id,
  onKeyDown,
  onBlur,
  ...rest
}: ScrubFieldProps) {
  const autoId = useId()
  const fieldId = id ?? autoId
  // The number being typed; applied on Enter or when the field loses focus. A scrub drops it, so
  // the dragged value is the one that stays.
  const [typed, setTyped] = useState<string>()
  const scrub = useScrub({
    value,
    onCommit: onChange,
    onStart: () => setTyped(undefined),
    min,
    max,
    step,
    pixelsPerStep,
    disabled,
  })
  // Set on Escape, so the blur that follows doesn't apply what was typed.
  const cancelled = useRef(false)
  const allowed = new RegExp(`[^0-9${Number.isInteger(step) ? '' : '.'}${min < 0 ? '-' : ''}]`, 'g')
  const shown = scrub.dragging ? String(scrub.shown) : (typed ?? String(value))

  return (
    <span
      className={`ui-scrub ${scrub.dragging ? 'is-scrubbing' : ''} ${className}`}
      aria-disabled={disabled || undefined}
    >
      <label htmlFor={fieldId} className="ui-scrub-label" {...scrub.handlers}>
        {label}
      </label>
      {start}
      <input
        {...rest}
        id={fieldId}
        className="ui-scrub-field"
        inputMode={Number.isInteger(step) ? 'numeric' : 'decimal'}
        value={shown}
        disabled={disabled}
        readOnly={scrub.dragging}
        onChange={(e) => setTyped(e.target.value.replace(allowed, ''))}
        onKeyDown={(e) => {
          onKeyDown?.(e)
          if (e.defaultPrevented) return
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') {
            cancelled.current = true
            setTyped(undefined)
            e.currentTarget.blur()
          }
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            const next = keyValue(e, value, { min, max, step })
            setTyped(undefined)
            if (next !== undefined && next !== value) onChange(next)
          }
        }}
        onBlur={(e) => {
          onBlur?.(e)
          const n = typed === undefined || typed.trim() === '' ? NaN : Number(typed)
          setTyped(undefined)
          if (cancelled.current) cancelled.current = false
          else if (Number.isFinite(n) && n !== value) onChange(n)
        }}
      />
      {end}
    </span>
  )
}

export type KnobProps = {
  label: string
  value: number
  /**
   * Called on release after a drag, and per key press or double-click reset. When `live`, also
   * called while turning, at most once a frame, and with the start value if Escape cancels.
   */
  onChange: (value: number) => void
  /** Apply the value as it turns, not only on release: for a setting everyone hears change. */
  live?: boolean
  min?: number
  max?: number
  step?: number
  /** Where a double-click puts it (default: `min`). */
  defaultValue?: number
  /** The arc lit to the value, and the cap's index line (default: the focus accent). */
  color?: string
  /** How the value reads in the bubble and to screen readers (default: the number). */
  format?: (value: number) => string
  disabled?: boolean
  className?: string
}

/**
 * A rotary knob: a raised cap with an index line, in a ring lit to the value in `color`. Drag up
 * or right to turn it up, down or left to turn it down, Shift for ten steps; the value shows in a
 * bubble while turning and applies once on release, and Escape puts it back. A `live` knob applies
 * as it turns, once a frame, and Escape applies the start value again. Arrows, Page Up/Down,
 * Home and End turn it from the keyboard; a double-click resets it to `defaultValue`. Screen
 * readers hear a slider.
 */
export function Knob({
  label,
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  defaultValue = min,
  color,
  format = String,
  live = false,
  disabled = false,
  className = '',
}: KnobProps) {
  // The whole sweep takes about 200px of drag, but never less than a pixel a step.
  const pixelsPerStep = Math.max(1, 200 / ((max - min) / step))
  const scrub = useScrub({
    value,
    onCommit: onChange,
    min,
    max,
    step,
    pixelsPerStep,
    axis: 'xy',
    live,
    disabled,
  })
  const f = fraction(scrub.shown, min, max)
  const vars = { '--f': f } as CSSProperties
  if (color) Object.assign(vars, { '--ui-c': color })
  return (
    <span className={`ui-knob ${scrub.dragging ? 'is-dragging' : ''} ${className}`} style={vars}>
      <span className="ui-knob-bubble" aria-hidden>
        {format(scrub.shown)}
      </span>
      <span
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={scrub.shown}
        aria-valuetext={format(scrub.shown)}
        aria-disabled={disabled || undefined}
        aria-orientation="vertical"
        className="ui-knob-dial"
        {...scrub.handlers}
        onDoubleClick={() => {
          if (!disabled && defaultValue !== value) onChange(defaultValue)
        }}
        onKeyDown={(e) => {
          if (disabled || scrub.dragging) return
          const v = keyValue(e, value, { min, max, step })
          if (v === undefined) return
          e.preventDefault()
          // Keys don't tick, as the fader's don't.
          if (v !== value) onChange(v)
        }}
      >
        <span className="ui-knob-cap" aria-hidden />
      </span>
    </span>
  )
}
