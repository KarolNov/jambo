import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from 'react'
import { haptic } from './haptics'
import {
  type Frames,
  type LiveDrag,
  liveDrag,
  type ScrubAnchor,
  type ScrubRange,
  scrubMove,
} from './scrubSteps'

/** The browser's animation frames. */
export const ANIMATION_FRAMES: Frames = {
  request: (run) => requestAnimationFrame(run),
  cancel: (id) => cancelAnimationFrame(id),
}

/** How a drag is read: `x` sideways only (right raises); `xy` also up raises, down lowers. */
export type ScrubAxis = 'x' | 'xy'

export type ScrubOptions = Partial<ScrubRange> & {
  value: number
  /**
   * Called once, when a drag that changed the value is let go. Never for a cancelled drag. When
   * `live`, also called as the drag moves, at most once a frame, and with the start value again
   * if a drag that applied something is cancelled and no one has changed the value since.
   */
  onCommit: (value: number) => void
  /** Called when a drag begins, before the first preview. */
  onStart?: () => void
  axis?: ScrubAxis
  /** Apply the value while dragging, not only on release. */
  live?: boolean
  disabled?: boolean
  /**
   * Whether moving from one value to the next ticks on phones (default: every step does). A knob
   * ticks only where a light of its ring changes. Ticks are throttled either way.
   */
  ticks?: (from: number, to: number) => boolean
}

type Drag = {
  id: number
  el: Element
  start: number
  anchor: ScrubAnchor
  shift: boolean
  moved: boolean
}

/**
 * Drag to change a number, for a knob or a scrub label. The value previews locally while
 * dragged (`shown`) and is handed to `onCommit` once on release; Escape or a lost pointer puts
 * it back without committing. Live, it is also handed on as it moves, once a frame, and Escape
 * hands back the start value unless a peer has changed it since. Steps tick on phones (those
 * `ticks` allows, throttled). Spread `handlers` on the drag handle.
 */
export function useScrub({
  value,
  onCommit,
  onStart,
  min = -Infinity,
  max = Infinity,
  step = 1,
  pixelsPerStep = 4,
  axis = 'x',
  live = false,
  disabled = false,
  ticks,
}: ScrubOptions) {
  const [draft, setDraft] = useState<number>()
  const drag = useRef<Drag>(undefined)
  const current = useRef<number>(undefined)
  // A live drag's frame-coalesced sender; undefined unless dragging a live control.
  const sender = useRef<LiveDrag>(undefined)
  // Set when a drag that moved ends, so the click that follows doesn't count as a click.
  const swallowClick = useRef(false)
  const range = { min, max, step, pixelsPerStep }
  const pos = (e: { clientX: number; clientY: number }) =>
    axis === 'xy' ? e.clientX - e.clientY : e.clientX

  /** Ends the drag: committing it, cancelling it, or `drop`ping it (nothing more is applied, nothing put back). */
  const end = (commit: boolean, drop = false) => {
    const d = drag.current
    if (!d) return
    drag.current = undefined
    if (d.el.hasPointerCapture(d.id)) d.el.releasePointerCapture(d.id)
    const v = current.current
    current.current = undefined
    swallowClick.current = d.moved
    setDraft(undefined)
    const s = sender.current
    sender.current = undefined
    if (s) return drop ? s.drop() : s.end(commit)
    // Against the value now, not at the start: it may have changed under the drag (a peer).
    if (commit && d.moved && v !== undefined && v !== latest.current.value) onCommit(v)
  }
  // The listeners below outlive a render; they reach this render's `end` through here.
  const latest = useRef({ value, end, onCommit })
  useEffect(() => {
    latest.current = { value, end, onCommit }
  })
  // Unmounted mid-drag (a peer removed what it controls): what a live drag applied stays, and
  // nothing more is applied.
  useEffect(
    () => () => {
      sender.current?.drop()
      sender.current = undefined
    },
    [],
  )

  // Escape puts the value back. Listened for on the window: the handle may not have focus.
  const dragging = draft !== undefined
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      latest.current.end(false)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [dragging])
  // Disabled mid-drag (the tempo locks, or someone else won the control): drop the drag where it
  // is. A live drag leaves what it applied, so it can't overwrite whoever took over.
  useEffect(() => {
    if (disabled) latest.current.end(false, true)
  }, [disabled])

  const handlers = {
    onPointerDown(e: ReactPointerEvent) {
      if (disabled || e.button !== 0 || drag.current) return
      // No text selection from the drag. That also stops the default focus, so a focusable
      // handle (a knob) is focused here: its keys work after a turn.
      e.preventDefault()
      const el = e.currentTarget
      if (el instanceof HTMLElement && el.tabIndex >= 0) el.focus()
      el.setPointerCapture(e.pointerId)
      onStart?.()
      drag.current = {
        id: e.pointerId,
        el: e.currentTarget,
        start: value,
        anchor: { base: value, at: pos(e) },
        shift: e.shiftKey,
        moved: false,
      }
      current.current = value
      swallowClick.current = false
      if (live)
        sender.current = liveDrag(
          value,
          (v) => latest.current.onCommit(v),
          () => latest.current.value,
          ANIMATION_FRAMES,
        )
      setDraft(value)
    },
    onPointerMove(e: ReactPointerEvent) {
      const d = drag.current
      if (!d || e.pointerId !== d.id) return
      const was = current.current ?? d.start
      // Shift pressed or let go mid-drag: count from here, so the value doesn't jump.
      if (e.shiftKey !== d.shift) {
        d.shift = e.shiftKey
        d.anchor = { base: was, at: pos(e) }
      }
      const next = scrubMove(d.anchor, pos(e), d.shift, range)
      d.anchor = next.anchor
      if (next.value === was) return
      d.moved = true
      if (!ticks || ticks(was, next.value)) haptic('step')
      current.current = next.value
      setDraft(next.value)
      sender.current?.move(next.value)
    },
    onPointerUp(e: ReactPointerEvent) {
      if (e.pointerId === drag.current?.id) end(true)
    },
    // The browser took the pointer (a scroll on touch): nothing is applied.
    onPointerCancel(e: ReactPointerEvent) {
      if (e.pointerId === drag.current?.id) end(false)
    },
    onLostPointerCapture(e: ReactPointerEvent) {
      if (e.pointerId === drag.current?.id) end(false)
    },
    onClick(e: ReactMouseEvent) {
      if (!swallowClick.current) return
      swallowClick.current = false
      e.preventDefault()
    },
  }

  return { shown: draft ?? value, dragging, handlers }
}
