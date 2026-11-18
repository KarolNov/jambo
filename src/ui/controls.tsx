import type { ButtonHTMLAttributes, CSSProperties, InputHTMLAttributes, ReactNode } from 'react'
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

/** An on/off switch: an inset track with a raised knob, then its label. */
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
      onClick={() => onChange(!checked)}
      {...rest}
    >
      <span className="ui-switch-track" aria-hidden>
        <span className="ui-switch-knob" />
      </span>
      {children}
    </button>
  )
}

/** A soft slider: an inset groove and a raised knob, rimmed in `color` (default: the focus accent). */
export function Range({
  label,
  color,
  className = '',
  style,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { label: string; color?: string }) {
  return (
    <input
      type="range"
      aria-label={label}
      className={`ui-range ${className}`}
      style={color ? ({ ...style, '--ui-c': color } as CSSProperties) : style}
      {...rest}
    />
  )
}
