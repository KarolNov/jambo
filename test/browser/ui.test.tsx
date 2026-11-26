import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { board, BPM, CONTROL_KEYS } from '../../shared/board'
import { beatSeconds } from '../../shared/looper'
import About from '../../src/about/About'
import { Console } from '../../src/board/console/Console'
import { Deck } from '../../src/board/console/Deck'
import { Master } from '../../src/board/console/Master'
import { Mixer } from '../../src/board/console/Mixer'
import { masterAtom, tracksAtom } from '../../src/board/model'
import { controlKey } from '../../src/board/presence'
import type { Session } from '../../src/board/session'
import Showcase from '../../src/ds/Showcase'
import { SWATCHES } from '../../src/theme/palette'
import { ThemeToggle } from '../../src/theme/ThemeToggle'
import { Knob, ScrubField, Tabs, XYPad } from '../../src/ui'
import {
  addTrack,
  addUploads,
  agreeClock,
  endSession,
  makeSession,
  mockServer,
  renderJam,
  SLUG,
  Themed,
  upload,
  uploadId,
} from './jam'

const theme = () => document.documentElement.dataset.theme

/** The page's size before any test resizes it, put back after each one. */
const size = { width: window.innerWidth, height: window.innerHeight }

beforeEach(() => {
  localStorage.clear()
  mockServer()
})

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await page.viewport(size.width, size.height)
})

describe('knob', () => {
  /** A knob that keeps what it is given, as a board would. */
  function Owned({ start, onChange }: { start: number; onChange: (v: number) => void }) {
    const [value, setValue] = useState(start)
    return (
      <Knob
        label="Reverb"
        value={value}
        defaultValue={0}
        onChange={(v) => {
          onChange(v)
          setValue(v)
        }}
      />
    )
  }

  // @scenario ui: Reset
  it('returns to its default on a double-click', async () => {
    const onChange = vi.fn()
    await render(
      <Themed>
        <Owned start={0.6} onChange={onChange} />
      </Themed>,
    )
    const knob = page.getByRole('slider', { name: 'Reverb' })
    await userEvent.dblClick(knob, { force: true })
    expect(onChange).toHaveBeenCalledWith(0)
    await expect.element(knob).toHaveAttribute('aria-valuenow', '0')
  })
})

describe('scrub field', () => {
  /** Whether the mouse is still held, so a failed test doesn't leave it down for the next. */
  let pressed = false
  afterEach(async () => {
    if (pressed) await commands.mouseUp()
    pressed = false
  })

  // @scenario ui: Cancel
  it('shows its starting value and applies nothing on Escape mid-scrub', async () => {
    const onChange = vi.fn()
    await render(
      <Themed>
        <ScrubField label="BPM" aria-label="Tempo" value={100} onChange={onChange} />
      </Themed>,
    )
    const field = page.getByRole('textbox', { name: 'Tempo' })
    const at = await commands.mouseDown('.ui-scrub-label')
    pressed = true
    await commands.mouseMove(at.x + 40, at.y)
    // Mid-scrub it shows the scrubbed value...
    await expect
      .poll(() => Number((field.element() as HTMLInputElement).value))
      .toBeGreaterThan(100)
    // ...and Escape puts the start back, before the mouse is let go.
    await userEvent.keyboard('{Escape}')
    await expect.element(field).toHaveValue('100')
    await commands.mouseUp()
    pressed = false
    await expect.element(field).toHaveValue('100')
    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('theme switch', () => {
  const knobOffset = (container: HTMLElement) =>
    new DOMMatrix(getComputedStyle(container.querySelector('.ui-slide-carriage')!).transform).m41

  // @scenario ui: Theme switch
  it('slides its knob from the sun to the moon, and back', async () => {
    const { container } = await render(
      <Themed>
        <ThemeToggle />
      </Themed>,
    )
    const toggle = page.getByRole('switch', { name: 'Dark mode' })
    const sun = container.querySelector('.ui-slide-off')!
    const moon = container.querySelector('.ui-slide-on')!
    const dark = theme() === 'dark'
    const start = knobOffset(container)
    expect(getComputedStyle(dark ? moon : sun).visibility).toBe('visible')

    await userEvent.click(toggle)
    await expect.poll(() => knobOffset(container)).toBe(dark ? 0 : 28)
    expect(getComputedStyle(dark ? sun : moon).visibility).toBe('visible')
    expect(getComputedStyle(dark ? moon : sun).visibility).toBe('hidden')
    await expect.poll(theme).toBe(dark ? 'light' : 'dark')

    await userEvent.click(toggle)
    await expect.poll(() => knobOffset(container)).toBe(start)
    await expect.poll(theme).toBe(dark ? 'dark' : 'light')
  })

  // @scenario ui: Storage blocked
  it('switches the page even when the browser blocks storage', async () => {
    const blocked = () => {
      throw new DOMException('The operation is insecure.', 'SecurityError')
    }
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(blocked)
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(blocked)
    await render(
      <Themed>
        <ThemeToggle />
      </Themed>,
    )
    const before = theme()
    await userEvent.click(page.getByRole('switch', { name: 'Dark mode' }))
    await expect.poll(theme).toBe(before === 'dark' ? 'light' : 'dark')
    expect(set).toHaveBeenCalled()
  })
})

describe('metronome switch', () => {
  let session: Session
  afterEach(() => endSession(session))

  // @scenario ui: Flip the metronome
  it('tips to I and lights the I when tapped on', async () => {
    localStorage.setItem('jambo.metronome', '0')
    session = makeSession()
    const { screen } = await renderJam(<Deck slug={SLUG} />, session)
    const metronome = page.getByRole('switch', { name: 'Metronome' })
    await expect.element(metronome).not.toBeChecked()
    const plate = screen.container.querySelector('.ui-rocker-plate')!
    const i = screen.container.querySelector('.ui-rocker-i')!
    const tilt = () => new DOMMatrix(getComputedStyle(plate).transform)
    // rotateY(14deg) leans the O side down: its m13 is negative; tipped to I it is positive.
    expect(tilt().m13).toBeLessThan(0)
    expect(getComputedStyle(i).textShadow).toBe('none')

    await userEvent.click(metronome)
    await expect.element(metronome).toBeChecked()
    expect(session.engine.metronome).toBe(true)
    await expect.poll(() => tilt().m13).toBeGreaterThan(0)
    expect(getComputedStyle(i).textShadow).not.toBe('none')
  })

  // @scenario ui: Desktop
  it('flips on a laptop with no error and no tick', async () => {
    // Headless Chromium has a mouse and no touchscreen, like a laptop.
    expect(window.matchMedia('(any-pointer: coarse)').matches).toBe(false)
    const vibrate = vi.spyOn(Navigator.prototype, 'vibrate')
    const errors: unknown[] = []
    const onError = (e: ErrorEvent) => errors.push(e.error)
    window.addEventListener('error', onError)
    localStorage.setItem('jambo.metronome', '0')
    session = makeSession()
    await renderJam(<Deck slug={SLUG} />, session)
    const metronome = page.getByRole('switch', { name: 'Metronome' })

    await userEvent.click(metronome)
    await expect.element(metronome).toBeChecked()
    expect(session.engine.metronome).toBe(true)
    expect(vibrate).not.toHaveBeenCalled()
    window.removeEventListener('error', onError)
    expect(errors).toEqual([])
  })
})

describe('tabs', () => {
  const tab = (name: string) =>
    page.getByRole('tablist', { name: 'AI apps' }).getByRole('tab', { name, exact: true })

  // @scenario ui: Keyboard
  it('moves two tabs along on → →, showing its panel', async () => {
    await render(
      <Themed>
        <About />
      </Themed>,
    )
    await userEvent.click(tab('Claude'))
    await expect.element(tab('Claude')).toHaveFocus()
    await userEvent.keyboard('{ArrowRight}{ArrowRight}')
    await expect.element(tab('ChatGPT')).toHaveAttribute('aria-selected', 'true')
    await expect.element(tab('ChatGPT')).toHaveFocus()
    await expect.element(page.getByRole('tabpanel')).toHaveTextContent('chatgpt.com')
  })

  // @scenario ui: Wrap
  it('goes from Other, the last tab, to Claude on →', async () => {
    await page.viewport(1200, 800)
    await render(
      <Themed>
        <About />
      </Themed>,
    )
    await userEvent.click(tab('Other'))
    await expect.element(tab('Other')).toHaveAttribute('aria-selected', 'true')
    await userEvent.keyboard('{ArrowRight}')
    await expect.element(tab('Claude')).toHaveAttribute('aria-selected', 'true')
    await expect.element(tab('Claude')).toHaveFocus()
    await expect.element(page.getByRole('tabpanel')).toHaveTextContent('Add custom connector')
  })

  it('shows that a tab behind "+N" is on, on "+N" and in its menu', async () => {
    const { container } = await render(
      <Themed>
        <div style={{ width: 150 }}>
          <Tabs
            label="Modes"
            tabs={[
              { id: 'filter', label: 'Filter', content: null, dot: '' },
              { id: 'throw', label: 'Throw', content: null, dot: '' },
              { id: 'lofi', label: 'Lo-fi', content: null, dot: '' },
              { id: 'repeat', label: 'Repeat', content: null, dot: 'on' },
            ]}
          />
        </div>
      </Themed>,
    )
    const more = page.getByRole('button', { name: /more:/ })
    await expect.element(more).toHaveAccessibleName(/Repeat, on/)
    expect(container.querySelector('.ui-tab-more .ui-tab-dot.is-on')).not.toBeNull()
    await userEvent.click(more)
    await expect.element(page.getByRole('option', { name: /Repeat/ })).toHaveTextContent(/on/)
  })
})

describe('design showcase', () => {
  // @scenario ui: Try another colour
  it("paints the slider's lights, the knob's arc, the XY pad's puck, the switches and the focus rings in the picked colour", async () => {
    const { container } = await render(
      <Themed>
        <Showcase />
      </Themed>,
    )
    await userEvent.click(page.getByRole('button', { name: /^Collaborator colour:/ }))
    await userEvent.click(page.getByRole('option', { name: 'Coral' }))
    const coral = SWATCHES.coral[theme() as 'light' | 'dark']
    const prop = (el: Element, name: string, pseudo?: string) =>
      getComputedStyle(el, pseudo).getPropertyValue(name).trim()

    await expect.poll(() => prop(document.documentElement, '--focus')).toBe(coral)
    const leds = container.querySelector('.ui-fader-leds')!
    expect(prop(leds, '--led', '::after')).toBe(coral)
    const dial = container.querySelector('.ui-knob .ui-knob-dial')!
    expect(prop(dial, '--ui-c', '::before')).toBe(coral)
    const puck = container.querySelector('.ui-xy .ui-xy-puck')!
    expect(prop(puck, '--ui-c')).toBe(coral)
    // The switches, the primary button and the other accent tints, as in a jam.
    for (const el of [
      container.querySelector('.ui-switch')!,
      page.getByRole('button', { name: 'Tap to start audio' }).element(),
    ])
      expect(prop(el, '--accent-2')).toBe(coral)
  })

  it('paints Misty Yak amber when you pick violet, so they never look like you', async () => {
    const { container } = await render(
      <Themed>
        <Showcase />
      </Themed>,
    )
    const held = () => container.querySelector<HTMLElement>('.ui-knob.is-held')!
    const t = theme() as 'light' | 'dark'
    expect(held().style.getPropertyValue('--ui-held')).toBe(SWATCHES.violet[t])
    await userEvent.click(page.getByRole('button', { name: /^Collaborator colour:/ }))
    await userEvent.click(page.getByRole('option', { name: 'Violet' }))
    await expect.poll(() => held().style.getPropertyValue('--ui-held')).toBe(SWATCHES.amber[t])
  })
})

describe('pad', () => {
  let session: Session
  // The upload is still loading: its file never arrives.
  beforeEach(() => {
    mockServer((url) => (url.includes('/sounds/u-') ? new Promise<Response>(() => {}) : undefined))
  })
  afterEach(() => endSession(session))

  // @scenario ui: Screen reader
  it('reads as its key, its sound, then its uploader', async () => {
    session = makeSession('Groovy Otter')
    const id = uploadId(3)
    addUploads(session, [
      [id, upload({ name: 'Vox', author: 'misty-id', authorName: 'Misty Yak' })],
    ])
    session.board.pad('r1c0').assign(id)
    await renderJam(<Deck slug={SLUG} />, session)
    await expect
      .element(page.getByRole('button', { name: 'Q Vox, Uploaded by Misty Yak', exact: true }))
      .toBeInTheDocument()
  })

  // @scenario ui: Long upload name
  it('shows a 40-character upload name in two lines ending in …, beside its dot, clear of the key, on a phone', async () => {
    await page.viewport(375, 812)
    session = makeSession()
    const id = uploadId(4)
    const name = 'Warm analogue strings with a slow swells'
    expect(name).toHaveLength(40)
    addUploads(session, [[id, upload({ name })]])
    session.board.pad('r1c0').assign(id)
    const { screen } = await renderJam(<Console slug={SLUG} status="connected" />, session)
    const button = screen.container.querySelector<HTMLElement>('[aria-keyshortcuts="q"]')!
    const slot = button.closest('.ui-pad-slot')!
    const text = slot.querySelector<HTMLElement>('.ui-pad-sound-name')!
    const dot = slot.querySelector<HTMLElement>('.ui-pad-sound-line > .ui-dot')!

    // Two lines, clamped: the whole name doesn't fit, so it ends in an ellipsis.
    const lineHeight = parseFloat(getComputedStyle(text).lineHeight)
    expect(Math.round(text.clientHeight / lineHeight)).toBe(2)
    expect(text.scrollHeight).toBeGreaterThan(text.clientHeight)
    expect(getComputedStyle(text).webkitLineClamp).toBe('2')

    const t = text.getBoundingClientRect()
    const d = dot.getBoundingClientRect()
    const b = button.getBoundingClientRect()
    // Beside its dot, in a column of its own.
    expect(d.right).toBeLessThanOrEqual(t.left)
    expect(d.top).toBeGreaterThanOrEqual(t.top)
    expect(d.bottom).toBeLessThanOrEqual(t.bottom)
    // Under the pad, clear of its key.
    expect(t.top).toBeGreaterThanOrEqual(b.bottom)
    expect(t.right).toBeLessThanOrEqual(slot.getBoundingClientRect().right + 0.5)
  })
})

describe('your colour', () => {
  let session: Session
  afterEach(() => endSession(session))

  /** A swatch for the page's theme, as getComputedStyle writes colours. */
  const rgb = (color: keyof typeof SWATCHES) => {
    const hex = SWATCHES[color][theme() as 'dark' | 'light']
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
    return `rgb(${r}, ${g}, ${b})`
  }
  const tempoField = () => page.getByRole('textbox', { name: 'Tempo in BPM' })

  // @scenario board/session: Tab through controls
  it('rings the focused tempo field in your colour', async () => {
    session = makeSession('Misty Yak', 'sky')
    await renderJam(<Console slug={SLUG} status="connected" />, session)
    await userEvent.click(tempoField())
    await expect.element(tempoField()).toHaveFocus()
    expect(getComputedStyle(tempoField().element()).boxShadow).toContain(rgb('sky'))
  })

  // @scenario board/session: Hover and switches
  it('lights hovers and a switch that is on in your colour', async () => {
    localStorage.setItem('jambo.metronome', '1')
    session = makeSession('Misty Yak', 'amber')
    const { screen } = await renderJam(<Console slug={SLUG} status="connected" />, session)
    await expect.element(page.getByRole('switch', { name: 'Metronome' })).toBeChecked()
    const i = screen.container.querySelector('.ui-rocker-i')!
    expect(getComputedStyle(i).color).toBe(rgb('amber'))

    const changeSounds = page.getByRole('button', { name: 'Change sounds' })
    await userEvent.hover(changeSounds)
    await expect.poll(() => getComputedStyle(changeSounds.element()).color).toBe(rgb('amber'))
  })

  // @scenario board/session: Leave the jam
  it("goes back to the theme's accent when you leave the jam", async () => {
    const accent = () => ({
      focus: getComputedStyle(document.documentElement).getPropertyValue('--focus'),
      accent2: getComputedStyle(document.body).getPropertyValue('--accent-2'),
    })
    session = makeSession('Misty Yak', 'violet')
    // The themed page without a jam: the theme's own accent.
    const themed = await render(<Themed>{null}</Themed>)
    const before = accent()
    await themed.unmount()

    const { screen } = await renderJam(<Console slug={SLUG} status="connected" />, session)
    expect(accent().accent2.toLowerCase()).toBe(SWATCHES.violet[theme() as 'dark' | 'light'])
    await screen.unmount()
    await render(<Themed>{null}</Themed>)
    expect(accent()).toEqual(before)
  })
})

describe('someone else moving a control', () => {
  let session: Session
  let pressed = false
  afterEach(async () => {
    if (pressed) await commands.mouseUp()
    pressed = false
    endSession(session)
  })

  const misty = { id: 'misty-id', name: 'Misty Yak', color: 'coral' } as const
  /** Misty Yak, in another browser, holding `control` of track `id`: their presence reaches this one. */
  function mistyHolds(id: string, control: string, clientID?: number) {
    mistyHoldsKey(controlKey(id, control), clientID)
  }
  /** Misty Yak, in another browser, holding the control presence names `key`. */
  function mistyHoldsKey(key: string, clientID?: number) {
    const doc = new Y.Doc()
    if (clientID !== undefined) doc.clientID = clientID
    const theirs = new Awareness(doc)
    theirs.setLocalState({ person: misty, control: key })
    applyAwarenessUpdate(
      session.jam.awareness,
      encodeAwarenessUpdate(theirs, [theirs.clientID]),
      'remote',
    )
  }
  const coral = () => SWATCHES.coral[theme() as 'dark' | 'light']

  // @scenario ui: Watch someone turn a knob
  it('lights a knob in their colour, names them in its bubble, and follows their value', async () => {
    session = makeSession('Groovy Otter')
    const id = addTrack(session, { name: 'Bassline', reverb: 0.2 })
    await renderJam(<Mixer />, session)
    await userEvent.click(page.getByRole('button', { name: 'Effects' }))
    const knob = page.getByRole('slider', { name: 'Reverb of Bassline' })
    await expect.element(knob).toHaveAttribute('aria-valuenow', '0.2')

    mistyHolds(id, 'reverb')
    expect(
      board(session.jam.doc, { kind: 'user', id: misty.id }).track(id).set({ reverb: 0.6 }).ok,
    ).toBe(true)

    await expect.element(knob).toHaveAttribute('aria-valuenow', '0.6')
    const wrap = knob.element().closest<HTMLElement>('.ui-knob')!
    await expect.poll(() => wrap.classList.contains('is-held')).toBe(true)
    expect(wrap.style.getPropertyValue('--ui-held')).toBe(coral())
    // Its arc is lit in their colour, not the loop's.
    expect(wrap.style.getPropertyValue('--ui-c')).toBe(coral())
    expect(wrap.querySelector('.ui-knob-bubble')!.textContent).toBe('Misty Yak')
    expect(Number(wrap.style.getPropertyValue('--f'))).toBeCloseTo(0.6)
  })

  // @scenario ui: Try to drag it
  // @scenario board/session: Held by someone else
  it("doesn't move a loop's level Misty Yak is dragging, by pointer or by key", async () => {
    session = makeSession('Groovy Otter')
    const id = addTrack(session, { name: 'Bassline', gain: 0.5 })
    const { screen } = await renderJam(<Mixer />, session)
    mistyHolds(id, 'gain')
    const fader = () => screen.container.querySelector<HTMLElement>('.ui-fader')!
    const slider = page.getByRole('slider', { name: 'Level of Bassline' })
    await expect.poll(() => fader().classList.contains('is-held')).toBe(true)
    await expect.element(slider).toHaveAttribute('aria-disabled', 'true')

    const at = await commands.mouseDown('input[aria-label="Level of Bassline"]')
    pressed = true
    await commands.mouseMove(at.x + 40, at.y, 4)
    await commands.mouseUp()
    pressed = false
    expect(fader().classList.contains('is-dragging')).toBe(false)
    // You never held it, and nothing reached the board.
    expect(session.jam.awareness.getLocalState()?.control).toBeUndefined()
    expect(session.jam.store.get(tracksAtom).get(id)?.gain).toBe(0.5)
    await expect.element(slider).toHaveValue('0.5')

    await userEvent.keyboard('{ArrowUp}')
    expect(session.jam.store.get(tracksAtom).get(id)?.gain).toBe(0.5)
    // It stays in Misty's colour.
    expect(fader().classList.contains('is-held')).toBe(true)
    expect(fader().style.getPropertyValue('--ui-c')).toBe(coral())
  })

  it("doesn't turn a knob Misty Yak is turning, by key or by double-click", async () => {
    session = makeSession('Groovy Otter')
    const id = addTrack(session, { name: 'Bassline', reverb: 0.2 })
    await renderJam(<Mixer />, session)
    await userEvent.click(page.getByRole('button', { name: 'Effects' }))
    const knob = page.getByRole('slider', { name: 'Reverb of Bassline' })
    mistyHolds(id, 'reverb')
    await expect.element(knob).toHaveAttribute('aria-disabled', 'true')
    knob.element().focus()
    await userEvent.keyboard('{ArrowUp}')
    await userEvent.dblClick(knob, { force: true })
    expect(session.jam.store.get(tracksAtom).get(id)?.reverb).toBe(0.2)
  })

  // @scenario board/session: Grab at once
  it('ends your drag where it is when someone with a lower client id grabbed it at the same time', async () => {
    session = makeSession('Groovy Otter')
    const id = addTrack(session, { name: 'Bassline', gain: 0.5 })
    const { screen } = await renderJam(<Mixer />, session)
    const fader = () => screen.container.querySelector<HTMLElement>('.ui-fader')!

    const at = await commands.mouseDown('input[aria-label="Level of Bassline"]')
    pressed = true
    await commands.mouseMove(at.x + 30, at.y)
    await expect.poll(() => fader().classList.contains('is-dragging')).toBe(true)
    const key = controlKey(id, 'gain')
    await expect.poll(() => session.jam.awareness.getLocalState()?.control).toBe(key)
    await expect.poll(() => session.jam.store.get(tracksAtom).get(id)?.gain).not.toBe(0.5)

    // Misty grabbed it in the same moment from a lower client id, and turns it to 1.2.
    mistyHolds(id, 'gain', 1)
    expect(
      board(session.jam.doc, { kind: 'user', id: misty.id }).track(id).set({ gain: 1.2 }).ok,
    ).toBe(true)
    await expect.poll(() => fader().classList.contains('is-dragging')).toBe(false)
    expect(fader().classList.contains('is-held')).toBe(true)
    // You let go of it for everyone...
    await expect.poll(() => session.jam.awareness.getLocalState()?.control).toBeUndefined()
    // ...and the rest of your press moves nothing, so their value stays.
    await commands.mouseMove(at.x - 60, at.y, 4)
    await commands.mouseUp()
    pressed = false
    expect(session.jam.store.get(tracksAtom).get(id)?.gain).toBe(1.2)
    await expect.element(page.getByRole('slider', { name: 'Level of Bassline' })).toHaveValue('1.2')
  })

  // @scenario board/session: Held by someone else
  it("doesn't move the touchpad's Filter while Misty Yak holds it, by pointer, key or reset", async () => {
    session = makeSession('Groovy Otter')
    const misty_ = board(session.jam.doc, { kind: 'user', id: misty.id })
    expect(misty_.fx('filter').set(-0.4, 0.3).ok).toBe(true)
    const { screen } = await renderJam(<Master />, session)
    mistyHoldsKey(CONTROL_KEYS.fx('filter'))
    const pad = () => screen.container.querySelector<HTMLElement>('.ui-xy')!
    const cutoff = page.getByRole('slider', { name: 'Filter cutoff' })
    await expect.poll(() => pad().classList.contains('is-held')).toBe(true)
    expect(pad().style.getPropertyValue('--ui-held')).toBe(coral())
    expect(pad().querySelector('.ui-xy-bubble')!.textContent).toBe('Misty Yak')
    // The puck and its lines are Misty's.
    expect(pad().style.getPropertyValue('--ui-c')).toBe(coral())
    await expect.element(cutoff).toHaveAttribute('aria-disabled', 'true')
    await expect.element(page.getByRole('button', { name: 'Reset Filter' })).toBeDisabled()

    const at = await commands.mouseDown('.ui-xy-surface')
    pressed = true
    await commands.mouseMove(at.x + 60, at.y - 60, 4)
    await commands.mouseUp()
    pressed = false
    cutoff.element().focus()
    await userEvent.keyboard('{ArrowRight}{ArrowUp}')
    expect(session.jam.store.get(masterAtom).filter).toEqual({ x: -0.4, y: 0.3 })
    expect(session.jam.awareness.getLocalState()?.control).toBeUndefined()

    // Misty moves it: you see it move, still locked.
    expect(misty_.fx('filter').set(-0.8, 0.5).ok).toBe(true)
    await expect.element(cutoff).toHaveAttribute('aria-valuenow', '-0.8')
    expect(pad().classList.contains('is-held')).toBe(true)
  })

  // @scenario board/session: Different controls
  it('leaves Throw free while Misty Yak holds Filter', async () => {
    session = makeSession('Groovy Otter')
    await renderJam(<Master />, session)
    mistyHoldsKey(CONTROL_KEYS.fx('filter'))
    await expect
      .element(page.getByRole('slider', { name: 'Filter cutoff' }))
      .toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(page.getByRole('tab', { name: /^Throw/ }))
    const send = page.getByRole('slider', { name: 'Throw send' })
    await expect.element(send).not.toHaveAttribute('aria-disabled', 'true')
    send.element().focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(session.jam.store.get(masterAtom).throw.y).toBeGreaterThan(0)
  })
})

describe('xy pad', () => {
  /** A pad that keeps what it is given, as a board would. */
  function Owned({
    start,
    onChange,
    live,
  }: {
    start: [number, number]
    onChange: (x: number, y: number) => void
    live?: boolean
  }) {
    const [[x, y], setXY] = useState(start)
    return (
      <XYPad
        label="Filter"
        x={x}
        y={y}
        live={live}
        xAxis={{ label: 'Cutoff', min: -1, max: 1 }}
        yAxis={{ label: 'Resonance' }}
        onChange={(nx, ny) => {
          onChange(nx, ny)
          setXY([nx, ny])
        }}
      />
    )
  }
  let pressed = false
  afterEach(async () => {
    if (pressed) await commands.mouseUp()
    pressed = false
  })
  const cutoff = () => page.getByRole('slider', { name: 'Cutoff' })
  const resonance = () => page.getByRole('slider', { name: 'Resonance' })

  // @scenario ui: Drag the puck
  it('follows a drag from the middle to the top-left corner, and stays there when released', async () => {
    const onChange = vi.fn()
    const { container } = await render(
      <Themed>
        <Owned start={[0.5, 0.2]} onChange={onChange} />
      </Themed>,
    )
    await expect.element(page.getByRole('group', { name: 'Filter' })).toBeVisible()
    const at = await commands.mouseDown('.ui-xy-surface')
    pressed = true
    // Pressing the middle puts the puck there.
    await expect.element(cutoff()).toHaveAttribute('aria-valuenow', '0')
    await expect.element(resonance()).toHaveAttribute('aria-valuenow', '0.5')
    await commands.mouseMove(at.x - 150, at.y - 150, 6)
    await expect.element(cutoff()).toHaveAttribute('aria-valuenow', '-1')
    await expect.element(resonance()).toHaveAttribute('aria-valuenow', '1')
    // Not live: nothing applied until it is let go, then once.
    expect(onChange).not.toHaveBeenCalled()
    await commands.mouseUp()
    pressed = false
    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenCalledWith(-1, 1)
    const pad = container.querySelector<HTMLElement>('.ui-xy')!
    expect(pad.classList.contains('is-dragging')).toBe(false)
    expect(Number(pad.style.getPropertyValue('--fx'))).toBe(0)
    expect(Number(pad.style.getPropertyValue('--fy'))).toBe(1)
  })

  // @scenario ui: Move the puck by key
  it('moves Y up a step on ↑ and X on →, ten with Shift', async () => {
    const onChange = vi.fn()
    await render(
      <Themed>
        <Owned start={[0, 0.5]} onChange={onChange} />
      </Themed>,
    )
    cutoff().element().focus()
    await userEvent.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(0, 0.51)
    await expect.element(resonance()).toHaveAttribute('aria-valuenow', '0.51')
    await userEvent.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith(0.01, 0.51)
    await userEvent.keyboard('{Shift>}{ArrowDown}{/Shift}')
    expect(onChange).toHaveBeenLastCalledWith(0.01, 0.41)
  })

  it('moves diagonally with two arrows held, and announces the axis that has no focus', async () => {
    const onChange = vi.fn()
    const { container } = await render(
      <Themed>
        <Owned start={[0, 0.5]} onChange={onChange} />
      </Themed>,
    )
    cutoff().element().focus()
    await userEvent.keyboard('{ArrowRight>}{ArrowUp>}')
    expect(onChange).toHaveBeenLastCalledWith(0.02, 0.51)
    await userEvent.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(0.03, 0.52)
    await userEvent.keyboard('{/ArrowUp}{/ArrowRight}')
    await userEvent.keyboard('{ArrowUp}')
    expect(onChange).toHaveBeenLastCalledWith(0.03, 0.53)
    expect(container.querySelector('.ui-xy-announce')!.textContent).toBe('Resonance 0.53')
  })

  it('applies a live drag as it moves, and puts it back on Escape', async () => {
    const onChange = vi.fn()
    await render(
      <Themed>
        <Owned start={[0.5, 0.2]} onChange={onChange} live />
      </Themed>,
    )
    const at = await commands.mouseDown('.ui-xy-surface')
    pressed = true
    await commands.mouseMove(at.x - 150, at.y - 150, 6)
    await expect.poll(() => onChange.mock.lastCall).toEqual([-1, 1])
    await userEvent.keyboard('{Escape}')
    expect(onChange).toHaveBeenLastCalledWith(0.5, 0.2)
    await expect.element(cutoff()).toHaveAttribute('aria-valuenow', '0.5')
    // The rest of the press moves nothing.
    await commands.mouseMove(at.x + 40, at.y, 4)
    await commands.mouseUp()
    pressed = false
    expect(onChange).toHaveBeenLastCalledWith(0.5, 0.2)
  })
})

describe('touchpad', () => {
  let session: Session
  afterEach(() => endSession(session))

  // @scenario audio/master: Reset
  it('shows a dot on Filter while it is latched away from 0/0, and its reset puts it back for everyone', async () => {
    session = makeSession('Groovy Otter')
    const { screen } = await renderJam(<Master />, session)
    const tab = page.getByRole('tab', { name: /^Filter/ })
    await expect.element(tab).toHaveAttribute('aria-selected', 'true')
    const dot = () => screen.container.querySelector('.ui-tab-dot')!
    expect(dot().classList.contains('is-on')).toBe(false)
    const reset = page.getByRole('button', { name: 'Reset Filter' })
    await expect.element(reset).toBeDisabled()

    // Someone latches Filter at x 0.6.
    const other = board(session.jam.doc, { kind: 'user', id: 'misty-id' })
    expect(other.fx('filter').set(0.6, 0).ok).toBe(true)
    await expect.element(tab).toHaveAccessibleName('Filter, on')
    expect(dot().classList.contains('is-on')).toBe(true)
    await expect
      .element(page.getByRole('slider', { name: 'Filter cutoff' }))
      .toHaveAttribute('aria-valuetext', 'High-pass 60%')

    await userEvent.click(reset)
    expect(session.jam.store.get(masterAtom).filter).toEqual({ x: 0, y: 0 })
    await expect.element(tab).toHaveAccessibleName('Filter')
    expect(dot().classList.contains('is-on')).toBe(false)
  })

  // @scenario audio/master: Reset
  it("shows Throw's and Lo-fi's positions as they read, and resets Lo-fi for everyone", async () => {
    session = makeSession('Groovy Otter')
    await renderJam(<Master />, session)
    const other = board(session.jam.doc, { kind: 'user', id: 'misty-id' })
    expect(other.fx('throw').set(0.9, 0.8).ok).toBe(true)
    expect(other.fx('lofi').set(0.7, 0.8).ok).toBe(true)
    await expect.element(page.getByRole('tab', { name: 'Throw, on' })).toBeVisible()
    const lofi = page.getByRole('tab', { name: 'Lo-fi, on' })
    await expect.element(lofi).toBeVisible()

    await userEvent.click(page.getByRole('tab', { name: /^Throw/ }))
    await expect
      .element(page.getByRole('slider', { name: 'Throw time' }))
      .toHaveAttribute('aria-valuetext', '1/4 echo')
    await expect
      .element(page.getByRole('slider', { name: 'Throw send' }))
      .toHaveAttribute('aria-valuetext', '80%')

    await userEvent.click(lofi)
    await expect
      .element(page.getByRole('slider', { name: 'Lo-fi bits' }))
      .toHaveAttribute('aria-valuetext', '6-bit')
    await userEvent.click(page.getByRole('button', { name: 'Reset Lo-fi' }))
    expect(session.jam.store.get(masterAtom).lofi).toEqual({ x: 0, y: 0 })
    await expect.element(page.getByRole('tab', { name: 'Lo-fi' })).toBeVisible()
    // Throw stays where it was.
    expect(session.jam.store.get(masterAtom).throw).toEqual({ x: 0.9, y: 0.8 })
  })

  // @scenario audio/master: On the grid for whoever steers
  it("engages Repeat at the slice's next grid line and lets go at the next 1/16, storing that beat", async () => {
    session = makeSession('Groovy Otter')
    await renderJam(<Master />, session)
    await userEvent.click(page.getByRole('tab', { name: /^Repeat/ }))
    const level = page.getByRole('slider', { name: 'Repeat level' })
    await expect.element(level).toHaveAttribute('aria-valuetext', 'Off')
    await expect
      .element(page.getByRole('slider', { name: 'Repeat slice' }))
      .toHaveAttribute('aria-valuetext', '1/4 slice')
    // Repeat stamps from the jam's clock, so this one has agreed with the room.
    session.engine.clock.offset = 0
    const beat = () => session.engine.clock.now()! / beatSeconds(BPM.default) / 1000
    level.element().focus()
    let before = beat()
    await userEvent.keyboard('{ArrowUp}')
    const on = session.jam.store.get(masterAtom).repeat
    expect(on.y).toBeGreaterThan(0)
    // The 1/4 slice starts on the next whole jam beat.
    expect(Number.isInteger(on.startBeat)).toBe(true)
    expect(on.startBeat).toBeGreaterThanOrEqual(before)
    expect(on.startBeat).toBeLessThanOrEqual(beat() + 1)
    await expect.element(page.getByRole('tab', { name: 'Repeat, on' })).toBeVisible()

    before = beat()
    await userEvent.click(page.getByRole('button', { name: 'Reset Repeat' }))
    const off = session.jam.store.get(masterAtom).repeat
    expect(off).toMatchObject({ x: 0, y: 0 })
    expect(Number.isInteger(off.startBeat * 4)).toBe(true)
    expect(off.startBeat).toBeGreaterThanOrEqual(before)
    expect(off.startBeat).toBeLessThanOrEqual(beat() + 0.25)
  })

  // @scenario audio/master: Latched
  it('latches Filter where a drag lets go, holding it only while dragging', async () => {
    session = makeSession('Groovy Otter')
    await renderJam(<Master />, session)
    const at = await commands.mouseDown('.console-touchpad .ui-xy-surface')
    await expect
      .poll(() => session.jam.awareness.getLocalState()?.control)
      .toBe(CONTROL_KEYS.fx('filter'))
    await commands.mouseMove(at.x - 55, at.y + 20, 4)
    await commands.mouseUp()
    await expect.poll(() => session.jam.awareness.getLocalState()?.control).toBeUndefined()
    const { x, y } = session.jam.store.get(masterAtom).filter
    expect(x).toBeLessThan(-0.3)
    expect(y).toBeLessThan(0.5)
    await expect
      .element(page.getByRole('slider', { name: 'Filter cutoff' }))
      .toHaveAttribute('aria-valuenow', String(x))
  })
})

describe('about link', () => {
  let session: Session
  afterEach(() => endSession(session))

  // @scenario board/session: Open about from a jam
  it('opens /about in a new tab, leaving the jam playing', async () => {
    session = makeSession()
    addTrack(session)
    agreeClock(session)
    await renderJam(<Console slug={SLUG} status="connected" />, session)
    await session.engine.unlock()
    const link = page.getByRole('link', { name: 'About · Add your AI' })
    await expect.element(link).toHaveAttribute('href', '/about')
    await expect.element(link).toHaveAttribute('target', '_blank')
    await expect.element(link).toHaveAttribute('rel', 'noopener')

    // Follow it, but keep the new tab out of the test run.
    const clicked = vi.fn((e: MouseEvent) => e.preventDefault())
    document.addEventListener('click', clicked, { once: true })
    try {
      await userEvent.click(link)
    } finally {
      document.removeEventListener('click', clicked)
    }
    expect(clicked).toHaveBeenCalled()
    // The jam is still here, and its audio still running.
    await expect.element(page.getByRole('group', { name: 'Pads' })).toBeVisible()
    expect(session.engine['ctx']?.state).toBe('running')
    expect(session.engine.ready).toBe(true)
  })
})
