import type { ButtonHTMLAttributes, CSSProperties, Ref } from 'react'
import { haptic } from './haptics'
import './ui.css'

export type PadProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  ref?: Ref<HTMLButtonElement>
  /** The key that plays it, moulded into the middle of the rubber. */
  keyLabel: string
  /**
   * The sound's name, printed on the console under the pad: up to two lines, then an ellipsis,
   * whole in its tooltip. With the key, it is also the pad's accessible name.
   */
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
   * element's classes and cuts its flash short. `ref`, `className` and the button props go on the
   * rubber pad itself; `style` goes on the slot that holds the pad and its name, so it lays them
   * out together (a grid cell, a width).
   */
  lit?: 'pressed' | 'glow'
  /** The colour of the press ring and the light (the `--glow` variable); else `--accent-2`. */
  tint?: string
}

/**
 * A pad's face: a soft rubber square with its key letter moulded into the middle, and its sound's
 * name printed on the console under it. Pressed, it is pushed in with a ring in `tint`; lit, light
 * spreads from inside it in `tint`. Otherwise presentational: the console decides what a press
 * does. Pressing it with a finger or the mouse taps on Android phones (iOS gives scripts no
 * haptics); `lit` and the console's flashes (a loop's hits) never do.
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
  const full = name + (status === 'missing' ? ' (missing)' : '')
  // The key first, as the pad read before, so pads on the same sound stay apart
  const label = [`${keyLabel.toUpperCase()} ${full}`, dot?.title].filter(Boolean).join(', ')
  return (
    <div className="ui-pad-slot" style={style}>
      <button
        type={type}
        className={`ui-pad ${lit ?? ''} ${className}`}
        style={vars}
        aria-label={label}
        title={full}
        {...rest}
        onPointerDown={(e) => {
          // The person's own press, so it may tap. A primary press only, and not while disabled.
          if (e.button === 0 && !rest.disabled) haptic('tap')
          onPointerDown?.(e)
        }}
      >
        <span className="ui-pad-key" aria-hidden>
          {keyLabel.toUpperCase()}
        </span>
        {editing && <span className="ui-pad-edit" aria-hidden />}
      </button>
      <span
        className={`ui-pad-sound ${status ? `ui-pad-sound-${status}` : ''}`}
        title={full}
        aria-hidden
      >
        <span className="ui-pad-sound-line">
          {dot && <span className="ui-dot" style={{ background: dot.color }} title={dot.title} />}
          <span className="ui-pad-sound-name">{full}</span>
        </span>
      </span>
    </div>
  )
}
