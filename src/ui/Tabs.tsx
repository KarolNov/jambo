import { type KeyboardEvent, type ReactNode, useId, useLayoutEffect, useRef, useState } from 'react'
import { stepIndex } from './listNav'
import { tabStep } from './tabFit'
import './ui.css'

export interface Tab {
  /** Stable id, unique among the tabs; it is also the value `onChange` reports. */
  id: string
  label: ReactNode
  /** What the panel shows while this tab is selected. */
  content: ReactNode
  disabled?: boolean
}

export type TabsProps = {
  tabs: Tab[]
  /** Names the tab strip for screen readers. */
  label: string
  /** The selected tab's id. Leave it out to let Tabs keep the selection itself. */
  value?: string
  /** Where an uncontrolled Tabs starts; the first enabled tab otherwise. */
  defaultValue?: string
  onChange?: (id: string) => void
  className?: string
}

/**
 * Folder tabs over one panel (`TabsProps`). The panel is a raised card and the selected tab grows
 * out of it as one surface, labelled in `--ui-c` (else `--accent-2`); the other tabs sit behind the
 * card. Where they don't fit, neighbouring tabs overlap a little (`tabStep`); past that the strip
 * scrolls sideways.
 * ← → move along the tabs and select as they go, Home and End jump to the ends; Tab moves from
 * the selected tab into the panel. Screen readers hear a tablist.
 */
export function Tabs({ tabs, label, value, defaultValue, onChange, className = '' }: TabsProps) {
  const base = useId()
  const [own, setOwn] = useState(
    () => defaultValue ?? tabs[stepIndex(tabs, -1, 1)]?.id ?? tabs[0]?.id,
  )
  const selected = value ?? own
  const index = Math.max(
    0,
    tabs.findIndex((t) => t.id === selected),
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const strip = useRef<HTMLDivElement>(null)

  // Fit the tabs to the strip: spaced while there is room, overlapping a little when there isn't.
  useLayoutEffect(() => {
    const el = strip.current
    if (!el) return
    const fit = () => {
      const style = getComputedStyle(el)
      const available =
        el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const tabEls = refs.current.slice(0, tabs.length).filter((t) => t !== null)
      const widths = tabEls.map((t) => t.offsetWidth)
      // Overlap no further than a tab's side padding, so every label stays readable.
      const padding = tabEls[0] ? parseFloat(getComputedStyle(tabEls[0]).paddingLeft) : 0
      el.style.setProperty('--tab-step', `${tabStep(widths, available, padding)}px`)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [tabs.length])

  const select = (i: number, focus = false) => {
    const tab = tabs[i]
    if (!tab || tab.disabled) return
    if (value === undefined) setOwn(tab.id)
    if (tab.id !== selected) onChange?.(tab.id)
    if (focus) refs.current[i]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const next =
      e.key === 'ArrowRight'
        ? stepIndex(tabs, index, 1)
        : e.key === 'ArrowLeft'
          ? stepIndex(tabs, index, -1)
          : e.key === 'Home'
            ? stepIndex(tabs, -1, 1)
            : e.key === 'End'
              ? stepIndex(tabs, tabs.length, -1)
              : undefined
    if (next === undefined) return
    e.preventDefault()
    select(next, true)
  }

  const current = tabs[index]
  return (
    <div className={`ui-tabs ${className}`}>
      <div
        ref={strip}
        className="ui-tablist"
        role="tablist"
        aria-label={label}
        onKeyDown={onKeyDown}
      >
        {tabs.map((t, i) => (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="tab"
            id={`${base}-tab-${i}`}
            aria-controls={`${base}-panel`}
            aria-selected={i === index}
            tabIndex={i === index ? 0 : -1}
            disabled={t.disabled}
            className="ui-tab"
            onClick={() => select(i)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div
        className="ui-tabpanel"
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${index}`}
        tabIndex={0}
      >
        {current?.content}
      </div>
    </div>
  )
}
