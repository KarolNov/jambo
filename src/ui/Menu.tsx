/**
 * A soft popover and option list, in place of native <select>s. Keyboard: ↑ ↓ Home End to move,
 * Enter or Space to pick, Escape to close; the logic is in listNav.ts.
 */
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { initialIndex, navKey } from './listNav'
import './ui.css'

export interface Option {
  value: string
  label: string
  disabled?: boolean
  /** Shown after the label, muted. */
  note?: string
  /** A dot in this colour before the label, e.g. who uploaded a sound. */
  dot?: { color: string; title: string }
}
export interface Group {
  label?: string
  options: Option[]
}

const GAP = 8
const EDGE = 12

/**
 * Floats `children` next to `anchor`, below it or above when there's more room there, and
 * closes on Escape or a press outside. Rendered into <body>: the theme's tokens live on <html>.
 */
export function Popover({
  anchor,
  onClose,
  children,
}: {
  anchor: HTMLElement
  onClose: () => void
  children: React.ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<React.CSSProperties>({ opacity: 0 })
  const close = useRef(onClose)
  close.current = onClose

  useLayoutEffect(() => {
    const place = () => {
      const el = box.current
      if (!el) return
      const r = anchor.getBoundingClientRect()
      const width = Math.max(r.width, el.offsetWidth)
      const natural = el.scrollHeight
      const below = window.innerHeight - r.bottom - GAP - EDGE
      const above = r.top - GAP - EDGE
      const up = natural > below && above > below
      const maxHeight = Math.max(140, up ? above : below)
      const height = Math.min(natural, maxHeight)
      setStyle({
        top: up ? r.top - GAP - height : r.bottom + GAP,
        left: Math.min(Math.max(EDGE, r.left), window.innerWidth - width - EDGE),
        minWidth: r.width,
        maxHeight,
      })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor])

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (!box.current?.contains(t) && !anchor.contains(t)) close.current()
    }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  }, [anchor])

  return createPortal(
    <div
      ref={box}
      className="ui-popover"
      style={style}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          close.current()
          anchor.focus()
        }
        // Keep pad keys and Space (record) from firing while the menu has focus.
        e.stopPropagation()
      }}
    >
      {children}
    </div>,
    document.body,
  )
}

/** A list of options to pick one from, focused on open with the current one active. */
export function OptionList({
  groups,
  value,
  onSelect,
  label,
}: {
  groups: Group[]
  value: string
  onSelect: (value: string) => void
  label: string
}) {
  const flat = groups.flatMap((g) => g.options)
  const [active, setActive] = useState(() => initialIndex(flat, value))
  const list = useRef<HTMLDivElement>(null)
  const id = useId()

  useEffect(() => list.current?.focus({ preventScroll: true }), [])
  useEffect(() => {
    document.getElementById(`${id}-${active}`)?.scrollIntoView({ block: 'nearest' })
  }, [id, active])

  const pick = (i: number) => {
    const o = flat[i]
    if (o && !o.disabled) onSelect(o.value)
  }

  let index = -1
  return (
    <div
      ref={list}
      className="ui-options"
      role="listbox"
      aria-label={label}
      tabIndex={0}
      aria-activedescendant={`${id}-${active}`}
      onKeyDown={(e) => {
        const to = navKey(e.key, flat, active)
        if (to === undefined) return
        e.preventDefault()
        if (to === 'pick') pick(active)
        else setActive(to)
      }}
    >
      {groups.map((g, gi) => (
        <div key={gi} role="group" aria-label={g.label} className="ui-option-group">
          {g.label && (
            <div className="ui-option-label" aria-hidden>
              {g.label}
            </div>
          )}
          {g.options.map((o) => {
            const i = ++index
            return (
              <div
                key={o.value}
                id={`${id}-${i}`}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                className={`ui-option ${i === active ? 'is-active' : ''}`}
                onPointerMove={() => !o.disabled && i !== active && setActive(i)}
                onClick={() => pick(i)}
              >
                <span className="ui-option-main">
                  {o.dot && (
                    <span
                      className="ui-dot"
                      style={{ background: o.dot.color }}
                      title={o.dot.title}
                      aria-label={o.dot.title}
                    />
                  )}
                  {o.label}
                </span>
                {o.note && <span className="ui-option-note">{o.note}</span>}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

/** A soft select: a button showing the current option that opens an OptionList. */
export function Select({
  value,
  groups,
  onChange,
  label,
  className = '',
}: {
  value: string
  groups: Group[]
  onChange: (value: string) => void
  label: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const button = useRef<HTMLButtonElement>(null)
  const current = groups.flatMap((g) => g.options).find((o) => o.value === value)
  return (
    <>
      <button
        ref={button}
        type="button"
        className={`ui-select ${className}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? 'none'}`}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setOpen(true)
          }
        }}
      >
        <span>{current?.label ?? '—'}</span>
        <span className="ui-chevron" aria-hidden />
      </button>
      {open && button.current && (
        <Popover anchor={button.current} onClose={() => setOpen(false)}>
          <OptionList
            groups={groups}
            value={value}
            label={label}
            onSelect={(v) => {
              setOpen(false)
              button.current?.focus()
              onChange(v)
            }}
          />
        </Popover>
      )}
    </>
  )
}
