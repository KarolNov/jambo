import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { bubbleText, heldVars, type SharedProps, useDragReport } from './controls'
import { fraction, valueAt } from './fader'
import { ANIMATION_FRAMES } from './scrub'
import { keyValue, type LiveDrag, liveDrag } from './scrubSteps'
import './ui.css'

/** One axis of an XY pad: its name as a slider, its range, and how its value reads. */
export type XYAxis = {
  /** Names the axis's slider for screen readers, e.g. "Filter cutoff". */
  label: string
  min?: number
  max?: number
  /** How finely a drag or an arrow key moves it (default 0.01); Shift moves ten. */
  step?: number
  /** How the value reads in the bubble and to screen readers (default: the number). */
  format?: (value: number) => string
}

export type XYPadProps = {
  /** Names the pad, the group of its two sliders. */
  label: string
  x: number
  y: number
  /**
   * Called on release after a drag, and per key press. When `live`, also called while dragging,
   * at most once a frame, and with the start position if Escape cancels (unless a peer has moved
   * it since).
   */
  onChange: (x: number, y: number) => void
  /** Across, left to right. */
  xAxis: XYAxis
  /** Up, bottom to top. */
  yAxis: XYAxis
  /** Apply the position as it moves, not only on release: for a setting everyone hears change. */
  live?: boolean
  /** A position to mark on the pad, such as where it is off. */
  home?: { x: number; y: number }
  /** The puck and its lines (default: `--accent-2`). */
  color?: string
  disabled?: boolean
  className?: string
} & SharedProps

/** How far in from the square's edge the puck's centre travels, so the puck stays inside it. */
const INSET = 14

type Point = readonly [x: number, y: number]
const samePoint = (a: Point, b: Point) => a[0] === b[0] && a[1] === b[1]

/** How long the puck takes, roughly, to glide to a position it didn't follow a drag to. */
const GLIDE_S = 0.07

/**
 * Puts the puck at `to` (fractions across and up) through `--fx` and `--fy` on `el`: at once
 * while `instant` (your own drag), else gliding there on a critically damped spring, so a peer's
 * moves, which arrive unevenly over the network, read as one smooth motion. Each new `to` bends
 * the glide without a jolt, as the spring keeps its speed.
 */
function useGlide(el: RefObject<HTMLElement | null>, to: Point, instant: boolean) {
  const [tx, ty] = to
  const target = useRef(to)
  const shown = useRef<Point>(undefined)
  const speed = useRef<[number, number]>([0, 0])
  const frame = useRef(0)
  useLayoutEffect(() => {
    target.current = [tx, ty]
    const node = el.current
    if (!node) return
    const write = (p: Point) => {
      shown.current = p
      node.style.setProperty('--fx', String(p[0]))
      node.style.setProperty('--fy', String(p[1]))
    }
    const stop = () => {
      cancelAnimationFrame(frame.current)
      frame.current = 0
      speed.current = [0, 0]
    }
    if (instant || !shown.current || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      stop()
      write([tx, ty])
      return
    }
    if (frame.current) return
    let last: number | undefined
    const step = (now: number) => {
      const dt = last === undefined ? 1 / 60 : Math.min(0.1, (now - last) / 1000)
      last = now
      const omega = 2 / GLIDE_S
      const k = omega * dt
      const decay = 1 / (1 + k + 0.48 * k * k + 0.235 * k * k * k)
      const goal = target.current
      const from = shown.current!
      const v = speed.current
      const next = [0, 0] as [number, number]
      let settled = true
      for (const i of [0, 1] as const) {
        const gap = from[i] - goal[i]
        const pull = (v[i] + omega * gap) * dt
        v[i] = (v[i] - omega * pull) * decay
        next[i] = goal[i] + (gap + pull) * decay
        if (Math.abs(next[i] - goal[i]) > 0.0005 || Math.abs(v[i]) > 0.01) settled = false
      }
      if (settled) {
        stop()
        write(goal)
        return
      }
      write(next)
      frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
  }, [el, tx, ty, instant])
  useEffect(() => () => cancelAnimationFrame(frame.current), [])
}

/**
 * Which axis each arrow key moves: ← → across, ↑ ↓ up and down, whichever slider has focus.
 * Held together, one of each moves it diagonally.
 */
const ARROW_AXIS: Partial<Record<string, 0 | 1>> = {
  ArrowLeft: 0,
  ArrowRight: 0,
  ArrowUp: 1,
  ArrowDown: 1,
}

/**
 * A square pad that sets two values at once (`XYPadProps`): press anywhere in it and drag, and the
 * puck follows, with a line through it on each axis in `color`. A drag previews locally and
 * applies once on release; a `live` pad applies as it moves, at most once a frame, and leaves the
 * puck where it is released. Any other move (a key, a peer's drag, a reset) glides there
 * (`useGlide`). Escape mid-drag puts it back where the drag started (and applies
 * that again when live). Arrow keys move it a step on their axis (← → across, ↑ ↓ up and down;
 * held together, one of each moves it diagonally, and a move of the unfocused axis is announced),
 * Shift for ten; Page Up/Down, Home and End move the focused axis. Screen readers hear a group of
 * two sliders, one per axis. While someone else holds it (`heldBy`), its puck and lines turn
 * their colour, the bubble names them, and it ignores drags and keys; if that arrives mid-drag, the drag
 * ends where it is.
 */
export function XYPad({
  label,
  x,
  y,
  onChange,
  xAxis,
  yAxis,
  live = false,
  home,
  color,
  disabled = false,
  heldBy,
  onDragChange,
  className = '',
}: XYPadProps) {
  const locked = disabled || !!heldBy
  const axes = [xAxis, yAxis].map((a) => ({
    min: a.min ?? 0,
    max: a.max ?? 1,
    step: a.step ?? 0.01,
    format: a.format ?? String,
    label: a.label,
  }))
  const [ax, ay] = axes as [(typeof axes)[0], (typeof axes)[0]]

  // While dragged, the pad shows `draft` at once; `start` is where the drag began.
  const [draft, setDraft] = useState<Point>()
  // The same draft, for `end` when called from a listener set up in an earlier render.
  const draftRef = useRef<Point>(undefined)
  const drag = useRef<{ id: number; el: Element; start: Point; moved: boolean }>(undefined)
  const sender = useRef<LiveDrag<Point>>(undefined)
  const xSlider = useRef<HTMLSpanElement>(null)
  const root = useRef<HTMLSpanElement>(null)
  // Focused by a press (so its keys work after a drag): no focus rim until a key is used, as a
  // pressed button shows none. The browser counts this focus as visible, so it is tracked here.
  const [pressFocused, setPressFocused] = useState(false)
  // The arrow keys held down, so two held together move it diagonally (only the last one repeats).
  const arrows = useRef(new Set<string>())
  // What screen readers hear when a key moves the axis whose slider doesn't have focus.
  const [announce, setAnnounce] = useState('')
  const latest = useRef({ x, y, onChange })
  useEffect(() => {
    latest.current = { x, y, onChange }
  })
  const dragging = draft !== undefined
  useDragReport(dragging, onDragChange)
  const [sx, sy] = draft ?? [x, y]

  /** Ends the drag: committing it, cancelling it, or `drop`ping it (nothing more is applied). */
  const end = (commit: boolean, drop = false) => {
    const d = drag.current
    if (!d) return
    drag.current = undefined
    if (d.el.hasPointerCapture(d.id)) d.el.releasePointerCapture(d.id)
    const s = sender.current
    sender.current = undefined
    const v = draftRef.current
    draftRef.current = undefined
    setDraft(undefined)
    if (s) return drop ? s.drop() : s.end(commit)
    if (commit && d.moved && v) {
      const now = latest.current
      if (!samePoint(v, [now.x, now.y])) now.onChange(v[0], v[1])
    }
  }
  const endRef = useRef(end)
  useEffect(() => {
    endRef.current = end
  })

  // Escape puts it back. Listened for on the window: the pad may not have focus.
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      endRef.current(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dragging])
  // Held or disabled mid-drag (someone else won it): drop the drag where it is, so it can't
  // overwrite whoever took over.
  useEffect(() => {
    if (locked) endRef.current(false, true)
  }, [locked])
  // Unmounted mid-drag: what a live drag applied stays, and nothing more is applied.
  useEffect(
    () => () => {
      sender.current?.drop()
      sender.current = undefined
    },
    [],
  )

  const pointAt = (e: { clientX: number; clientY: number }, el: Element): Point => {
    const r = el.getBoundingClientRect()
    return [
      valueAt((e.clientX - r.left - INSET) / (r.width - 2 * INSET), ax.min, ax.max, ax.step),
      valueAt(1 - (e.clientY - r.top - INSET) / (r.height - 2 * INSET), ay.min, ay.max, ay.step),
    ]
  }
  const preview = (p: Point) => {
    draftRef.current = p
    setDraft(p)
    sender.current?.move(p)
  }

  const surface = {
    onPointerDown(e: ReactPointerEvent) {
      if (locked || e.button !== 0 || drag.current) return
      // No text selection or scrolling from the drag; focus the pad so its keys work after.
      e.preventDefault()
      // After the focus moves: leaving the other axis's slider clears it on blur.
      xSlider.current?.focus({ preventScroll: true })
      setPressFocused(true)
      const el = e.currentTarget
      el.setPointerCapture(e.pointerId)
      const start: Point = [x, y]
      drag.current = { id: e.pointerId, el, start, moved: false }
      if (live)
        sender.current = liveDrag<Point>(
          start,
          (p) => latest.current.onChange(p[0], p[1]),
          () => [latest.current.x, latest.current.y],
          ANIMATION_FRAMES,
          samePoint,
        )
      const p = pointAt(e, el)
      drag.current.moved = !samePoint(p, start)
      preview(p)
    },
    onPointerMove(e: ReactPointerEvent) {
      const d = drag.current
      if (!d || e.pointerId !== d.id) return
      const p = pointAt(e, d.el)
      if (draftRef.current && samePoint(p, draftRef.current)) return
      d.moved = true
      preview(p)
    },
    onPointerUp(e: ReactPointerEvent) {
      if (e.pointerId === drag.current?.id) end(true)
    },
    // The browser took the pointer: nothing more is applied, and a live drag is put back.
    onPointerCancel(e: ReactPointerEvent) {
      if (e.pointerId === drag.current?.id) end(false)
    },
    onLostPointerCapture(e: ReactPointerEvent) {
      if (e.pointerId === drag.current?.id) end(false)
    },
  }

  const onKeyDown = (axis: 0 | 1) => (e: KeyboardEvent) => {
    const isArrow = ARROW_AXIS[e.key] !== undefined
    if (isArrow) arrows.current.add(e.key)
    // Each held arrow moves its own axis; any other key moves the focused one.
    const keys = isArrow ? [...arrows.current] : [e.key]
    const next: [number, number] = [x, y]
    let handled = false
    for (const key of keys) {
      const moves = ARROW_AXIS[key] ?? axis
      const v = keyValue({ key, shiftKey: e.shiftKey }, next[moves], axes[moves]!)
      if (v === undefined) continue
      handled = true
      next[moves] = v
    }
    // A key it doesn't use, such as a pad's, passes through and leaves the rim off.
    if (!handled) return
    e.preventDefault()
    setPressFocused(false)
    if (locked || dragging) return
    if (samePoint(next, [x, y])) return
    const other = axis === 0 ? 1 : 0
    const o = axes[other]!
    if (next[other] !== [x, y][other]) setAnnounce(`${o.label} ${o.format(next[other])}`)
    onChange(next[0], next[1])
  }
  const onKeyUp = (e: KeyboardEvent) => arrows.current.delete(e.key)

  useGlide(root, [fraction(sx, ax.min, ax.max), fraction(sy, ay.min, ay.max)], dragging)
  const vars = {
    '--xy-inset': `${INSET}px`,
    ...heldVars(heldBy),
  } as CSSProperties
  if (color) Object.assign(vars, { '--ui-c': color })
  // Someone else moving it: the puck and its lines are theirs, in their colour, over the pad's own.
  if (heldBy) Object.assign(vars, { '--ui-c': heldBy.color })
  const slider = (axis: 0 | 1) => {
    const a = axes[axis]!
    const v = axis === 0 ? sx : sy
    return (
      <span
        ref={axis === 0 ? xSlider : undefined}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label={a.label}
        aria-valuemin={a.min}
        aria-valuemax={a.max}
        aria-valuenow={v}
        aria-valuetext={a.format(v)}
        aria-orientation={axis === 0 ? 'horizontal' : 'vertical'}
        aria-disabled={locked || undefined}
        aria-description={heldBy && `${heldBy.name} is moving it`}
        className="ui-xy-axis"
        onKeyDown={onKeyDown(axis)}
        onKeyUp={onKeyUp}
        onBlur={() => {
          setPressFocused(false)
          arrows.current.clear()
        }}
      />
    )
  }

  return (
    <span
      ref={root}
      role="group"
      aria-label={label}
      className={`ui-xy ${dragging ? 'is-dragging' : ''} ${heldBy ? 'is-held' : ''} ${disabled ? 'is-disabled' : ''} ${pressFocused ? 'is-press-focused' : ''} ${className}`}
      style={vars}
    >
      <span className="ui-xy-surface" {...surface}>
        <span className="ui-xy-grid" aria-hidden />
        {home && (
          <span
            className="ui-xy-home"
            aria-hidden
            style={
              {
                '--hx': fraction(home.x, ax.min, ax.max),
                '--hy': fraction(home.y, ay.min, ay.max),
              } as CSSProperties
            }
          />
        )}
        <span className="ui-xy-lines" aria-hidden />
        <span className="ui-xy-puck" aria-hidden />
        <span className="ui-xy-bubble" aria-hidden>
          {bubbleText(`${ax.format(sx)} · ${ay.format(sy)}`, dragging, heldBy)}
        </span>
      </span>
      {slider(0)}
      {slider(1)}
      <span className="ui-xy-announce" aria-live="polite">
        {announce}
      </span>
    </span>
  )
}
