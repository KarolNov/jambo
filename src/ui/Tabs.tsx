import {
  type KeyboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import { stepIndex } from './listNav'
import { OptionList, Popover } from './Menu'
import { visibleTabs } from './tabFit'
import './ui.css'

/** What can take focus from the keyboard. */
const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'

export interface Tab {
  /** Stable id, unique among the tabs; it is also the value `onChange` reports. */
  id: string
  /** The tab's name, on the tab and in the "+N" menu. */
  label: string
  /** What the panel shows while this tab is selected. */
  content: ReactNode
  disabled?: boolean
  /**
   * A dot after the label that says the tab's content is on, such as a touchpad mode that sounds.
   * Give it the words a screen reader hears for the dot ("on"), or '' to keep the dot's room
   * without showing it (so the tab keeps its width as the dot comes and goes); leave it out for none.
   */
  dot?: string
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
 * Folder tabs over one panel (`TabsProps`). The panel is a raised card and the selected tab is
 * part of it, labelled in `--ui-c` (else `--accent-2`); the other tabs sit behind the card. Tabs
 * that don't fit go behind a "+N" tab that opens a menu of them (`visibleTabs`); the selected tab
 * always shows. ← → move through every tab, shown or not, and select as they go; Home and End
 * jump to the ends; Tab moves on to "+N", then into the panel: to its first control, or to the panel
 * itself when it has none. Screen readers hear a tablist.
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

  const strip = useRef<HTMLDivElement>(null)
  const measure = useRef<HTMLDivElement>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const focusAfter = useRef<string>(undefined)
  const [widths, setWidths] = useState<{ tabs: number[]; more: number; available: number }>()
  const [menu, setMenu] = useState(false)

  // Measure every tab once (in a hidden copy of the strip) and the strip's width as it changes.
  useLayoutEffect(() => {
    const el = strip.current
    const copy = measure.current
    if (!el || !copy) return
    const fit = () => {
      const style = getComputedStyle(el)
      const available =
        el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
      const buttons = [...copy.children] as HTMLElement[]
      const more = buttons.pop()?.offsetWidth ?? 0
      setWidths({ tabs: buttons.map((b) => b.offsetWidth), more, available })
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  }, [tabs])

  const shown = widths
    ? visibleTabs(widths.tabs, index, widths.available, widths.more)
    : tabs.map((_, i) => i)
  const hidden = tabs.filter((_, i) => !shown.includes(i))
  // A tab's name with what its dot says ("Filter, on"), and whether any tab has a dot: "+N" shows
  // one, lit when a hidden tab's is, so a tab that is on still shows behind it.
  const named = (t: Tab) => (t.dot ? `${t.label}, ${t.dot}` : t.label)
  const dotted = tabs.some((t) => t.dot !== undefined)

  // The panel is a stop for Tab only when nothing in it takes focus, so text can be scrolled and
  // read from the keyboard; a panel of controls goes straight from the tab to its first control.
  useLayoutEffect(() => {
    const el = panel.current
    if (!el) return
    if (el.querySelector(FOCUSABLE)) el.removeAttribute('tabindex')
    else el.tabIndex = 0
  })

  // A key moved to a tab: focus it once it's on screen (it may just have come out of "+N").
  useEffect(() => {
    if (!focusAfter.current) return
    refs.current.get(focusAfter.current)?.focus()
    focusAfter.current = undefined
  })

  const select = (i: number, focus = false) => {
    const tab = tabs[i]
    if (!tab || tab.disabled) return
    if (value === undefined) setOwn(tab.id)
    if (tab.id !== selected) onChange?.(tab.id)
    if (focus) focusAfter.current = tab.id
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
      <div className="ui-tabstrip" ref={strip}>
        <div className="ui-tablist" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
          {shown.map((i) => {
            const t = tabs[i]!
            return (
              <button
                key={t.id}
                ref={(el) => {
                  if (el) refs.current.set(t.id, el)
                  else refs.current.delete(t.id)
                }}
                type="button"
                role="tab"
                id={`${base}-tab-${i}`}
                aria-controls={`${base}-panel`}
                aria-selected={i === index}
                tabIndex={i === index ? 0 : -1}
                disabled={t.disabled}
                aria-label={t.dot ? named(t) : undefined}
                className="ui-tab"
                onClick={() => select(i)}
              >
                <span className="ui-tab-label">
                  {t.label}
                  {t.dot !== undefined && (
                    <span className={`ui-tab-dot ${t.dot ? 'is-on' : ''}`} aria-hidden />
                  )}
                </span>
              </button>
            )
          })}
        </div>
        {hidden.length > 0 && (
          <button
            ref={moreButton}
            type="button"
            className="ui-tab ui-tab-more"
            aria-haspopup="listbox"
            aria-expanded={menu}
            aria-label={`${hidden.length} more: ${hidden.map(named).join('; ')}`}
            title={hidden.map(named).join('; ')}
            onClick={() => setMenu((m) => !m)}
          >
            +{hidden.length}
            {dotted && (
              <span
                className={`ui-tab-dot ${hidden.some((t) => t.dot) ? 'is-on' : ''}`}
                aria-hidden
              />
            )}
          </button>
        )}
        {/* A hidden copy of every tab and the widest "+N", to measure what fits. */}
        <div className="ui-tabstrip-measure" ref={measure} aria-hidden>
          {tabs.map((t) => (
            <span key={t.id} className="ui-tab">
              {t.label}
              {t.dot !== undefined && <span className="ui-tab-dot" />}
            </span>
          ))}
          <span className="ui-tab ui-tab-more">
            +{tabs.length}
            {dotted && <span className="ui-tab-dot" />}
          </span>
        </div>
      </div>
      {menu && moreButton.current && (
        <Popover anchor={moreButton.current} onClose={() => setMenu(false)}>
          <OptionList
            label={`More of ${label}`}
            value={selected ?? ''}
            groups={[
              {
                options: hidden.map((t) => ({
                  value: t.id,
                  label: t.label,
                  note: t.dot || undefined,
                  disabled: t.disabled,
                })),
              },
            ]}
            onSelect={(id) => {
              setMenu(false)
              select(
                tabs.findIndex((t) => t.id === id),
                true,
              )
            }}
          />
        </Popover>
      )}
      <div
        ref={panel}
        className="ui-tabpanel"
        role="tabpanel"
        id={`${base}-panel`}
        aria-labelledby={`${base}-tab-${index}`}
      >
        {current?.content}
      </div>
    </div>
  )
}
