import type { ButtonHTMLAttributes, CSSProperties, Ref } from 'react'
import { haptic } from './haptics'
import './ui.css'

export type PadProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  ref?: Ref<HTMLButtonElement>
  /** The key that plays it, moulded into the rubber. */
  keyLabel: string
  /** The sound's name; long names wrap, then end in an ellipsis on line three. */
  name: string
  /** A dot before the name, e.g. who uploaded the sound. */
  dot?: { color: string; title: string }
  /** An uploaded sound's sample: dimmed while loading, marked when missing. */
  status?: 'loading' | 'ready' | 'missing'
  /** Shows the badge that says a click opens the sound menu. */
  editing?: boolean
  /**
   * Shows the pad pushed in (`pressed`) or lit from inside (`glow`), in `tint`. A live console
   * sets these classes straight on the element instead, as hits come too fast for React; it must
   * then keep `lit` and `className` unchanged, since a new className string replaces the
   * element's classes and cuts its flash short.
   */
  lit?: 'pressed' | 'glow'
  /** The colour of the press ring and the light (the `--glow` variable); else `--accent-2`. */
  tint?: string
}

/**
 * A pad's face: a soft rubber square with its key letter moulded in and its sound's name. Pressed,
 * it is pushed in with a ring in `tint`; lit, light spreads from inside it in `tint`. Otherwise
 * presentational: the console decides what a press does. Pressing it with a finger or the mouse
 * taps on phones; `lit` and the console's flashes (a loop's hits) never do.
 */
export function Pad({
  keyLabel,
  name,
  dot,
  status,
  editing = false,
  lit,
  tint,
  className = '',
  style,
  type = 'button',
  onPointerDown,
  ...rest
}: PadProps) {
  const vars = tint ? ({ '--glow': tint } as CSSProperties) : undefined
  return (
    <button
      type={type}
      className={`ui-pad ${lit ?? ''} ${className}`}
      style={vars ? { ...style, ...vars } : style}
      {...rest}
      onPointerDown={(e) => {
        // The person's own press, so it may tap. A primary press only, and not while disabled.
        if (e.button === 0 && !rest.disabled) haptic('tap')
        onPointerDown?.(e)
      }}
    >
      <span className="ui-pad-key">{keyLabel.toUpperCase()}</span>
      <span className={`ui-pad-sound ${status ? `ui-pad-sound-${status}` : ''}`}>
        {dot && (
          <span
            className="ui-dot"
            style={{ background: dot.color }}
            title={dot.title}
            aria-label={dot.title}
          />
        )}
        {name}
        {status === 'missing' && ' (missing)'}
      </span>
      {editing && <span className="ui-pad-edit" aria-hidden />}
    </button>
  )
}
