import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, page, userEvent } from 'vitest/browser'
import { render } from 'vitest-browser-react'
import { Awareness, applyAwarenessUpdate, encodeAwarenessUpdate } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { board } from '../../shared/board'
import About from '../../src/about/About'
import { Console } from '../../src/board/console/Console'
import { Deck } from '../../src/board/console/Deck'
import { Mixer } from '../../src/board/console/Mixer'
import { tracksAtom } from '../../src/board/model'
import { controlKey } from '../../src/board/presence'
import type { Session } from '../../src/board/session'
import Showcase from '../../src/ds/Showcase'
import { SWATCHES } from '../../src/theme/palette'
import { ThemeToggle } from '../../src/theme/ThemeToggle'
import { Knob, ScrubField } from '../../src/ui'
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
    await userEvent.dblClick(knob)
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
})

describe('design showcase', () => {
  // @scenario ui: Try another colour
  it("paints the slider's lights, the knob's arc, the switches and the focus rings in the picked colour", async () => {
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
  function mistyHolds(id: string, control: string) {
    const theirs = new Awareness(new Y.Doc())
    theirs.setLocalState({ person: misty, control: controlKey(id, control) })
    applyAwarenessUpdate(
      session.jam.awareness,
      encodeAwarenessUpdate(theirs, [theirs.clientID]),
      'remote',
    )
  }
  const coral = () => SWATCHES.coral[theme() as 'dark' | 'light']

  // @scenario ui: Watch someone turn a knob
  it('rings a knob in their colour, names them in its bubble, and follows their value', async () => {
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
    expect(wrap.querySelector('.ui-knob-bubble')!.textContent).toBe('Misty Yak')
    expect(Number(wrap.style.getPropertyValue('--f'))).toBeCloseTo(0.6)
  })

  // @scenario ui: Drag it too
  it('shows your own value in the bubble while you drag a slider they hold, keeping their ring', async () => {
    session = makeSession('Groovy Otter')
    const id = addTrack(session, { name: 'Bassline', gain: 0.5 })
    const { screen } = await renderJam(<Mixer />, session)
    mistyHolds(id, 'gain')
    const fader = () => screen.container.querySelector<HTMLElement>('.ui-fader')!
    const bubble = () => fader().querySelector('.ui-fader-bubble')!.textContent
    await expect.poll(bubble).toBe('Misty Yak')

    const at = await commands.mouseDown('input[aria-label="Level of Bassline"]')
    pressed = true
    await commands.mouseMove(at.x + 20, at.y)
    await expect.poll(() => fader().classList.contains('is-dragging')).toBe(true)
    expect(bubble()).not.toBe('Misty Yak')
    expect(bubble()).toBe(
      page
        .getByRole('slider', { name: 'Level of Bassline' })
        .element()
        .getAttribute('aria-valuetext'),
    )
    expect(fader().classList.contains('is-held')).toBe(true)
    expect(fader().style.getPropertyValue('--ui-held')).toBe(coral())
  })

  // @scenario board/session: Both at once
  it("lets you drag a loop's level Misty Yak is dragging, showing their ring while you do", async () => {
    session = makeSession('Groovy Otter')
    const id = addTrack(session, { name: 'Bassline', gain: 0.5 })
    const { screen } = await renderJam(<Mixer />, session)
    mistyHolds(id, 'gain')
    const fader = () => screen.container.querySelector<HTMLElement>('.ui-fader')!
    await expect.poll(() => fader().classList.contains('is-held')).toBe(true)

    const at = await commands.mouseDown('input[aria-label="Level of Bassline"]')
    pressed = true
    await commands.mouseMove(at.x + 30, at.y)
    await expect.poll(() => fader().classList.contains('is-dragging')).toBe(true)
    // Their ring stays on while you drag.
    expect(fader().classList.contains('is-held')).toBe(true)
    expect(fader().style.getPropertyValue('--ui-held')).toBe(coral())
    await commands.mouseUp()
    pressed = false
    // Nothing stopped you: your drag reached the board.
    await expect.poll(() => session.jam.store.get(tracksAtom).get(id)?.gain).not.toBe(0.5)
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
